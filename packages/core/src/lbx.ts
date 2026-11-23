/**
 * Brother P-touch .lbx importer.
 *
 * An .lbx is a zip holding label.xml (+ prop.xml, images). We only need it once,
 * to turn existing designs into our own Template + LabelRow data. Labels that
 * share a layout are merged into a single template; text that differs between
 * them becomes a `{{field}}`.
 */
import JSZip from "jszip";
import type { Label, LabelNode, Paint, Template } from "./schema";

/* Intermediate (flat) shapes parsed from P-touch, before conversion to v2 nodes. */
interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: 0 | 90 | 180 | 270;
  paint: Exclude<Paint, "none">;
}
interface RectElement extends ElementBase {
  type: "rect";
  radius: number;
  fill: boolean;
  stroke: number;
}
interface TextElement extends ElementBase {
  type: "text";
  text: string;
  font: string;
  sizePt: number;
  weight: number;
  align: "left" | "center" | "right" | "justify";
  valign: "top" | "middle" | "bottom";
  shrink: boolean;
}
type LabelElement = RectElement | TextElement;
type LabelRow = Label;
type LegacyField = { key: string; label: string; multiline?: boolean };

const PT_TO_MM = 25.4 / 72;

type DomParserCtor = new () => { parseFromString(xml: string, type: string): Document };

export interface ParsedLbx {
  fileName: string;
  /** File name without extension and trailing date, e.g. "Shelf 3 - Screws". */
  name: string;
  widthMm: number;
  heightMm: number;
  invertByDefault: boolean;
  elements: (LabelElement & { objectName: string })[];
  warnings: string[];
}

export interface ImportOptions {
  /** Map an LBX objectName (e.g. "Text10") to a friendlier field key. */
  fieldNames?: Record<string, string>;
  /** Names for the merged templates, in the order groups are found. */
  templateNames?: string[];
}

export interface ImportResult {
  templates: Template[];
  labels: Label[];
  warnings: string[];
}

const pt = (v: string | null | undefined): number => {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n * PT_TO_MM : 0;
};

const round = (n: number, step = 0.01) => Number((Math.round(n / step) * step).toFixed(3));

/** First descendant with this qualified tag name. */
const first = (el: Element | Document, tag: string): Element | null => {
  const list = el.getElementsByTagName(tag);
  return list.length ? list[0] : null;
};

const isDark = (hex: string | null) => {
  if (!hex) return false;
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 128;
};

/**
 * P-touch draws with GDI raster ops. "Black" in the design always means "ink".
 * COPYPEN paints the colour, NOTCOPYPEN paints its inverse, XORPEN flips.
 */
const paintFor = (color: string | null, rop: string | null): Exclude<Paint, "none"> => {
  const ink = isDark(color ?? "#000000");
  switch (rop) {
    case "NOTCOPYPEN":
      return ink ? "white" : "black";
    case "XORPEN":
    case "NOTXORPEN":
      return "invert";
    default:
      return ink ? "black" : "white";
  }
};

/** P-touch angles are clockwise, like ours (270 = text reads bottom-to-top). */
const rotateFor = (angle: string | null): 0 | 90 | 180 | 270 => {
  const a = (((parseInt(angle ?? "0", 10) || 0) % 360) + 360) % 360;
  return (Math.round(a / 90) * 90) % 360 as 0 | 90 | 180 | 270;
};

const alignFor = (h: string | null): TextElement["align"] => {
  switch (h) {
    case "LEFT":
      return "left";
    case "RIGHT":
      return "right";
    case "JUSTIFY":
      return "justify";
    default:
      return "center";
  }
};

const valignFor = (v: string | null): TextElement["valign"] =>
  v === "TOP" ? "top" : v === "BOTTOM" ? "bottom" : "middle";

export function parseLabelXml(fileName: string, xml: string, Parser: DomParserCtor): ParsedLbx {
  const doc = new Parser().parseFromString(xml, "text/xml");
  const warnings: string[] = [];
  const paper = first(doc, "style:paper");
  if (!paper) throw new Error(`${fileName}: no <style:paper> element`);

  let widthMm = pt(paper.getAttribute("width"));
  let heightMm = pt(paper.getAttribute("height"));
  if (paper.getAttribute("orientation") === "landscape") [widthMm, heightMm] = [heightMm, widthMm];

  // White ink on black tape: the design's "black" prints as white on the real label.
  const invertByDefault = isDark(paper.getAttribute("paperColor")) && !isDark(paper.getAttribute("paperInk"));

  const objects = first(doc, "pt:objects");
  const elements: ParsedLbx["elements"] = [];
  let n = 0;

  for (const node of Array.from(objects?.childNodes ?? [])) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const style = first(el, "pt:objectStyle");
    if (!style) continue;
    const objectName = first(style, "pt:expanded")?.getAttribute("objectName") ?? `obj${n}`;
    const base = {
      id: `e${n++}`,
      objectName,
      x: round(pt(style.getAttribute("x"))),
      y: round(pt(style.getAttribute("y"))),
      w: round(pt(style.getAttribute("width"))),
      h: round(pt(style.getAttribute("height"))),
      rotate: rotateFor(style.getAttribute("angle")),
    };
    const rop = style.getAttribute("ropMode");

    if (el.tagName === "draw:rect") {
      const brush = first(style, "pt:brush");
      const pen = first(style, "pt:pen");
      const shape = first(el, "draw:rectStyle");
      const fill = brush?.getAttribute("style") !== "NULL";
      const stroke = pen?.getAttribute("style") === "NULL" ? 0 : round(pt(pen?.getAttribute("widthX")));
      const rounded = /ROUND/i.test(shape?.getAttribute("shape") ?? "");
      if (/ELLIPSE/i.test(shape?.getAttribute("shape") ?? "")) warnings.push(`${fileName}: ellipse ${objectName} drawn as rectangle`);
      elements.push({
        ...base,
        type: "rect",
        radius: rounded ? round(pt(shape?.getAttribute("roundnessX"))) : 0,
        fill,
        stroke,
        paint: paintFor((fill ? brush : pen)?.getAttribute("color") ?? null, rop),
      });
    } else if (el.tagName === "text:text") {
      const font = first(el, "text:logFont");
      const ext = first(el, "text:fontExt");
      const align = first(el, "text:textAlign");
      const control = first(el, "text:textControl");
      const data = first(el, "pt:data");
      elements.push({
        ...base,
        type: "text",
        text: data?.textContent ?? "",
        font: font?.getAttribute("name") ?? "sans-serif",
        sizePt: parseFloat(ext?.getAttribute("size") ?? "8") || 8,
        weight: parseInt(font?.getAttribute("weight") ?? "400", 10) || 400,
        align: alignFor(align?.getAttribute("horizontalAlignment") ?? null),
        valign: valignFor(align?.getAttribute("verticalAlignment") ?? null),
        shrink: control?.getAttribute("shrink") === "true",
        paint: paintFor(ext?.getAttribute("textColor") ?? null, rop),
      });
    } else {
      warnings.push(`${fileName}: skipped unsupported object <${el.tagName}> ${objectName}`);
    }
  }

  return {
    fileName,
    name: fileName.replace(/\.lbx$/i, "").replace(/\s+\d{4}-\d{2}-\d{2}$/, "").trim(),
    widthMm: round(widthMm),
    heightMm: round(heightMm),
    invertByDefault,
    elements,
    warnings,
  };
}

/** Identity of each text element in a layout: font + rotation, numbered top-to-bottom. Maps key -> element index. */
const textKeys = (p: ParsedLbx) => {
  const texts: { e: TextElement; i: number }[] = [];
  p.elements.forEach((e, i) => e.type === "text" && texts.push({ e, i }));
  texts.sort((a, b) => a.e.font.localeCompare(b.e.font) || a.e.rotate - b.e.rotate || a.e.y - b.e.y || a.e.x - b.e.x);
  const seen = new Map<string, number>();
  const keys = new Map<string, number>();
  for (const { e, i } of texts) {
    const base = `${e.font}|${e.rotate}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    keys.set(`${base}|${n}`, i);
  }
  return keys;
};

/**
 * Layout fingerprint: shapes exactly, text only by font/rotation. Text boxes are
 * ignored because P-touch nudges them when it auto-shrinks, and element order
 * varies between files.
 */
const signature = (p: ParsedLbx) =>
  JSON.stringify([
    round(p.widthMm, 0.2),
    round(p.heightMm, 0.2),
    p.elements
      .filter((e) => e.type !== "text")
      .map((e) => [e.type, round(e.x, 0.2), round(e.y, 0.2), round(e.w, 0.2), round(e.h, 0.2), e.rotate, e.paint]),
    [...textKeys(p).keys()].sort(),
  ]);

/** Imported element -> v2 node (free layout, scales with the label). */
const toNode = (e: LabelElement): LabelNode => {
  const base = {
    id: e.id,
    x: e.x,
    y: e.y,
    w: { kind: "fixed", mm: e.w } as const,
    h: { kind: "fixed", mm: e.h } as const,
    ax: "scale" as const,
    ay: "scale" as const,
    rotate: e.rotate,
  };
  if (e.type === "rect")
    return { ...base, type: "rect", fill: e.fill ? e.paint : "none", stroke: e.stroke ? e.paint : undefined, strokeMm: e.stroke || undefined, radius: e.radius || undefined };
  return {
    ...base,
    type: "text",
    text: e.text,
    font: e.font,
    sizePt: e.sizePt,
    weight: e.weight,
    align: e.align,
    valign: e.valign,
    fit: e.shrink ? "shrink" : "fixed",
    color: e.paint,
  };
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Merge parsed labels into templates (one per distinct layout) and rows. */
export function mergeParsed(parsed: ParsedLbx[], opts: ImportOptions = {}): ImportResult {
  const groups = new Map<string, ParsedLbx[]>();
  for (const p of parsed) {
    const sig = signature(p);
    groups.set(sig, [...(groups.get(sig) ?? []), p]);
  }

  const templates: Template[] = [];
  const rows: LabelRow[] = [];
  let gi = 0;

  for (const members of groups.values()) {
    const head = members[0];
    const name = opts.templateNames?.[gi] ?? (members.length > 1 ? `Imported layout ${gi + 1}` : head.name);
    const templateId = `t-${slug(name)}-${gi}`;
    gi++;

    // Line each member's text elements up with the head's, by font/rotation identity.
    const headKeys = textKeys(head);
    const align = members.map((m) => {
      const mk = textKeys(m);
      const map = new Map<number, number>(); // head index -> member index
      for (const [k, hi] of headKeys) map.set(hi, mk.get(k)!);
      return map;
    });

    const fields: LegacyField[] = [];
    const fieldOf = new Map<number, string>(); // head element index -> field key
    const elements: LabelElement[] = head.elements.map((e, i) => {
      const { objectName, ...el } = e;
      if (el.type !== "text") return el;
      const versions = members.map((m, mi) => m.elements[align[mi].get(i)!] as TextElement);
      // Use the least-shrunk instance's box and size; our renderer shrinks per value anyway.
      const best = versions.reduce((a, b) => (b.sizePt > a.sizePt ? b : a));
      const merged = { ...el, x: best.x, y: best.y, w: best.w, h: best.h, sizePt: best.sizePt };
      const texts = versions.map((v) => v.text);
      if (new Set(texts).size === 1) return merged;
      const key = opts.fieldNames?.[objectName] ?? slug(objectName);
      fields.push({ key, label: key, multiline: texts.some((t) => t.includes("\n")) });
      fieldOf.set(i, key);
      return { ...merged, text: `{{${key}}}` };
    });

    templates.push({
      id: templateId,
      name,
      schema: 2,
      description: `Imported from ${members.length} P-touch file(s).`,
      design: { w: head.widthMm, h: head.heightMm },
      scaleText: true,
      invertByDefault: head.invertByDefault,
      fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.multiline ? "multiline" : "text" })),
      // Imported layouts are free-form and scale with the label; restructure them in the editor to reflow.
      root: {
        id: "root",
        name: "Label",
        type: "frame",
        layout: "free",
        w: { kind: "fill" },
        h: { kind: "fill" },
        children: elements.map(toNode),
      },
    });

    members.forEach((m, mi) => {
      const values: Record<string, string> = {};
      const overrides: Record<string, Partial<LabelNode>> = {};
      for (const [hi, key] of fieldOf) {
        const own = m.elements[align[mi].get(hi)!] as TextElement;
        values[key] = own.text;
        // Keep the size the designer used for this label when it differs from the template's.
        const tpl = elements[hi] as TextElement;
        if (own.sizePt !== tpl.sizePt) overrides[tpl.id] = { sizePt: own.sizePt };
      }
      rows.push({
        id: `l-${slug(m.name)}`,
        templateId,
        name: m.name,
        values,
        ...(Object.keys(overrides).length ? { overrides } : {}),
      });
    });
  }

  return { templates, labels: rows, warnings: parsed.flatMap((p) => p.warnings) };
}

/** Read label.xml out of an .lbx zip. */
export async function readLbx(data: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file("label.xml");
  if (!file) throw new Error("not an .lbx file (label.xml missing)");
  return file.async("string");
}

/** Browser entry point: import a set of dropped/selected .lbx files. */
export async function importLbxFiles(files: File[], opts?: ImportOptions): Promise<ImportResult> {
  const parsed: ParsedLbx[] = [];
  for (const f of files) parsed.push(parseLabelXml(f.name, await readLbx(await f.arrayBuffer()), DOMParser));
  return mergeParsed(parsed, opts);
}
