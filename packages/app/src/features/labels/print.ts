"use client";
/**
 * Print pipeline. Each stage lives in its own file so features can extend it
 * independently:
 *   1. preload assets               (core)
 *   2. plan the run: copies order (collation), range, continue-from   core print-plan.ts
 *   3. build jobs (per-copy for {{seq}}/{{copy}} tokens)   print-jobs.ts   [elements]
 *   4. apply printer calibration    calibration.ts          [media]
 *   5. send to printer in chunks    core LabelPrinter drivers (pause / resume / cancel, per-label progress)
 *   6. count roll / ribbon usage    features/printers/store.ts
 *   7. record history               history-client.ts       [data]
 */
import {
  consumableKey,
  expandCopies,
  feedOf,
  mediaKindById,
  needsPerCopyRender,
  parseLabelRange,
  pickPositions,
  preloadAssets,
  runsOf,
  thermalFor,
  usageEstimate,
  usageLevel,
  type Collation,
  type Label,
  type LabelSize,
  type Library,
  type MediaKind,
  type PrintJob,
  type PrintTaskName,
  type LabelPrinter,
  type PrinterProfile,
  type RollInfo,
  type ReservedRange,
  type RunStatus,
} from "@labebal/core";
import { toast } from "sonner";
import { confirmDialog } from "../../components/dialogs";
import { printerSetup, shortModel } from "../printers/targets";
import { usePrinterStore } from "../printers/store";
import { applyCalibration } from "./calibration";
import { recordHistory } from "./history-client";
import { buildJobs, preparePrint, reservedByItem, withPrintValues, type ItemReservation } from "./print-jobs";
import { printers } from "./printer";
import type { PrintSettings } from "./store";

export interface PrintContext {
  settings: PrintSettings;
  printer: PrinterProfile;
  size: LabelSize;
}

export interface PrintOptions {
  /** First sequence number for {{seq}} tokens. */
  seqStart?: number;
  /** Where the print was started from (for history), e.g. "queue", "label", "run:<id>". */
  source?: string;
  /** Print-time form answers, template id -> field key -> value (from `askForPrintValues`). */
  printValues?: Record<string, Record<string, string>>;
  /** Persistent counter numbers reserved for this print (set by `preparePrint`, recorded in history). */
  counters?: ReservedRange[];
  /** Order of multiple copies: "grouped" 1,1,2,2 (default) or "collated" 1,2,1,2. */
  collation?: Collation;
  /** Only these labels of the run, e.g. "40-80, 95" (numbers in print order; empty = all). */
  range?: string;
  /** Continue a stopped run from label N (of the labels selected by `range`). */
  startAt?: number;
  /** Printer to print on (default: the first printer). */
  connection?: LabelPrinter;
  /** Cancels the run. */
  signal?: AbortSignal;
  /** Filled in by printLabels before history is recorded: how the run went. */
  outcome?: PrintOutcome;
}

/** How a run ended (also passed to history). Label numbers count the labels selected for this print. */
export interface PrintOutcome {
  status: RunStatus;
  /** Labels printed by this call. */
  printed: number;
  /** Labels in the selection (range applied). */
  total: number;
  /** First label printed by this call (1 unless continuing). */
  startAt: number;
  /** Next label to print when the run did not finish (for "continue from label N"). */
  nextLabel?: number;
  error?: string;
  /** Printer, label type and print task used. */
  printerId: string;
  printerName: string;
  mediaKind: MediaKind;
  printTask?: PrintTaskName;
}

/** Thrown when a run was cancelled or failed part-way; carries where it stopped. */
export class PrintStoppedError extends Error {
  constructor(readonly outcome: PrintOutcome) {
    super(
      outcome.status === "cancelled"
        ? `Printing canceled after ${outcome.startAt - 1 + outcome.printed} of ${outcome.total} labels`
        : `Printing stopped after ${outcome.startAt - 1 + outcome.printed} of ${outcome.total} labels${outcome.error ? `: ${outcome.error}` : ""}`,
    );
    this.name = "PrintStoppedError";
  }
}

/** How many labels a print will produce (after collation and range); error text for a bad range. */
export function countRun(items: { qty: number }[], range?: string) {
  const total = items.reduce((n, i) => n + Math.max(0, Math.trunc(i.qty) || 0), 0);
  const r = parseLabelRange(range ?? "", total);
  return r.ok ? { total, count: r.count, error: null } : { total, count: 0, error: r.error };
}

/**
 * Render labels at printer resolution and print them. Resolves with the
 * outcome when every label printed; throws PrintStoppedError (with the
 * outcome) when cancelled or stopped part-way.
 */
export async function printLabels(lib: Library, items: { label: Label; qty: number }[], ctx0: PrintContext, opts: PrintOptions = {}): Promise<PrintOutcome> {
  const connection = opts.connection ?? printers.primary;
  const snap = connection.getSnapshot();
  if (!snap.connected) throw new Error("Printer not connected");
  if (snap.model && snap.model !== ctx0.printer.model)
    throw new Error(`The connected printer is a ${shortModel(snap.model)}, but these labels are set up for the ${ctx0.printer.name}. Pick the printer in the toolbar first.`);
  const setup = printerSetup(snap, ctx0);
  const ctx = setup.ctx;

  // Stock that needs a ribbon on a printer without one (or similar): ask first.
  const thermal = thermalFor(ctx.printer, ctx.settings.material, snap.live?.thermal);
  if (thermal.problem && !(await confirmDialog({ title: "Stock and printer don't match", description: thermal.problem, confirmLabel: "Print anyway" })))
    throw new PrintStoppedError({ status: "cancelled", printed: 0, total: 0, startAt: 1, printerId: connection.id, printerName: setup.profile?.name || shortModel(snap.model), mediaKind: setup.mediaKind });

  // Plan: copies in print order, then the range.
  const wanted = items.filter((i) => i.qty > 0);
  const entries = expandCopies(wanted.map((i) => i.qty), opts.collation ?? "grouped");
  const range = parseLabelRange(opts.range ?? "", entries.length);
  if (!range.ok) throw new Error(range.error);
  const selected = pickPositions(entries, range.ranges);
  const startAt = Math.max(1, Math.min(Math.trunc(opts.startAt ?? 1), selected.length + 1));

  const templateOf = (l: Label) => lib.templates.find((t) => t.id === l.templateId);
  const perCopy = wanted.map((i) => {
    const t = templateOf(i.label);
    return !!t && needsPerCopyRender(t, i.label);
  });
  // {{seq}} numbers follow the full run, so printing labels 40-80 gives the same numbers as printing all.
  const seqStart = Number.isFinite(opts.seqStart) ? Math.trunc(opts.seqStart!) : 1;
  const seqAt: number[] = [];
  let seq = seqStart;
  for (const e of entries) {
    seqAt[e.position] = seq;
    if (perCopy[e.item]) seq++;
  }

  const outcomeBase = { total: selected.length, startAt, printerId: connection.id, printerName: setup.profile?.name || shortModel(snap.model), mediaKind: setup.mediaKind, printTask: setup.printTask };
  const todo = selected.slice(startAt - 1);
  if (!todo.length) return { ...outcomeBase, status: "done", printed: 0 };

  const used = [...new Set(todo.map((e) => e.item))];
  for (const t of lib.templates) {
    const ls = used.filter((i) => wanted[i].label.templateId === t.id).map((i) => withPrintValues(wanted[i].label, opts));
    if (ls.length) await preloadAssets(t, ls, { seq: seqStart, copy: 1 });
  }

  // Persistent counters: reserve numbers for exactly the copies printed by this call,
  // then give each run its slice (copies of an item take consecutive numbers in print order).
  const printedPerItem = wanted.map((w, i) => ({ label: w.label, qty: todo.filter((e) => e.item === i).length }));
  opts = await preparePrint(lib, printedPerItem, opts);
  const reservations = reservedByItem(lib, printedPerItem, opts);
  const consumed = new Map<number, number>();
  const sliceFor = (item: number, count: number): ItemReservation | undefined => {
    const r = reservations.get(item);
    if (!r) return undefined;
    const off = consumed.get(item) ?? 0;
    consumed.set(item, off + count);
    return {
      seqFrom: r.seqFrom !== undefined ? r.seqFrom + off : undefined,
      counters: Object.fromEntries(Object.entries(r.counters).map(([id, c]) => [id, { from: c.from + off, format: c.format }])),
    };
  };

  // Jobs: one page per run of the same label; labels without per-copy tokens render once.
  const once = new Map<number, HTMLCanvasElement>();
  const jobs: PrintJob[] = [];
  for (const run of runsOf(todo)) {
    const { label } = wanted[run.item];
    if (perCopy[run.item]) {
      const reserved = sliceFor(run.item, run.count);
      jobs.push(...buildJobs(lib, [{ label, qty: run.count, copyFrom: run.firstCopy, copies: run.copies, reserved }], ctx, reserved?.seqFrom !== undefined ? opts : { ...opts, seqStart: seqAt[run.from] }));
    } else {
      let canvas = once.get(run.item);
      if (!canvas) {
        canvas = buildJobs(lib, [{ label, qty: 1, copies: run.copies, reserved: { counters: {} } }], ctx, { ...opts, seqStart: seqAt[run.from] })[0].canvas;
        once.set(run.item, canvas);
      }
      jobs.push({ canvas, qty: run.count, name: label.name });
    }
  }
  const calibrated = applyCalibration(jobs, ctx);
  // The roll as it was before printing (niimbluelib re-reads the tag afterwards).
  const rollBefore = connection.getSnapshot().roll;

  const result = await connection.print(calibrated, {
    density: ctx.settings.density,
    // N1-style 14 mm rolls print turned on any printer (see LabelSize.feed).
    direction: feedOf(ctx.size),
    labelType: mediaKindById(setup.mediaKind).labelType,
    printTask: setup.printTask,
    signal: opts.signal,
    label: { widthMm: ctx.size.widthMm, heightMm: ctx.size.heightMm, gapMm: ctx.size.gapMm },
    mediaKind: setup.mediaKind,
    thermal: thermal.kind,
  });

  const outcome: PrintOutcome = {
    ...outcomeBase,
    status: result.status,
    printed: result.printed,
    error: result.error,
    nextLabel: result.status === "done" ? undefined : startAt + result.printed,
  };

  // Count what came out per roll / ribbon (RFID serial).
  if (result.printed && rollBefore) countUsage(rollBefore, result.printed);

  // History: what was actually printed, per label.
  const printedEntries = todo.slice(0, result.printed);
  const perItem = new Map<number, number>();
  for (const e of printedEntries) perItem.set(e.item, (perItem.get(e.item) ?? 0) + 1);
  const printedItems = [...perItem].map(([i, qty]) => ({ label: wanted[i].label, qty }));
  if (printedItems.length) await recordHistory(lib, printedItems, ctx, { ...opts, outcome }).catch((e) => console.warn("history not recorded", e));

  if (result.status !== "done") throw new PrintStoppedError(outcome);
  return outcome;
}

/** Count printed labels on the roll and ribbon; warn when either runs low. */
function countUsage(roll: RollInfo, n: number) {
  const parts = [
    { kind: "roll" as const, key: consumableKey("roll", roll.serial, roll.barcode), tag: roll, what: "label roll" },
    // The ribbon tag counts in its own unit (a real N1 reported 83/1600 with 5 labels on the roll),
    // so only the tag figure is used for it, shown as a percentage.
    ...(roll.ribbon ? [{ kind: "ribbon" as const, key: consumableKey("ribbon", roll.ribbon.serial, roll.ribbon.barcode), tag: roll.ribbon, what: "ribbon (ink)" }] : []),
  ];
  for (const p of parts) {
    if (p.kind === "roll") usePrinterStore.getState().recordUsage(p.key, { kind: p.kind, barcode: p.tag.barcode, total: p.tag.total, used: p.tag.used }, n);
    const est = p.kind === "roll" ? usageEstimate(usePrinterStore.getState().usage[p.key], p.tag) : { left: Math.max(0, p.tag.total - p.tag.used), total: p.tag.total };
    const level = usageLevel(est.left, est.total);
    if (level === "low" || level === "empty")
      toast.warning(level === "empty" ? `The ${p.what} looks used up` : `The ${p.what} is running low`, {
        id: `low:${p.key}`,
        description: p.kind === "roll" ? `About ${est.left} of ${est.total} labels left. Have a new one ready.` : `About ${est.total ? Math.round((est.left / est.total) * 100) : 0}% left. Have a new one ready.`,
      });
  }
}
