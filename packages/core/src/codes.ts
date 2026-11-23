/**
 * Barcodes and 2D codes.
 *
 * 2D: QR, Micro QR, rMQR (rectangular Micro QR), Data Matrix (square and
 * rectangular), GS1 Data Matrix, GS1 QR, PDF417, Aztec, DotCode, Han Xin,
 * Swiss QR. 1D: Code 128, GS1-128, Code 39 (and full ASCII), Code 93,
 * Interleaved 2 of 5, Codabar, MSI Plessey, Pharmacode, EAN-13 / EAN-8 /
 * UPC-A / UPC-E (with 2- or 5-digit add-ons), ITF-14, GS1 DataBar (and
 * Expanded). Postal (4-state bars): USPS Intelligent Mail, Royal Mail.
 *
 * Symbols are encoded with bwip-js (loaded lazily: it is large) into a module
 * matrix / bar widths, then laid out so every module is a whole number of
 * printer dots: the largest integer module size that fits the box, centred.
 * Fractional modules would be smeared by the 1-bit conversion and hurt
 * scannability.
 *
 * Non-square 2D symbols get width / height fitting: rMQR comes in 32 fixed
 * shapes and PDF417 in any column count, so the encoder returns every shape
 * that holds the value and `layoutCode` picks the one with the biggest module
 * for the box. PDF417 rows are several modules tall (`rowRatio`).
 */
import type { CodeFormat } from "./schema";

export interface Encoded2d {
  kind: "2d";
  cols: number;
  rows: number;
  bits: Uint8Array;
  /** Row height in module widths (PDF417: 3, at least 2). Square modules when absent. */
  rowRatio?: number;
  /** Other shapes holding the same value (rMQR versions, PDF417 column counts); layout picks the best fit. */
  shapes?: Encoded2d[];
}

export type EncodedCode =
  | Encoded2d
  | {
      kind: "1d";
      /** Alternating bar / space widths in modules, starting with a bar. */
      widths: number[];
      /** Per bar: true for guard bars that extend into the text (EAN / UPC). */
      guards: boolean[];
      /**
       * Per bar: vertical extent as fractions of the bar area, from the top
       * ([0, 1] = full height). Set for postal 4-state codes and EAN / UPC
       * add-ons (shorter bars with their digits above).
       */
      spans?: [number, number][];
      modules: number;
      /** Human-readable characters positioned in modules (EAN / UPC); otherwise the whole text centred. `top`: an add-on digit, printed above its bars. */
      chars?: { ch: string; x: number; top?: boolean }[];
      text: string;
    };

type RawFn = (opts: Record<string, unknown>) => Array<Record<string, unknown>>;
let raw: RawFn | null = null;
let loading: Promise<void> | null = null;

/** Load the encoder (idempotent). Painting codes before this shows a placeholder. */
export function loadCodeEncoder(): Promise<void> {
  loading ??= import("bwip-js/browser").then((m) => {
    raw = (m.default as unknown as { raw: RawFn }).raw;
  });
  return loading;
}
export const codeEncoderReady = () => raw !== null;

/* ------------------------------------------------------------- format info */

export interface CodeFormatInfo {
  label: string;
  /** Picker group. */
  group: "2D codes" | "Barcodes" | "Retail" | "GS1" | "Postal";
  bcid: string;
  /** Shape of the symbol: square 2D, rectangular 2D (rMQR, PDF417) or linear. */
  shape: "square" | "rect" | "1d";
  /** Standard quiet zone in modules (each side). */
  quiet: number;
  /** Error-correction levels the format accepts (QR naming). */
  ecc?: ("L" | "M" | "Q" | "H")[];
  /** What it holds, in plain words (editor hint and error messages). */
  holds: string;
  /** A value that encodes, e.g. for a new node or a hint. */
  example: string;
  /** Upper-case the value before encoding (Code 39 / 93 have no lower case). */
  upper?: boolean;
  /** Fixed versions ("rows x cols") tried for rectangular symbols; layout picks the best fit for the box. */
  versions?: string[];
  /** Extra encoder options. */
  opts?: Record<string, unknown>;
}

export const CODE_FORMATS: Record<CodeFormat, CodeFormatInfo> = {
  qrcode: { label: "QR code", group: "2D codes", bcid: "qrcode", shape: "square", quiet: 4, ecc: ["L", "M", "Q", "H"], holds: "any text or a web address", example: "https://example.com" },
  microqr: { label: "Micro QR", group: "2D codes", bcid: "microqrcode", shape: "square", quiet: 2, ecc: ["L", "M", "Q"], holds: "short values: up to 35 digits or 21 letters", example: "A-1234" },
  rmqr: {
    label: "Rectangular Micro QR (rMQR)",
    group: "2D codes",
    bcid: "rectangularmicroqrcode",
    shape: "rect",
    quiet: 2,
    ecc: ["M", "H"],
    holds: "short text; a long thin QR that suits narrow labels",
    example: "SKU-00042",
  },
  datamatrix: { label: "Data Matrix", group: "2D codes", bcid: "datamatrix", shape: "square", quiet: 1, holds: "any text", example: "HELLO 123" },
  datamatrixrect: {
    label: "Data Matrix, rectangular",
    group: "2D codes",
    bcid: "datamatrixrectangular",
    shape: "rect",
    quiet: 1,
    holds: "short text; a flat Data Matrix for narrow labels",
    example: "SKU-00042",
    versions: ["8x18", "8x32", "12x26", "12x36", "16x36", "16x48"],
  },
  aztec: { label: "Aztec", group: "2D codes", bcid: "azteccode", shape: "square", quiet: 0, holds: "any text", example: "HELLO 123" },
  pdf417: { label: "PDF417", group: "2D codes", bcid: "pdf417", shape: "rect", quiet: 2, holds: "any text (long, stacked barcode)", example: "HELLO 123" },
  dotcode: { label: "DotCode", group: "2D codes", bcid: "dotcode", shape: "rect", quiet: 3, holds: "any text (made for fast inkjet and laser marking)", example: "HELLO 123" },
  hanxin: { label: "Han Xin", group: "2D codes", bcid: "hanxin", shape: "square", quiet: 3, holds: "any text, including Chinese characters", example: "HELLO 123" },
  swissqr: {
    label: "Swiss QR (payment slip)",
    group: "2D codes",
    bcid: "swissqrcode",
    shape: "square",
    quiet: 4,
    holds: "a Swiss QR-bill payload (lines SPC, 0200, 1, then the account, creditor and amount)",
    example: "SPC\n0200\n1\nCH4431999123000889012\nS\nRobert Schneider AG\nRue du Lac\n1268\n2501\nBiel\nCH\n\n\n\n\n\n\n\n199.95\nCHF\n\n\n\n\n\n\n\nNON\n\n\nEPD",
  },
  code128: { label: "Barcode (Code 128)", group: "Barcodes", bcid: "code128", shape: "1d", quiet: 10, holds: "letters, digits and symbols", example: "ABC-123" },
  code39: { label: "Barcode (Code 39)", group: "Barcodes", bcid: "code39", shape: "1d", quiet: 10, holds: "capital letters A-Z, digits and - . $ / + % space", example: "ABC-123", upper: true },
  code39ext: { label: "Barcode (Code 39, full ASCII)", group: "Barcodes", bcid: "code39ext", shape: "1d", quiet: 10, holds: "any plain text (letters, digits, symbols, lower case)", example: "Abc-123" },
  code93: { label: "Barcode (Code 93)", group: "Barcodes", bcid: "code93", shape: "1d", quiet: 10, holds: "capital letters A-Z, digits and - . $ / + % space", example: "ABC-123", upper: true },
  itf: { label: "Interleaved 2 of 5", group: "Barcodes", bcid: "interleaved2of5", shape: "1d", quiet: 10, holds: "digits only (an odd count gets a leading 0)", example: "12345670" },
  codabar: {
    label: "Codabar",
    group: "Barcodes",
    bcid: "rationalizedCodabar",
    shape: "1d",
    quiet: 10,
    holds: "digits and - $ : / . +, optionally wrapped in start / stop letters A-D (A is used when left off)",
    example: "A40156B",
    upper: true,
  },
  msi: { label: "MSI Plessey", group: "Barcodes", bcid: "msi", shape: "1d", quiet: 12, holds: "digits only (a check digit is added)", example: "1234567", opts: { includecheck: true } },
  pharmacode: { label: "Pharmacode", group: "Barcodes", bcid: "pharmacode", shape: "1d", quiet: 6, holds: "a whole number from 3 to 131070", example: "1234" },
  ean13: {
    label: "EAN-13",
    group: "Retail",
    bcid: "ean13",
    shape: "1d",
    quiet: 11,
    holds: "12 digits (the 13th, a check digit, is added); add a space and 2 or 5 digits for an add-on",
    example: "590123412345",
  },
  ean8: { label: "EAN-8", group: "Retail", bcid: "ean8", shape: "1d", quiet: 7, holds: "7 digits (the 8th, a check digit, is added)", example: "9638507" },
  upca: {
    label: "UPC-A",
    group: "Retail",
    bcid: "upca",
    shape: "1d",
    quiet: 9,
    holds: "11 digits (the 12th, a check digit, is added); add a space and 2 or 5 digits for an add-on",
    example: "03600029145",
  },
  upce: {
    label: "UPC-E (small packs)",
    group: "Retail",
    bcid: "upce",
    shape: "1d",
    quiet: 9,
    holds: "6 or 7 digits starting 0 or 1 (a check digit is added); add a space and 2 or 5 digits for an add-on",
    example: "0123456",
  },
  itf14: { label: "ITF-14 (cartons)", group: "Retail", bcid: "itf14", shape: "1d", quiet: 10, holds: "13 digits (the 14th, a check digit, is added)", example: "0001234560001" },
  gs1_128: {
    label: "GS1-128",
    group: "GS1",
    bcid: "gs1-128",
    shape: "1d",
    quiet: 10,
    holds: "GS1 data with the application identifiers in brackets, e.g. (01)09521234543213(10)LOT42",
    example: "(01)09521234543213(10)LOT42",
  },
  databar: { label: "GS1 DataBar", group: "GS1", bcid: "databaromni", shape: "1d", quiet: 1, holds: "a GTIN as (01) and 13 or 14 digits, e.g. (01)09521234543213", example: "(01)09521234543213" },
  databarexpanded: {
    label: "GS1 DataBar Expanded",
    group: "GS1",
    bcid: "databarexpanded",
    shape: "1d",
    quiet: 1,
    holds: "GS1 data with the application identifiers in brackets, e.g. (01)09521234543213(3103)000123 (fresh food: weight, dates)",
    example: "(01)09521234543213(3103)000123",
  },
  gs1qr: {
    label: "GS1 QR code",
    group: "GS1",
    bcid: "gs1qrcode",
    shape: "square",
    quiet: 4,
    ecc: ["L", "M", "Q", "H"],
    holds: "GS1 data with the application identifiers in brackets, e.g. (01)09521234543213(10)LOT42",
    example: "(01)09521234543213(10)LOT42",
  },
  gs1datamatrix: {
    label: "GS1 Data Matrix",
    group: "GS1",
    bcid: "gs1datamatrix",
    shape: "square",
    quiet: 1,
    holds: "GS1 data with the application identifiers in brackets, e.g. (01)09521234543213(17)261231",
    example: "(01)09521234543213(17)261231",
  },
  uspsimb: {
    label: "USPS Intelligent Mail",
    group: "Postal",
    bcid: "onecode",
    shape: "1d",
    quiet: 6,
    holds: "20 digits (barcode ID, service, mailer and serial) plus an optional 5, 9 or 11 digit ZIP",
    example: "0123456709498765432101234567891",
  },
  royalmail: { label: "Royal Mail 4-state (RM4SCC)", group: "Postal", bcid: "royalmail", shape: "1d", quiet: 6, holds: "a UK postcode and delivery point, letters and digits", example: "LE28HS9Z", upper: true },
};

export const CODE_FORMAT_IDS = Object.keys(CODE_FORMATS) as CodeFormat[];

/** 2D symbol (module matrix) rather than a linear barcode. */
export const is2d = (f: CodeFormat) => (CODE_FORMATS[f]?.shape ?? "1d") !== "1d";
/** 2D symbol with a fixed square shape (QR, Data Matrix...). */
export const isSquare2d = (f: CodeFormat) => CODE_FORMATS[f]?.shape === "square";

/** Linear codes whose digits sit under the bars with long guard bars. */
const EAN_LIKE = new Set<CodeFormat>(["ean13", "ean8", "upca", "upce"]);

/** Tidy a value into what the encoder wants (start / stop letters, a missing leading 0). */
function prepare(format: CodeFormat, text: string): string {
  if (format === "codabar") {
    const t = text.replace(/\s+/g, "");
    return t.length > 1 && /^[A-D].*[A-D]$/.test(t) ? t : `A${t.replace(/^[A-D]|[A-D]$/g, "")}A`;
  }
  if (format === "upce") return text.replace(/^(\d{6})(?=\s|$)/, "0$1");
  if (format === "itf") return /^\d+$/.test(text) && text.length % 2 ? `0${text}` : text;
  return text;
}

/** rMQR versions (rows x cols), grouped by height; the narrowest fitting width per height wins. */
const RMQR: Record<number, number[]> = {
  7: [43, 59, 77, 99, 139],
  9: [43, 59, 77, 99, 139],
  11: [27, 43, 59, 77, 99, 139],
  13: [27, 43, 59, 77, 99, 139],
  15: [43, 59, 77, 99, 139],
  17: [43, 59, 77, 99, 139],
};
/** PDF417 data column counts tried (1 = tall and narrow ... 12 = long and flat). */
const PDF417_COLUMNS = [1, 2, 3, 4, 5, 6, 8, 10, 12];
export const PDF417_ROW_RATIO = 3;

const cache = new Map<string, EncodedCode | Error>();

const eccFor = (format: CodeFormat, ecc?: "L" | "M" | "Q" | "H") => {
  const levels = CODE_FORMATS[format].ecc;
  if (!levels) return undefined;
  const want = ecc ?? "M";
  if (levels.includes(want)) return want;
  // Nearest supported level (rMQR has M / H, Micro QR L / M / Q).
  const order = ["L", "M", "Q", "H"];
  return [...levels].sort((a, b) => Math.abs(order.indexOf(a) - order.indexOf(want)) - Math.abs(order.indexOf(b) - order.indexOf(want)))[0];
};

const matrix = (r: Record<string, unknown>): Encoded2d => {
  const pixs = r.pixs as number[];
  const cols = r.pixx as number;
  return { kind: "2d", cols, rows: Math.round(pixs.length / cols), bits: Uint8Array.from(pixs) };
};

/** Encode a value; returns an Error for invalid data (e.g. wrong EAN length), null if the encoder isn't loaded. */
export function encodeCode(format: CodeFormat, value: string, ecc?: "L" | "M" | "Q" | "H"): EncodedCode | Error | null {
  if (!raw) return null;
  const info = CODE_FORMATS[format];
  if (!info) return new Error(`unknown code format ${format}`);
  const text = prepare(format, info.upper ? value.toUpperCase() : value);
  const level = eccFor(format, ecc);
  const key = `${format}\u0000${level ?? ""}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: EncodedCode | Error;
  try {
    if (!text) throw new Error("empty value");
    const opts: Record<string, unknown> = { bcid: info.bcid, text, ...info.opts };
    if (level) opts.eclevel = level;
    if (EAN_LIKE.has(format)) opts.includetext = true;
    if (format === "code93") opts.includecheck = true;
    if (format === "rmqr") out = encodeRmqr(opts);
    else if (format === "pdf417") out = encodePdf417(opts);
    else if (info.versions) out = encodeVersions(opts, info.versions);
    else {
      const [r] = raw(opts);
      if (info.shape !== "1d") out = matrix(r);
      else {
        const widths = r.sbs as number[];
        const bhs = (r.bhs as number[] | undefined) ?? [];
        const bbs = (r.bbs as number[] | undefined) ?? [];
        const txt = (r.txt as [string, number, number, ...unknown[]][] | undefined) ?? [];
        const ean = EAN_LIKE.has(format);
        const tops = bhs.map((h, i) => h + (bbs[i] ?? 0));
        const top = Math.max(0, ...tops);
        let spans: [number, number][] | undefined;
        let guards = bhs.map(() => false);
        if (ean) {
          // Guards reach into the digits; add-on bars are shorter, with their digits above.
          const addon = tops.map((t) => t < top - 0.01);
          guards = bhs.map((h, i) => h > 1.001 || addon[i]);
          if (addon.some(Boolean)) spans = addon.map((a) => [a ? 0.15 : 0, 1]);
        } else if (bhs.some((h, i) => Math.abs(h - bhs[0]) > 1e-6 || Math.abs((bbs[i] ?? 0) - (bbs[0] ?? 0)) > 1e-6)) {
          // 4-state postal bars: each its own height and position.
          const bot = Math.min(...bbs);
          const range = top - bot || 1;
          spans = bhs.map((_, i) => [(top - tops[i]) / range, (top - (bbs[i] ?? 0)) / range]);
        }
        out = {
          kind: "1d",
          widths,
          guards,
          spans,
          modules: widths.reduce((a, b) => a + b, 0),
          chars: ean && txt.length ? txt.map(([ch, x, y]) => (y > 0 ? { ch, x, top: true } : { ch, x })) : undefined,
          text,
        };
      }
    }
  } catch (e) {
    out = e instanceof Error ? e : new Error(String(e));
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

function encodeRmqr(opts: Record<string, unknown>): Encoded2d {
  const shapes: Encoded2d[] = [];
  let last: unknown;
  for (const [rows, widths] of Object.entries(RMQR))
    for (const cols of widths) {
      try {
        shapes.push(matrix(raw!({ ...opts, version: `R${rows}x${cols}` })[0]));
        break; // wider versions of the same height only make the modules smaller
      } catch (e) {
        last = e;
      }
    }
  if (!shapes.length) throw last instanceof Error ? last : new Error("bwipp.qrcodeNoValidSymbol: too long for rMQR");
  // Default (hug) shape: the smallest symbol.
  shapes.sort((a, b) => a.cols * a.rows - b.cols * b.rows);
  return { ...shapes[0], shapes };
}

/** Rectangular symbols in fixed sizes (rectangular Data Matrix): every version that holds the value. */
function encodeVersions(opts: Record<string, unknown>, versions: string[]): Encoded2d {
  const shapes: Encoded2d[] = [];
  let last: unknown;
  for (const version of versions) {
    try {
      shapes.push(matrix(raw!({ ...opts, version })[0]));
    } catch (e) {
      last = e;
    }
  }
  if (!shapes.length) throw last instanceof Error ? last : new Error("NoValidSymbol: too long");
  shapes.sort((a, b) => a.cols * a.rows - b.cols * b.rows);
  return { ...shapes[0], shapes };
}

function encodePdf417(opts: Record<string, unknown>): Encoded2d {
  const shapes: Encoded2d[] = [];
  let last: unknown;
  for (const columns of PDF417_COLUMNS) {
    try {
      shapes.push({ ...matrix(raw!({ ...opts, columns, rowmult: 1 })[0]), rowRatio: PDF417_ROW_RATIO });
    } catch (e) {
      last = e;
    }
  }
  if (!shapes.length) throw last instanceof Error ? last : new Error("PDF417 failed");
  // Default shape: closest to 3:1 wide, a common PDF417 look.
  const aspect = (s: Encoded2d) => s.cols / (s.rows * PDF417_ROW_RATIO);
  const best = [...shapes].sort((a, b) => Math.abs(Math.log(aspect(a) / 3)) - Math.abs(Math.log(aspect(b) / 3)))[0];
  return { ...best, shapes };
}

/**
 * Plain-language reason a value can't be encoded ("" when it can, null when
 * the encoder isn't loaded yet). For the editor and preflight.
 */
export function codeProblem(format: CodeFormat, value: string, ecc?: "L" | "M" | "Q" | "H"): string | null {
  if (!value.trim()) return "";
  const enc = encodeCode(format, value, ecc);
  if (enc === null) return null;
  return enc instanceof Error ? friendlyCodeError(format, enc) : "";
}

/** Turn a bwip-js error into a message for non-technical users. */
export function friendlyCodeError(format: CodeFormat, e: Error): string {
  const info = CODE_FORMATS[format];
  const m = e.message;
  const name = info?.label ?? format;
  if (/check ?digit/i.test(m)) return `The last digit (check digit) is wrong for ${name}. Leave it off and it is worked out for you.`;
  if (/between \d+ and \d+/i.test(m)) return `${name} takes ${info.holds}.`;
  if (/badLength|InvalidLength|must be \d+ or \d+ digits|must be \d+ digits/i.test(m) || /bad.?Char|must only contain|digits/i.test(m))
    return `${name} can only hold ${info.holds}.`;
  if (/GS1|AI\b|AIs/i.test(m)) return `This isn't valid GS1 data. ${name} needs ${info.holds}.`;
  if (/Maximum length|too long|NoValidSymbol|exceed/i.test(m)) return `Too much for a ${name}. Shorten the value, or use a QR code or Data Matrix.`;
  if (/empty/i.test(m)) return "There is nothing to encode.";
  return `${name} can't hold this value. It takes ${info.holds}.`;
}

/* ------------------------------------------------------------ sizing math */

/** Largest whole-dot module that fits `cols x rows` modules in a box, centred (all values in dots). */
export function fit2d(bw: number, bh: number, cols: number, rows: number) {
  const module = Math.max(0, Math.floor(Math.min(bw / cols, bh / rows)));
  const w = cols * module, h = rows * module;
  return { module, x: Math.floor((bw - w) / 2), y: Math.floor((bh - h) / 2), w, h };
}

/**
 * Fit a symbol whose rows are `ratio` modules tall (PDF417) with `q` quiet
 * modules on every side: whole-dot module width, row height a whole number of
 * dots between 2 and `ratio` module widths.
 */
export function fitRows(bw: number, bh: number, cols: number, rows: number, ratio: number, q = 0) {
  const fit = (r: number) => Math.max(0, Math.floor(Math.min(bw / (cols + 2 * q), bh / (rows * r + 2 * q))));
  // Not even 1 dot at the full ratio: accept squatter rows (2 modules) before giving up.
  const module = fit(ratio) || fit(2);
  const rowH = module ? Math.max(2 * module, Math.min(ratio * module, Math.floor((bh - 2 * q * module) / rows))) : 0;
  return { module, rowH };
}

/** Standard quiet-zone widths in modules (QR 4, Micro QR / rMQR / PDF417 2, DataMatrix 1, Aztec 0, linear 7-11). */
export const quietModules = (format: CodeFormat) => CODE_FORMATS[format]?.quiet ?? 10;

/** Largest whole-dot module for a 1D symbol spanning `span` modules in `bw` dots. */
export const fit1dModule = (bw: number, span: number) => Math.max(0, Math.floor(bw / span));

export interface CodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CodeText {
  str: string;
  x: number;
  /** Baseline */
  y: number;
  px: number;
  align: "left" | "center";
}
export interface CodeLayout {
  /** Module width in dots. */
  module: number;
  /** Module (row) height in dots for 2D codes; equals `module` for square modules. */
  moduleH: number;
  rects: CodeRect[];
  texts: CodeText[];
  /** The symbol itself (bars / modules, without quiet zone or text), box-local dots. */
  bounds: CodeRect;
  /** Symbol size in modules (2D: the shape picked). */
  cols: number;
  rows: number;
}

/** Monospace digit width as a fraction of the font size. */
const MONO_ADVANCE = 0.6;

/** Best 2D shape for a box: biggest module, then the shape closest to the box's proportions. */
function pick2d(enc: Encoded2d, bw: number, bh: number, q: number) {
  let best: { s: Encoded2d; module: number; rowH: number } | null = null;
  const misfit = (s: Encoded2d, rowH: number, module: number) => Math.abs(Math.log((s.cols * module) / (s.rows * rowH) / (bw / bh)));
  for (const s of enc.shapes ?? [enc]) {
    let f: { module: number; rowH: number };
    if (s.rowRatio) f = fitRows(bw, bh, s.cols, s.rows, s.rowRatio, q);
    else {
      const module = fit2d(bw, bh, s.cols + 2 * q, s.rows + 2 * q).module;
      f = { module, rowH: module };
    }
    if (f.module < 1) continue;
    if (!best || f.module > best.module || (f.module === best.module && misfit(s, f.rowH, f.module) < misfit(best.s, best.rowH, best.module))) best = { s, ...f };
  }
  return best;
}

/**
 * Lay out an encoded symbol in a box (dots, origin at the box's top-left).
 * Returns null when not even a 1-dot module fits.
 */
export function layoutCode(enc: EncodedCode, bw: number, bh: number, opts: { showText?: boolean; dpmm: number; quiet?: number }): CodeLayout | null {
  const q = Math.max(0, opts.quiet ?? 0);
  if (enc.kind === "2d") {
    const hit = pick2d(enc, bw, bh, q);
    if (!hit) return null;
    const { s, module: mw, rowH: mh } = hit;
    const symW = s.cols * mw, symH = s.rows * mh;
    // Centre the symbol; the quiet margin is part of the fitted area.
    const x0 = Math.floor((bw - symW) / 2), y0 = Math.floor((bh - symH) / 2);
    const rects: CodeRect[] = [];
    for (let r = 0; r < s.rows; r++) {
      // Merge horizontal runs: fewer, cleaner rects.
      let c = 0;
      while (c < s.cols) {
        if (!s.bits[r * s.cols + c]) {
          c++;
          continue;
        }
        const start = c;
        while (c < s.cols && s.bits[r * s.cols + c]) c++;
        rects.push({ x: x0 + start * mw, y: y0 + r * mh, w: (c - start) * mw, h: mh });
      }
    }
    return { module: mw, moduleH: mh, rects, texts: [], bounds: { x: x0, y: y0, w: symW, h: symH }, cols: s.cols, rows: s.rows };
  }

  let textPx = opts.showText ? Math.min(Math.max(6, Math.round(bh * 0.22)), Math.round(3 * opts.dpmm)) : 0;
  let gap = textPx ? Math.max(1, Math.round(0.15 * opts.dpmm)) : 0;
  if (bh - textPx - gap < Math.max(4, bh * 0.4)) textPx = gap = 0; // too short for text: bars only
  // Horizontal extent in modules (EAN/UPC put digits outside the guards).
  // Add-on digits go above their (shorter) bars.
  const hasTop = !!enc.chars?.some((c) => c.top);
  let minX = 0, maxX = enc.modules;
  if (textPx && enc.chars)
    for (const c of enc.chars) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x + 7);
    }
  const module = fit1dModule(bw, maxX - minX + 2 * q);
  if (module < 1) return null;
  const x0 = Math.floor((bw - (maxX - minX) * module) / 2) - minX * module;
  const barH = bh - textPx - gap;
  // Add-on bars start below room for their digits.
  const addonTop = hasTop ? Math.max(Math.round(barH * 0.15), textPx ? textPx + gap : 0) : 0;
  const rects: CodeRect[] = [];
  let pos = 0;
  enc.widths.forEach((wm, i) => {
    if (i % 2 === 0 && wm > 0) {
      const bar = i / 2;
      const guard = textPx > 0 && enc.guards[bar];
      // Whole dots even when the encoder uses fractional widths (USPS bars and spaces differ).
      const x = Math.round(x0 + pos * module);
      const w = Math.max(1, Math.round(x0 + (pos + wm) * module) - x);
      let y = 0;
      let h = guard ? barH + gap + Math.round(textPx / 2) : barH;
      const span = enc.spans?.[bar];
      if (span && hasTop) {
        y = span[0] > 0 ? addonTop : 0;
        h -= y;
      } else if (span) {
        y = Math.round(span[0] * barH);
        h = Math.max(1, Math.round(span[1] * barH) - y);
      }
      rects.push({ x, y, w, h });
    }
    pos += wm;
  });

  const texts: CodeText[] = [];
  if (textPx) {
    const baseline = bh - Math.max(0, Math.round(textPx * 0.12));
    if (enc.chars) {
      const px = Math.max(4, Math.min(textPx, Math.floor((7 * module * 0.9) / MONO_ADVANCE)));
      const topPx = Math.max(4, Math.min(px, addonTop - gap));
      for (const c of enc.chars) {
        const cpx = c.top ? topPx : px;
        const y = c.top ? Math.max(cpx, addonTop - gap) - Math.round(cpx * 0.12) : baseline;
        texts.push({ str: c.ch, x: x0 + c.x * module + Math.round((7 * module - MONO_ADVANCE * cpx) / 2), y, px: cpx, align: "left" });
      }
    } else {
      const px = Math.max(4, Math.min(textPx, Math.floor(bw / (MONO_ADVANCE * Math.max(1, enc.text.length)))));
      texts.push({ str: enc.text, x: Math.round(bw / 2), y: baseline, px, align: "center" });
    }
  }
  return { module, moduleH: barH, rects, texts, bounds: { x: x0, y: 0, w: enc.modules * module, h: barH }, cols: enc.modules, rows: 1 };
}

/* ------------------------------------------------------ intrinsic (layout) */

/** Sensible default module for hug sizing: 0.25 mm (2 dots at 203 dpi, 3 at 300 dpi). */
export const DEFAULT_MODULE_MM = 0.25;

/**
 * Width / height of a 2D symbol for hug sizing: 1 for square codes, the
 * default shape's proportions for rMQR / PDF417 (a typical shape until the
 * encoder is loaded). Undefined for linear barcodes.
 */
export function codeAspect(format: CodeFormat, value: string, ecc?: "L" | "M" | "Q" | "H"): number | undefined {
  const shape = CODE_FORMATS[format]?.shape;
  if (shape === "square") return 1;
  if (shape !== "rect") return undefined;
  const enc = value.trim() ? encodeCode(format, value, ecc) : null;
  if (enc && !(enc instanceof Error) && enc.kind === "2d") return enc.cols / (enc.rows * (enc.rowRatio ?? 1));
  return format === "rmqr" ? 43 / 7 : 3;
}

/** Module count of a 1D symbol (exact when the encoder is loaded, estimated otherwise), incl. EAN/UPC digit overhang. */
export function linearModules(format: CodeFormat, value: string): number {
  const enc = encodeCode(format, value);
  if (enc && !(enc instanceof Error) && enc.kind === "1d") {
    const lo = Math.min(0, ...(enc.chars ?? []).map((c) => c.x));
    const hi = Math.max(enc.modules, ...(enc.chars ?? []).map((c) => c.x + 7));
    return hi - lo;
  }
  const n = Math.max(1, value.length);
  switch (format) {
    case "code128":
    case "gs1_128":
      return 11 * n + 35;
    case "code39":
      return 16 * (n + 2);
    case "code93":
      return 9 * (n + 4) + 1;
    case "ean13":
    case "upca":
      return 95 + 16;
    case "ean8":
      return 67 + 14;
    case "itf14":
      return 7 * 14 + 10;
    case "itf":
      return 9 * (n + (n % 2)) + 9;
    case "codabar":
      return 12 * (n + 2);
    case "code39ext":
      return 16 * (2 * n + 2);
    case "msi":
      return 12 * (n + 1) + 7;
    case "pharmacode":
      return 4 * Math.ceil(Math.log2(Math.max(4, Number(value) || 4)));
    case "upce":
      return 51 + 16;
    case "databar":
      return 96;
    case "databarexpanded":
      return 17 * Math.ceil(n / 2) + 40;
    case "uspsimb":
      return 65 * 3;
    case "royalmail":
      return 8 * (n + 2);
    default:
      return 0;
  }
}
