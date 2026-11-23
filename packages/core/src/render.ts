/**
 * Template + label -> 1-bit canvas at printer resolution (browser).
 *
 * The output canvas is exactly what is sent to the printer: every pixel is pure
 * black (dot) or pure white (no dot). Previews are built from the same canvas.
 */
import { layout, type LaidOut, type LayoutResult, type TextMeasurer } from "./layout";
import type { RichText } from "./richtext";
import { drawRich } from "./richtext-canvas";
import { paintTable } from "./table-paint";
import type { Label, LabelNode, Paint, Template } from "./schema";
import { CanvasMeasurer, drawText, type TextFacts } from "./text";
import { paintCode, paintIcon, paintImage, type CodeFacts } from "./elements";
import { createCanvas } from "./canvas";
import { pixelFont } from "./fonts";
import { dilate, makeCanvas, maskOf, paintMask, subtract } from "./paint";
import type { PolygonNode, RenderContext, TextNode } from "./schema";

export interface RenderOptions {
  /** Output size in dots. */
  w: number;
  h: number;
  /** Dots per mm. */
  dpmm: number;
  /** Blank border kept on every side, mm. */
  marginMm: number;
  /** Final invert (print the background, leave the marks). */
  invert: boolean;
  /** 0-255; pixels darker than this become dots. */
  threshold?: number;
  /** Dynamic token context (date, sequence, copy). */
  context?: RenderContext;
  /**
   * Physical label size in mm (same orientation as the render). When the band
   * the printhead reaches is narrower than the stock (N1: 12 mm on 14 mm tape),
   * the clean border / inverted "inside the margin" area is measured from the
   * label's edge, so only the ends come in to match the unprinted strips.
   */
  labelMm?: { w: number; h: number };
}

/**
 * Inset in dots of the "inside the margin" area (clean inverted border, template
 * border): the same distance from every physical label edge, at least the margin.
 * Where the band is already narrower than the stock, that strip counts towards it.
 */
export function cleanInset(o: Pick<RenderOptions, "w" | "h" | "dpmm" | "marginMm" | "labelMm">) {
  const m = o.marginMm * o.dpmm;
  if (!o.labelMm) return { x: Math.round(m), y: Math.round(m) };
  const sx = Math.max(0, (o.labelMm.w * o.dpmm - o.w) / 2), sy = Math.max(0, (o.labelMm.h * o.dpmm - o.h) / 2);
  const b = Math.max(m, sx, sy);
  return { x: Math.round(Math.max(0, b - sx)), y: Math.round(Math.max(0, b - sy)) };
}

/** What the renderer did with one node (dots, canvas coordinates), for preflight. */
export interface NodeFacts {
  /** The node's box snapped to whole dots. */
  box: { x: number; y: number; w: number; h: number };
  text?: TextFacts;
  code?: CodeFacts;
}

export interface RenderResult {
  canvas: HTMLCanvasElement;
  layout: LayoutResult;
  /** Per painted node id (mirrored copies included): final text size, code modules... */
  facts: Map<string, NodeFacts>;
}

const measurers = new Map<number | undefined, TextMeasurer>();
/**
 * Shared canvas measurer. Pass the render's dots per mm to measure pixel fonts
 * at the whole-dot scale they are drawn at (what renderLabel does); without it
 * sizes are continuous.
 */
export const measurer = (dpmm?: number) => {
  let m = measurers.get(dpmm);
  if (!m) measurers.set(dpmm, (m = new CanvasMeasurer(dpmm)));
  return m;
};

/** Printable area in mm for a render (used by layout). */
export const contentSize = (o: Pick<RenderOptions, "w" | "h" | "dpmm" | "marginMm">) => ({
  width: Math.max(0.1, o.w / o.dpmm - 2 * o.marginMm),
  height: Math.max(0.1, o.h / o.dpmm - 2 * o.marginMm),
});

export function renderLabel(t: Template, label: (Pick<Label, "values" | "overrides"> & { id?: string }) | undefined, o: RenderOptions, target?: HTMLCanvasElement): RenderResult {
  const canvas = target ?? createCanvas(o.w, o.h);
  canvas.width = o.w;
  canvas.height = o.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, o.w, o.h);

  const { width, height } = contentSize(o);
  const result = layout({ template: t, label, width, height, measurer: measurer(o.dpmm), context: o.context });
  const off = o.marginMm * o.dpmm;
  const px = (mm: number) => off + mm * o.dpmm;

  // Frames with `clip` restrict their descendants (items are pre-order with depth).
  const clips: number[] = [];
  const facts = new Map<string, NodeFacts>();
  for (const it of result.items) {
    while (clips.length && clips[clips.length - 1] >= it.depth) {
      clips.pop();
      ctx.restore();
    }
    const b = it.box;
    // Snap the box to whole dots so adjoining shapes meet cleanly.
    const x0 = Math.round(px(b.x)), y0 = Math.round(px(b.y));
    const x1 = Math.round(px(b.x + b.w)), y1 = Math.round(px(b.y + b.h));
    const box = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    ctx.save();
    facts.set(it.node.id, { box, ...paintNode(ctx, it.node, box, o.dpmm, it.text, it.sizePt, it) });
    ctx.restore();
    if (it.node.type === "frame" && it.node.clip) {
      ctx.save();
      ctx.beginPath();
      const r = Math.min((it.node.radius ?? 0) * o.dpmm, box.w / 2, box.h / 2);
      if (r >= 0.5) ctx.roundRect(box.x, box.y, box.w, box.h, r);
      else ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      clips.push(it.depth);
    }
  }
  while (clips.pop() !== undefined) ctx.restore();

  const inset = cleanInset(o);
  const contentArea = { x: inset.x, y: inset.y, w: o.w - 2 * inset.x, h: o.h - 2 * inset.y };
  const radius = (t.borderRadiusMm ?? 0) * o.dpmm;
  const border = (t.borderMm ?? 0) > 0 ? Math.max(1, Math.round(t.borderMm! * o.dpmm)) : 0;
  const contentOnly = t.invertArea === "content" && (inset.x > 0 || inset.y > 0);
  if (!border && !(o.invert && contentOnly)) {
    binarize(ctx, o.w, o.h, o.threshold ?? 128, o.invert);
  } else {
    // Invert only the content area (clean unprinted margin), then the border on top.
    binarize(ctx, o.w, o.h, o.threshold ?? 128, o.invert && !contentOnly);
    ctx.save();
    if (o.invert && contentOnly) {
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff";
      shape(ctx, contentArea, radius);
      ctx.fill();
    }
    if (border) {
      // The border always shows: printed dots, or cleared dots on a fully inverted band.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = ctx.strokeStyle = o.invert && !contentOnly ? "#ffffff" : "#000000";
      shape(ctx, contentArea, radius);
      ctx.clip();
      ctx.lineWidth = border * 2;
      ctx.stroke();
    }
    ctx.restore();
    binarize(ctx, o.w, o.h, 128, false);
  }
  return { canvas, layout: result, facts };
}

/** Set fill/stroke style + composite op for a paint; false if nothing to draw. */
function usePaint(ctx: CanvasRenderingContext2D, p: Paint | undefined) {
  if (!p || p === "none") return false;
  if (p === "invert") {
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = ctx.strokeStyle = p === "black" ? "#000000" : "#ffffff";
  }
  return true;
}

type PxBox = { x: number; y: number; w: number; h: number };

function shape(ctx: CanvasRenderingContext2D, b: PxBox, radiusPx: number) {
  ctx.beginPath();
  const r = Math.min(radiusPx, b.w / 2, b.h / 2);
  if (r < 0.5) ctx.rect(b.x, b.y, b.w, b.h);
  else ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

function fillStroke(ctx: CanvasRenderingContext2D, b: PxBox, fill: Paint | undefined, stroke: Paint | undefined, strokeMm: number | undefined, dpmm: number, path: () => void) {
  if (usePaint(ctx, fill)) {
    path();
    ctx.fill();
  }
  if (strokeMm && usePaint(ctx, stroke)) {
    const lw = Math.max(1, Math.round(strokeMm * dpmm));
    // Stroke inside the box: clip to the shape and draw a double-width line.
    path();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = lw * 2;
    ctx.stroke();
    ctx.restore();
  }
}

function paintNode(ctx: CanvasRenderingContext2D, n: LabelNode, b: PxBox, dpmm: number, text?: string, sizePt?: number, it?: Pick<LaidOut, "rich" | "table">): Omit<NodeFacts, "box"> | undefined {
  switch (n.type) {
    case "frame":
      fillStroke(ctx, b, n.fill, n.stroke, n.strokeMm, dpmm, () => shape(ctx, b, (n.radius ?? 0) * dpmm));
      break;
    case "rect":
      fillStroke(ctx, b, n.fill, n.stroke, n.strokeMm, dpmm, () => shape(ctx, b, (n.radius ?? 0) * dpmm));
      break;
    case "polygon":
      fillStroke(ctx, b, n.fill, n.stroke, n.strokeMm, dpmm, () => {
        ctx.beginPath();
        polygonPoints(n, b).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      });
      break;
    case "ellipse":
      fillStroke(ctx, b, n.fill, n.stroke, n.strokeMm, dpmm, () => {
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      });
      break;
    case "line": {
      if (!usePaint(ctx, n.color)) break;
      const lw = Math.max(1, Math.round(n.strokeMm * dpmm));
      ctx.lineWidth = lw;
      ctx.lineCap = "butt";
      if (n.dashMm) ctx.setLineDash([n.dashMm * dpmm, n.dashMm * dpmm]);
      ctx.beginPath();
      const odd = lw % 2 ? 0.5 : 0;
      if (n.direction === "horizontal") {
        const y = Math.round(b.y + b.h / 2) + odd;
        ctx.moveTo(b.x, y);
        ctx.lineTo(b.x + b.w, y);
      } else if (n.direction === "vertical") {
        const x = Math.round(b.x + b.w / 2) + odd;
        ctx.moveTo(x, b.y);
        ctx.lineTo(x, b.y + b.h);
      } else if (n.direction === "down") {
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + b.w, b.y + b.h);
      } else {
        ctx.moveTo(b.x, b.y + b.h);
        ctx.lineTo(b.x + b.w, b.y);
      }
      ctx.stroke();
      break;
    }
    case "image":
      if (usePaint(ctx, n.color)) paintImage(ctx, n, b, dpmm, text ?? n.src);
      break;
    case "icon":
      if (usePaint(ctx, n.color)) paintIcon(ctx, n, b, dpmm, text ?? n.icon);
      break;
    case "code":
      if (usePaint(ctx, n.color)) return { code: paintCode(ctx, n, b, dpmm, text ?? n.value) };
      break;
    case "text": {
      if (!text && !it?.rich) break;
      const facts = {} as TextFacts;
      // Rich text has no preflight text facts yet; plain text reports them.
      if (n.strokeMm && n.stroke && n.stroke !== "none") outlinedText(ctx, n, text ?? "", sizePt ?? n.sizePt, b, dpmm, it?.rich ? undefined : facts, it?.rich);
      else if (usePaint(ctx, n.color)) {
        if (it?.rich) drawRich(ctx, n, it.rich, sizePt ?? n.sizePt, { ...b, dpmm });
        else drawText(ctx, n, text!, sizePt ?? n.sizePt, { ...b, dpmm }, facts);
      }
      return "usedPt" in facts ? { text: facts } : undefined;
    }
    case "table":
      if (it?.table && usePaint(ctx, n.color)) paintTable(ctx, n, b, dpmm, it.table);
      break;
  }
}

/**
 * Text with an outline: the glyphs are rasterised to a dot mask, dilated by the
 * stroke width (square for pixel fonts so they stay blocky, round otherwise),
 * and the ring is painted with the stroke paint underneath the fill paint.
 * Also covers knockout styles (white text with a black outline on black).
 */
function outlinedText(ctx: CanvasRenderingContext2D, n: TextNode, text: string, sizePt: number, b: PxBox, dpmm: number, facts?: TextFacts, rich?: RichText) {
  const r = Math.max(1, Math.round((n.strokeMm ?? 0) * dpmm));
  const c = makeCanvas(b.w + 2 * r, b.h + 2 * r);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.fillStyle = "#000000";
  if (rich) drawRich(x, n, rich, sizePt, { x: r, y: r, w: b.w, h: b.h, dpmm });
  else drawText(x, n, text, sizePt, { x: r, y: r, w: b.w, h: b.h, dpmm }, facts);
  const fill = maskOf(c);
  const ring = subtract(dilate(fill, c.width, c.height, r, pixelFont(n.font) ? "square" : "disk"), fill);
  if (usePaint(ctx, n.stroke)) paintMask(ctx, ring, c.width, c.height, b.x - r, b.y - r);
  if (usePaint(ctx, n.color)) paintMask(ctx, fill, c.width, c.height, b.x - r, b.y - r);
}

function binarize(ctx: CanvasRenderingContext2D, w: number, h: number, threshold: number, invert: boolean) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum < threshold !== invert ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Fraction of dots printed, e.g. to warn about ribbon usage on inverted labels. */
export function inkCoverage(canvas: HTMLCanvasElement) {
  const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  let dots = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === 0) dots++;
  return dots / (canvas.width * canvas.height);
}

/** Recolour a 1-bit canvas: dots -> ribbon colour, no-dot -> transparent (material shows through). */
export function tintDots(src: HTMLCanvasElement, rgb: [number, number, number], target: HTMLCanvasElement) {
  target.width = src.width;
  target.height = src.height;
  const img = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dot = d[i] === 0;
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = dot ? 255 : 0;
  }
  target.getContext("2d")!.putImageData(img, 0, 0);
}

/** Corner points of a polygon / star node inscribed in its box (pixels). */
export function polygonPoints(n: Pick<PolygonNode, "sides" | "star" | "innerRatio" | "angle">, b: { x: number; y: number; w: number; h: number }): [number, number][] {
  const sides = Math.max(3, Math.min(24, Math.round(n.sides || 3)));
  const count = n.star ? sides * 2 : sides;
  const inner = Math.max(0.1, Math.min(0.95, n.innerRatio ?? 0.45));
  const start = -Math.PI / 2 + ((n.angle ?? 0) * Math.PI) / 180;
  const unit: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = start + (i * 2 * Math.PI) / count;
    const r = n.star && i % 2 ? inner : 1;
    unit.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Scale the shape's own bounds to fill the box (a triangle uses the full height).
  const xs = unit.map((p) => p[0]), ys = unit.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = b.w / (maxX - minX || 1), sy = b.h / (maxY - minY || 1);
  return unit.map(([x, y]) => [b.x + (x - minX) * sx, b.y + (y - minY) * sy]);
}
