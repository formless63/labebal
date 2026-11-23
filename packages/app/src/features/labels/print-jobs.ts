"use client";
/**
 * Labels -> print jobs (counters and runs).
 *
 * Templates using {{seq}} / {{copy}} / {{counter:...}} are rendered once per
 * copy with their own context; everything else renders once and prints `qty`
 * copies.
 *
 * Sequence numbers: a "Start #" typed when printing (`opts.seqStart`) wins;
 * otherwise a template with `seqCounter` takes its numbers from that persistent
 * counter; otherwise they start at 1 and continue across items.
 *
 * `preparePrint` (async, before building jobs) reserves persistent counter
 * numbers on the server for exactly the copies being printed and stores them on
 * `opts.counters` (history records them). `reservedByItem` maps those ranges
 * back to items; print.ts hands each run its slice via `item.reserved`.
 * Print-time form answers (`opts.printValues`, features/print-form) replace the
 * label's values for this print only.
 */
import {
  countersUsed,
  labelPixels,
  needsPerCopyRender,
  renderLabel,
  resolveLabel,
  usesSequence,
  type Label,
  type Library,
  type PrintJob,
  type RenderContext,
  type Template,
} from "@labebal/core";
import { reserveCounters, type ReserveItem } from "../counters/api";
import { isInverted } from "./context";
import type { PrintContext, PrintOptions } from "./print";

type Item = { label: Label; qty: number };

/** Reserved numbers for one item's copies: first {{seq}} number and first number per counter id. */
export interface ItemReservation {
  seqFrom?: number;
  counters: Record<string, { from: number; format?: string }>;
}

/** The label with this print's form answers applied (not saved). */
export function withPrintValues(label: Label, opts: Pick<PrintOptions, "printValues">): Label {
  const pv = opts.printValues?.[label.templateId];
  return pv && Object.keys(pv).length ? { ...label, values: { ...label.values, ...pv } } : label;
}

const manualSeq = (opts: PrintOptions) => opts.seqStart !== undefined && Number.isFinite(opts.seqStart);

/** Counter reservations a print needs, in a fixed order (item, then seq counter, then {{counter:...}} ids). */
function counterRequests(lib: Library, items: Item[], opts: PrintOptions) {
  const out: { item: number; kind: "seq" | "counter"; req: ReserveItem }[] = [];
  items.forEach(({ label: raw, qty }, item) => {
    const t = lib.templates.find((x) => x.id === raw.templateId);
    if (!t || qty < 1) return;
    const label = withPrintValues(raw, opts);
    const ids = [...countersUsed(t, label)];
    const wantsSeq = !!t.seqCounter && !manualSeq(opts) && usesSequence(t, label);
    if (!ids.length && !wantsSeq) return;
    const values = keyValues(t, label);
    const req = (counter: string): ReserveItem => ({ counter, n: qty, templateId: t.id, values, labelId: label.id });
    if (wantsSeq) out.push({ item, kind: "seq", req: req(t.seqCounter!.toLowerCase()) });
    for (const id of ids) out.push({ item, kind: "counter", req: req(id) });
  });
  return out;
}

/** Field values (defaults, template rules, label, print values) that pick a counter's scope key. */
function keyValues(t: Template, label: Label): Record<string, string> {
  const resolved = resolveLabel(t, label) ?? label;
  return { ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...resolved.values };
}

/**
 * Reserve persistent counter numbers for a print; returns options with `counters` set.
 * `items[i].qty` must be the number of copies actually printed for that item.
 */
export async function preparePrint(lib: Library, items: Item[], opts: PrintOptions): Promise<PrintOptions> {
  const reqs = counterRequests(lib, items, opts);
  if (!reqs.length) return { ...opts, counters: [] };
  const ranges = await reserveCounters(
    reqs.map((r) => r.req),
    opts.source ? `print:${opts.source}` : "print",
  ).catch((e) => {
    throw new Error(`Could not reserve counter numbers (nothing was printed): ${(e as Error).message}`);
  });
  return { ...opts, counters: ranges };
}

/** Map `opts.counters` (from preparePrint with the same items) back to items by index. */
export function reservedByItem(lib: Library, items: Item[], opts: PrintOptions): Map<number, ItemReservation> {
  const reqs = counterRequests(lib, items, opts);
  if (reqs.length && (opts.counters?.length ?? 0) !== reqs.length) throw new Error("Counter numbers were not reserved for this print (call preparePrint first).");
  const byItem = new Map<number, ItemReservation>();
  reqs.forEach((r, i) => {
    const range = opts.counters![i];
    const e = byItem.get(r.item) ?? { counters: {} };
    if (r.kind === "seq") e.seqFrom = range.from;
    else e.counters[r.req.counter] = { from: range.from, format: range.format };
    byItem.set(r.item, e);
  });
  return byItem;
}

/**
 * Build print jobs. `copyFrom` / `copies`: this item is copies copyFrom..copyFrom+qty-1
 * of `copies` (collated / partial runs, print.ts). `reserved`: counter numbers for
 * exactly these qty copies (first copy gets `from`); when absent and `opts.counters`
 * is set, numbers are mapped by item index (whole-item prints).
 */
export function buildJobs(
  lib: Library,
  items: (Item & { copyFrom?: number; copies?: number; reserved?: ItemReservation })[],
  ctx: PrintContext,
  opts: PrintOptions,
): PrintJob[] {
  const px = labelPixels(ctx.size, ctx.printer);
  const now = new Date();
  let seq = manualSeq(opts) ? Math.trunc(opts.seqStart!) : 1;
  const byIndex = items.some((i) => i.reserved) ? new Map<number, ItemReservation>() : reservedByItem(lib, items, opts);

  const jobs: PrintJob[] = [];
  items.forEach(({ label: raw, qty, copyFrom = 1, copies = qty, reserved: given }, index) => {
    const label = withPrintValues(raw, opts);
    const t = lib.templates.find((x) => x.id === label.templateId);
    if (!t) throw new Error(`Template missing for ${label.name}`);
    const render = (context: RenderContext) =>
      renderLabel(t, label, {
        w: px.w,
        h: px.h,
        dpmm: px.dpmm,
        marginMm: ctx.settings.marginMm,
        labelMm: { w: ctx.size.widthMm, h: ctx.size.heightMm },
        invert: isInverted(label, t, ctx.settings.invertAll),
        context,
      }).canvas;
    const reserved = given ?? byIndex.get(index);
    if (needsPerCopyRender(t, label)) {
      for (let k = 0; k < qty; k++) {
        const copy = copyFrom + k;
        const counters = reserved && Object.fromEntries(Object.entries(reserved.counters).map(([id, c]) => [id, { n: c.from + k, format: c.format }]));
        const s = reserved?.seqFrom !== undefined ? reserved.seqFrom + k : seq++;
        jobs.push({ canvas: render({ now, seq: s, copy, copies, counters }), qty: 1, name: copies > 1 ? `${label.name} (${copy}/${copies})` : label.name });
      }
    } else {
      jobs.push({ canvas: render({ now, seq, copy: copyFrom, copies }), qty, name: label.name });
    }
  });
  return jobs;
}
