/**
 * 1-bit images: pull the dot pattern out of a rendered label canvas and write
 * it as a tiny 1-bit greyscale PNG (history thumbnails, PNG export). Pure
 * except for `CompressionStream` (browsers, Node 18+).
 */

/** A 1-bit bitmap, row-major, one byte per pixel (1 = dot / black). */
export interface Bitmap {
  w: number;
  h: number;
  dots: Uint8Array;
}

/** Dots of a rendered label canvas (anything darker than mid-grey is a dot). */
export function canvasBitmap(canvas: HTMLCanvasElement): Bitmap {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const dots = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < dots.length; i += 4, p++) dots[p] = d[i] < 128 && d[i + 3] > 0 ? 1 : 0;
  return { w, h, dots };
}

/** Halve a bitmap by `factor` (a dot survives when any source dot in its cell is set). */
export function shrinkBitmap(b: Bitmap, factor: number): Bitmap {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return b;
  const w = Math.ceil(b.w / f), h = Math.ceil(b.h / f);
  const dots = new Uint8Array(w * h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.dots[y * b.w + x]) dots[Math.floor(y / f) * w + Math.floor(x / f)] = 1;
  return { w, h, dots };
}

/** Pack rows MSB-first, `ceil(w/8)` bytes each; `dotBit` is the bit a dot gets (PNG grey: 0 = black). */
export function packRows(b: Bitmap, dotBit: 0 | 1, filterByte = false): Uint8Array {
  const stride = Math.ceil(b.w / 8);
  const rowLen = stride + (filterByte ? 1 : 0);
  const out = new Uint8Array(rowLen * b.h);
  if (dotBit === 0) out.fill(0xff);
  for (let y = 0; y < b.h; y++) {
    const row = y * rowLen + (filterByte ? 1 : 0);
    if (filterByte) out[y * rowLen] = 0;
    for (let x = 0; x < b.w; x++) {
      if (!b.dots[y * b.w + x]) continue;
      const i = row + (x >> 3), bit = 0x80 >> (x & 7);
      if (dotBit) out[i] |= bit;
      else out[i] &= ~bit;
    }
  }
  return out;
}

/** zlib-wrapped deflate (what PNG IDAT and PDF FlateDecode expect). */
export async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let crcTable: Uint32Array | null = null;
/** Standard CRC-32 (PNG chunks). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

/** Encode a bitmap as a 1-bit greyscale PNG (dots black, rest white). `dpmm` adds a pHYs chunk (true size). */
export async function encodePng1(b: Bitmap, dpmm?: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(b.w), 0);
  ihdr.set(u32(b.h), 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // greyscale
  const idat = await zlibDeflate(packRows(b, 0, true)); // grey 0 = black = dot
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (dpmm) {
    const ppm = Math.round(dpmm * 1000);
    parts.push(chunk("pHYs", new Uint8Array([...u32(ppm), ...u32(ppm), 1])));
  }
  parts.push(chunk("IDAT", idat), chunk("IEND", new Uint8Array()));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

export function toBase64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** `data:image/png;base64,...` thumbnail of a bitmap, shrunk until it has at most `maxPixels`. */
export async function bitmapThumb(b: Bitmap, maxPixels = 160_000): Promise<string> {
  let f = 1;
  while ((b.w / f) * (b.h / f) > maxPixels) f++;
  return `data:image/png;base64,${toBase64(await encodePng1(shrinkBitmap(b, f)))}`;
}
