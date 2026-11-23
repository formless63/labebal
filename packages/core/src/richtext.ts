/**
 * Rich text: mixed runs (bold / size / invert per run) and inline icons inside
 * one text node. Pure and framework-free; canvas measuring and drawing live in
 * richtext-canvas.ts.
 *
 * Model (backward compatible): a text node keeps its plain `text`. Styles are
 * `spans` over character ranges of that raw text (before placeholders are
 * filled), and inline icons are tokens in the text: `{{icon:mdi:usb}}`
 * (any icon id the icon node accepts). A node without spans or icon tokens is
 * plain text and takes the original code path unchanged.
 *
 * Text still does not wrap: lines come from explicit newlines, and the whole
 * block shrinks / grows to fit the box like plain text.
 */
import { fillPlaceholders, walk, type Label, type LabelNode, type RenderContext, type Template, type TextNode, type TextSpan } from "./schema";
import { resolveTemplate } from "./parts";

/** `{{icon:set:name}}` inline icon token. */
export const ICON_TOKEN = /\{\{\s*icon:([^{}|\s]+)\s*\}\}/g;
const ANY_PLACEHOLDER = /\{\{[^{}]*\}\}/g;

export const hasIconToken = (s: string) => new RegExp(ICON_TOKEN.source).test(s);
export const iconToken = (id: string) => `{{icon:${id}}}`;

export interface RunStyle {
  bold: boolean;
  scale: number;
  invert: boolean;
}

export type RichPiece = ({ kind: "text"; text: string } | { kind: "icon"; icon: string }) & RunStyle;

export interface RichText {
  /** One entry per line (split at newlines). */
  lines: RichPiece[][];
  /** The text without icons (for search, preflight, accessibility). */
  plain: string;
}

/** True when a text node needs the rich path (styled spans or inline icons). */
export const isRichText = (n: Pick<TextNode, "text" | "spans">) => !!n.spans?.some((s) => s.end > s.start) || hasIconToken(n.text ?? "");

/** Placeholder ranges [start, end) of a raw text. */
const placeholderRanges = (text: string) => [...text.matchAll(ANY_PLACEHOLDER)].map((m) => [m.index!, m.index! + m[0].length] as const);

/** Clamp spans to the text and widen them so they never cut through a `{{…}}`. */
export function normalizeSpans(text: string, spans: TextSpan[] = []): TextSpan[] {
  const ranges = placeholderRanges(text);
  const out: TextSpan[] = [];
  for (const s of spans) {
    let a = Math.max(0, Math.min(text.length, Math.floor(s.start)));
    let b = Math.max(0, Math.min(text.length, Math.floor(s.end)));
    for (const [ps, pe] of ranges) {
      if (a > ps && a < pe) a = ps;
      if (b > ps && b < pe) b = pe;
    }
    if (b > a) out.push({ ...s, start: a, end: b });
  }
  return out;
}

const styleAt = (spans: TextSpan[], a: number, b: number): RunStyle => {
  const st: RunStyle = { bold: false, scale: 1, invert: false };
  for (const s of spans)
    if (s.start <= a && s.end >= b) {
      if (s.bold) st.bold = true;
      if (s.invert) st.invert = true;
      if (s.scale && s.scale > 0) st.scale = s.scale;
    }
  return st;
};

const sameStyle = (a: RunStyle, b: RunStyle) => a.bold === b.bold && a.scale === b.scale && a.invert === b.invert;

/** Fill placeholders of one segment, keeping inline icon tokens intact; returns pieces (with "\n" inside text). */
function fillSegment(raw: string, style: RunStyle, values: Record<string, string>, ctx: RenderContext, upper: boolean): RichPiece[] {
  const icons: string[] = [];
  const guarded = raw.replace(ICON_TOKEN, (_, id: string) => `${icons.push(id) - 1}`);
  let filled = fillPlaceholders(guarded, values, ctx);
  if (upper) filled = filled.toUpperCase();
  const out: RichPiece[] = [];
  // Icons written directly in the text, or arriving through a field value.
  const re = /(\d+)|\{\{\s*icon:([^{}|\s]+)\s*\}\}/gi;
  let last = 0;
  for (const m of filled.matchAll(re)) {
    if (m.index! > last) out.push({ kind: "text", text: filled.slice(last, m.index), ...style });
    const id = m[1] !== undefined ? icons[Number(m[1])] : m[2];
    if (id) out.push({ kind: "icon", icon: id, ...style });
    last = m.index! + m[0].length;
  }
  if (last < filled.length) out.push({ kind: "text", text: filled.slice(last), ...style });
  return out;
}

/** Resolve a text node's raw text + spans into styled lines. */
export function buildRich(n: Pick<TextNode, "text" | "spans" | "uppercase">, values: Record<string, string>, ctx: RenderContext = {}): RichText {
  const text = n.text ?? "";
  const spans = normalizeSpans(text, n.spans);
  const cuts = [...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const pieces: RichPiece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    if (b > a) pieces.push(...fillSegment(text.slice(a, b), styleAt(spans, a, b), values, ctx, !!n.uppercase));
  }
  const lines: RichPiece[][] = [[]];
  for (const p of pieces) {
    if (p.kind === "icon") {
      lines[lines.length - 1].push(p);
      continue;
    }
    p.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (!part) return;
      const line = lines[lines.length - 1];
      const prev = line[line.length - 1];
      if (prev?.kind === "text" && sameStyle(prev, p)) prev.text += part;
      else line.push({ ...p, text: part });
    });
  }
  const plain = lines.map((l) => l.map((p) => (p.kind === "text" ? p.text : "")).join("")).join("\n");
  return { lines, plain };
}

/** Every inline icon id used by a raw text (literal tokens only). */
export const iconTokensIn = (s: string) => [...s.matchAll(ICON_TOKEN)].map((m) => m[1]);

/**
 * Inline icon ids a template can show for a label: tokens in text nodes and
 * table cells (base, variants, label overrides) and in field values.
 */
export function inlineIconIds(template: Template, label?: Pick<Label, "values" | "overrides">): string[] {
  const t = resolveTemplate(template);
  const ids = new Set<string>();
  const add = (s: unknown) => typeof s === "string" && iconTokensIn(s).forEach((id) => ids.add(id));
  const addNode = (n: Partial<LabelNode> | undefined) => {
    if (!n) return;
    if ("text" in n) add(n.text);
    if ("cells" in n && Array.isArray(n.cells)) n.cells.forEach((row) => row?.forEach(add));
  };
  walk(t.root, (n) => {
    addNode(n);
    for (const v of t.variants ?? []) addNode(v.patches[n.id]);
    addNode(label?.overrides?.[n.id]);
  });
  t.fields.forEach((f) => add(f.default));
  Object.values(label?.values ?? {}).forEach(add);
  return [...ids];
}

/* -------------------------------------------------------------- layout */

/** Metrics of one run, all in the same unit (mm when measuring, device px when drawing). */
export interface RunMetrics {
  /** Advance width. */
  w: number;
  /** Font ascent / descent above / below the baseline. */
  ascent: number;
  descent: number;
  /** Cap height (inline icons are this tall). */
  cap: number;
  /** Baseline-to-baseline distance for this run's size. */
  line: number;
}

export interface RichMeasure {
  run(n: TextNode, text: string, sizePt: number, bold: boolean): RunMetrics;
}

/** Inline icons get this much space on each side, as a fraction of their size. */
export const ICON_SIDE = 0.12;

export interface RichItem {
  piece: RichPiece;
  /** Offset from the line start. */
  x: number;
  w: number;
  sizePt: number;
  /** Icon size (cap height) for icons. */
  cap: number;
}

export interface RichLine {
  items: RichItem[];
  w: number;
  /** Baseline offset from the block top. */
  baseline: number;
  ascent: number;
  descent: number;
}

export interface RichLayout {
  lines: RichLine[];
  w: number;
  h: number;
}

/** Lay out rich lines at a base size (no wrapping). */
export function layoutRich(n: TextNode, rich: RichText, sizePt: number, m: RichMeasure): RichLayout {
  const lines: RichLine[] = [];
  let width = 0;
  let prev: RichLine | null = null;
  for (const pieces of rich.lines) {
    let x = 0, asc = 0, desc = 0, step = 0;
    const items: RichItem[] = [];
    const base = m.run(n, "", sizePt, false);
    if (!pieces.length) [asc, desc, step] = [base.ascent, base.descent, base.line];
    for (const p of pieces) {
      const size = sizePt * p.scale;
      if (p.kind === "text") {
        const r = m.run(n, p.text, size, p.bold);
        items.push({ piece: p, x, w: r.w, sizePt: size, cap: r.cap });
        x += r.w;
        [asc, desc, step] = [Math.max(asc, r.ascent), Math.max(desc, r.descent), Math.max(step, r.line)];
      } else {
        const r = m.run(n, "", size, p.bold);
        const w = r.cap * (1 + 2 * ICON_SIDE);
        items.push({ piece: p, x, w, sizePt: size, cap: r.cap });
        x += w;
        [asc, desc, step] = [Math.max(asc, r.ascent, r.cap), Math.max(desc, r.descent), Math.max(step, r.line)];
      }
    }
    const baseline: number = prev ? prev.baseline + Math.max(step, prev.descent + asc) : asc;
    const line: RichLine = { items, w: x, baseline, ascent: asc, descent: desc };
    lines.push(line);
    width = Math.max(width, x);
    prev = line;
  }
  const h = prev ? prev.baseline + prev.descent : 0;
  return { lines, w: width, h };
}

/**
 * Pick the size (pt) for a rich block in a box, following the node's fit mode
 * (shrink / fill / fixed) and minimum size. Re-measures after scaling, so
 * measurers that snap sizes (pixel fonts) still end up inside the box.
 */
export function fitRich(n: TextNode, rich: RichText, sizePt: number, boxW: number, boxH: number, m: RichMeasure): { sizePt: number; layout: RichLayout } {
  const fit = n.fit ?? "shrink";
  let L = layoutRich(n, rich, sizePt, m);
  if (fit === "fixed" || !L.w || !L.h) return { sizePt, layout: L };
  const k = Math.min(boxW / L.w, boxH / L.h);
  const minPt = Math.min(n.minSizePt ?? 1, sizePt);
  let size = fit === "fill" ? sizePt * k : Math.max(minPt, Math.min(sizePt, sizePt * k));
  if (size === sizePt) return { sizePt, layout: L };
  L = layoutRich(n, rich, size, m);
  for (let i = 0; i < 24 && (L.w > boxW + 1e-6 || L.h > boxH + 1e-6) && size * 0.95 >= minPt; i++) {
    size *= 0.95;
    L = layoutRich(n, rich, size, m);
  }
  return { sizePt: size, layout: L };
}

/* ------------------------------------------------------ editing helpers */

/**
 * Keep spans attached to their characters when the text is edited: the change
 * is found as one replaced range (common prefix / suffix); text typed inside or
 * at the end of a span joins it.
 */
export function adjustSpans(spans: TextSpan[] | undefined, before: string, after: string): TextSpan[] | undefined {
  if (!spans?.length) return spans;
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  // Replaced range: [p, oldEnd) in `before` became [p, newEnd) in `after`.
  const oldEnd = before.length - s;
  const newEnd = after.length - s;
  // Before the change: unchanged. After it: shifted. A span ending where text is
  // typed grows; one starting there does not (the new text takes the style of
  // the character before it, like a word processor).
  const map = (i: number) => (i < p ? i : i > oldEnd ? i + newEnd - oldEnd : i === p && oldEnd > p ? p : newEnd);
  const out = spans.map((x) => ({ ...x, start: map(x.start), end: map(x.end) })).filter((x) => x.end > x.start);
  return out.length ? out : undefined;
}

type StyleKey = "bold" | "invert" | "scale";

/**
 * Apply (or clear) one style on [start, end) of a text: spans are split where
 * needed so only that range changes. `value` undefined / false removes it.
 */
export function applySpanStyle(spans: TextSpan[] | undefined, start: number, end: number, key: StyleKey, value: boolean | number | undefined): TextSpan[] | undefined {
  if (end <= start) return spans;
  const out: TextSpan[] = [];
  for (const s of spans ?? []) {
    if (s.end <= start || s.start >= end) {
      out.push(s);
      continue;
    }
    if (s.start < start) out.push({ ...s, end: start });
    if (s.end > end) out.push({ ...s, start: end });
    const mid = { ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) };
    delete mid[key];
    if (mid.bold || mid.invert || mid.scale) out.push(mid);
  }
  if (value) out.push({ start, end, [key]: value } as TextSpan);
  const cleaned = mergeSpans(out);
  return cleaned.length ? cleaned : undefined;
}

/** Sort, and merge touching spans with identical styles. */
function mergeSpans(spans: TextSpan[]): TextSpan[] {
  // Flatten to elementary segments so overlapping spans combine cleanly.
  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const segs: TextSpan[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const st: TextSpan = { start: a, end: b };
    for (const s of spans)
      if (s.start <= a && s.end >= b) {
        if (s.bold) st.bold = true;
        if (s.invert) st.invert = true;
        if (s.scale) st.scale = s.scale;
      }
    if (!st.bold && !st.invert && !st.scale) continue;
    const prev = segs[segs.length - 1];
    if (prev && prev.end === a && !!prev.bold === !!st.bold && !!prev.invert === !!st.invert && prev.scale === st.scale) prev.end = b;
    else segs.push(st);
  }
  return segs;
}

/** Style shared by the whole range (for toolbar toggle states). */
export function styleOfRange(spans: TextSpan[] | undefined, start: number, end: number): Partial<RunStyle> {
  if (end <= start) {
    const s = (spans ?? []).find((x) => x.start < start && x.end >= start);
    return { bold: !!s?.bold, invert: !!s?.invert, scale: s?.scale ?? 1 };
  }
  const covered = (pred: (s: TextSpan) => boolean) => {
    let i = start;
    const cs = (spans ?? []).filter(pred).sort((a, b) => a.start - b.start);
    for (const s of cs) if (s.start <= i && s.end > i) i = s.end;
    return i >= end;
  };
  const scales = new Set((spans ?? []).filter((s) => s.start < end && s.end > start).map((s) => s.scale ?? 1));
  return { bold: covered((s) => !!s.bold), invert: covered((s) => !!s.invert), scale: scales.size === 1 && covered((s) => !!s.scale) ? [...scales][0] : 1 };
}
