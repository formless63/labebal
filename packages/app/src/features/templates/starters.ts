/** Starting points for new templates. All reflow (row/column) so they work on every size. */
import { LABEL_FONT, type FrameNode, type Template, type TextNode } from "@labebal/core";

export type StarterId = "blank" | "title-subtitle" | "icon-text" | "qr-text";

export const STARTERS: { id: StarterId; name: string; description: string }[] = [
  { id: "blank", name: "Blank", description: "Empty label, place things anywhere." },
  { id: "title-subtitle", name: "Title + subtitle", description: "Big line on top, smaller line below." },
  { id: "icon-text", name: "Icon + text", description: "Symbol on the left, two lines of text." },
  { id: "qr-text", name: "QR code + text", description: "Scannable code with a title beside it." },
];

const text = (id: string, name: string, field: string, sizePt: number, extra: Partial<TextNode> = {}): TextNode => ({
  id,
  name,
  type: "text",
  text: `{{${field}}}`,
  font: LABEL_FONT,
  weight: 600,
  sizePt,
  fit: "shrink",
  align: "center",
  valign: "middle",
  color: "black",
  w: { kind: "fill" },
  h: { kind: "fill" },
  ...extra,
});

const twoLines = (align: TextNode["align"]): FrameNode => ({
  id: "lines",
  name: "Text",
  type: "frame",
  layout: "column",
  w: { kind: "fill" },
  h: { kind: "fill" },
  gap: 0.3,
  align: "stretch",
  children: [text("title", "Title", "title", 12, { weight: 700, align, h: { kind: "fill", weight: 2 } }), text("subtitle", "Subtitle", "subtitle", 7, { align })],
});

export function makeStarter(kind: StarterId, opts: { id: string; name: string; design: { w: number; h: number } }): Template {
  const base = { id: opts.id, name: opts.name, schema: 2 as const, design: opts.design, scaleText: true };
  const root = (layout: FrameNode["layout"], children: FrameNode["children"], extra: Partial<FrameNode> = {}): FrameNode => ({
    id: "root",
    name: "Label",
    type: "frame",
    layout,
    w: { kind: "fill" },
    h: { kind: "fill" },
    children,
    ...extra,
  });
  const pad: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
  switch (kind) {
    case "blank":
      return { ...base, fields: [], root: root("free", []) };
    case "title-subtitle":
      return {
        ...base,
        fields: [
          { key: "title", label: "Title", type: "text", default: "TITLE" },
          { key: "subtitle", label: "Subtitle", type: "text", default: "Subtitle" },
        ],
        root: root("column", twoLines("center").children, { gap: 0.3, align: "stretch", padding: pad }),
      };
    case "icon-text":
      return {
        ...base,
        fields: [
          { key: "icon", label: "Icon", type: "text", default: "box" },
          { key: "title", label: "Title", type: "text", default: "TITLE" },
          { key: "subtitle", label: "Detail", type: "text", default: "Detail" },
        ],
        root: root(
          "row",
          [
            { id: "icon", name: "Icon", type: "icon", icon: "{{icon}}", color: "black", w: { kind: "fixed", mm: Math.max(3, opts.design.h - 1) }, h: { kind: "fill" } },
            twoLines("left"),
          ],
          { gap: 1, align: "stretch", padding: pad },
        ),
        variants: [{ id: "tiny", name: "Tiny labels: no icon", when: { maxW: 18 }, patches: { icon: { hidden: true } } }],
      };
    case "qr-text":
      return {
        ...base,
        fields: [
          { key: "title", label: "Title", type: "text", default: "TITLE" },
          { key: "subtitle", label: "Detail", type: "text", default: "Detail" },
          { key: "url", label: "Code contents", type: "text", default: "https://example.com" },
        ],
        root: root(
          "row",
          [
            { id: "code", name: "QR code", type: "code", format: "qrcode", value: "{{url}}", ecc: "M", color: "black", w: { kind: "fixed", mm: Math.max(3, opts.design.h - 1) }, h: { kind: "fill" } },
            twoLines("left"),
          ],
          { gap: 1, align: "stretch", padding: pad },
        ),
      };
  }
}
