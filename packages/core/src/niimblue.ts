/**
 * NiimBlue label importer (https://github.com/MultiMote/niimblue).
 *
 * NiimBlue saves / exports a label as JSON: `{ label: { size: { width, height },
 * printDirection, ... }, canvas: <Fabric.js JSON> }` with sizes in printer dots
 * (8 dots/mm on 203 dpi printers). A file may hold one label, a list, or
 * `{ templates: [...] }`. Each becomes a free-layout template that scales with
 * the label; text and code contents become fields (NiimBlue `{name}`
 * placeholders become `{{name}}` fields) and one label keeps the original
 * contents.
 *
 * Covered: text (i-text / textbox / text), rect, circle, ellipse, line, image,
 * QRCode, Barcode (EAN13 / CODE128); groups are flattened. Rotations snap to
 * 90°.
 */
import type { CodeFormat, LabelNode, Paint } from "./schema";
import { FieldSet, PT_TO_MM, freeTemplate, placed, round2, slug, snapRotation, usableFont, type DesignImport } from "./import-common";

/* eslint-disable @typescript-eslint/no-explicit-any */
type FabricObject = Record<string, any>;

export interface NiimBlueLabel {
  title?: string;
  id?: string;
  timestamp?: number;
  label: { size: { width: number; height: number }; printDirection?: "left" | "top"; shape?: string };
  canvas: { version?: string; objects: FabricObject[] };
}

export interface NiimBlueOptions {
  /** Dots per mm of the sizes in the file (default 8 = 203 dpi). */
  dpmm?: number;
  /** Name when the file has no title. */
  name?: string;
}

const isLabel = (o: any): o is NiimBlueLabel => !!o && typeof o === "object" && o.label?.size && Array.isArray(o.canvas?.objects);

/** True when the parsed JSON looks like NiimBlue output. */
export const isNiimBlue = (json: unknown) => {
  const list = Array.isArray(json) ? json : (json as any)?.templates ?? [json];
  return Array.isArray(list) && list.length > 0 && list.every(isLabel);
};

const paintOf = (c: unknown): Paint => {
  if (c === null || c === undefined || c === "" || c === "transparent") return "none";
  if (typeof c !== "string") return "black";
  const s = c.trim().toLowerCase();
  if (s === "white" || s === "#fff" || s === "#ffffff" || /^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(s)) return "white";
  if (/^rgba\(.*,\s*0(\.0+)?\s*\)$/.test(s)) return "none";
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    const n = parseInt(h, 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum < 128 ? "black" : "white";
  }
  return "black";
};
const ink = (p: Paint): Exclude<Paint, "none"> => (p === "none" ? "black" : p);

const originFrac = (v: unknown, start: string, end: string) => (v === "center" ? 0.5 : v === end ? 1 : typeof v === "number" ? v : v === start ? 0 : 0);

/** Axis-aligned box (dots) of a fabric object of local size w x h, rotated about its origin point. */
function boxOf(o: FabricObject, w: number, h: number, dx = 0, dy = 0) {
  const ox = originFrac(o.originX, "left", "right"), oy = originFrac(o.originY, "top", "bottom");
  const a = ((o.angle ?? 0) * Math.PI) / 180;
  const left = (o.left ?? 0) + dx, top = (o.top ?? 0) + dy;
  const pts = [
    [-ox * w, -oy * h],
    [(1 - ox) * w, -oy * h],
    [(1 - ox) * w, (1 - oy) * h],
    [-ox * w, (1 - oy) * h],
  ].map(([x, y]) => [left + x * Math.cos(a) - y * Math.sin(a), top + x * Math.sin(a) + y * Math.cos(a)]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const placeholders = (text: string, fields: FieldSet) =>
  text.replace(/\{\s*([A-Za-z_][\w-]*)\s*\}/g, (_, k: string) => {
    fields.named(k);
    return `{{${k}}}`;
  });

function convertLabel(src: NiimBlueLabel, index: number, opts: NiimBlueOptions, warnings: string[]): DesignImport {
  const dpmm = opts.dpmm ?? 8;
  const mm = (d: number) => d / dpmm;
  const name = src.title?.trim() || opts.name || `NiimBlue label ${index + 1}`;
  const warn = (w: string) => warnings.push(`${name}: ${w}`);
  const fields = new FieldSet();
  const nodes: LabelNode[] = [];
  let n = 0;
  const nextId = (t: string) => `${t}-${++n}`;

  const visit = (o: FabricObject, dx = 0, dy = 0) => {
    const type = String(o.type ?? "").toLowerCase().replace(/[-_]/g, "");
    if (o.visible === false) return;
    const sx = o.scaleX ?? 1, sy = o.scaleY ?? 1;
    const w = (o.width ?? 0) * sx, h = (o.height ?? 0) * sy;
    const rot = snapRotation(o.angle ?? 0);
    if (o.angle && Math.abs((o.angle % 90 + 90) % 90) > 1 && Math.abs((o.angle % 90 + 90) % 90) < 89) warn(`${type} rotated ${o.angle}° snapped to ${rot}°`);
    const b = boxOf(o, w, h, dx, dy);
    const base = () => placed(nextId(type || "node"), mm(b.x), mm(b.y), mm(b.w), mm(b.h), rot);

    switch (type) {
      case "group": {
        // Children are relative to the group's centre.
        const g = boxOf(o, w, h, dx, dy);
        for (const c of o.objects ?? []) visit({ ...c, scaleX: (c.scaleX ?? 1) * sx, scaleY: (c.scaleY ?? 1) * sy, left: (c.left ?? 0) * sx, top: (c.top ?? 0) * sy }, g.x + g.w / 2, g.y + g.h / 2);
        return;
      }
      case "itext":
      case "textbox":
      case "text": {
        const raw = String(o.text ?? "");
        const text = /\{\s*[A-Za-z_][\w-]*\s*\}/.test(raw) ? placeholders(raw, fields) : fields.add("text", raw);
        const fill = paintOf(o.fill);
        nodes.push({
          ...base(),
          type: "text",
          text,
          font: usableFont(o.fontFamily, warn),
          sizePt: round2(mm((o.fontSize ?? 16) * sy) / PT_TO_MM),
          weight: o.fontWeight === "bold" ? 700 : typeof o.fontWeight === "number" ? o.fontWeight : Number(o.fontWeight) || 400,
          align: o.textAlign === "center" || o.textAlign === "right" || o.textAlign === "justify" ? o.textAlign : "left",
          valign: "top",
          fit: "shrink",
          ...(o.lineHeight ? { lineHeight: o.lineHeight } : {}),
          color: ink(fill),
        });
        return;
      }
      case "rect": {
        const fill = paintOf(o.fill), stroke = paintOf(o.stroke);
        const sw = o.strokeWidth && stroke !== "none" ? mm(o.strokeWidth) : 0;
        nodes.push({ ...base(), type: "rect", fill, ...(sw ? { stroke, strokeMm: round2(sw) } : {}), ...(o.rx ? { radius: round2(mm(o.rx * sx)) } : {}) });
        return;
      }
      case "circle":
      case "ellipse": {
        const rw = type === "circle" ? (o.radius ?? 0) * 2 * sx : (o.rx ?? 0) * 2 * sx || w;
        const rh = type === "circle" ? (o.radius ?? 0) * 2 * sy : (o.ry ?? 0) * 2 * sy || h;
        const eb = boxOf(o, rw || w, rh || h, dx, dy);
        const fill = paintOf(o.fill), stroke = paintOf(o.stroke);
        const sw = o.strokeWidth && stroke !== "none" ? mm(o.strokeWidth) : 0;
        nodes.push({ ...placed(nextId("ellipse"), mm(eb.x), mm(eb.y), mm(eb.w), mm(eb.h)), type: "ellipse", fill, ...(sw ? { stroke, strokeMm: round2(sw) } : {}) });
        return;
      }
      case "line": {
        const x1 = o.x1 ?? 0, y1 = o.y1 ?? 0, x2 = o.x2 ?? w, y2 = o.y2 ?? 0;
        const lw = Math.abs(x2 - x1) * sx, lh = Math.abs(y2 - y1) * sy;
        const sw = (o.strokeWidth ?? 1) * Math.max(sx, sy);
        const lb = boxOf(o, Math.max(lw, sw), Math.max(lh, sw), dx, dy);
        const direction = lh < sw ? "horizontal" : lw < sw ? "vertical" : (x2 - x1) * (y2 - y1) > 0 ? "down" : "up";
        const vertical = rot === 90 || rot === 270;
        const dir = vertical && direction === "horizontal" ? "vertical" : vertical && direction === "vertical" ? "horizontal" : direction;
        nodes.push({ ...placed(nextId("line"), mm(lb.x), mm(lb.y), mm(lb.w), mm(lb.h)), type: "line", direction: dir, color: ink(paintOf(o.stroke ?? "#000")), strokeMm: round2(mm(sw)) });
        return;
      }
      case "image": {
        if (typeof o.src !== "string" || !o.src) return warn("image without data skipped");
        nodes.push({ ...base(), type: "image", src: o.src, fit: "stretch", dither: "floyd-steinberg", color: "black" });
        return;
      }
      case "qrcode": {
        const value = fields.add("qr", String(o.text ?? ""), `QR ${fields.fields.filter((f) => f.key.startsWith("qr")).length + 1}`);
        const ecc = ["L", "M", "Q", "H"].includes(o.ecl) ? (o.ecl as "L" | "M" | "Q" | "H") : undefined;
        nodes.push({ ...base(), type: "code", format: "qrcode", value, ...(ecc ? { ecc } : {}), quietZone: false, color: "black" });
        return;
      }
      case "barcode": {
        const enc = String(o.encoding ?? "CODE128B").toUpperCase();
        const format: CodeFormat = enc.startsWith("EAN13") ? "ean13" : enc.startsWith("UPC") ? "upca" : enc.startsWith("CODE39") ? "code39" : "code128";
        if (!/^(EAN13|UPC|CODE39|CODE128)/.test(enc)) warn(`barcode type ${enc} imported as Code128`);
        const value = fields.add("barcode", String(o.text ?? ""));
        nodes.push({ ...base(), type: "code", format, value, showText: o.printText !== false, quietZone: false, color: "black" });
        return;
      }
      default:
        warn(`${o.type ?? "unknown"} object skipped`);
    }
  };
  for (const o of src.canvas.objects) visit(o);

  if (src.label.printDirection === "left") warnings.push(`${name}: printed sideways in NiimBlue; check the orientation on your printer`);
  const w = mm(src.label.size.width), h = mm(src.label.size.height);
  const tid = `t-niimblue-${slug(name)}`;
  const template = freeTemplate(tid, name, w, h, nodes, fields.fields, `Imported from NiimBlue (${round2(w)} × ${round2(h)} mm).`);
  const label = { id: `l-niimblue-${slug(name)}`, templateId: tid, name, values: fields.values };
  return { templates: [template], labels: [label], warnings: [] };
}

/** Parse NiimBlue JSON (one label, a list, or `{ templates }`) into templates + one label each. */
export function importNiimBlue(json: unknown, opts: NiimBlueOptions = {}): DesignImport {
  const list: unknown[] = Array.isArray(json) ? json : Array.isArray((json as any)?.templates) ? (json as any).templates : [json];
  const warnings: string[] = [];
  const out: DesignImport = { templates: [], labels: [], warnings };
  const ids = new Set<string>();
  list.forEach((src, i) => {
    if (!isLabel(src)) return void warnings.push(`entry ${i + 1} is not a NiimBlue label`);
    const r = convertLabel(src, i, opts, warnings);
    // Same title twice: keep both.
    for (const t of r.templates) {
      let id = t.id, k = 2;
      while (ids.has(id)) id = `${t.id}-${k++}`;
      ids.add(id);
      const suffix = id.slice(t.id.length);
      out.templates.push({ ...t, id });
      out.labels.push(...r.labels.map((l) => ({ ...l, id: l.id + suffix, templateId: id })));
    }
  });
  if (!out.templates.length) throw new Error("no NiimBlue labels found in this file");
  return out;
}
