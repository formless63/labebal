/**
 * ZPL importer: turn Zebra label code into free-layout templates.
 *
 * Covered (the common subset label designers and ERPs emit):
 *   ^XA / ^XZ          one template per label format
 *   ^PW ^LL ^LH        label width, length, home offset
 *   ^FO ^FT            field origin (^FT = text baseline / barcode bottom-left)
 *   ^A / ^A0 / ^CF     font (orientation, height, width); ^CF sets the default
 *   ^FB                field block (width, lines, line spacing, justification)
 *   ^FD ^FS ^FH ^FN ^FR  data (with _xx hex escapes), field end, field number, reverse
 *   ^BY                barcode defaults (module width, ratio, height)
 *   ^BC ^B3 ^BE ^BU    Code128, Code39, EAN-13, UPC-A
 *   ^BQ ^BX            QR code, DataMatrix
 *   ^GB ^GC ^GE        box / line, circle, ellipse
 * Anything else is ignored with a warning. Text and code contents become
 * fields (`^FN` numbers become `field<n>`); one label keeps the original data.
 */
import { linearModules } from "./codes";
import type { CodeFormat, LabelNode, Paint, Rotation } from "./schema";
import { FieldSet, PT_TO_MM, freeTemplate, placed, round2, slug, type DesignImport } from "./import-common";

export interface ZplOptions {
  /** Printer resolution in dots per mm (8 = 203 dpi default, 12 = 300 dpi). */
  dpmm?: number;
  /** Template name (numbered when the file has several labels). */
  name?: string;
  /** Label size when ^PW / ^LL are missing (mm). Default: the extent of the content. */
  widthMm?: number;
  heightMm?: number;
}

interface Cmd {
  /** e.g. "FO", "A", "BC", "GB" (^A's font letter is the first param char). */
  code: string;
  params: string;
}

const KNOWN_IGNORED = new Set(["CI", "PR", "MD", "PQ", "LR", "MN", "MT", "PO", "PM", "LT", "LS", "JM", "FX", "SN", "SF", "XB", "MM", "MU", "PA", "CC", "CT", "CD", "TO", "DF", "XF", "IS", "IL", "ID", "XG", "DG", "FW", "FP", "FV"]);

/** Split ZPL into commands. Field data (^FD) runs until the next ^FS. */
export function tokenizeZpl(zpl: string): Cmd[] {
  const out: Cmd[] = [];
  let i = 0;
  const s = zpl.replace(/\r/g, "");
  while (i < s.length) {
    const c = s[i];
    if (c !== "^" && c !== "~") {
      i++;
      continue;
    }
    let code = s.slice(i + 1, i + 3).toUpperCase();
    // ^A<font> takes one letter; ^Ax: font letter is part of the params.
    if (code[0] === "A" && code !== "A@") code = "A";
    i += 1 + code.length;
    let end: number;
    if (code === "FD" || code === "FV") {
      end = s.indexOf("^FS", i);
      if (end < 0) end = s.length;
    } else {
      end = i;
      while (end < s.length && s[end] !== "^" && s[end] !== "~") end++;
    }
    const params = code === "FD" || code === "FV" ? s.slice(i, end) : s.slice(i, end).replace(/\n/g, "").trim();
    if (c === "^") out.push({ code, params });
    i = end;
  }
  return out;
}

const num = (v: string | undefined, d: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};

const ROTATIONS: Record<string, Rotation> = { N: 0, R: 90, I: 180, B: 270 };
const rotationOf = (o: string | undefined, d: Rotation = 0): Rotation => ROTATIONS[(o ?? "").trim().toUpperCase()] ?? d;

const unhex = (data: string, indicator: string) => data.replace(new RegExp(`\\${indicator}([0-9A-Fa-f]{2})`, "g"), (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** One ^XA ... ^XZ block. */
function convertFormat(cmds: Cmd[], index: number, total: number, opts: ZplOptions, warnings: string[]): DesignImport {
  const dpmm = opts.dpmm ?? 8;
  const mm = (d: number) => d / dpmm;
  const name = total > 1 ? `${opts.name ?? "ZPL label"} ${index + 1}` : (opts.name ?? "ZPL label");
  const warn = (w: string) => warnings.push(`${name}: ${w}`);
  const fields = new FieldSet();
  const nodes: LabelNode[] = [];
  let n = 0;
  const id = (t: string) => `${t}-${++n}`;

  let pw = 0, ll = 0, hx = 0, hy = 0;
  let defFont = { h: 30, w: 0 };
  let by = { w: 2, ratio: 3, h: 10 * dpmm };
  // Per-field state, reset at ^FS.
  let fo: { x: number; y: number; baseline: boolean } | null = null;
  let font: { h: number; w: number; rot: Rotation } | null = null;
  let fb: { w: number; lines: number; spacing: number; align: "left" | "center" | "right" | "justify" } | null = null;
  let code: { format: CodeFormat; rot: Rotation; h: number; text: boolean; mag?: number; ecc?: "L" | "M" | "Q" | "H" } | null = null;
  let reverse = false;
  let hexInd: string | null = null;
  let fieldNo: number | null = null;
  let data: string | null = null;
  const ignored = new Set<string>();

  const endField = () => {
    if (fo && data !== null) emit(fo, data);
    fo = null;
    font = null;
    fb = null;
    code = null;
    reverse = false;
    hexInd = null;
    fieldNo = null;
    data = null;
  };

  const valueFor = (raw: string, prefix: string) => (fieldNo !== null ? (fields.named(`field${fieldNo}`), (fields.values[`field${fieldNo}`] = raw), `{{field${fieldNo}}}`) : fields.add(prefix, raw));

  const emit = (at: NonNullable<typeof fo>, raw0: string) => {
    let raw = hexInd ? unhex(raw0, hexInd) : raw0;
    const x = at.x + hx, y = at.y + hy;
    if (code) {
      if (code.format === "qrcode") {
        // ^FD<ecc><mode>,<data>: e.g. "QA,https://..." or "MM,..."
        const m = /^([HQML])([AM]),([\s\S]*)$/.exec(raw);
        if (m) {
          code.ecc = m[1] as "H";
          raw = m[3];
        }
        const mag = code.mag ?? 3;
        const modules = 21 + 4 * Math.min(39, Math.ceil(Math.max(0, raw.length - 17) / 16));
        const side = mm(modules * mag);
        // ^FO places the QR's top-left (ZPL adds ~10 dots above it in practice; ignored).
        nodes.push({ ...placed(id("qr"), mm(x), mm(at.baseline ? y - modules * mag : y), side, side), type: "code", format: "qrcode", value: valueFor(raw, "qr"), ...(code.ecc ? { ecc: code.ecc } : {}), quietZone: false, color: reverse ? "invert" : "black" });
        return;
      }
      if (code.format === "datamatrix") {
        const side = mm(code.h || 10 * dpmm);
        nodes.push({ ...placed(id("datamatrix"), mm(x), mm(at.baseline ? y - (code.h || 10 * dpmm) : y), side, side), type: "code", format: "datamatrix", value: valueFor(raw, "code"), quietZone: false, color: reverse ? "invert" : "black" });
        return;
      }
      const len = linearModules(code.format, raw) * by.w;
      const textH = code.text ? 2.5 * dpmm : 0;
      const hh = code.h + textH;
      const sideways = code.rot === 90 || code.rot === 270;
      const bw = sideways ? hh : len, bh = sideways ? len : hh;
      nodes.push({
        ...placed(id("barcode"), mm(x), mm(at.baseline ? y - bh : y), mm(bw), mm(bh), code.rot),
        type: "code",
        format: code.format,
        value: valueFor(raw, "barcode"),
        showText: code.text,
        quietZone: false,
        color: reverse ? "invert" : "black",
      });
      return;
    }
    // Text.
    const f = font ?? { ...defFont, rot: 0 as Rotation };
    const ch = f.h;
    const cw = f.w || f.h * 0.6;
    const text = raw.replace(/\\&/g, "\n");
    const lines = fb ? Math.max(1, fb.lines) : text.split("\n").length;
    const longest = Math.max(...text.split("\n").map((l) => l.length), 1);
    const along = fb ? fb.w : Math.min(longest * cw * 1.05, (pw || Infinity) - x);
    const across = ch * lines + (fb ? fb.spacing * (lines - 1) : 0);
    const sideways = f.rot === 90 || f.rot === 270;
    const w = sideways ? across : along, h = sideways ? along : across;
    nodes.push({
      ...placed(id("text"), mm(x), mm(at.baseline ? y - ch : y), mm(Math.max(w, cw)), mm(Math.max(h, ch)), f.rot),
      type: "text",
      text: valueFor(text, "text"),
      font: "Arial",
      sizePt: round2(mm(ch) / PT_TO_MM),
      align: fb?.align ?? "left",
      valign: "top",
      fit: "shrink",
      color: reverse ? "invert" : "black",
    });
  };

  const shape = (type: "rect" | "ellipse", w: number, h: number, t: number, color: string | undefined, round = 0) => {
    if (!fo) return;
    const x = fo.x + hx, y = fo.y + hy;
    const paint: Exclude<Paint, "none"> = reverse ? "invert" : (color ?? "B").toUpperCase() === "W" ? "white" : "black";
    w = Math.max(w, t);
    h = Math.max(h, t);
    const solid = t * 2 >= Math.min(w, h);
    const base = placed(id(type === "rect" ? (Math.min(w, h) <= t ? "line" : "box") : "ellipse"), mm(x), mm(at(y, h)), mm(w), mm(h));
    if (type === "rect") nodes.push({ ...base, type: "rect", fill: solid ? paint : "none", ...(solid ? {} : { stroke: paint, strokeMm: round2(mm(t)) }), ...(round ? { radius: round2(mm((Math.min(w, h) / 2) * (round / 8))) } : {}) });
    else nodes.push({ ...base, type: "ellipse", fill: solid ? paint : "none", ...(solid ? {} : { stroke: paint, strokeMm: round2(mm(t)) }) });
  };
  const at = (y: number, h: number) => (fo?.baseline ? y - h : y);

  for (const { code: c, params } of cmds) {
    const p = params.split(",");
    switch (c) {
      case "XA":
      case "XZ":
        break;
      case "PW":
        pw = num(p[0], 0);
        break;
      case "LL":
        ll = num(p[0], 0);
        break;
      case "LH":
        hx = num(p[0], 0);
        hy = num(p[1], 0);
        break;
      case "FO":
      case "FT":
        fo = { x: num(p[0], 0), y: num(p[1], 0), baseline: c === "FT" };
        break;
      case "CF":
        defFont = { h: num(p[1], defFont.h), w: num(p[2], 0) };
        break;
      case "A": {
        // params: "<font><orientation>,<h>,<w>" e.g. "0N,30,30"
        const rot = rotationOf(p[0]?.slice(1, 2));
        font = { h: num(p[1], defFont.h), w: num(p[2], 0), rot };
        break;
      }
      case "FB":
        fb = { w: num(p[0], 0), lines: num(p[1], 1), spacing: num(p[2], 0), align: ({ L: "left", C: "center", R: "right", J: "justify" } as const)[(p[3] ?? "L").trim().toUpperCase() as "L"] ?? "left" };
        break;
      case "FR":
        reverse = true;
        break;
      case "FH":
        hexInd = (p[0] ?? "").trim() || "_";
        break;
      case "FN":
        fieldNo = num(p[0], 0);
        // A field number with no data: an empty field.
        data ??= "";
        break;
      case "FD":
      case "FV":
        data = params;
        break;
      case "FS":
        endField();
        break;
      case "BY":
        by = { w: num(p[0], by.w), ratio: num(p[1], by.ratio), h: num(p[2], by.h) };
        break;
      case "BC":
      case "B3":
      case "BE":
      case "BU": {
        const format: CodeFormat = c === "BC" ? "code128" : c === "B3" ? "code39" : c === "BE" ? "ean13" : "upca";
        const hIdx = c === "B3" ? 2 : 1, tIdx = c === "B3" ? 3 : 2;
        code = { format, rot: rotationOf(p[0], 0), h: num(p[hIdx], by.h), text: (p[tIdx] ?? "Y").trim().toUpperCase() !== "N" };
        break;
      }
      case "BQ":
        code = { format: "qrcode", rot: 0, h: 0, text: false, mag: num(p[2], 3) };
        break;
      case "BX":
        code = { format: "datamatrix", rot: rotationOf(p[0], 0), h: num(p[1], 10 * dpmm), text: false };
        break;
      case "GB": {
        const t = num(p[2], 1);
        shape("rect", num(p[0], t), num(p[1], t), t, p[3], num(p[4], 0));
        break;
      }
      case "GC": {
        const d = num(p[0], 3);
        shape("ellipse", d, d, num(p[1], 1), p[2]);
        break;
      }
      case "GE": {
        const t = num(p[2], 1);
        shape("ellipse", num(p[0], t), num(p[1], t), t, p[3]);
        break;
      }
      default:
        if (!KNOWN_IGNORED.has(c)) ignored.add(c);
    }
  }
  endField();
  if (ignored.size) warn(`ignored ZPL commands: ${[...ignored].map((c) => `^${c}`).join(" ")}`);

  // Label size: ^PW / ^LL, else options, else the content's extent.
  const extent = (k: "x" | "y") =>
    Math.max(
      1,
      ...nodes.map((nd) => (nd[k] ?? 0) + ((k === "x" ? nd.w : nd.h) as { mm: number }).mm),
    );
  const w = pw ? mm(pw) : (opts.widthMm ?? round2(extent("x") + 1));
  const h = ll ? mm(ll) : (opts.heightMm ?? round2(extent("y") + 1));
  const tid = `t-zpl-${slug(name)}`;
  const template = freeTemplate(tid, name, w, h, nodes, fields.fields, `Imported from ZPL (${round2(w)} × ${round2(h)} mm at ${Math.round(dpmm * 25.4)} dpi).`);
  return { templates: [template], labels: [{ id: `l-zpl-${slug(name)}`, templateId: tid, name, values: fields.values }], warnings: [] };
}

/** True when the text looks like ZPL. */
export const isZpl = (text: string) => /\^XA/i.test(text) || /\^F[OT]\s*\d/i.test(text);

/** Parse ZPL (one or more ^XA...^XZ formats) into templates + one label each. */
export function importZpl(zpl: string, opts: ZplOptions = {}): DesignImport {
  const cmds = tokenizeZpl(zpl);
  const blocks: Cmd[][] = [];
  let cur: Cmd[] | null = null;
  for (const c of cmds) {
    if (c.code === "XA") cur = [];
    else if (c.code === "XZ") {
      if (cur?.length) blocks.push(cur);
      cur = null;
    } else (cur ??= []).push(c);
  }
  if (cur?.length) blocks.push(cur);
  const real = blocks.filter((b) => b.some((c) => c.code === "FD" || c.code === "GB" || c.code === "GC" || c.code === "GE" || c.code === "FN"));
  if (!real.length) throw new Error("no ZPL label found (expected ^XA ... ^FO ... ^FD ... ^FS ... ^XZ)");
  const warnings: string[] = [];
  const out: DesignImport = { templates: [], labels: [], warnings };
  real.forEach((b, i) => {
    const r = convertFormat(b, i, real.length, opts, warnings);
    out.templates.push(...r.templates);
    out.labels.push(...r.labels);
  });
  return out;
}
