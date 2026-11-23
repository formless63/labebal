/**
 * Print run planning: pure functions (no DOM, no printer) so they are unit-tested.
 *
 *   expandCopies   queue items x copies -> label positions, grouped (1,1,2,2) or collated (1,2,1,2)
 *   parseLabelRange / pickPositions   "40-80, 95" -> a subset of those positions
 *   runsOf         consecutive positions of the same item -> one page with a quantity
 *   chunkJobs / skipLabels            split a run into printer tasks; resume after label N
 *   runChunks      drive the chunks with pause / resume / cancel and per-label progress
 *   routeItems     several printers: send each item to the printer whose label fits best
 */

/* ------------------------------------------------------------ copies and order */

/** "grouped": all copies of a label together (1,1,2,2). "collated": whole sets (1,2,1,2). */
export type Collation = "grouped" | "collated";

/** One printed label in run order. */
export interface PlanEntry {
  /** Index into the items passed to `expandCopies`. */
  item: number;
  /** 1-based copy of that item, and the item's copy count. */
  copy: number;
  copies: number;
  /** 1-based position in the full run (what "labels 40-80" refers to). */
  position: number;
}

/** Expand per-item quantities into the order labels come out of the printer. */
export function expandCopies(qtys: number[], collation: Collation = "grouped"): PlanEntry[] {
  const q = qtys.map((n) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0));
  const out: PlanEntry[] = [];
  const push = (item: number, copy: number) => out.push({ item, copy, copies: q[item], position: out.length + 1 });
  if (collation === "grouped") {
    q.forEach((n, item) => {
      for (let c = 1; c <= n; c++) push(item, c);
    });
  } else {
    const max = Math.max(0, ...q);
    for (let c = 1; c <= max; c++) q.forEach((n, item) => c <= n && push(item, c));
  }
  return out;
}

/* ------------------------------------------------------------ ranges */

export type LabelRange = [from: number, to: number];

/**
 * Parse "40-80", "5", "1-3, 10, 20-" (open end = to the last label) against a run
 * of `total` labels. Empty text = everything. Ranges are clamped to the run,
 * merged and sorted.
 */
export function parseLabelRange(text: string, total: number): { ok: true; ranges: LabelRange[]; count: number } | { ok: false; error: string } {
  const t = text.trim().replace(/\s*(?:-|–|\.\.)\s*/g, "-");
  if (!t) return { ok: true, ranges: total > 0 ? [[1, total]] : [], count: Math.max(0, total) };
  const ranges: LabelRange[] = [];
  for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)(?:(-)(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `"${part}" is not a label number or range (like 40-80)` };
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : total) : a;
    if (a < 1) return { ok: false, error: "Label numbers start at 1" };
    if (b < a) return { ok: false, error: `${a}-${b}: the first number must be the smaller one` };
    if (a > total) return { ok: false, error: `There ${total === 1 ? "is only 1 label" : `are only ${total} labels`} in this print` };
    ranges.push([a, Math.min(b, total)]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: LabelRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return { ok: true, ranges: merged, count: merged.reduce((n, [a, b]) => n + b - a + 1, 0) };
}

/** Keep the entries whose run position falls in one of the ranges. */
export const pickPositions = (entries: PlanEntry[], ranges: LabelRange[]) => entries.filter((e) => ranges.some(([a, b]) => e.position >= a && e.position <= b));

/* ------------------------------------------------------------ runs / pages */

/** Consecutive entries of one item: printed as one page with `count` copies (unless rendered per copy). */
export interface PlanRun {
  item: number;
  firstCopy: number;
  count: number;
  copies: number;
  /** Run positions covered (first and last). */
  from: number;
  to: number;
}

/** Group consecutive entries of the same item with consecutive copy numbers. */
export function runsOf(entries: PlanEntry[]): PlanRun[] {
  const runs: PlanRun[] = [];
  for (const e of entries) {
    const r = runs[runs.length - 1];
    if (r && r.item === e.item && e.copy === r.firstCopy + r.count && e.position === r.to + 1) {
      r.count++;
      r.to = e.position;
    } else runs.push({ item: e.item, firstCopy: e.copy, count: 1, copies: e.copies, from: e.position, to: e.position });
  }
  return runs;
}

/* ------------------------------------------------------------ chunks and resume */

/** Anything printed with a quantity (core `PrintJob`). */
export interface Countable {
  qty: number;
}

export const countLabels = (jobs: Countable[]) => jobs.reduce((n, j) => n + Math.max(0, j.qty), 0);

/**
 * Drop the first `n` labels (resume after a failure). A job whose copies are
 * partly done keeps only the remaining quantity.
 */
export function skipLabels<J extends Countable>(jobs: J[], n: number): J[] {
  let skip = Math.max(0, Math.trunc(n));
  const out: J[] = [];
  for (const j of jobs) {
    if (j.qty <= 0) continue;
    if (skip >= j.qty) {
      skip -= j.qty;
      continue;
    }
    out.push(skip ? { ...j, qty: j.qty - skip } : j);
    skip = 0;
  }
  return out;
}

/**
 * Split jobs into printer tasks of at most `size` labels (a job with many
 * copies is split across tasks). Small tasks make cancel / pause quick and let
 * a failed run resume close to where it stopped.
 */
export function chunkJobs<J extends Countable>(jobs: J[], size: number): J[][] {
  const max = Math.max(1, Math.trunc(size) || 1);
  const chunks: J[][] = [];
  let cur: J[] = [];
  let room = max;
  for (const j of jobs) {
    let left = j.qty;
    while (left > 0) {
      const take = Math.min(left, room);
      cur.push(take === j.qty ? j : { ...j, qty: take });
      left -= take;
      room -= take;
      if (!room) {
        chunks.push(cur);
        cur = [];
        room = max;
      }
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/* ------------------------------------------------------------ run control */

export type RunStatus = "done" | "cancelled" | "failed";

export interface RunResult {
  status: RunStatus;
  /** Labels confirmed printed (whole chunks, plus what the printer reported in the chunk that stopped). */
  printed: number;
  total: number;
  error?: string;
}

/** Pause / resume / cancel for a print run. Pause and cancel take effect between labels or chunks. */
export class RunControl {
  private _paused = false;
  private _cancelled = false;
  private waiters: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  /** Aborted on cancel (for awaiting printer status). */
  readonly signal = this.abort.signal;

  constructor(signal?: AbortSignal) {
    if (signal) {
      if (signal.aborted) this.cancel();
      else signal.addEventListener("abort", () => this.cancel(), { once: true });
    }
  }

  get paused() {
    return this._paused;
  }
  get cancelled() {
    return this._cancelled;
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.listeners.forEach((l) => l());
  }
  pause() {
    if (this._cancelled || this._paused) return;
    this._paused = true;
    this.changed();
  }
  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.release();
    this.changed();
  }
  cancel() {
    if (this._cancelled) return;
    this._cancelled = true;
    this._paused = false;
    this.abort.abort();
    this.release();
    this.changed();
  }
  private release() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }
  /** Resolves when not paused (immediately if running or cancelled). */
  waitIfPaused(): Promise<void> {
    if (!this._paused) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}

export interface RunProgress {
  /** Labels printed so far in this run. */
  done: number;
  total: number;
  /** 0-based chunk being printed, and how many there are. */
  chunk: number;
  chunks: number;
  paused: boolean;
}

/**
 * Print chunks one after another. `exec` prints one chunk and calls
 * `report(n)` with the labels done within it (printer progress events);
 * it should stop early when `control.cancelled`. Pause waits between chunks.
 */
export async function runChunks<J extends Countable>(
  chunks: J[][],
  exec: (chunk: J[], index: number, report: (doneInChunk: number) => void) => Promise<void>,
  control: RunControl = new RunControl(),
  onProgress?: (p: RunProgress) => void,
): Promise<RunResult> {
  const total = chunks.reduce((n, c) => n + countLabels(c), 0);
  let printed = 0;
  let partial = 0;
  let index = 0;
  const emit = () => onProgress?.({ done: printed + partial, total, chunk: index, chunks: chunks.length, paused: control.paused });
  const off = control.onChange(emit);
  try {
    for (; index < chunks.length; index++) {
      if (control.paused) {
        emit();
        await control.waitIfPaused();
      }
      if (control.cancelled) return { status: "cancelled", printed, total };
      const size = countLabels(chunks[index]);
      partial = 0;
      emit();
      try {
        await exec(chunks[index], index, (n) => {
          partial = Math.max(partial, Math.min(size, Math.max(0, Math.trunc(n))));
          emit();
        });
      } catch (e) {
        printed += partial;
        partial = 0;
        if (control.cancelled) return { status: "cancelled", printed, total };
        return { status: "failed", printed, total, error: e instanceof Error ? e.message : String(e) };
      }
      if (control.cancelled) {
        // Stopped inside the chunk: count only what the printer reported.
        printed += partial;
        partial = 0;
        return { status: "cancelled", printed, total };
      }
      printed += size;
      partial = 0;
      emit();
    }
    return { status: "done", printed, total };
  } finally {
    off();
  }
}

/* ------------------------------------------------------------ routing */

/** A connected printer that can take labels, with the label size it has loaded (printable area, mm). */
export interface RouteTarget {
  id: string;
  /** Printable area of the loaded / selected label, mm. */
  w: number;
  h: number;
  /** False while busy or not ready: only used when chosen by hand. */
  available?: boolean;
}

export interface RouteItem {
  /** Size the template was designed at (printable area, mm). */
  design?: { w: number; h: number };
  /** Printer picked by hand (a RouteTarget id). */
  pinned?: string;
}

/** How far a label of size b is from the design size a (0 = same). Orientation-insensitive. */
export function sizeMismatch(a: { w: number; h: number }, b: { w: number; h: number }) {
  const d = (x: number, y: number) => Math.abs(Math.log(Math.max(x, 0.1) / Math.max(y, 0.1)));
  const straight = d(a.w, b.w) + d(a.h, b.h);
  const turned = d(a.w, b.h) + d(a.h, b.w) + 0.25; // prefer the same orientation
  return Math.min(straight, turned);
}

/**
 * Pick a printer for each item: the hand-picked one if it is connected,
 * otherwise the available printer whose label is closest to the template's
 * design size (first target on ties, and when the item has no design size).
 * Returns target ids (null when no printer is available).
 */
export function routeItems(items: RouteItem[], targets: RouteTarget[]): (string | null)[] {
  const avail = targets.filter((t) => t.available !== false);
  return items.map((it) => {
    if (it.pinned && targets.some((t) => t.id === it.pinned)) return it.pinned;
    if (!avail.length) return null;
    if (!it.design || avail.length === 1) return avail[0].id;
    let best = avail[0];
    let score = sizeMismatch(it.design, best);
    for (const t of avail.slice(1)) {
      const s = sizeMismatch(it.design, t);
      if (s < score - 1e-9) {
        best = t;
        score = s;
      }
    }
    return best.id;
  });
}
