import { createCanvas } from "./canvas";
/**
 * Dot-mask helpers shared by the element painters and text outlines.
 *
 * A mask is a Uint8Array of width*height, 1 = dot. Painting a mask goes
 * through an offscreen canvas so black / white / invert paints behave the same
 * for every element type (an inverted shape flips each dot exactly once, even
 * where strokes overlap).
 */

/** Morphological dilation by `r` dots: "square" (pixel-art look) or "disk" (round outline). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number, shape: "square" | "disk" = "disk"): Uint8Array {
  r = Math.max(0, Math.round(r));
  if (!r) return mask.slice();
  // Horizontal dilation of every row by each half-width we need.
  const halfWidths = shape === "square" ? [r] : [...new Set(Array.from({ length: r + 1 }, (_, dy) => Math.floor(Math.sqrt(r * r - dy * dy + 1e-9))))];
  const horiz = new Map<number, Uint8Array>();
  for (const hw of halfWidths) horiz.set(hw, dilateRows(mask, w, h, hw));
  const out = new Uint8Array(w * h);
  for (let dy = -r; dy <= r; dy++) {
    const hw = shape === "square" ? r : Math.floor(Math.sqrt(r * r - dy * dy + 1e-9));
    const src = horiz.get(hw)!;
    for (let y = 0; y < h; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= h) continue;
      const o = y * w, s = sy * w;
      for (let x = 0; x < w; x++) if (src[s + x]) out[o + x] = 1;
    }
  }
  return out;
}

/** Dilate each row by hw (running count of set pixels in a sliding window). */
function dilateRows(mask: Uint8Array, w: number, h: number, hw: number) {
  if (!hw) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(hw, w); x++) count += mask[o + x];
    for (let x = 0; x < w; x++) {
      const add = x + hw, drop = x - hw - 1;
      if (add < w) count += mask[o + add];
      if (drop >= 0) count -= mask[o + drop];
      out[o + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

/** a AND NOT b */
export function subtract(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && !b[i] ? 1 : 0;
  return out;
}

/* ------------------------------------------------------- canvas (browser) */

/** Uses the shared canvas factory, so headless renders (tests, workers) work too. */
export const makeCanvas = (w: number, h: number) => createCanvas(w, h);

/** Mask of a canvas's alpha (or darkness, when `dark`): 1 where >= 50%. */
export function maskOf(c: HTMLCanvasElement, dark = false): Uint8Array {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = dark ? (d[i + 3] >= 128 && d[i] + d[i + 1] + d[i + 2] < 384 ? 1 : 0) : d[i + 3] >= 128 ? 1 : 0;
  }
  return out;
}

/** Mask -> canvas: dots in `color`, everything else transparent. */
export function maskCanvas(mask: Uint8Array, w: number, h: number, color: string): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = c.getContext("2d")!;
  const img = x.createImageData(w, h);
  const [r, g, b] = color === "#ffffff" || color === "white" ? [255, 255, 255] : [0, 0, 0];
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (!mask[p]) continue;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/**
 * Draw a mask at (x, y) using the paint currently set on ctx (fillStyle +
 * composite op, see render's usePaint).
 */
export function paintMask(ctx: CanvasRenderingContext2D, mask: Uint8Array, w: number, h: number, x: number, y: number) {
  ctx.drawImage(maskCanvas(mask, w, h, String(ctx.fillStyle)), Math.round(x), Math.round(y));
}
