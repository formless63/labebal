/**
 * Font inspection: family name and pixel-font grid detection (framework-free,
 * runs in the browser before upload and in Node scripts/tests).
 *
 * A pixel font draws every outline point on a square grid. We look for the
 * coarsest grid (fewest font pixels per em) on which the outline points and
 * advance widths of the alphanumerics land, within a small tolerance.
 */
/// <reference path="./opentype.d.ts" />
import * as opentype from "opentype.js";
import type { Font } from "opentype.js";
import type { PixelFont } from "./fonts";

// ESM build exports `parse`; Node loading the CJS build only exposes it on the default export.
const parse: typeof opentype.parse = opentype.parse ?? (opentype as unknown as { default: typeof opentype }).default.parse;

export interface FontInfo {
  family: string;
  /** Detected pixel grid, if the font looks like a pixel font. */
  pixel?: PixelFont;
  unitsPerEm: number;
}

const SAMPLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const toArrayBuffer = (b: ArrayBuffer | Uint8Array): ArrayBuffer =>
  b instanceof Uint8Array ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : b;

function familyOf(font: Font): string {
  const names = font.names as unknown as Record<string, Record<string, Record<string, string>> | undefined>;
  for (const table of [names.windows, names.macintosh, names.unicode, names as unknown as Record<string, Record<string, string>>]) {
    const n = table?.preferredFamily ?? table?.typographicFamily ?? table?.fontFamily;
    const v = n?.en ?? (n && Object.values(n)[0]);
    if (v) return v;
  }
  return "";
}

/** Fraction of values more than 10% of a step away from the grid (rounding of non-integer steps is fine). */
export function offGridFraction(values: number[], step: number) {
  let off = 0;
  for (const v of values) {
    const r = v / step;
    if (Math.abs(r - Math.round(r)) > 0.1) off++;
  }
  return values.length ? off / values.length : 1;
}

/**
 * Coarsest pixels-per-em (integer, 4..64) on which (almost) every coordinate
 * lands, or undefined for a regular (non-pixel) font. A coarser grid that most
 * points happen to fit (e.g. 8 for a 16 px font) is rejected by the strict
 * `maxOff` fraction.
 */
export function detectGrid(values: number[], unitsPerEm: number, maxOff = 0.002): number | undefined {
  if (values.length < 20) return undefined;
  for (let px = 4; px <= 64; px++) if (offGridFraction(values, unitsPerEm / px) <= maxOff) return px;
  return undefined;
}

/** Inspect a TTF / OTF / WOFF file. Throws if it cannot be parsed. */
export function inspectFont(buffer: ArrayBuffer | Uint8Array): FontInfo {
  const font = parse(toArrayBuffer(buffer));
  const values: number[] = [];
  for (const ch of SAMPLE) {
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) continue;
    for (const c of g.path.commands as { x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]) {
      for (const k of ["x", "y", "x1", "y1", "x2", "y2"] as const) if (c[k] !== undefined) values.push(c[k]!);
    }
    if (g.advanceWidth !== undefined) values.push(g.advanceWidth);
  }
  const upm = font.unitsPerEm;
  const pxPerEm = detectGrid(values, upm);
  let pixel: PixelFont | undefined;
  if (pxPerEm) {
    const step = upm / pxPerEm;
    const hhea = font.tables.hhea as { ascender?: number; descender?: number; lineGap?: number } | undefined;
    const asc = hhea?.ascender ?? font.ascender;
    const desc = Math.abs(hhea?.descender ?? font.descender);
    const linePx = Math.max(1, Math.round((asc + desc + (hhea?.lineGap ?? 0)) / step));
    pixel = { pxPerEm, linePx };
  }
  return { family: familyOf(font), pixel, unitsPerEm: upm };
}

/** Pixel grid of a font file, or undefined for regular fonts. */
export const detectPixelGrid = (buffer: ArrayBuffer | Uint8Array) => inspectFont(buffer).pixel;
