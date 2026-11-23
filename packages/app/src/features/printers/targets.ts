"use client";
/**
 * Connected printers -> what to print on each: label size, stock, darkness,
 * label type, print task and calibration offset.
 *
 * The first printer follows the print toolbar. Other printers use their saved
 * profile (Settings > Printers), else the size their roll's RFID tag matches.
 */
import { useMemo } from "react";
import {
  findPrinter,
  labelPixels,
  matchRoll,
  mediaKindById,
  printerFor,
  resolveMediaKind,
  sizesFor,
  usableSizes,
  type MediaKind,
  type PrintTaskName,
  type LabelPrinter,
  type PrinterSnapshot,
} from "@labebal/core";
import { presetDensity } from "../labels/calibration";
import type { PrintContext } from "../labels/print";
import { printers, usePrinters } from "../labels/printer";
import { useLabelStore, type PrintSettings } from "../labels/store";
import { usePrinterStore, type SavedPrinter } from "./store";

/** Short printer name: "N1", "M2", or the name given to a network / other printer. */
export const shortModel = (model: string | null | undefined) =>
  model === "M2_H" ? "M2" : model === "N1" ? "N1" : (findPrinter(model)?.name ?? model ?? "Printer");

/** Stable key of a physical printer: serial, else Bluetooth name, else null (not identified yet). */
export function printerKey(s: Pick<PrinterSnapshot, "device" | "model">): string | null {
  const serial = s.device?.serial?.trim();
  if (serial) return `sn:${serial}`;
  const name = s.device?.name?.trim();
  if (name) return `name:${name}`;
  return null;
}

export interface PrinterTarget {
  /** Connection id. */
  id: string;
  key: string | null;
  name: string;
  primary: boolean;
  connection: LabelPrinter;
  snapshot: PrinterSnapshot;
  ctx: PrintContext;
  mediaKind: MediaKind;
  /** Why this label type (for tooltips). */
  mediaSource: "printer" | "model" | "auto";
  printTask?: PrintTaskName;
  profile?: SavedPrinter;
  /** Printable area, mm (routing). */
  area: { w: number; h: number };
}

type PrinterState = Pick<ReturnType<typeof usePrinterStore.getState>, "models" | "profiles"> & Partial<Pick<ReturnType<typeof usePrinterStore.getState>, "shared">>;

export function resolveTarget(snapshot: PrinterSnapshot, connection: LabelPrinter, primary: boolean, settings: PrintSettings, ps: PrinterState): PrinterTarget | null {
  if (!snapshot.connected) return null;
  const key = printerKey(snapshot);
  const profile = key ? ps.profiles[key] : undefined;
  let s: PrintSettings;
  if (primary || !snapshot.model) {
    s = settings;
  } else {
    const model = snapshot.model;
    const sizes = usableSizes(model);
    const match = snapshot.roll ? matchRoll(snapshot.roll, printerFor(model), settings.learnedRolls) : null;
    const sizeId = [profile?.sizeId, match?.sizeId].find((id) => id && sizes.some((z) => z.id === id)) ?? (model === settings.printer ? settings.sizeId : sizes[0]?.id ?? "");
    const material = profile?.material ?? match?.materialId ?? (model === settings.printer ? settings.material : "white");
    s = { ...settings, printer: model, sizeId, material, density: model === settings.printer && material === settings.material ? settings.density : presetDensity(settings, model, material) };
  }
  const printer = printerFor(s.printer);
  const size = usableSizes(printer.model).find((z) => z.id === s.sizeId) ?? sizesFor(printer.model)[0];
  const setup = printerSetup(snapshot, { settings: s, printer, size }, ps);
  const px = labelPixels(size, printer);
  return {
    id: connection.id,
    key,
    name: profile?.name || shortModel(snapshot.model),
    primary,
    connection,
    snapshot,
    ...setup,
    area: { w: px.w / px.dpmm - 2 * s.marginMm, h: px.h / px.dpmm - 2 * s.marginMm },
  };
}

/**
 * What a print on this printer needs beyond the label settings: its own offset
 * (shared calibration by serial, else this browser's profile; replaces the model
 * offset), label type and print task.
 */
export function printerSetup(snapshot: PrinterSnapshot, ctx: PrintContext, ps: PrinterState = usePrinterStore.getState()) {
  const key = printerKey(snapshot);
  const profile = key ? ps.profiles[key] : undefined;
  const model = ctx.printer.model;
  // The shared calibration saved against this printer's serial wins, then this browser's own.
  const own = (key ? ps.shared?.[key]?.offset : undefined) ?? profile?.offset;
  const settings = own ? { ...ctx.settings, offsets: { ...(ctx.settings.offsets ?? {}), [model]: own } } : ctx.settings;
  const modelDefaults = ps.models[model];
  // Only trust the roll tag when the printer is the model we print for.
  const rollType = snapshot.model === model ? snapshot.roll?.type : undefined;
  const mediaKind = resolveMediaKind({ override: profile?.mediaKind ?? modelDefaults?.mediaKind, rollType, sizeId: ctx.size.id, materialId: settings.material });
  return {
    ctx: { ...ctx, settings },
    mediaKind,
    mediaSource: (profile?.mediaKind ? "printer" : modelDefaults?.mediaKind ? "model" : "auto") as PrinterTarget["mediaSource"],
    printTask: profile?.printTask ?? modelDefaults?.printTask,
    profile,
  };
}

/** Targets for all connected printers (first printer first). */
export function usePrinterTargets(): PrinterTarget[] {
  const list = usePrinters();
  const settings = useLabelStore((s) => s.settings);
  const models = usePrinterStore((s) => s.models);
  const profiles = usePrinterStore((s) => s.profiles);
  return useMemo(
    () => list.map((p, i) => resolveTarget(p, p.connection, i === 0, settings, { models, profiles })).filter((t): t is PrinterTarget => !!t),
    [list, settings, models, profiles],
  );
}

/** Non-React: target for one connection (print pipeline). */
export function targetForConnection(connection: LabelPrinter, settings: PrintSettings): PrinterTarget | null {
  return resolveTarget(connection.getSnapshot(), connection, connection === printers.primary, settings, usePrinterStore.getState());
}

export const mediaKindLabel = (k: MediaKind) => mediaKindById(k).name;
