"use client";
/**
 * Queue printing across printers: route each queue item to a printer, print,
 * and remember runs that stopped part-way so they can continue from label N.
 */
import { create } from "zustand";
import { routeItems, type Label, type Library } from "@labebal/core";
import { PrintStoppedError, printLabels, type PrintContext, type PrintOptions, type PrintOutcome } from "../labels/print";
import type { QueueItem } from "../labels/store";
import type { PrinterTarget } from "./targets";

/** A run that was cancelled or failed; kept for this tab session only. */
export interface StoppedRun {
  id: string;
  /** Connection id it ran on. */
  printerId: string;
  /** Physical printer (serial), to find it again after reconnecting. */
  printerKey?: string | null;
  printerName: string;
  items: { labelId: string; qty: number }[];
  ctx: PrintContext;
  opts: Pick<PrintOptions, "collation" | "range" | "seqStart" | "source" | "printValues">;
  outcome: PrintOutcome;
  /** Queue entries the run came from (removed from the queue once it completes). */
  queueIds?: string[];
  at: number;
}

interface RunState {
  stopped: StoppedRun[];
  add: (r: StoppedRun) => void;
  dismiss: (id: string) => void;
}

export const useRunStore = create<RunState>()((set, get) => ({
  stopped: [],
  add: (r) => set({ stopped: [r, ...get().stopped.filter((x) => x.printerId !== r.printerId)].slice(0, 5) }),
  dismiss: (id) => set({ stopped: get().stopped.filter((x) => x.id !== id) }),
}));

export interface RoutedItem {
  item: QueueItem;
  label: Label;
  /** Target id (connection id) or null when no printer is connected. */
  target: string | null;
  /** True when picked by hand. */
  pinned: boolean;
}

/** Route ticked queue items to connected printers (hand-picked printer first, else best size fit). */
export function routeQueue(lib: Library, items: { item: QueueItem; label: Label }[], targets: PrinterTarget[]): RoutedItem[] {
  const routeTargets = targets.map((t) => ({ id: t.id, w: t.area.w, h: t.area.h, available: !t.snapshot.busy }));
  const pinnedId = (key?: string) => (key ? targets.find((t) => t.key === key)?.id : undefined);
  const ids = routeItems(
    items.map(({ item, label }) => ({ design: lib.templates.find((t) => t.id === label.templateId)?.design, pinned: pinnedId(item.printerKey) })),
    routeTargets,
  );
  return items.map((x, i) => ({ ...x, target: ids[i], pinned: !!pinnedId(x.item.printerKey) }));
}

/**
 * Print on one printer. Returns the outcome; a cancelled / failed run is
 * remembered (useRunStore) and its outcome returned instead of thrown.
 * Other errors (bad range, not connected) are thrown.
 */
export async function printOn(
  lib: Library,
  target: { id: string; key?: string | null; name: string; ctx: PrintContext; connection: PrinterTarget["connection"] },
  items: { label: Label; qty: number }[],
  opts: StoppedRun["opts"] & { startAt?: number },
  queueIds?: string[],
): Promise<PrintOutcome> {
  try {
    return await printLabels(lib, items, target.ctx, { ...opts, connection: target.connection });
  } catch (e) {
    if (!(e instanceof PrintStoppedError)) throw e;
    useRunStore.getState().add({
      id: crypto.randomUUID(),
      printerId: target.id,
      printerKey: target.key,
      printerName: target.name,
      items: items.map((i) => ({ labelId: i.label.id, qty: i.qty })),
      ctx: target.ctx,
      opts: { collation: opts.collation, range: opts.range, seqStart: opts.seqStart, source: opts.source, printValues: opts.printValues },
      outcome: e.outcome,
      queueIds,
      at: Date.now(),
    });
    return e.outcome;
  }
}
