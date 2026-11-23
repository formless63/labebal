/**
 * Printing on ZPL printers (Zebra and compatibles): a rendered 1-bit label
 * becomes one ZPL format with the image as a compressed ^GFA graphic.
 *
 * Pure apart from reading canvas pixels; `bitsToZpl` / `zplGraphic` work on a
 * plain bitmap (tests). The bytes go to the printer through whatever link the
 * app has (labebal: the server's network relay, see the app's net printers).
 */
import type { MediaKind, ThermalKind } from "./media";

/** 1-bit image, rows of `bytesPerRow` bytes, MSB = leftmost dot, 1 = print. */
export interface Bitmap1 {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
}

/** Dark pixels of a canvas (luminance < 50%, not transparent). `rotate` turns it 90° clockwise first. */
export function canvasBits(canvas: HTMLCanvasElement, rotate = false): Bitmap1 {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  const { width: cw, height: ch } = canvas;
  const px = ctx.getImageData(0, 0, cw, ch).data;
  const width = rotate ? ch : cw;
  const height = rotate ? cw : ch;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Clockwise: output (x, y) comes from source (y, ch - 1 - x).
      const sx = rotate ? y : x;
      const sy = rotate ? ch - 1 - x : y;
      const i = (sy * cw + sx) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (px[i + 3] > 127 && lum < 128) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bytesPerRow, data };
}

const HEX = "0123456789ABCDEF";

/** ZPL repeat count prefix: G..Y = 1..19, g..z = 20..400 (summed). */
function repeat(n: number, ch: string): string {
  if (n === 1) return ch;
  let out = "";
  while (n >= 400) {
    out += "z";
    n -= 400;
  }
  if (n >= 20) {
    out += String.fromCharCode("f".charCodeAt(0) + Math.floor(n / 20)); // g = 20
    n %= 20;
  }
  if (n > 0) out += String.fromCharCode("F".charCodeAt(0) + n); // G = 1
  return out + ch;
}

/** One row as compressed hex: runs of a digit get a count; trailing zeros become ",", trailing F's "!". */
function compressRow(hex: string): string {
  const zeros = /0+$/.exec(hex);
  const ones = /F+$/.exec(hex);
  let body = hex;
  let tail = "";
  if (zeros && zeros[0].length > 1) {
    body = hex.slice(0, zeros.index);
    tail = ",";
  } else if (ones && ones[0].length > 1) {
    body = hex.slice(0, ones.index);
    tail = "!";
  }
  let out = "";
  for (let i = 0; i < body.length; ) {
    let j = i;
    while (j < body.length && body[j] === body[i]) j++;
    out += repeat(j - i, body[i]);
    i = j;
  }
  return out + tail;
}

/** ^GFA graphic field for a bitmap (ZPL ASCII compression; ":" repeats the previous row). */
export function zplGraphic(b: Bitmap1): string {
  const total = b.bytesPerRow * b.height;
  let prev = "";
  let body = "";
  for (let y = 0; y < b.height; y++) {
    let hex = "";
    for (let x = 0; x < b.bytesPerRow; x++) {
      const v = b.data[y * b.bytesPerRow + x];
      hex += HEX[v >> 4] + HEX[v & 15];
    }
    body += hex === prev ? ":" : compressRow(hex);
    prev = hex;
  }
  return `^GFA,${total},${total},${b.bytesPerRow},${body}`;
}

export interface ZplLabelOptions {
  /** Copies of this label (^PQ). */
  qty: number;
  /** Label length along the feed in dots (^LL); default the bitmap height. */
  lengthDots?: number;
  mediaKind?: MediaKind;
  thermal?: ThermalKind;
  /** Darkness relative to the printer's own setting, -30..30 (^MD); 0 / undefined = unchanged. */
  darkness?: number;
  /** Shift the image right / down, dots (calibration). Negative values crop. */
  offsetX?: number;
  offsetY?: number;
}

/** ^MN media tracking for a media kind. */
const tracking = (k: MediaKind | undefined) => (k === "continuous" ? "N" : k === "black-mark" ? "M" : "Y");

/** One complete ZPL format: setup, the image, quantity. */
export function bitsToZpl(b: Bitmap1, o: ZplLabelOptions): string {
  const parts = ["^XA", "^CI28", `^PW${b.width}`, `^LL${o.lengthDots ?? b.height}`, "^LH0,0", "^LS0", `^MN${tracking(o.mediaKind)}`];
  if (o.thermal) parts.push(o.thermal === "transfer" ? "^MTT" : "^MTD");
  if (o.darkness) parts.push(`^MD${Math.max(-30, Math.min(30, Math.round(o.darkness)))}`);
  parts.push(`^FO${Math.max(0, Math.round(o.offsetX ?? 0))},${Math.max(0, Math.round(o.offsetY ?? 0))}${zplGraphic(b)}^FS`);
  parts.push(`^PQ${Math.max(1, Math.trunc(o.qty))},0,1,Y`, "^XZ");
  return parts.join("");
}

/** A rendered label canvas as ZPL. `direction: "left"` = the image is turned (tape-style sizes). */
export function canvasToZpl(canvas: HTMLCanvasElement, o: ZplLabelOptions & { direction?: "left" | "top" }): string {
  return bitsToZpl(canvasBits(canvas, o.direction === "left"), o);
}

/* ------------------------------------------------------------ printer replies */

export interface ZplHostStatus {
  paperOut: boolean;
  paused: boolean;
  headOpen: boolean;
  ribbonOut: boolean;
  /** Printer is in thermal transfer mode (else direct thermal). */
  thermalTransfer: boolean;
  /** Labels still to print in the current batch. */
  remaining: number;
  /** Formats waiting in the receive buffer. */
  queued: number;
  underTemp: boolean;
  overTemp: boolean;
  /** Plain words for the first problem, if any. */
  problem?: string;
}

/** Parse the reply to ~HS (three STX ... ETX strings). */
export function parseHostStatus(reply: string): ZplHostStatus | null {
  const parts = [...reply.matchAll(/\x02([^\x03]*)\x03/g)].map((m) => m[1].split(","));
  if (parts.length < 2) return null;
  const [a, b] = parts;
  const flag = (v: string | undefined) => v?.trim() === "1";
  const s: ZplHostStatus = {
    paperOut: flag(a[1]),
    paused: flag(a[2]),
    queued: Number(a[4]) || 0,
    underTemp: flag(a[10]),
    overTemp: flag(a[11]),
    headOpen: flag(b[2]),
    ribbonOut: flag(b[3]),
    thermalTransfer: flag(b[4]),
    remaining: Number(b[8]) || 0,
  };
  s.problem = s.headOpen
    ? "The printhead is open."
    : s.paperOut
      ? "Out of labels (or the labels aren't seen)."
      : s.ribbonOut
        ? "Out of ribbon."
        : s.overTemp
          ? "The printhead is too hot."
          : s.underTemp
            ? "The printhead is too cold."
            : s.paused
              ? "The printer is paused (press its pause button)."
              : undefined;
  return s;
}

export interface ZplIdentity {
  model: string;
  firmware: string;
  /** Dots per mm (8 = 203 dpi, 12 = 300 dpi, 24 = 600 dpi). */
  dpmm: number;
}

/** Parse the reply to ~HI, e.g. "ZD500-200dpi,V74.20.22Z,8,4096KB". */
export function parseHostIdentity(reply: string): ZplIdentity | null {
  const m = /\x02?([^,\x02\x03]+),([^,]*),(\d+),/.exec(reply);
  if (!m) return null;
  return { model: m[1].trim(), firmware: m[2].trim(), dpmm: Number(m[3]) };
}

export interface ZplConfig {
  /** Print width setting, dots. */
  printWidth?: number;
  /** Full head width, dots (from RESOLUTION, e.g. "832 8/MM FULL"). */
  headDots?: number;
  dpmm?: number;
  labelLength?: number;
  darkness?: number;
  /** "DIRECT-THERMAL" / "THERMAL-TRANS." */
  method?: "direct" | "transfer";
  /** "GAP/NOTCH", "CONTINUOUS", "MARK". */
  mediaType?: string;
}

/** Parse the reply to ^HH (the configuration label as text). */
export function parseHostConfig(reply: string): ZplConfig {
  const lines = reply.replace(/[\x02\x03]/g, "").split(/\r?\n/);
  const get = (name: RegExp) => {
    const l = lines.find((x) => name.test(x));
    return l ? l.replace(name, "").trim() : undefined;
  };
  const c: ZplConfig = {};
  const pw = get(/\s{2,}PRINT WIDTH\s*$/);
  if (pw) c.printWidth = Number(pw) || undefined;
  const ll = get(/\s{2,}LABEL LENGTH\s*$/);
  if (ll) c.labelLength = Number(ll) || undefined;
  const dk = get(/\s{2,}DARKNESS\s*$/);
  if (dk) c.darkness = Number(dk) || undefined;
  const pm = get(/\s{2,}PRINT METHOD\s*$/);
  if (pm) c.method = /TRANS/i.test(pm) ? "transfer" : "direct";
  const mt = get(/\s{2,}MEDIA TYPE\s*$/);
  if (mt) c.mediaType = mt;
  const res = get(/\s{2,}RESOLUTION\s*$/);
  const rm = res && /(\d+)\s+(\d+)\/MM/i.exec(res);
  if (rm) {
    c.headDots = Number(rm[1]);
    c.dpmm = Number(rm[2]);
  }
  return c;
}
