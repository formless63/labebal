/**
 * Reflow layout engine: template + label size -> absolute boxes (mm).
 *
 * Pure and framework-free. Text measurement is injected so the same engine runs
 * in the browser (canvas) and in tests (fake measurer).
 */
import {
  boundText,
  fillPlaceholders,
  matchesRule,
  type Anchor,
  type FrameNode,
  type Label,
  type LabelNode,
  type Sizing,
  type RenderContext,
  type Template,
  type TextNode,
} from "./schema";
import { DEFAULT_MODULE_MM, codeAspect, is2d, linearModules } from "./codes";
import { resolveLabel } from "./rules";
import { labelContext } from "./tokens";
import { applyCableSizing, applyMirrors } from "./cable";
import { buildRich, isRichText, type RichText } from "./richtext";
import { DEFAULT_CELL_PADDING_MM, cellNode, tableBorderMm } from "./table";
import type { TableNode } from "./schema";
import { wholePixelScale } from "./fonts";
import { resolveTemplate } from "./parts";
import type { LibraryParts } from "./schema";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Measures text at a given size; returns its natural width/height in mm (unrotated). */
export interface TextMeasurer {
  measure(node: TextNode, text: string, sizePt: number): { w: number; h: number };
  /** Rich text (styled runs, inline icons); falls back to `measure` of the plain text when missing. */
  measureRich?(node: TextNode, rich: RichText, sizePt: number): { w: number; h: number };
  /**
   * Pixel fonts, when the measurer knows the output resolution: the size (pt)
   * drawn at exactly one printer dot per font pixel (whole multiples of it
   * print crisply). Lockups snap their scale with it. Undefined otherwise.
   */
  pixelStepPt?(node: TextNode): number | undefined;
  /** The same measurer without resolution snapping (used for the design pass). */
  unsnapped?(): TextMeasurer;
}

/** Resolved table content (table nodes). */
export interface TableContent {
  /** cells[row][col]: filled text (and rich model when the cell has inline icons / styles). */
  cells: { node: TextNode; text: string; rich?: RichText }[][];
  /** Cell text size after template scaling (pt). */
  sizePt: number;
  /** Content sizes per column / row (mm), for hug tracks. */
  natural: { cols: number[]; rows: number[] };
}

export interface LaidOut {
  node: LabelNode;
  box: Box;
  /** Resolved text (text nodes) or bound value (image src, icon name, code value). */
  text?: string;
  /** Text size after template scaling (pt), before box fitting. */
  sizePt?: number;
  /** Rich text model (text nodes with spans or inline icons). */
  rich?: RichText;
  /** Table nodes: resolved cells. */
  table?: TableContent;
  depth: number;
  /** Set on the copies drawn by a mirrored frame (cable flags): the id of the node copied. */
  copyOf?: string;
}

export interface LayoutResult {
  /** Paint order (pre-order traversal). */
  items: LaidOut[];
  byId: Map<string, LaidOut>;
  /** Effective template root after variants/overrides/visibility. */
  root: FrameNode;
  /** Variants that applied. */
  variants: string[];
  /** Text scale factor applied (label vs design size). */
  textScale: number;
}

export interface LayoutInput {
  template: Template;
  /** With an `id`, `{{labelUrl}}` points at that label's page. */
  label?: Pick<Label, "values" | "overrides"> & { id?: string };
  /** Available area in mm (printable band minus margins). */
  width: number;
  height: number;
  measurer: TextMeasurer;
  /** Dynamic token context (date, sequence number, copy index). */
  context?: RenderContext;
  /** Natural image sizes for hugging images (defaults to the decoded image cache). */
  imageSize?: ImageSizer;
  /** Library text styles and components the template refers to (defaults to `setLibraryParts`). */
  parts?: LibraryParts;
}

const PT_TO_MM = 25.4 / 72;

/** Hug sizes for elements without a natural size (mm). */
export const DEFAULT_ICON_MM = 6;
export const DEFAULT_2D_MM = 10;
export const DEFAULT_1D_MM = 8;
export const DEFAULT_1D_TEXT_MM = 2.5;

/**
 * Natural size (any unit, only the ratio matters) of an image source, or
 * undefined when unknown (not loaded yet). The default reads core's decoded
 * image cache (`elements.ts` registers it); tests and servers can inject
 * their own with `setImageSizer` or per call with `LayoutInput.imageSize`.
 */
export type ImageSizer = (src: string) => { w: number; h: number } | undefined;
let defaultImageSizer: ImageSizer = () => undefined;
export const setImageSizer = (fn: ImageSizer) => {
  defaultImageSizer = fn;
};

/* ------------------------------------------------------------------ helpers */

const clone = <T>(v: T): T => structuredClone(v);

const sideways = (n: LabelNode) => n.rotate === 90 || n.rotate === 270;

const clamp = (v: number, lo?: number, hi?: number) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));

/** Apply variants, label overrides, and visibility; returns a fresh tree. */
export function effectiveRoot(t: Template, w: number, h: number, label?: LayoutInput["label"]) {
  const root = clone(t.root);
  const applied: string[] = [];
  const patches: Record<string, Partial<LabelNode>>[] = [];
  for (const v of t.variants ?? [])
    if (matchesRule(v.when, w, h)) {
      applied.push(v.id);
      patches.push(v.patches);
    }
  if (label?.overrides) patches.push(label.overrides);

  const patchNode = (n: LabelNode) => {
    for (const p of patches) if (p[n.id]) Object.assign(n, p[n.id]);
    if (n.type === "frame") {
      n.children = n.children.filter((c) => {
        patchNode(c);
        return !c.hidden && matchesRule(c.showWhen, w, h);
      });
    }
  };
  patchNode(root);
  applyCableSizing(root);
  return { root, applied };
}

/* ------------------------------------------------------------------ lockups */

const SCALED_KEYS = ["minW", "maxW", "minH", "maxH", "x", "y", "gap", "strokeMm", "radius", "letterSpacing", "dashMm", "borderMm", "cellPaddingMm", "sizePt", "minSizePt"] as const;

/**
 * Copy of a lockup subtree with every length (mm) and text size (pt) scaled
 * by k. `snap` may replace a text node's scaled size (pixel fonts). Nested
 * lockup flags are dropped: the whole subtree scales as one.
 */
function scaleTree<T extends LabelNode>(n: T, k: number, snap: (t: TextNode) => void): T {
  const c = clone(n) as T & Record<string, unknown>;
  const visit = (m: LabelNode) => {
    const r = m as unknown as Record<string, unknown>;
    for (const key of SCALED_KEYS) if (typeof r[key] === "number") r[key] = (r[key] as number) * k;
    for (const s of [m.w, m.h]) if (s.kind === "fixed") s.mm *= k;
    if (m.type === "frame") {
      if (m.padding) m.padding = m.padding.map((p) => p * k) as FrameNode["padding"];
      delete m.lockup;
      m.children.forEach(visit);
    } else if (m.type === "table") {
      for (const s of [...m.cols, ...m.rows]) if (s.kind === "fixed") s.mm *= k;
    } else if (m.type === "text") snap(m);
  };
  visit(c);
  return c;
}

const textNodes = (n: LabelNode): TextNode[] => (n.type === "text" ? [n] : n.type === "frame" ? n.children.flatMap(textNodes) : []);

/** Fraction a snapped lockup may exceed the space it gets (avoids losing a whole scale step to a hair). */
export const LOCKUP_SLACK = 0.02;

interface LockupFit {
  k: number;
  /** Size of the scaled lockup (mm). */
  w: number;
  h: number;
  tree: FrameNode;
}

/* --------------------------------------------------------------- the engine */

class Engine {
  items: LaidOut[] = [];
  byId = new Map<string, LaidOut>();
  /** Content boxes of free frames at design size, for constraint maths. */
  designContent = new Map<string, Box>();
  designBoxes = new Map<string, Box>();

  constructor(
    private measurer: TextMeasurer,
    private values: Record<string, string>,
    private textScale: number,
    private recordDesign: boolean,
    private design?: Engine,
    private context: RenderContext = {},
    private imageSize: ImageSizer = defaultImageSizer,
  ) {}

  /**
   * Width / height of content with a fixed shape (box space, after rotation):
   * icons and 2D codes are square, images use their natural aspect when known
   * (square until loaded). Undefined for everything else.
   */
  aspectOf(n: LabelNode): number | undefined {
    if (n.type === "icon") return 1;
    if (n.type === "code") {
      // Square 2D codes are 1; rMQR / PDF417 use their default shape's proportions; 1D has no fixed shape.
      const a = codeAspect(n.format, fillPlaceholders(n.value, this.values, this.context), n.ecc);
      return a && sideways(n) ? 1 / a : a;
    }
    if (n.type !== "image") return undefined;
    const s = this.imageSize(fillPlaceholders(n.src, this.values, this.context));
    const a = s && s.w > 0 && s.h > 0 ? s.w / s.h : 1;
    return sideways(n) ? 1 / a : a;
  }

  /** Lockups scale as one unit (only once design boxes exist: never in the design pass). */
  isLockup(n: LabelNode): n is FrameNode & { lockup: true } {
    return n.type === "frame" && !!n.lockup && !n.mirror && !!this.design?.designBoxes.get(n.id);
  }

  /** Sub-engine for a scaled lockup tree: its design boxes are the design ones scaled by k. */
  private lockupEngine(tree: FrameNode, k: number) {
    const d = new Engine(this.measurer, this.values, 1, false, undefined, this.context, this.imageSize);
    const scale = (b: Box): Box => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });
    const visit = (m: LabelNode) => {
      const b = this.design!.designBoxes.get(m.id);
      if (b) d.designBoxes.set(m.id, scale(b));
      const c = this.design!.designContent.get(m.id);
      if (c) d.designContent.set(m.id, scale(c));
      if (m.type === "frame") m.children.forEach(visit);
    };
    visit(tree);
    return new Engine(this.measurer, this.values, 1, false, d, this.context, this.imageSize);
  }

  /**
   * Fit a lockup into (availW, availH) mm with one uniform scale k for all its
   * contents (text sizes, gaps, shapes). k is the largest scale at which the
   * contents fit at their natural (packed) size: justified words count their
   * letters plus the minimum gap, not their designed spacing. Axes the lockup
   * does not hug then take the scaled design size, up to the space available,
   * so justified words spread over it with small gaps.
   *
   * With pixel fonts (and a measurer that knows the resolution) k is snapped
   * down so the largest text is drawn at a whole number of dots per font
   * pixel; the other texts take the nearest or the next lower whole scale (so they
   * stay within one step of their designed size ratio).
   */
  lockupFit(n: FrameNode, availW: number, availH: number): LockupFit {
    const d = this.design!.designBoxes.get(n.id)!;
    const steps = new Map<string, number>();
    for (const t of textNodes(n)) {
      const s = this.measurer.pixelStepPt?.(t);
      if (s && t.sizePt > 0) steps.set(t.id, s);
    }
    // Snapping: "round" = nearest whole scale, "floor" = the whole scale below
    // (both within one step of the exact size; the primary text is exact either way).
    const build = (k: number, snap: false | "round" | "floor") => {
      const tree = scaleTree(n, k, (t) => {
        const step = snap ? steps.get(t.id) : undefined;
        if (!step) return;
        const x = t.sizePt / step;
        t.sizePt = (snap === "floor" && x >= 0.5 ? Math.max(1, Math.floor(x + 1e-6)) : wholePixelScale(x)) * step;
      });
      return { k, tree, nat: this.lockupEngine(tree, k).intrinsic(tree) };
    };
    const size = ({ k, tree, nat }: ReturnType<typeof build>, aw: number, ah: number): LockupFit => ({
      k,
      tree,
      w: n.w.kind === "hug" ? nat.w : Math.max(nat.w, Math.min(d.w * k, aw)),
      h: n.h.kind === "hug" ? nat.h : Math.max(nat.h, Math.min(d.h * k, ah)),
    });
    // Unbounded on both axes: the design size at the label's text scale.
    if (!Number.isFinite(availW) && !Number.isFinite(availH)) [availW, availH] = [d.w * this.textScale, d.h * this.textScale];
    // Natural size is proportional to k without snapping.
    const one = build(1, false).nat;
    let kmax = Math.min(one.w > 0 ? availW / one.w : Infinity, one.h > 0 ? availH / one.h : Infinity);
    if (!Number.isFinite(kmax)) kmax = this.textScale;
    kmax = Math.max(0, kmax);
    // The text drawn largest (in dots per font pixel) sets the snapping step.
    let primary: TextNode | undefined;
    for (const t of textNodes(n))
      if (steps.has(t.id) && (!primary || t.sizePt / steps.get(t.id)! > primary.sizePt / steps.get(primary.id)!)) primary = t;
    if (primary) {
      const step = steps.get(primary.id)!;
      // May overrun its space by LOCKUP_SLACK rather than drop a whole scale step.
      const room = 1 + LOCKUP_SLACK;
      // +1: rounding the other texts down can make a larger step fit than linear scaling suggests.
      for (let m = Math.floor((primary.sizePt * kmax * room) / step + 1e-6) + 1; m >= 1; m--)
        for (const mode of ["round", "floor"] as const) {
          const fit = build((m * step) / primary.sizePt, mode);
          if (fit.nat.w <= availW * room + 1e-6 && fit.nat.h <= availH * room + 1e-6) return size(fit, availW, availH);
        }
    }
    // No pixel fonts, unknown resolution, or too small for one dot per font pixel.
    return size(build(kmax, false), availW, availH);
  }

  /** Place a lockup: its scaled design layout, centred in the box it was given. */
  placeLockup(n: FrameNode, box: Box, depth: number) {
    const fit = this.lockupFit(n, box.w, box.h);
    const inner: Box = { x: box.x + (box.w - fit.w) / 2, y: box.y + (box.h - fit.h) / 2, w: fit.w, h: fit.h };
    const sub = this.lockupEngine(fit.tree, fit.k);
    sub.place(fit.tree, inner, depth);
    for (const it of sub.items) {
      this.items.push(it);
      this.byId.set(it.node.id, it);
    }
  }

  textOf(n: TextNode) {
    const t = fillPlaceholders(n.text, this.values, this.context);
    return n.uppercase ? t.toUpperCase() : t;
  }

  sizeOf(n: TextNode | TableNode) {
    return n.sizePt * this.textScale;
  }

  richOf(n: TextNode): RichText | undefined {
    return isRichText(n) ? buildRich(n, this.values, this.context) : undefined;
  }

  /** Natural size of a text node's content (rich or plain), unrotated. */
  measureText(n: TextNode, sizePt: number, rich = this.richOf(n)) {
    if (rich) {
      if (!rich.plain.trim() && !rich.lines.some((l) => l.some((p) => p.kind === "icon"))) return { w: 0, h: 0 };
      return this.measurer.measureRich ? this.measurer.measureRich(n, rich, sizePt) : this.measurer.measure(n, rich.plain, sizePt);
    }
    const text = this.textOf(n);
    return text.trim() ? this.measurer.measure(n, text, sizePt) : { w: 0, h: 0 };
  }

  tableContent(n: TableNode): TableContent {
    const sizePt = this.sizeOf(n);
    const pad = n.cellPaddingMm ?? DEFAULT_CELL_PADDING_MM;
    const border = tableBorderMm(n);
    const cols = n.cols.map(() => 0);
    const rows = n.rows.map(() => 0);
    const cells = n.rows.map((_, r) =>
      n.cols.map((_, c) => {
        const node = cellNode(n, r, c);
        const rich = this.richOf(node);
        const text = rich ? rich.plain : this.textOf(node);
        const m = this.measureText(node, sizePt, rich);
        cols[c] = Math.max(cols[c], m.w + 2 * pad + border);
        rows[r] = Math.max(rows[r], m.h + 2 * pad + border);
        return { node, text, rich };
      }),
    );
    return { cells, sizePt, natural: { cols, rows } };
  }

  /** Natural content size of a node along both axes (unrotated box space). */
  intrinsic(n: LabelNode): { w: number; h: number } {
    let w = 0, h = 0;
    if (this.isLockup(n)) {
      // Fixed axes bound the scale; otherwise the design size at the label's text scale.
      const fit = this.lockupFit(n, n.w.kind === "fixed" ? n.w.mm : Infinity, n.h.kind === "fixed" ? n.h.mm : Infinity);
      [w, h] = [fit.w, fit.h];
    } else if (n.type === "text") {
      const m = this.measureText(n, this.sizeOf(n));
      [w, h] = sideways(n) ? [m.h, m.w] : [m.w, m.h];
    } else if (n.type === "table") {
      const { natural } = this.tableContent(n);
      const sum = (sizes: TableNode["cols"], nat: number[]) => sizes.reduce((a, s, i) => a + (s.kind === "fixed" ? s.mm : nat[i]), 0);
      [w, h] = [sum(n.cols, natural.cols), sum(n.rows, natural.rows)];
    } else if (n.type === "frame") {
      const [pt, pr, pb, pl] = n.padding ?? [0, 0, 0, 0];
      if (n.layout === "free") {
        // Hugging a free frame: its design size.
        const d = this.design?.designBoxes.get(n.id);
        w = d ? d.w - pl - pr : 0;
        h = d ? d.h - pt - pb : 0;
      } else {
        const row = n.layout === "row";
        const flow = n.children.filter((c) => !c.float);
        const sizes = flow.map((c) => this.preferred(c));
        const main = sizes.reduce((a, s) => a + (row ? s.w : s.h), 0) + (n.gap ?? 0) * Math.max(0, flow.length - 1);
        const cross = Math.max(0, ...sizes.map((s) => (row ? s.h : s.w)));
        [w, h] = row ? [main, cross] : [cross, main];
      }
      w += pl + pr;
      h += pt + pb;
    } else if (n.type === "icon" || n.type === "image" || (n.type === "code" && is2d(n.format))) {
      // Fixed-shape content: follow the fixed axis, else a default size for the longer side.
      const a = this.aspectOf(n) ?? 1;
      if (n.w.kind === "fixed") [w, h] = [n.w.mm, n.w.mm / a];
      else if (n.h.kind === "fixed") [w, h] = [n.h.mm * a, n.h.mm];
      else {
        const s = n.type === "icon" ? DEFAULT_ICON_MM : DEFAULT_2D_MM;
        [w, h] = a >= 1 ? [s, s / a] : [s * a, s];
      }
    } else if (n.type === "code") {
      // 1D: natural length at the default module size; bar height from the fixed axis or a default.
      const length = linearModules(n.format, fillPlaceholders(n.value, this.values, this.context)) * DEFAULT_MODULE_MM;
      const across = sideways(n) ? n.w : n.h;
      const height = across.kind === "fixed" ? across.mm : DEFAULT_1D_MM + (n.showText ? DEFAULT_1D_TEXT_MM : 0);
      [w, h] = sideways(n) ? [height, length] : [length, height];
    }
    return { w: clamp(w, n.minW, n.maxW), h: clamp(h, n.minH, n.maxH) };
  }

  /** Preferred size used by a parent stack when measuring (fill counts as its content). */
  preferred(n: LabelNode) {
    const nat = this.intrinsic(n);
    const pick = (s: Sizing, natural: number) => (s.kind === "fixed" ? s.mm : s.kind === "hug" ? natural : natural);
    return { w: pick(n.w, nat.w), h: pick(n.h, nat.h) };
  }

  emit(n: LabelNode, box: Box, depth: number) {
    const item: LaidOut = { node: n, box, depth };
    if (n.type === "text") {
      const rich = this.richOf(n);
      item.text = rich ? rich.plain : this.textOf(n);
      if (rich) item.rich = rich;
      item.sizePt = this.sizeOf(n);
    } else if (n.type === "table") {
      item.table = this.tableContent(n);
      item.sizePt = item.table.sizePt;
    } else {
      // Images, icons and codes: resolve their bound value (src / icon / value).
      const bound = boundText(n);
      if (bound !== undefined) item.text = fillPlaceholders(bound, this.values, this.context);
    }
    this.items.push(item);
    this.byId.set(n.id, item);
    if (this.recordDesign) this.designBoxes.set(n.id, box);
  }

  place(n: LabelNode, box: Box, depth = 0) {
    if (this.isLockup(n)) return this.placeLockup(n, box, depth);
    this.emit(n, box, depth);
    if (n.type !== "frame") return;
    const [pt, pr, pb, pl] = n.padding ?? [0, 0, 0, 0];
    const content: Box = { x: box.x + pl, y: box.y + pt, w: Math.max(0, box.w - pl - pr), h: Math.max(0, box.h - pt - pb) };
    if (this.recordDesign) this.designContent.set(n.id, content);
    if (n.layout === "free") this.placeFree(n, content, depth);
    else this.placeStack(n, content, depth);
  }

  /** Resolve a sizing against an available length. */
  resolve(s: Sizing, avail: number, natural: number) {
    switch (s.kind) {
      case "fixed":
        return s.mm;
      case "pct":
        return (avail * s.pct) / 100;
      case "fill":
        return avail;
      case "hug":
        return natural;
    }
  }

  placeFree(f: FrameNode, content: Box, depth: number) {
    for (const c of f.children) this.placeAt(f, c, content, depth);
  }

  /** Place one child by its position and anchors in the parent's content box (free frames, floating children). */
  placeAt(f: FrameNode, c: LabelNode, content: Box, depth: number) {
    const dc = this.design?.designContent.get(f.id);
    {
      const nat = this.intrinsic(c);
      const [nw, nh] = [nat.w, nat.h];
      // Design-space rect of the child relative to the parent's content box.
      const dx = c.x ?? 0;
      const dy = c.y ?? 0;
      const dW = dc?.w ?? content.w;
      const dH = dc?.h ?? content.h;
      const dw = c.w.kind === "fill" ? dW - dx : this.resolve(c.w, dW, nw);
      const dh = c.h.kind === "fill" ? dH - dy : this.resolve(c.h, dH, nh);
      let [x, w] = constrain(c.ax ?? "start", dx, dw, dW, content.w, c.w.kind === "hug" ? nw : undefined);
      let [y, h] = constrain(c.ay ?? "start", dy, dh, dH, content.h, c.h.kind === "hug" ? nh : undefined);
      // A lockup hugging an axis takes its scaled size there (bounded by the other axis).
      if (this.isLockup(c) && (c.w.kind === "hug" || c.h.kind === "hug")) {
        const fit = this.lockupFit(c, c.w.kind === "hug" ? content.w : w, c.h.kind === "hug" ? content.h : h);
        if (c.w.kind === "hug") [x, w] = constrain(c.ax ?? "start", dx, dw, dW, content.w, fit.w);
        if (c.h.kind === "hug") [y, h] = constrain(c.ay ?? "start", dy, dh, dH, content.h, fit.h);
      }
      // Fixed-shape content hugging one axis follows the other, resolved one.
      const a = this.aspectOf(c);
      if (a && c.w.kind === "hug" && c.h.kind !== "hug")
        [x, w] = constrain(c.ax ?? "start", dx, dw, dW, content.w, clamp(h, c.minH, c.maxH) * a);
      else if (a && c.h.kind === "hug" && c.w.kind !== "hug")
        [y, h] = constrain(c.ay ?? "start", dy, dh, dH, content.h, clamp(w, c.minW, c.maxW) / a);
      this.place(c, { x: content.x + x, y: content.y + y, w: clamp(w, c.minW, c.maxW), h: clamp(h, c.minH, c.maxH) }, depth + 1);
    }
  }

  placeStack(f: FrameNode, content: Box, depth: number) {
    // Floating children skip the line-up and are placed on top afterwards.
    const kids = f.children.filter((c) => !c.float);
    this.placeStackFlow(f, kids, content, depth);
    for (const c of f.children) if (c.float) this.placeAt(f, c, content, depth);
  }

  placeStackFlow(f: FrameNode, kids: LabelNode[], content: Box, depth: number) {
    const row = f.layout === "row";
    if (!kids.length) return;
    const mainAvail = row ? content.w : content.h;
    const crossAvail = row ? content.h : content.w;
    const gap = f.gap ?? 0;
    const mainOf = (n: LabelNode) => (row ? n.w : n.h);
    const crossOf = (n: LabelNode) => (row ? n.h : n.w);

    // Main-axis sizes: fixed/pct/hug first, then share the rest among fills.
    const nat = kids.map((k) => this.intrinsic(k));
    const alignOf = (k: LabelNode) => k.alignSelf ?? (crossOf(k).kind === "fill" ? "stretch" : (f.align ?? "start"));
    const crossSize = (k: LabelNode, i: number) => {
      const cross = alignOf(k) === "stretch" ? crossAvail : this.resolve(crossOf(k), crossAvail, row ? nat[i].h : nat[i].w);
      return row ? clamp(cross, k.minH, k.maxH) : clamp(cross, k.minW, k.maxW);
    };
    // Fixed-shape content hugging the main axis follows its cross size (e.g. an icon as tall as its row).
    const aspects = kids.map((k) => this.aspectOf(k));
    kids.forEach((k, i) => {
      // A lockup hugging the main axis: its scaled size for the cross size it gets.
      if (this.isLockup(k) && mainOf(k).kind === "hug") {
        const s = crossSize(k, i);
        const fit = row ? this.lockupFit(k, mainAvail, s) : this.lockupFit(k, s, mainAvail);
        nat[i] = { w: clamp(fit.w, k.minW, k.maxW), h: clamp(fit.h, k.minH, k.maxH) };
        return;
      }
      const a = aspects[i];
      if (!a || mainOf(k).kind !== "hug") return;
      const s = crossSize(k, i);
      nat[i] = row ? { w: clamp(s * a, k.minW, k.maxW), h: nat[i].h } : { w: nat[i].w, h: clamp(s / a, k.minH, k.maxH) };
    });
    const sizes = kids.map((k, i) => {
      const s = mainOf(k);
      return s.kind === "fill" ? 0 : this.resolve(s, mainAvail, row ? nat[i].w : nat[i].h);
    });
    const used = sizes.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
    const fills = kids.map((k) => mainOf(k)).map((s) => (s.kind === "fill" ? (s.weight ?? 1) : 0));
    const totalWeight = fills.reduce((a, b) => a + b, 0);
    const free = Math.max(0, mainAvail - used);
    kids.forEach((k, i) => {
      if (fills[i]) sizes[i] = (free * fills[i]) / totalWeight;
      sizes[i] = row ? clamp(sizes[i], k.minW, k.maxW) : clamp(sizes[i], k.minH, k.maxH);
    });

    // Justify along the main axis.
    const total = sizes.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
    const slack = totalWeight ? 0 : Math.max(0, mainAvail - total);
    let pos = 0;
    let between = gap;
    switch (f.justify ?? "start") {
      case "center":
        pos = slack / 2;
        break;
      case "end":
        pos = slack;
        break;
      case "between":
        between = kids.length > 1 ? gap + slack / (kids.length - 1) : gap;
        break;
      case "around":
        between = gap + slack / kids.length;
        pos = slack / kids.length / 2;
        break;
    }

    kids.forEach((k, i) => {
      const align = alignOf(k);
      // ...and fixed-shape content hugging the cross axis follows its main size.
      if (this.isLockup(k) && crossOf(k).kind === "hug" && mainOf(k).kind !== "hug") {
        const fit = row ? this.lockupFit(k, sizes[i], crossAvail) : this.lockupFit(k, crossAvail, sizes[i]);
        nat[i] = row ? { ...nat[i], h: fit.h } : { ...nat[i], w: fit.w };
      }
      const a = aspects[i];
      if (a && crossOf(k).kind === "hug" && mainOf(k).kind !== "hug") nat[i] = row ? { ...nat[i], h: sizes[i] / a } : { ...nat[i], w: sizes[i] * a };
      const cross = crossSize(k, i);
      const off = align === "center" ? (crossAvail - cross) / 2 : align === "end" ? crossAvail - cross : 0;
      const box: Box = row
        ? { x: content.x + pos, y: content.y + off, w: sizes[i], h: cross }
        : { x: content.x + off, y: content.y + pos, w: cross, h: sizes[i] };
      this.place(k, box, depth + 1);
      pos += sizes[i] + between;
    });
  }
}

/**
 * Figma-style constraint along one axis.
 * d = design position, dw = design size, D = design parent size, P = actual parent size.
 */
function constrain(a: Anchor, d: number, dw: number, D: number, P: number, hugSize?: number): [number, number] {
  const w = hugSize ?? dw;
  switch (a) {
    case "start":
      return [d, w];
    case "end":
      return [P - (D - d - dw) - w, w];
    case "center":
      return [P / 2 + (d + dw / 2 - D / 2) - w / 2, w];
    case "stretch":
      return [d, Math.max(0, P - d - (D - d - dw))];
    case "scale": {
      const k = D ? P / D : 1;
      return [d * k, hugSize ?? dw * k];
    }
  }
}

/** Lay a template out for a label of the given size. */
export function layout(input: LayoutInput): LayoutResult {
  const { width, height, measurer } = input;
  const labelId = input.label?.id;
  // Components expanded, shared text styles applied (unchanged when unused).
  const t = resolveTemplate(input.template, input.parts);
  // Template rules (category -> icon...) apply on every render path.
  input = { ...input, label: resolveLabel(t, input.label) };
  const values = { ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...input.label?.values };
  const context = labelContext(t, { id: labelId }, values, input.context);
  const textScale = t.scaleText ? Math.min(width / t.design.w, height / t.design.h) : 1;

  // Design pass: positions of free-layout children are defined at design size.
  const designTree = effectiveRoot(t, t.design.w, t.design.h, input.label).root;
  const sizer = input.imageSize ?? defaultImageSizer;
  // Design sizes are resolution independent (no pixel-font snapping).
  const design = new Engine(measurer.unsnapped?.() ?? measurer, values, 1, true, undefined, context, sizer);
  design.place(designTree, { x: 0, y: 0, w: t.design.w, h: t.design.h });

  const { root, applied } = effectiveRoot(t, width, height, input.label);
  const engine = new Engine(measurer, values, textScale, false, design, context, sizer);
  engine.place(root, { x: 0, y: 0, w: width, h: height });
  return { items: applyMirrors(engine.items, engine.byId), byId: engine.byId, root, variants: applied, textScale };
}

export const ptToMm = (pt: number) => pt * PT_TO_MM;
