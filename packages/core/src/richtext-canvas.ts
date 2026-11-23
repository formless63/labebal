/**
 * Rich text on canvas: run metrics (vector and pixel fonts) and drawing.
 * Layout maths is in richtext.ts.
 */
import { pixelFont, wholePixelScale, type PixelFont } from "./fonts";
import { paintIconAt } from "./elements";
import { ICON_SIDE, fitRich, type RichMeasure, type RichText } from "./richtext";
import type { TextNode } from "./schema";
import { rasterize, tint, vectorFont, type TextBox } from "./text";

const PT_TO_MM = 25.4 / 72;
type Ctx = CanvasRenderingContext2D;

/**
 * Whole dots per font pixel (same rule as plain pixel text, `wholePixelScale`),
 * so every run stays crisp with even strokes. fitRich shrinks the size until the
 * snapped layout fits. Continuous when measuring in mm (dpmm null).
 */
export function pixelScale(sizePt: number, pf: PixelFont, dpmm: number | null) {
  const k = (sizePt * PT_TO_MM * (dpmm ?? 1)) / pf.pxPerEm;
  return dpmm === null ? k : wholePixelScale(k);
}

/**
 * Run metrics in mm (`dpmm` null, used by layout) or device px (drawing).
 * Pixel fonts use advances and ink bounds of their native bitmaps.
 */
export function canvasRichMeasure(ctx: Ctx, dpmm: number | null): RichMeasure {
  const unit = dpmm ?? 1;
  return {
    run(n, text, sizePt, bold) {
      const pf = pixelFont(n.font);
      if (pf) {
        const k = pixelScale(sizePt, pf, dpmm);
        const ref = rasterize("Hg", n.font, pf);
        const cap = rasterize("H", n.font, pf);
        const adv = text ? rasterize(text, n.font, pf).advance + (bold ? 1 : 0) : 0;
        return { w: adv * k, ascent: -ref.top * k, descent: ref.bottom * k, cap: -cap.top * k, line: pf.linePx * k };
      }
      const px = sizePt * PT_TO_MM * unit;
      ctx.font = vectorFont({ ...n, weight: bold ? 700 : n.weight }, px);
      const m = ctx.measureText(text || "Hg");
      const h = ctx.measureText("H");
      return {
        w: text ? m.width : 0,
        ascent: m.fontBoundingBoxAscent ?? px * 0.8,
        descent: m.fontBoundingBoxDescent ?? px * 0.2,
        cap: h.actualBoundingBoxAscent || px * 0.7,
        line: px * (n.lineHeight ?? 1.1),
      };
    },
  };
}

/**
 * Draw rich text fitted into a box (same contract as drawText: the caller sets
 * the paint). Returns the base size used (pt).
 */
export function drawRich(ctx: Ctx, n: TextNode, rich: RichText, sizePt: number, b: TextBox): number {
  const turned = n.rotate === 90 || n.rotate === 270;
  const runW = turned ? b.h : b.w;
  const runH = turned ? b.w : b.h;
  const m = canvasRichMeasure(ctx, b.dpmm);
  const { sizePt: used, layout: L } = fitRich(n, rich, sizePt, runW, runH, m);
  if (!L.w && !L.h) return used;
  const color = String(ctx.fillStyle);
  const op = ctx.globalCompositeOperation;
  const pf = pixelFont(n.font);

  ctx.save();
  ctx.translate(Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2));
  ctx.rotate(((n.rotate ?? 0) * Math.PI) / 180);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.imageSmoothingEnabled = !pf;

  const top = n.valign === "top" ? -runH / 2 : n.valign === "bottom" ? runH / 2 - L.h : -L.h / 2;
  for (const line of L.lines) {
    const x0 = n.align === "left" ? -runW / 2 : n.align === "right" ? runW / 2 - line.w : -line.w / 2;
    const base = Math.round(top + line.baseline);
    for (const it of line.items) {
      const x = Math.round(x0 + it.x);
      const p = it.piece;
      const paint = p.invert ? "#ffffff" : color;
      if (p.invert) {
        // Flip the run's line box, then draw the glyphs flipping it back.
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, base - Math.round(line.ascent), Math.round(it.w), Math.round(line.ascent + line.descent));
      } else {
        ctx.globalCompositeOperation = op;
        ctx.fillStyle = color;
      }
      if (p.kind === "icon") {
        const pad = it.cap * ICON_SIDE;
        paintIconAt(ctx, p.icon, x + pad, base - it.cap, it.cap);
      } else if (pf) {
        const k = pixelScale(it.sizePt, pf, b.dpmm);
        const r = rasterize(p.text, n.font, pf);
        const img = tint(r.canvas, paint === "#ffffff" ? "#ffffff" : color);
        const dx = x - pf.pxPerEm * k; // rasters are drawn `pxPerEm` px in from their left edge
        const dy = base - r.base * k;
        const draw = (off: number) => ctx.drawImage(img, 0, 0, r.canvas.width, r.canvas.height, Math.round(dx + off), Math.round(dy), Math.round(r.canvas.width * k), Math.round(r.canvas.height * k));
        draw(0);
        if (p.bold) draw(Math.max(1, Math.round(k)));
      } else {
        ctx.font = vectorFont({ ...n, weight: p.bold ? 700 : n.weight }, it.sizePt * PT_TO_MM * b.dpmm);
        ctx.fillText(p.text, x, base);
      }
    }
  }
  ctx.restore();
  return used;
}
