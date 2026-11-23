/**
 * Persistent counters (pure logic; storage lives in the app).
 *
 * A counter hands out numbers that survive between prints: box numbers, lot
 * numbers, serials. Templates use them as `{{counter:name}}` or
 * `{{counter:name:000}}` (see tokens.ts). A counter keeps one running value per
 * scope key:
 *
 *   global    one sequence shared by everything
 *   template  one sequence per template that uses it
 *   value     one sequence per template + value of a field (e.g. per SKU)
 *
 * and restarts at `start` when its reset policy says so: never, every day /
 * ISO week / month / year (server local time), or when a watched field's value
 * changes (e.g. a new lot number restarts the box count).
 *
 * Numbers are reserved in blocks (`reserveCounter`): the app does this in one
 * database transaction per print so concurrent prints never overlap.
 */
export type CounterScope = "global" | "template" | "value";
export type CounterReset = "never" | "daily" | "weekly" | "monthly" | "yearly" | "change";

export const COUNTER_SCOPES: CounterScope[] = ["global", "template", "value"];
export const COUNTER_RESETS: CounterReset[] = ["never", "daily", "weekly", "monthly", "yearly", "change"];

/** Counter ids are what templates write after `counter:`; lower-case letters, digits, `_` and `-`. */
export const COUNTER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface CounterDef {
  id: string;
  /** Display name (defaults to the id). */
  name?: string;
  scope: CounterScope;
  /** Scope "value": field whose value picks the sequence (e.g. "sku"). */
  keyField?: string;
  reset: CounterReset;
  /** Reset "change": field whose value restarts the counter when it changes (e.g. "lot"). */
  watchField?: string;
  /** First number after a reset (default 1). */
  start: number;
  /**
   * How the number is shown when the token has no format of its own: a run of
   * `#` is the number zero padded to the run length (`LOT-####` -> `LOT-0042`),
   * a plain pattern such as `000` pads to its length. Empty = plain number.
   */
  format?: string;
}

/** Stored state for one scope key of a counter. */
export interface CounterState {
  /** Next number to hand out. */
  next: number;
  /** Reset period the state belongs to (see `counterPeriod`), "" for never / change. */
  period: string;
  /** Last value of the watched field (reset "change"). */
  watched: string | null;
}

/** A block of numbers handed out for a print (what history records). */
export interface ReservedRange {
  counter: string;
  /** Scope key ("" global, template id, template id + "/" + value). */
  key: string;
  from: number;
  to: number;
  /** Label the numbers were printed on (browser prints). */
  labelId?: string;
  /** The counter's display format at reservation time. */
  format?: string;
}

export interface Reservation {
  /** First and last number reserved (inclusive). */
  from: number;
  to: number;
  /** True when this reservation restarted the counter. */
  reset: boolean;
  state: CounterState;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 week ("2026-W47") of a local date. */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** The reset period `now` falls in: "2026-11-19" (daily), "2026-W47", "2026-11", "2026", or "" (never / change). */
export function counterPeriod(reset: CounterReset, now: Date): string {
  switch (reset) {
    case "daily":
      return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    case "weekly": {
      const w = isoWeek(now);
      return `${w.year}-W${pad2(w.week)}`;
    }
    case "monthly":
      return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    case "yearly":
      return String(now.getFullYear());
    default:
      return "";
  }
}

/** Scope key a label uses for a counter: "" (global), the template id, or template id + "/" + field value. */
export function counterKey(def: Pick<CounterDef, "scope" | "keyField">, templateId: string, values: Record<string, string>): string {
  if (def.scope === "global") return "";
  if (def.scope === "template" || !def.keyField) return templateId;
  return `${templateId}/${(values[def.keyField] ?? "").trim()}`;
}

/** Watched value for reset "change" (null otherwise). */
export const watchedValue = (def: Pick<CounterDef, "reset" | "watchField">, values: Record<string, string>): string | null =>
  def.reset === "change" && def.watchField ? (values[def.watchField] ?? "").trim() : null;

/** Whether the stored state must restart before handing out more numbers. */
export function shouldReset(def: Pick<CounterDef, "reset">, state: CounterState | undefined, period: string, watched: string | null): boolean {
  if (!state) return true;
  if (def.reset === "change") return state.watched !== watched;
  if (def.reset === "never") return false;
  return state.period !== period;
}

/** Reserve `n` numbers (n >= 1). Pure: returns the range and the state to store. */
export function reserveCounter(
  def: Pick<CounterDef, "reset" | "start">,
  state: CounterState | undefined,
  n: number,
  now: Date,
  watched: string | null = null,
): Reservation {
  const count = Math.max(1, Math.trunc(n));
  const period = counterPeriod(def.reset, now);
  const reset = shouldReset(def, state, period, watched);
  const from = reset || !state ? Math.trunc(def.start) : state.next;
  const to = from + count - 1;
  return { from, to, reset, state: { next: to + 1, period, watched } };
}

/**
 * The next number without reserving it (what the settings page shows): `start`
 * when the counter would reset now.
 */
export function peekCounter(def: Pick<CounterDef, "reset" | "start">, state: CounterState | undefined, now: Date, watched: string | null = null): number {
  return shouldReset(def, state, counterPeriod(def.reset, now), watched) ? Math.trunc(def.start) : state!.next;
}

/**
 * Format a number with a pattern: a run of `#` is replaced by the number zero
 * padded to the run's length (`LOT-####`), a plain pattern pads to its length
 * (`000` -> `007`, like `{{seq:000}}`), empty = plain number.
 */
export function formatCounter(n: number, format?: string): string {
  const f = format?.trim() ?? "";
  const neg = n < 0;
  const abs = String(Math.abs(Math.trunc(n)));
  const num = (len: number) => (neg ? "-" : "") + abs.padStart(len, "0");
  if (!f) return num(0);
  if (f.includes("#")) return f.replace(/#+/, (run) => num(run.length));
  return num(f.length);
}
