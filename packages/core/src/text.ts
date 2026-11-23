/**
 * Text measuring and drawing on canvas (browser).
 *
 * Pixel fonts take a bitmap path (rasterise at native size, scale up
 * nearest-neighbour), other fonts are drawn as vectors and thresholded later.
 */
import { fittingPixelScale, pixelFont, wholePixelScale, type PixelFont } from "./fonts";
import type { TextMeasurer } from "./layout";
import type { TextNode } from "./schema";
import { createCanvas } from "./canvas";
import { layoutRich, type RichText } from "./richtext";
import { canvasRichMeasure } from "./richtext-canvas";

const PT_TO_MM = 25.4 / 72;

type Ctx = CanvasRenderingContext2D;

const makeCanvas = (w: number, h: number) => createCanvas(w, h);

/* -------------------------------------------------------- pixel-font rasters */

/** Text rasterised at native pixel size, with ink bounds in font pixels. */
export interface Raster {
  canvas: HTMLCanvasElement;
  base: number; // baseline row in the canvas
  left: number;
  right: number; // exclusive
  top: number; // relative to baseline (negative = above)
  bottom: number;
  advance: number;
  empty: boolean;
}

const rasterCache = new Map<string, Raster>();

export function rasterize(s: string, family: string, pf: PixelFont): Raster {
  const key = `${family}\u0000${pf.pxPerEm}\u0000${s}`;
  const hit = rasterCache.get(key);
  if (hit) return hit;

  const em = pf.pxPerEm;
  const probe = makeCanvas(1, 1).getContext("2d")!;
  probe.font = `${em}px "${family}"`;
  const advance = Math.round(probe.measureText(s).width);
  const pad = em;
  const c = makeCanvas(advance + pad * 2, em * 3);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const base = em * 2;
  x.font = `${em}px "${family}"`;
  x.fillStyle = "#000";
  x.fillText(s, pad, base);

  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (let y = 0; y < c.height; y++)
    for (let xx = 0; xx < c.width; xx++) {
      const i = (y * c.width + xx) * 4 + 3;
      if (d[i] >= 128) {
        d[i] = 255;
        l = Math.min(l, xx);
        r = Math.max(r, xx);
        t = Math.min(t, y);
        b = Math.max(b, y);
      } else d[i] = 0;
    }
  x.putImageData(img, 0, 0);
  const out: Raster =
    l === Infinity
      ? { canvas: c, base, left: pad, right: pad + advance, top: 0, bottom: 0, advance, empty: true }
      : { canvas: c, base, left: l, right: r + 1, top: t - base, bottom: b + 1 - base, advance, empty: false };
  if (rasterCache.size > 2000) rasterCache.clear();
  rasterCache.set(key, out);
  return out;
}

const inkW = (r: Raster) => (r.empty ? r.advance : r.right - r.left);

/** Layout of a block of pixel-font text in font pixels. */
function pixelBlock(lines: string[], family: string, pf: PixelFont, justify: boolean) {
  const rows = lines.map((line) => ({
    whole: rasterize(line, family, pf),
    chars: justify && line.length > 1 ? [...line].map((ch) => rasterize(ch, family, pf)) : null,
  }));
  let top = Infinity, bottom = -Infinity, width = 0;
  rows.forEach(({ whole, chars }, i) => {
    if (!whole.empty) {
      top = Math.min(top, i * pf.linePx + whole.top);
      bottom = Math.max(bottom, i * pf.linePx + whole.bottom);
    }
    width = Math.max(width, chars ? chars.reduce((a, c) => a + inkW(c), 0) : whole.empty ? 0 : inkW(whole));
  });
  if (top === Infinity) return { rows, top: 0, height: 0, width: 0 };
  return { rows, top, height: bottom - top, width };
}

/* ------------------------------------------------------------- vector text */

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
// Generic families must not be quoted (a quoted "sans-serif" is a missing named font).
export const vectorFont = (n: TextNode, px: number) => `${n.weight ?? 400} ${px}px ${GENERIC.has(n.font) ? n.font : `"${n.font}"`}`;

function vectorMetrics(ctx: Ctx, n: TextNode, lines: string[], px: number, letterPx: number) {
  ctx.font = vectorFont(n, px);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width + letterPx * Math.max(0, [...l].length - 1)));
  const lh = px * (n.lineHeight ?? 1.1);
  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent ?? px * 0.8;
  const descent = m.fontBoundingBoxDescent ?? px * 0.2;
  return { width, height: (lines.length - 1) * lh + ascent + descent, lh, ascent, descent };
}

/* -------------------------------------------------------------- measurer */

/**
 * Canvas-backed measurer for the layout engine.
 *
 * With `dpmm` (the render's dots per mm) pixel fonts are measured at the whole
 * dots-per-font-pixel scale they will be drawn at, so boxes hugging them fit the
 * drawn text. Without it sizes are continuous (resolution independent).
 */
export class CanvasMeasurer implements TextMeasurer {
  private ctx = makeCanvas(1, 1).getContext("2d")!;

  constructor(readonly dpmm?: number) {}

  private free?: CanvasMeasurer;
  unsnapped(): TextMeasurer {
    return this.dpmm ? (this.free ??= new CanvasMeasurer()) : this;
  }

  pixelStepPt(n: TextNode) {
    const pf = pixelFont(n.font);
    return pf && this.dpmm ? pf.pxPerEm / (PT_TO_MM * this.dpmm) : undefined;
  }

  measure(n: TextNode, text: string, sizePt: number) {
    const lines = text.split("\n");
    const sizeMm = sizePt * PT_TO_MM;
    const pf = pixelFont(n.font);
    if (pf) {
      const b = pixelBlock(lines, n.font, pf, n.align === "justify");
      const k = this.dpmm ? wholePixelScale((sizeMm * this.dpmm) / pf.pxPerEm) / this.dpmm : sizeMm / pf.pxPerEm;
      // Justified pixel text needs a dot between letters when drawn (see drawPixel).
      const gaps = n.align === "justify" ? (this.dpmm ? maxChars(lines) / this.dpmm : 0) : (n.letterSpacing ?? 0) * maxChars(lines);
      return { w: b.width * k + gaps, h: b.height * k };
    }
    const px = 100;
    const m = vectorMetrics(this.ctx, n, lines, px, 0);
    const k = sizeMm / px;
    return { w: m.width * k + (n.letterSpacing ?? 0) * maxChars(lines), h: m.height * k };
  }

  measureRich(n: TextNode, rich: RichText, sizePt: number) {
    if (this.dpmm && pixelFont(n.font)) {
      // Lay out in dots (whole-dot pixel scales, as drawn), report mm.
      const D = layoutRich(n, rich, sizePt, canvasRichMeasure(this.ctx, this.dpmm));
      return { w: D.w / this.dpmm, h: D.h / this.dpmm };
    }
    const L = layoutRich(n, rich, sizePt, canvasRichMeasure(this.ctx, null));
    return { w: L.w, h: L.h };
  }
}

const maxChars = (lines: string[]) => Math.max(0, ...lines.map((l) => [...l].length - 1));

/* ---------------------------------------------------------------- drawing */

export interface TextBox {
  /** Box in canvas pixels (unrotated, i.e. before applying node.rotate). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Dots per mm. */
  dpmm: number;
}

/** What drawText did, for preflight checks (all in dots unless noted). */
export interface TextFacts {
  /** Size asked for (pt, after template scaling) and size drawn (pt). */
  requestedPt: number;
  usedPt: number;
  /** Height of a capital letter as drawn. */
  capDots: number;
  /** Pixel fonts: printer dots per font pixel (below 1 drops pixels). */
  pixelScale?: number;
  /** Drawn text is larger than its box (minimum size or "never resize" reached). */
  overflow: boolean;
}

/**
 * Draw text fitted into a box. ctx.fillStyle and composite op must be set by the
 * caller (paint). Returns the final size used (pt); `facts` (optional) is
 * filled in with what was drawn.
 */
export function drawText(ctx: Ctx, n: TextNode, text: string, sizePt: number, b: TextBox, facts?: TextFacts): number {
  if (!text.trim()) return sizePt;
  const lines = text.split("\n");
  const turned = n.rotate === 90 || n.rotate === 270;
  const runW = turned ? b.h : b.w;
  const runH = turned ? b.w : b.h;
  const fit = n.fit ?? "shrink";
  const minPt = n.minSizePt ?? 1;
  const color = String(ctx.fillStyle);
  const letterPx = (n.letterSpacing ?? 0) * b.dpmm;

  ctx.save();
  ctx.translate(Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2));
  ctx.rotate(((n.rotate ?? 0) * Math.PI) / 180);

  const pf = pixelFont(n.font);
  let used = sizePt;
  if (pf) used = drawPixel(ctx, n, lines, sizePt, minPt, fit, runW, runH, b.dpmm, pf, color, letterPx, facts);
  else used = drawVector(ctx, n, lines, sizePt, minPt, fit, runW, runH, b.dpmm, letterPx, facts);
  ctx.restore();
  if (facts) {
    facts.requestedPt = sizePt;
    facts.usedPt = used;
  }
  return used;
}

function drawPixel(
  ctx: Ctx, n: TextNode, lines: string[], sizePt: number, minPt: number, fit: string,
  runW: number, runH: number, dpmm: number, pf: PixelFont, color: string, letterPx: number, facts?: TextFacts,
) {
  const justify = n.align === "justify";
  const block = pixelBlock(lines, n.font, pf, justify);
  if (!block.height) return sizePt;
  // Scales are printer dots per font pixel, whole numbers wherever possible:
  // every font pixel becomes the same k x k block of dots, so strokes keep
  // their weight and the text looks like the font at every label size.
  const desired = (sizePt * PT_TO_MM * dpmm) / pf.pxPerEm;
  // Justified letters need about a dot between them, so a scale whose letters
  // would overlap is not picked.
  const extra = justify ? maxChars(lines) : letterPx * maxChars(lines);
  // One dot of slack: boxes are snapped to whole dots, so a box hugging text
  // measured at scale k can come out a dot short of k * size.
  const fitN = Math.min((runW - extra + 1) / block.width, (runH + 1) / block.height);
  const minN = (minPt * PT_TO_MM * dpmm) / pf.pxPerEm;
  const want = wholePixelScale(desired);
  const room = fittingPixelScale(fitN);
  let s = fit === "fixed" ? want : fit === "fill" ? room : Math.min(want, room);
  // The minimum size wins over fitting (the text overflows instead).
  if (fit !== "fixed" && minN > s) s = Math.max(s, Math.min(minN >= 1 ? Math.ceil(minN - 1e-6) : minN, want));

  ctx.imageSmoothingEnabled = false;
  const h = block.height * s;
  const top = n.valign === "top" ? -runH / 2 : n.valign === "bottom" ? runH / 2 - h : -h / 2;
  const tinted = (r: Raster) => tint(r.canvas, color);
  const blit = (r: Raster, x: number, line: number) => {
    const y = top + (line * pf.linePx - r.base - block.top) * s;
    const w = inkW(r);
    ctx.drawImage(tinted(r), r.left, 0, w, r.canvas.height, Math.round(x), Math.round(y), Math.round(w * s), Math.round(r.canvas.height * s));
  };

  block.rows.forEach(({ whole, chars }, i) => {
    if (chars) {
      const widths = chars.map((c) => inkW(c) * s);
      const gap = (runW - widths.reduce((a, w) => a + w, 0)) / (chars.length - 1);
      let x = -runW / 2;
      chars.forEach((c, ci) => {
        if (!c.empty) blit(c, x, i);
        x += widths[ci] + gap;
      });
    } else if (letterPx && !whole.empty) {
      const chars = [...lines[i]].map((ch) => rasterize(ch, n.font, pf));
      const total = chars.reduce((a, c) => a + inkW(c) * s, 0) + letterPx * (chars.length - 1);
      let x = n.align === "left" ? -runW / 2 : n.align === "right" ? runW / 2 - total : -total / 2;
      chars.forEach((c) => {
        if (!c.empty) blit(c, x, i);
        x += inkW(c) * s + letterPx;
      });
    } else if (!whole.empty) {
      const w = inkW(whole) * s;
      const x = n.align === "left" ? -runW / 2 : n.align === "right" ? runW / 2 - w : -w / 2;
      blit(whole, x, i);
    }
  });
  if (facts) {
    const cap = rasterize("H", n.font, pf);
    facts.capDots = (cap.empty ? block.height * 0.7 : -cap.top) * s;
    facts.pixelScale = s;
    facts.overflow = block.width * s + extra > runW + 1 || block.height * s > runH + 1;
  }
  return (s * pf.pxPerEm) / dpmm / PT_TO_MM;
}

/** Pixel-font rasters are black; recolour for white/invert paint. */
const tintCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
export function tint(src: HTMLCanvasElement, color: string) {
  if (color === "#000000" || color === "black") return src;
  let m = tintCache.get(src);
  if (!m) tintCache.set(src, (m = new Map()));
  const hit = m.get(color);
  if (hit) return hit;
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext("2d")!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  m.set(color, c);
  return c;
}

function drawVector(
  ctx: Ctx, n: TextNode, lines: string[], sizePt: number, minPt: number, fit: string,
  runW: number, runH: number, dpmm: number, letterPx: number, facts?: TextFacts,
) {
  const toPx = (pt: number) => pt * PT_TO_MM * dpmm;
  let px = toPx(sizePt);
  let m = vectorMetrics(ctx, n, lines, px, letterPx);
  const fitScale = Math.min(runW / m.width, runH / m.height);
  if (fit === "fill" || (fit === "shrink" && fitScale < 1)) {
    px = Math.max(px * fitScale, fit === "shrink" ? Math.min(toPx(minPt), px) : 1);
    m = vectorMetrics(ctx, n, lines, px, letterPx);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = n.valign === "top" ? -runH / 2 : n.valign === "bottom" ? runH / 2 - m.height : -m.height / 2;
  for (const line of lines) {
    const chars = [...line];
    const baseline = Math.round(y + m.ascent);
    if (n.align === "justify" && chars.length > 1) {
      const widths = chars.map((c) => ctx.measureText(c).width);
      const gap = (runW - widths.reduce((a, w) => a + w, 0)) / (chars.length - 1);
      let x = -runW / 2;
      chars.forEach((c, i) => {
        ctx.fillText(c, x, baseline);
        x += widths[i] + gap;
      });
    } else {
      const lw = ctx.measureText(line).width + letterPx * Math.max(0, chars.length - 1);
      let x = n.align === "left" ? -runW / 2 : n.align === "right" ? runW / 2 - lw : -lw / 2;
      if (letterPx) {
        for (const c of chars) {
          ctx.fillText(c, x, baseline);
          x += ctx.measureText(c).width + letterPx;
        }
      } else ctx.fillText(line, x, baseline);
    }
    y += m.lh;
  }
  if (facts) {
    // Ink extent (not the font's line box), so tall line spacing doesn't count as overflow.
    const ink = lines.map((l) => ctx.measureText(l || " "));
    const up = Math.max(...ink.map((t) => t.actualBoundingBoxAscent ?? m.ascent));
    const down = Math.max(...ink.map((t) => t.actualBoundingBoxDescent ?? m.descent));
    const inkH = (lines.length - 1) * m.lh + Math.max(0, up) + Math.max(0, down);
    facts.capDots = ctx.measureText("H").actualBoundingBoxAscent || px * 0.7;
    facts.overflow = (n.align === "justify" ? 0 : m.width) > runW + 0.5 || inkH > runH + 0.5;
  }
  return px / dpmm / PT_TO_MM;
}
