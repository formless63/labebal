/**
 * Dynamic tokens and extra filters, registered with the schema's placeholder filler:
 *
 *   {{date}}                ISO date (local time), e.g. 2026-11-18
 *   {{date:DD MMM YYYY}}    formatted date (see `formatDate`), [literal]
 *   {{date+30d:DD/MM/YY}}   date maths: + / - N h, d, w, m (months), y; chainable (+1y-1d)
 *   {{time}} {{time+2h}}    HH:mm (also {{time:FORMAT}})
 *   {{seq}} {{seq:000}}     sequence number, optionally zero padded to the arg length
 *   {{copy}} {{copies}}     1-based copy index within a print job, total copies
 *   {{counter:name}}        persistent counter (counters.ts), {{counter:name:000}} / {{counter:name:LOT-####}}
 *   {{team:name}}           a value set once for the whole team (Settings > Team values): company, address...
 *   {{labelUrl}}            absolute URL of the label's page, <base>/l/<label id> (base: setLabelUrlBase / origin)
 *   {{recordUrl}}           the template's `recordUrl` pattern filled with the label's values
 *
 * Filters added here (schema.ts has the basic ones):
 *   |date:FMT  |date:+30d  |date:+30d:FMT   parse the value as a date, shift, format
 *   |mod10   append a Luhn check digit      |gs1   append a GS1 (EAN/GTIN/SSCC) check digit
 *   |slice:a:b   characters a..b (JS slice, negatives count from the end)
 *   |add:N   add N to a whole number, keeping its zero padding
 *   |url     percent-encode for use inside a link (recordUrl: .../parts/{{sku|url}})
 *
 * A template field with the same name (and no `:arg`) always wins.
 * Without a print context (previews) seq/copy/copies/counters render as 1.
 */
import { formatCounter } from "./counters";
import { resolveTemplate } from "./parts";
import { BOUND_PROPS, FILTERS, fillPlaceholders, setTokenResolver, walk, type Label, type LabelNode, type RenderContext, type Template } from "./schema";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number, len = 2) => String(n).padStart(len, "0");

const dayOfYear = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86_400_000) + 1;
function isoWeekNo(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/**
 * Format a date. Tokens: YYYY YY, MMMM (January) MMM (Jan) MM M, DD D,
 * DDD (day of year, 001-366, for Julian lot codes), dddd (Monday) ddd (Mon),
 * WW (ISO week), HH mm ss; `[text]` is literal.
 */
export function formatDate(d: Date, format: string): string {
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DDD|DD|D|WW|HH|mm|ss/g, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return pad(d.getFullYear() % 100);
      case "MMMM":
        return MONTHS_LONG[d.getMonth()];
      case "MMM":
        return MONTHS[d.getMonth()];
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "dddd":
        return DAYS_LONG[d.getDay()];
      case "ddd":
        return DAYS[d.getDay()];
      case "DDD":
        return pad(dayOfYear(d), 3);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "WW":
        return pad(isoWeekNo(d));
      case "HH":
        return pad(d.getHours());
      case "mm":
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

/** One or more offsets such as `+30d`, `-1w`, `+1y-1d` (h, d, w, m = months, y). */
const OFFSETS = /^(?:[+-]\d+[hdwmy])+$/i;

/**
 * Shift a date by offsets like "+30d", "-2w", "+1m", "+1y-1d" (h hours, d days,
 * w weeks, m months, y years). Month / year steps keep the day of month, clamped
 * to the month's length (31 Jan + 1m = 28/29 Feb). Returns null for bad input.
 */
export function shiftDate(d: Date, offsets: string): Date | null {
  const s = offsets.trim();
  if (!s) return new Date(d);
  if (!OFFSETS.test(s)) return null;
  const out = new Date(d);
  for (const [, sign, num, unit] of s.matchAll(/([+-])(\d+)([hdwmy])/gi)) {
    const n = (sign === "-" ? -1 : 1) * Number(num);
    switch (unit.toLowerCase()) {
      case "h":
        out.setHours(out.getHours() + n);
        break;
      case "d":
        out.setDate(out.getDate() + n);
        break;
      case "w":
        out.setDate(out.getDate() + 7 * n);
        break;
      default: {
        const months = unit.toLowerCase() === "y" ? 12 * n : n;
        const day = out.getDate();
        out.setDate(1);
        out.setMonth(out.getMonth() + months);
        const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
        out.setDate(Math.min(day, last));
      }
    }
  }
  return out;
}

/**
 * Parse a date value from a field: ISO `2026-11-19` (optionally with `T14:05`),
 * `20261119`, GS1-style `261119` (YYMMDD), or day first `19/11/2026`,
 * `19.11.2026`, `19-11-26`. Local time. Null when it is not a valid date.
 */
export function parseDateValue(v: string): Date | null {
  const s = v.trim();
  let y: number, mo: number, d: number, h = 0, mi = 0;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (m[4]) [h, mi] = [+m[4], +m[5]];
  } else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{2})(\d{2})(\d{2})$/.exec(s))) [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) [d, mo, y] = [+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
  else return null;
  // GS1 allows day 00 = last day of the month.
  const date = new Date(y, mo - 1, d === 0 ? 1 : d, h, mi);
  if (d === 0) date.setMonth(date.getMonth() + 1, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || (d !== 0 && date.getDate() !== d)) return null;
  return date;
}

/** Number, zero padded to the length of a pattern such as "000" (any non-empty arg counts its characters). */
const padded = (n: number, arg: string | undefined) => (arg?.trim() ? String(n).padStart(arg.trim().length, "0") : String(n));

const DATE_TOKEN = /^(date|time)((?:[+-]\d+[hdwmy])+)?$/i;

/* ------------------------------------------------------------- team values */

let teamValues: Record<string, string> = {};

/** Names team values may have: a letter, then letters, digits, - and _ (stored lower-case). */
export const TEAM_VALUE_NAME = /^[a-z][a-z0-9_-]{0,39}$/;

/** Values for `{{team:name}}` (the app keeps them in sync with the team's settings). */
export const setTeamValues = (v: Record<string, string>) => {
  teamValues = Object.fromEntries(Object.entries(v).map(([k, x]) => [k.trim().toLowerCase(), x]));
};
export const getTeamValues = (): Readonly<Record<string, string>> => teamValues;

/** Team value names a text uses (`{{team:company}}` -> "company"). */
export function teamValuesIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*team:([^}|]*)/g)].map((m) => m[1].trim().toLowerCase()).filter(Boolean);
}

/* -------------------------------------------------------------- label URLs */

let labelUrlBase: string | undefined;

/**
 * Base URL of the label pages for `{{labelUrl}}` (the app calls this with
 * `LABEBAL_PUBLIC_URL`). Empty / undefined falls back to the page origin.
 */
export const setLabelUrlBase = (url: string | undefined) => {
  labelUrlBase = url?.trim() ? url.trim().replace(/\/+$/, "") : undefined;
};

/** The base in effect: context, then `setLabelUrlBase`, then `location.origin` (browser), else "". */
export function labelUrlBaseFor(ctx: Pick<RenderContext, "baseUrl"> = {}): string {
  const fromCtx = ctx.baseUrl?.trim().replace(/\/+$/, "");
  if (fromCtx) return fromCtx;
  if (labelUrlBase) return labelUrlBase;
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin && origin !== "null" ? origin : "";
}

/** Id `{{labelUrl}}` uses when rendering without a label (editor / template previews). Every saved label has a real id. */
export const PREVIEW_LABEL_ID = "example";

/** Path of a label's page: `/l/<id>`. */
export const labelPath = (id: string) => `/l/${encodeURIComponent(id)}`;

/** Absolute URL of a label's page (relative `/l/<id>` when no base is known). */
export const labelUrlFor = (id: string, base = labelUrlBaseFor()) => `${base.replace(/\/+$/, "")}${labelPath(id)}`;

/**
 * Label id from a scanned label-page URL (`https://host/l/<id>`, any host,
 * optional trailing slash / query), else null.
 */
export function labelIdFromUrl(s: string): string | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const m = /\/l\/([^/]+)\/?$/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Context for one label's render: adds `labelId` (from the label) and the
 * template's `recordUrl` filled with the label's values. Explicit context wins.
 */
export function labelContext(t: Pick<Template, "recordUrl">, label: { id?: string } | undefined, values: Record<string, string>, ctx: RenderContext = {}): RenderContext {
  const labelId = ctx.labelId ?? label?.id;
  const out: RenderContext = labelId ? { ...ctx, labelId } : { ...ctx };
  if (ctx.recordUrl === undefined && t.recordUrl?.trim()) {
    // {{recordUrl}} inside the pattern itself resolves to "" (no recursion).
    out.recordUrl = fillPlaceholders(t.recordUrl.trim(), values, { ...out, recordUrl: "" });
  }
  return out;
}

export function resolveToken(name: string, arg: string | undefined, ctx: RenderContext): string | undefined {
  switch (name) {
    case "labelUrl":
      // No label (template previews with example values): a stand-in of the same length class, so the QR shows.
      return labelUrlFor(ctx.labelId ?? PREVIEW_LABEL_ID, labelUrlBaseFor(ctx));
    case "recordUrl":
      return ctx.recordUrl;
    case "seq":
      return padded(ctx.seq ?? 1, arg);
    case "copy":
      return padded(ctx.copy ?? 1, arg);
    case "copies":
      return padded(ctx.copies ?? 1, arg);
    case "team": {
      const key = (arg ?? "").trim().toLowerCase();
      return key ? ((ctx.team ?? teamValues)[key] ?? "") : undefined;
    }
    case "counter": {
      const { id, format } = parseCounterArg(arg);
      if (!id) return undefined;
      const c = ctx.counters?.[id];
      return formatCounter(c?.n ?? 1, format ?? c?.format);
    }
  }
  const m = DATE_TOKEN.exec(name);
  if (!m) return undefined;
  const isTime = m[1].toLowerCase() === "time";
  const d = shiftDate(ctx.now ?? new Date(), m[2] ?? "") ?? new Date();
  return formatDate(d, arg?.trim() || (isTime ? "HH:mm" : "YYYY-MM-DD"));
}

/** `{{counter:ARG}}`: "name" or "name:FORMAT". Ids are matched lower-case. */
export function parseCounterArg(arg: string | undefined): { id: string; format?: string } {
  const a = (arg ?? "").trim();
  const i = a.indexOf(":");
  const id = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase();
  const format = i < 0 ? undefined : a.slice(i + 1) || undefined;
  return { id, format };
}

setTokenResolver(resolveToken);

/* ---------------------------------------------------------------- filters */

const digitsOf = (v: string) => v.replace(/\D/g, "");

/** Luhn (mod 10) check digit for a digit string. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10;
}

/** GS1 mod 10 check digit (EAN-8/13, UPC-A, GTIN-14, SSCC, GLN) for the digits before it. */
export function gs1Digit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

function dateFilter(v: string, arg?: string): string {
  const a = arg ?? "";
  const m = /^((?:[+-]\d+[hdwmy])+)(?::(.*))?$/i.exec(a.trim());
  const offsets = m ? m[1] : "";
  const fmt = (m ? m[2] : a)?.trim() || "YYYY-MM-DD";
  const d = parseDateValue(v);
  if (!d) return v;
  const shifted = shiftDate(d, offsets);
  return shifted ? formatDate(shifted, fmt) : v;
}

Object.assign(FILTERS, {
  date: dateFilter,
  url: (v: string) => encodeURIComponent(v),
  mod10: (v: string) => (digitsOf(v) ? v + luhnDigit(digitsOf(v)) : v),
  gs1: (v: string) => (digitsOf(v) ? v + gs1Digit(digitsOf(v)) : v),
  slice: (v: string, a?: string) => {
    const [from, to] = (a ?? "").split(":").map((x) => (x.trim() === "" ? undefined : Number(x)));
    const chars = [...v];
    return chars.slice(Number.isFinite(from) ? from : 0, Number.isFinite(to) ? to : undefined).join("");
  },
  add: (v: string, a?: string) => {
    const n = Number(a);
    const s = v.trim();
    if (!/^-?\d+$/.test(s) || !Number.isFinite(n)) return v;
    const r = BigInt(s) + BigInt(Math.trunc(n));
    const width = s.replace("-", "").length;
    const neg = r < BigInt(0);
    return (neg ? "-" : "") + String(neg ? -r : r).padStart(width, "0");
  },
} satisfies Record<string, (v: string, arg?: string) => string>);

/* ------------------------------------------------------------ token usage */

function scanBound(template: Template, label: Pick<Label, "overrides"> | undefined, scan: (s: string) => void) {
  const t = resolveTemplate(template);
  const visit = (p: Partial<LabelNode>) =>
    Object.values(BOUND_PROPS).forEach((k) => {
      const s = (p as Record<string, unknown>)[k];
      if (typeof s === "string") scan(s);
    });
  walk(t.root, (n) => visit(n));
  for (const v of t.variants ?? []) Object.values(v.patches).forEach(visit);
  Object.values(label?.overrides ?? {}).forEach(visit);
}

/** Names of all `{{token}}` placeholders used by a template (+ label overrides). */
export function tokensUsed(t: Template, label?: Pick<Label, "overrides">): Set<string> {
  const out = new Set<string>();
  scanBound(t, label, (s) => {
    for (const m of s.matchAll(/\{\{\s*([\w-]+)/g)) out.add(m[1]);
  });
  return out;
}

/** Persistent counter ids used as `{{counter:id...}}` (lower-case; `Template.seqCounter` is separate). */
export function countersUsed(t: Template, label?: Pick<Label, "overrides">): Set<string> {
  const out = new Set<string>();
  if (t.fields.some((f) => f.key === "counter")) return out;
  scanBound(t, label, (s) => {
    for (const m of s.matchAll(/\{\{\s*counter\s*:\s*([\w-]+)/g)) out.add(m[1].toLowerCase());
  });
  return out;
}

/**
 * Whether each printed copy needs its own render ({{seq}}, {{copy}} or a
 * {{counter:...}} used and not shadowed by a template field of the same name).
 */
export function needsPerCopyRender(t: Template, label?: Pick<Label, "overrides">): boolean {
  const used = tokensUsed(t, label);
  const fields = new Set(t.fields.map((f) => f.key));
  return (["seq", "copy", "counter"] as const).some((k) => used.has(k) && !fields.has(k));
}

/** True when the template shows a sequence number ({{seq}}). */
export const usesSequence = (t: Template, label?: Pick<Label, "overrides">) =>
  tokensUsed(t, label).has("seq") && !t.fields.some((f) => f.key === "seq");

/** Fields the print-time form asks for (FieldDef.askAtPrint). */
export const askedFields = (t: Template) => t.fields.filter((f) => f.askAtPrint);

/**
 * Initial value for a print-time question: the field default, where date
 * questions accept "today" or offsets such as "+30d" (ISO date result).
 */
export function askDefault(f: Pick<Template["fields"][number], "default" | "askType">, now = new Date()): string {
  const d = f.default?.trim() ?? "";
  if (f.askType !== "date") return f.default ?? "";
  if (!d) return "";
  if (/^today$/i.test(d) || OFFSETS.test(d)) return formatDate(shiftDate(now, /^today$/i.test(d) ? "" : d) ?? now, "YYYY-MM-DD");
  const parsed = parseDateValue(d);
  return parsed ? formatDate(parsed, "YYYY-MM-DD") : "";
}
