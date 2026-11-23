/**
 * Greyscale -> 1-bit conversion for images (pure, framework-free).
 *
 * Works on ImageData-like RGBA buffers at device resolution, so every output
 * pixel is exactly one printer dot. Transparent pixels count as white paper.
 */

export type DitherMethod = "threshold" | "floyd-steinberg" | "atkinson" | "ordered";

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DitherOptions {
  method: DitherMethod;
  /** 0-255. Threshold for "threshold"; for the others it shifts brightness (128 = neutral). */
  threshold?: number;
  /** Flip the image (dark <-> light) before converting. Transparent areas stay blank. */
  invert?: boolean;
}

/** Luminance 0 (black) - 255 (white), alpha composited over white. */
export function toGray(img: RgbaImage, invert = false): Float32Array {
  const { data: d, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (invert) lum = 255 - lum;
    const a = d[i + 3] / 255;
    out[p] = a * lum + (1 - a) * 255;
  }
  return out;
}

/** 8x8 Bayer matrix (values 0-63). */
export const BAYER8 = (() => {
  const m = new Uint8Array(64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      // Bit-interleave of x ^ y and y, reversed: the classic recursive construction.
      let v = 0;
      const xy = x ^ y;
      for (let bit = 0; bit < 3; bit++) v |= (((xy >> bit) & 1) << (5 - 2 * bit)) | (((y >> bit) & 1) << (4 - 2 * bit));
      m[y * 8 + x] = v;
    }
  return m;
})();

type Kernel = [dx: number, dy: number, weight: number][];
const FLOYD: Kernel = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
// Atkinson spreads only 6/8 of the error: crisper, keeps highlights clean.
const ATKINSON: Kernel = [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];

/**
 * Convert a greyscale buffer to dots. Returns 1 where a dot prints (dark), 0 otherwise.
 */
export function ditherGray(gray: Float32Array, width: number, height: number, o: Pick<DitherOptions, "method" | "threshold">): Uint8Array {
  const t = o.threshold ?? 128;
  const out = new Uint8Array(width * height);
  if (o.method === "threshold") {
    for (let i = 0; i < out.length; i++) out[i] = gray[i] < t ? 1 : 0;
    return out;
  }
  const bias = 128 - t; // >0 lightens, <0 darkens
  if (o.method === "ordered") {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const level = ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) * 255;
        out[i] = gray[i] + bias < level ? 1 : 0;
      }
    return out;
  }
  const kernel = o.method === "atkinson" ? ATKINSON : FLOYD;
  const buf = Float32Array.from(gray, (v) => v + bias);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const dot = old < 128;
      out[i] = dot ? 1 : 0;
      const err = old - (dot ? 0 : 255);
      for (const [dx, dy, wgt] of kernel) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < width && yy < height) buf[yy * width + xx] += err * wgt;
      }
    }
  return out;
}

/** RGBA image -> dot mask (1 = print). */
export const ditherImage = (img: RgbaImage, o: DitherOptions) => ditherGray(toGray(img, o.invert), img.width, img.height, o);

/** Contain / cover / stretch an image of size iw x ih into a box: draw rect relative to the box. */
export function fitRect(iw: number, ih: number, bw: number, bh: number, fit: "contain" | "cover" | "stretch") {
  if (fit === "stretch" || !iw || !ih) return { x: 0, y: 0, w: bw, h: bh };
  const k = fit === "contain" ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
  const w = iw * k, h = ih * k;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}
