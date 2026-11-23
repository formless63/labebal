/**
 * Test fixture: the Label Muncher, a small monster with your words in its mouth.
 *
 *   root (row, black): the monster
 *   ├─ face (column)
 *   │   ├─ eyes (row of free frames: white ellipse + black pupil, scaled)
 *   │   └─ noise (lockup column): "NOM" over "NOM NOM", scaled as one unit
 *   └─ mouth (column, white)
 *       ├─ top teeth (row of triangles)
 *       ├─ title   {{title}}
 *       ├─ tongue (black pill)  {{detail}}
 *       └─ bottom teeth
 *
 * Square and tall labels put the face above the mouth; short ones lose the noise.
 */
import type { FrameNode, Label, LabelNode, PolygonNode, Template, TextNode } from "../../src";

const fill = { kind: "fill" } as const;
const weight = (n: number) => ({ kind: "fill", weight: n }) as const;

const frame = (id: string, name: string, layout: FrameNode["layout"], children: LabelNode[], extra: Partial<FrameNode> = {}): FrameNode => ({
  id, name, type: "frame", layout, w: fill, h: fill, align: "stretch", children, ...extra,
});

const tooth = (id: string, down: boolean): PolygonNode => ({ id, name: "Tooth gap", type: "polygon", sides: 3, angle: down ? 180 : 0, fill: "black", w: fill, h: fill });
const teeth = (id: string, down: boolean) =>
  frame(id, down ? "Top teeth" : "Bottom teeth", "row", Array.from({ length: 7 }, (_, i) => tooth(`${id}${i + 1}`, down)), { h: weight(1) });

/** One eye in a 3 x 4 mm box; the pupil scales with it. */
const eye = (id: string, px: number, py: number): FrameNode =>
  frame(id, "Eye", "free", [
    { id: `${id}White`, name: "White", type: "ellipse", x: 0, y: 0, w: fill, h: fill, ax: "stretch", ay: "stretch", fill: "white" },
    { id: `${id}Pupil`, name: "Pupil", type: "ellipse", x: px, y: py, w: { kind: "fixed", mm: 1.3 }, h: { kind: "fixed", mm: 1.6 }, ax: "scale", ay: "scale", fill: "black" },
  ]);

const word = (id: string, text: string, sizePt: number): TextNode => ({
  id, name: text, type: "text", text, font: "Test Pixel 8", sizePt, fit: "shrink", align: "center", valign: "middle", color: "white", w: fill, h: { kind: "hug" },
});

export const muncherTemplate: Template = {
  id: "t-muncher",
  name: "Label Muncher",
  description: "A small monster with your words in its mouth.",
  schema: 2,
  design: { w: 30, h: 12 },
  scaleText: true,
  tags: ["fun"],
  fields: [
    { key: "title", label: "What it's eating", type: "text", default: "SNACKS" },
    { key: "detail", label: "On its tongue", type: "text", default: "DO NOT FEED" },
  ],
  root: frame("root", "Monster", "row", [
    frame("face", "Face", "column", [
      frame("eyes", "Eyes", "row", [eye("eyeL", 1.3, 1.5), eye("eyeR", 0.9, 0.9)], { gap: 0.5 }),
      frame("noise", "Noise", "column", [word("big", "NOM", 5.4), word("small", "NOM NOM", 3.6)], { lockup: true, gap: 0.3, h: { kind: "hug" } }),
    ], { w: weight(1), gap: 0.5, padding: [0.4, 0.3, 0.3, 0.3] }),
    frame("mouth", "Mouth", "column", [
      teeth("top", true),
      {
        id: "title", name: "Title", type: "text", text: "{{title}}", font: "Test Pixel 12", sizePt: 9, fit: "shrink", align: "center", valign: "middle", color: "black", w: fill, h: weight(2.6),
      },
      frame("tongue", "Tongue", "row", [
        { id: "detail", name: "Detail", type: "text", text: "{{detail}}", font: "Test Pixel 16", sizePt: 6, fit: "shrink", align: "center", valign: "middle", color: "white", w: fill, h: fill },
      ], { h: weight(1.5), fill: "black", radius: 1, padding: [0.1, 0.8, 0.1, 0.8] }),
      teeth("bottom", false),
    ], { w: weight(2.6), gap: 0.4, padding: [0, 0.4, 0, 0.4], fill: "white", radius: 1 }),
  ], { padding: [0.8, 0.9, 0.8, 0.9], gap: 0.8, fill: "black", radius: 2 }),
  variants: [
    { id: "narrow", name: "Short labels: no noise", when: { maxW: 22 }, patches: { noise: { hidden: true } } },
    { id: "tall", name: "Square and tall labels: face on top", when: { maxAspect: 1.2 }, patches: { root: { layout: "column" }, face: { w: fill, h: weight(1) }, mouth: { w: fill, h: weight(1.6) } } },
  ],
};

/** Short and long titles, with and without a detail, a per-label text size. */
export const muncherLabels: Label[] = (
  [
    ["Snacks", "SNACKS", "DO NOT FEED"],
    ["Odd socks", "ODD SOCKS", "ONLY THE LEFT ONES", 7],
    ["Mystery cables", "MYSTERY\nCABLES", "PROBABLY FINE"],
    ["Tuesday", "TUESDAY", ""],
    ["Spare screws", "SPARE SCREWS", "FROM THE THING\nYOU FIXED"],
  ] as [string, string, string, number?][]
).map(([name, title, detail, sizePt]) => ({
  id: `l-muncher-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  templateId: muncherTemplate.id,
  name,
  values: { title, detail },
  tags: ["fun"],
  overrides: sizePt ? { title: { sizePt } } : undefined,
}));
