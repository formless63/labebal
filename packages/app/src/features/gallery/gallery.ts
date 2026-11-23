/**
 * Starter template gallery: curated designs by use case. Every starter is
 * built from row / column stacks (no free positions), so it reflows from N1
 * 14 mm tape up to M2 50 mm labels; variants drop secondary parts on tiny
 * sizes. Field defaults are the example values shown in the gallery.
 */
import { LABEL_FONT, type FieldDef, type FrameNode, type LabelNode, type TableNode, type Template, type TextNode, type Variant } from "@labebal/core";

export type GalleryCategory = "storage" | "electronics" | "cables" | "assets" | "kitchen" | "fun" | "shipping";

export const CATEGORIES: { id: GalleryCategory; name: string }[] = [
  { id: "storage", name: "Parts bins & drawers" },
  { id: "electronics", name: "Electronics & SMD" },
  { id: "cables", name: "Cables" },
  { id: "assets", name: "Asset tags" },
  { id: "kitchen", name: "Food & dates" },
  { id: "fun", name: "Just for fun" },
  { id: "shipping", name: "Shipping & returns" },
];

export interface GalleryItem {
  id: string;
  name: string;
  description: string;
  category: GalleryCategory;
  /** Size id the preview opens at (and the design size, when it fits the chosen printer). */
  sizeId: string;
  build: (design: { w: number; h: number }) => Omit<Template, "id" | "name" | "design">;
}

/* --------------------------------------------------------------- helpers */

const fill = { kind: "fill" } as const;
const hug = { kind: "hug" } as const;
const fixed = (mm: number) => ({ kind: "fixed", mm }) as const;
const pad = (v: number): [number, number, number, number] => [v, v, v, v];

const text = (id: string, value: string, sizePt: number, extra: Partial<TextNode> = {}): TextNode => ({
  id,
  type: "text",
  text: value,
  font: LABEL_FONT,
  weight: 600,
  sizePt,
  fit: "shrink",
  align: "left",
  valign: "middle",
  color: "black",
  w: fill,
  h: fill,
  ...extra,
});

const frame = (id: string, layout: FrameNode["layout"], children: LabelNode[], extra: Partial<FrameNode> = {}): FrameNode => ({
  id,
  type: "frame",
  layout,
  w: fill,
  h: fill,
  align: "stretch",
  children,
  ...extra,
});

const root = (layout: FrameNode["layout"], children: LabelNode[], extra: Partial<FrameNode> = {}) =>
  frame("root", layout, children, { name: "Label", padding: pad(0.4), gap: 0.8, ...extra });

const field = (key: string, label: string, def: string, type: FieldDef["type"] = "text"): FieldDef => ({ key, label, type, default: def });

const tiny = (patches: Variant["patches"]): Variant => ({ id: "tiny", name: "Short labels", when: { maxW: 20 }, patches });

/** Label Muncher parts: an eye whose pupil scales with it, and a row of teeth. */
const eye = (id: string, x: number, y: number): FrameNode =>
  frame(id, "free", [
    { id: `${id}White`, name: "White", type: "ellipse", x: 0, y: 0, w: fill, h: fill, ax: "stretch", ay: "stretch", fill: "white" },
    { id: `${id}Pupil`, name: "Pupil", type: "ellipse", x, y, w: fixed(1.3), h: fixed(1.6), ax: "scale", ay: "scale", fill: "black" },
  ]);
const teeth = (id: string, down: boolean): FrameNode =>
  frame(id, "row", Array.from({ length: 7 }, (_, i): LabelNode => ({ id: `${id}${i + 1}`, name: "Tooth gap", type: "polygon", sides: 3, angle: down ? 180 : 0, fill: "black", w: fill, h: fill })), { name: "Teeth" });

/** A square-ish leading element as tall as the label. */
const leading = (h: number) => fixed(Math.max(3, h - 0.8));

/* --------------------------------------------------------------- starters */

export const GALLERY: GalleryItem[] = [
  {
    id: "parts-bin",
    name: "Parts bin",
    description: "Icon, part name and a size / spec line. The icon drops off on short labels.",
    category: "storage",
    sizeId: "n1-14x40",
    build: (d) => ({
      schema: 2,
      scaleText: true,
      tags: ["storage"],
      fields: [field("icon", "Icon", "box"), field("name", "Part", "M3 x 8 SCREW"), field("spec", "Spec", "DIN 912 · stainless")],
      root: root("row", [
        { id: "icon", name: "Icon", type: "icon", icon: "{{icon}}", color: "black", w: leading(d.h), h: fill },
        frame("lines", "column", [text("name", "{{name}}", 12, { weight: 700, h: { kind: "fill", weight: 2 } }), text("spec", "{{spec}}", 7)], { gap: 0.2 }),
      ]),
      variants: [tiny({ icon: { hidden: true } })],
    }),
  },
  {
    id: "drawer-front",
    name: "Drawer front (inverted)",
    description: "White on black title with a thin detail line, for small drawers.",
    category: "storage",
    sizeId: "n1-14x30",
    build: () => ({
      schema: 2,
      scaleText: true,
      invertByDefault: true,
      tags: ["storage"],
      fields: [field("title", "Title", "RESISTORS"), field("detail", "Detail", "1/4 W · E12")],
      root: root("column", [text("title", "{{title}}", 11, { weight: 700, align: "center", h: { kind: "fill", weight: 2 } }), text("detail", "{{detail}}", 6, { align: "center" })], { gap: 0.2 }),
    }),
  },
  {
    id: "smd-reel",
    name: "SMD reel / strip",
    description: "Big value with a package / tolerance table and a part-number QR on wider labels.",
    category: "electronics",
    sizeId: "m2-30x15",
    build: (d) => ({
      schema: 2,
      scaleText: true,
      tags: ["electronics"],
      fields: [field("value", "Value", "10kΩ"), field("package", "Package", "0603"), field("tol", "Tolerance", "1%"), field("mpn", "Part number", "RC0603FR-0710KL")],
      root: root("row", [
        frame(
          "info",
          "column",
          [
            text("value", "{{value}}", 14, { weight: 700, h: { kind: "fill", weight: 2 } }),
            {
              id: "specs",
              name: "Specs",
              type: "table",
              cols: [hug, fill],
              rows: [fill, fill],
              cells: [
                ["PKG", "{{package}}"],
                ["TOL", "{{tol}}"],
              ],
              header: "column",
              font: LABEL_FONT,
              sizePt: 6,
              fit: "shrink",
              color: "black",
              borderMm: 0.15,
              cellPaddingMm: 0.25,
              w: fill,
              h: { kind: "fill", weight: 2 },
            } satisfies TableNode,
          ],
          { gap: 0.4 },
        ),
        { id: "qr", name: "Part QR", type: "code", format: "qrcode", value: "{{mpn}}", ecc: "M", color: "black", w: leading(d.h), h: fill, showWhen: { minW: 24 } },
      ]),
    }),
  },
  {
    id: "pinout",
    name: "Connector pinout",
    description: "Pin / signal table with an inverted header row; columns reflow with the label.",
    category: "electronics",
    sizeId: "m2-50x30",
    build: () => ({
      schema: 2,
      scaleText: true,
      tags: ["electronics", "cables"],
      fields: [field("title", "Connector", "USB-C (power)")],
      root: root(
        "column",
        [
          text("title", "{{icon:mdi:usb}} {{title}}", 9, { weight: 700, h: { kind: "fill", weight: 1 } }),
          {
            id: "pins",
            name: "Pins",
            type: "table",
            cols: [hug, fill, hug, fill],
            rows: [fill, fill, fill, fill],
            cells: [
              ["Pin", "Signal", "Pin", "Signal"],
              ["A1", "GND", "A4", "VBUS"],
              ["A5", "CC1", "A6", "D+"],
              ["A7", "D-", "A9", "VBUS"],
            ],
            header: "row",
            headerStyle: "invert",
            font: LABEL_FONT,
            sizePt: 6,
            fit: "shrink",
            color: "black",
            borderMm: 0.15,
            w: fill,
            h: { kind: "fill", weight: 4 },
          } satisfies TableNode,
        ],
        { gap: 0.5 },
      ),
    }),
  },
  {
    id: "cable-ends",
    name: "Cable: from → to",
    description: "Both ends of a cable on one line, with an optional cable number.",
    category: "cables",
    sizeId: "n1-14x40",
    build: () => ({
      schema: 2,
      scaleText: true,
      tags: ["cables"],
      fields: [field("from", "From", "NAS"), field("to", "To", "SWITCH P12"), field("id", "Cable no.", "C-042")],
      root: root(
        "column",
        [
          text("route", "{{from}} {{icon:arrow-narrow-right}} {{to}}", 11, {
            align: "center",
            weight: 700,
            h: { kind: "fill", weight: 2 },
          }),
          text("id", "{{id}}", 6, { align: "center" }),
        ],
        { gap: 0.2 },
      ),
      variants: [tiny({ id: { hidden: true } })],
    }),
  },
  {
    id: "cable-flag",
    name: "Cable ID (large number)",
    description: "One big cable number with a small note, readable from a distance.",
    category: "cables",
    sizeId: "n1-14x22",
    build: () => ({
      schema: 2,
      scaleText: true,
      tags: ["cables"],
      fields: [field("id", "Cable no.", "042"), field("note", "Note", "PATCH A")],
      root: root("row", [text("id", "{{id}}", 16, { weight: 700, align: "center", w: { kind: "fill", weight: 2 } }), text("note", "{{note}}", 6, { align: "center", showWhen: { minW: 18 } })]),
    }),
  },
  {
    id: "asset-tag",
    name: "Asset tag with QR",
    description: "Inverted owner line, asset number and a QR code that encodes it.",
    category: "assets",
    sizeId: "m2-30x15",
    build: (d) => ({
      schema: 2,
      scaleText: true,
      tags: ["assets"],
      fields: [field("org", "Owner", "PROPERTY OF ACME"), field("asset", "Asset no.", "IT-00421"), field("url", "QR contents", "https://example.com/a/IT-00421")],
      root: root("row", [
        { id: "qr", name: "QR", type: "code", format: "qrcode", value: "{{url}}", ecc: "M", color: "black", w: leading(d.h), h: fill },
        frame(
          "lines",
          "column",
          [
            text("org", "{{org}}", 6, { spans: [{ start: 0, end: 7, invert: true }], h: fill }),
            text("asset", "{{asset}}", 12, { weight: 700, font: "JetBrains Mono", h: { kind: "fill", weight: 2 } }),
          ],
          { gap: 0.2 },
        ),
      ]),
      variants: [tiny({ org: { hidden: true } })],
    }),
  },
  {
    id: "food-date",
    name: "Food: made / use by",
    description: "What it is, when it was made (today's date) and a use-by date.",
    category: "kitchen",
    sizeId: "n1-14x40",
    build: () => {
      const dates = "Made {{date:DD/MM}}  Use by {{useby}}";
      return {
        schema: 2,
        scaleText: true,
        tags: ["kitchen"],
        fields: [field("item", "Item", "Chicken soup"), field("useby", "Use by", "25/11")],
        root: root(
          "row",
          [
            { id: "icon", name: "Icon", type: "icon", icon: "tools-kitchen-2", color: "black", w: hug, h: fill, showWhen: { minW: 25 } },
            frame(
              "lines",
              "column",
              [
                text("item", "{{item}}", 11, { weight: 700, h: { kind: "fill", weight: 2 } }),
                text("dates", dates, 7, { spans: [{ start: dates.indexOf("Use by"), end: dates.length, bold: true }] }),
              ],
              { gap: 0.2 },
            ),
          ],
          { gap: 0.8 },
        ),
      };
    },
  },
  {
    id: "muncher",
    name: "Label Muncher",
    description: "A small monster with your words in its mouth. Put what it guards on its tongue.",
    category: "fun",
    sizeId: "n1-14x30",
    build: () => ({
      schema: 2,
      scaleText: true,
      tags: ["fun"],
      fields: [field("title", "What it's eating", "SNACKS"), field("detail", "On its tongue", "DO NOT FEED")],
      root: root(
        "row",
        [
          frame("eyes", "row", [eye("eyeL", 1.3, 1.5), eye("eyeR", 0.9, 0.9)], { name: "Eyes", w: { kind: "fill", weight: 1 }, gap: 0.5, padding: [0.6, 0.3, 1.2, 0.3] }),
          frame(
            "mouth",
            "column",
            [
              teeth("top", true),
              text("title", "{{title}}", 10, { weight: 800, align: "center", fit: "fill", h: { kind: "fill", weight: 2.6 } }),
              frame("tongue", "row", [text("detail", "{{detail}}", 6, { weight: 700, align: "center", fit: "fill", color: "white" })], { name: "Tongue", h: { kind: "fill", weight: 1.6 }, fill: "black", radius: 1, padding: [0.1, 0.8, 0.1, 0.8] }),
              teeth("bottom", false),
            ],
            { name: "Mouth", w: { kind: "fill", weight: 2.6 }, gap: 0.3, fill: "white", radius: 1 },
          ),
        ],
        { padding: [0.8, 0.9, 0.8, 0.9], gap: 0.8, fill: "black", radius: 2 },
      ),
      variants: [{ id: "tall", name: "Square and tall labels: face on top", when: { maxAspect: 1.2 }, patches: { root: { layout: "column" }, eyes: { w: fill, h: { kind: "fill", weight: 1 } }, mouth: { w: fill, h: { kind: "fill", weight: 1.6 } } } }],
    }),
  },
  {
    id: "return-label",
    name: "Return address mini label",
    description: "Inverted RETURN TO header, two address lines, tracking barcode on wide labels.",
    category: "shipping",
    sizeId: "m2-50x30",
    build: () => ({
      schema: 2,
      scaleText: true,
      tags: ["shipping"],
      fields: [field("name", "Name", "Sam Example"), field("address", "Address", "12 High Street\nAnytown AB1 2CD", "multiline"), field("ref", "Reference", "RMA-1042")],
      root: root(
        "column",
        [
          text("head", "RETURN TO", 6, { spans: [{ start: 0, end: 9, invert: true, bold: true }], h: fill }),
          text("name", "{{name}}", 9, { weight: 700, h: { kind: "fill", weight: 1.5 } }),
          text("address", "{{address}}", 7, { h: { kind: "fill", weight: 2.5 } }),
          { id: "ref", name: "Reference", type: "code", format: "code128", value: "{{ref}}", showText: true, color: "black", w: fill, h: { kind: "fill", weight: 2 }, showWhen: { minW: 35, minH: 20 } },
        ],
        { gap: 0.3 },
      ),
    }),
  },
  {
    id: "ship-mini",
    name: "Package contents",
    description: "Truck icon, order number and contents line for boxes and bags.",
    category: "shipping",
    sizeId: "m2-40x20",
    build: (d) => ({
      schema: 2,
      scaleText: true,
      tags: ["shipping"],
      fields: [field("order", "Order", "#10582"), field("contents", "Contents", "2x cable, 1x adapter")],
      root: root("row", [
        { id: "icon", name: "Icon", type: "icon", icon: "truck-delivery", color: "black", w: leading(d.h), h: fill },
        frame("lines", "column", [text("order", "{{order}}", 12, { weight: 700, h: { kind: "fill", weight: 2 } }), text("contents", "{{contents}}", 7)], { gap: 0.2 }),
      ]),
      variants: [tiny({ icon: { hidden: true } })],
    }),
  },
];

/** A gallery starter as a concrete template. */
export function makeFromGallery(item: GalleryItem, opts: { id: string; name: string; design: { w: number; h: number } }): Template {
  return { ...item.build(opts.design), id: opts.id, name: opts.name, design: opts.design, description: item.description };
}
