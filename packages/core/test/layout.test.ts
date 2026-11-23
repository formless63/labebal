import { describe, expect, it } from "vitest";
import { DEFAULT_2D_MM, layout, type ImageSizer, type TextMeasurer } from "../src/layout";
import type { FrameNode, ImageNode, Sizing, Template } from "../src/schema";

/** 1 pt of text = 1 mm wide per character, 1 mm tall per pt. */
const fake: TextMeasurer = {
  measure: (_n, text, sizePt) => ({ w: Math.max(...text.split("\n").map((l) => l.length)) * sizePt * 0.1, h: text.split("\n").length * sizePt * 0.1 }),
};

const tpl = (root: FrameNode, design = { w: 30, h: 10 }): Template => ({
  id: "t", name: "t", schema: 2, design, root, fields: [{ key: "a", label: "A", type: "text" }],
});

const run = (t: Template, w: number, h: number, values: Record<string, string> = {}) =>
  layout({ template: t, width: w, height: h, measurer: fake, label: { values } });

describe("stack layout", () => {
  const root: FrameNode = {
    id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, gap: 1, padding: [1, 1, 1, 1], align: "stretch",
    children: [
      { id: "fixed", type: "rect", fill: "black", w: { kind: "fixed", mm: 4 }, h: { kind: "fill" } },
      { id: "fill", type: "rect", fill: "black", w: { kind: "fill" }, h: { kind: "fill" } },
      { id: "hug", type: "text", text: "{{a}}", font: "x", sizePt: 10, color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
    ],
  };

  it("fills remaining space and hugs content", () => {
    const r = run(tpl(root), 30, 10, { a: "abc" }); // hug text = 3 mm wide
    expect(r.byId.get("fixed")!.box).toEqual({ x: 1, y: 1, w: 4, h: 8 });
    expect(r.byId.get("hug")!.box.w).toBeCloseTo(3);
    // 30 - 2 padding - 2 gaps - 4 fixed - 3 hug = 19
    expect(r.byId.get("fill")!.box.w).toBeCloseTo(19);
  });

  it("reflows to a different label size", () => {
    const r = run(tpl(root), 20, 15, { a: "abc" });
    expect(r.byId.get("fill")!.box.w).toBeCloseTo(9);
    expect(r.byId.get("fixed")!.box.h).toBeCloseTo(13);
  });
});

describe("free layout constraints", () => {
  const root: FrameNode = {
    id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" },
    children: [
      { id: "s", type: "rect", fill: "black", x: 2, y: 2, w: { kind: "fixed", mm: 4 }, h: { kind: "fixed", mm: 2 } },
      { id: "e", type: "rect", fill: "black", x: 24, y: 6, w: { kind: "fixed", mm: 4 }, h: { kind: "fixed", mm: 2 }, ax: "end", ay: "end" },
      { id: "st", type: "rect", fill: "black", x: 1, y: 4, w: { kind: "fixed", mm: 28 }, h: { kind: "fixed", mm: 1 }, ax: "stretch", ay: "center" },
      { id: "sc", type: "rect", fill: "black", x: 15, y: 0, w: { kind: "fixed", mm: 3 }, h: { kind: "fixed", mm: 10 }, ax: "scale", ay: "scale" },
    ],
  };

  it("applies start/end/stretch/center/scale", () => {
    const r = run(tpl(root), 60, 20);
    expect(r.byId.get("s")!.box).toEqual({ x: 2, y: 2, w: 4, h: 2 });
    expect(r.byId.get("e")!.box).toEqual({ x: 54, y: 16, w: 4, h: 2 });
    expect(r.byId.get("st")!.box).toEqual({ x: 1, y: 9, w: 58, h: 1 });
    expect(r.byId.get("sc")!.box).toEqual({ x: 30, y: 0, w: 6, h: 20 });
  });
});

describe("variants and visibility", () => {
  const root: FrameNode = {
    id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" },
    children: [
      { id: "logo", type: "rect", fill: "black", w: { kind: "fixed", mm: 5 }, h: { kind: "fill" } },
      { id: "body", type: "rect", fill: "black", w: { kind: "fill" }, h: { kind: "fill" }, showWhen: { minH: 8 } },
    ],
  };
  const t: Template = { ...tpl(root), variants: [{ id: "narrow", name: "n", when: { maxW: 15 }, patches: { logo: { hidden: true } } }] };

  it("hides nodes by variant and showWhen", () => {
    expect(run(t, 30, 10).byId.has("logo")).toBe(true);
    const narrow = run(t, 12, 10);
    expect(narrow.variants).toEqual(["narrow"]);
    expect(narrow.byId.has("logo")).toBe(false);
    expect(narrow.byId.get("body")!.box.w).toBeCloseTo(12);
    expect(run(t, 30, 6).byId.has("body")).toBe(false);
  });

  it("applies label overrides", () => {
    const r = layout({ template: t, width: 30, height: 10, measurer: fake, label: { values: {}, overrides: { logo: { w: { kind: "fixed", mm: 9 } } } } });
    expect(r.byId.get("logo")!.box.w).toBe(9);
  });
});

describe("image hug sizing", () => {
  const img = (id: string, w: Sizing, h: Sizing, extra: Partial<ImageNode> = {}): ImageNode => ({
    id, type: "image", src: "wide.png", fit: "contain", dither: "threshold", color: "black", w, h, ...extra,
  });
  const sizes: ImageSizer = (src) => (src === "wide.png" ? { w: 200, h: 100 } : src === "tall.png" ? { w: 50, h: 100 } : undefined);
  const lay = (root: FrameNode, imageSize: ImageSizer = sizes, w = 30, h = 10) => layout({ template: tpl(root), width: w, height: h, measurer: fake, imageSize });
  const free = (...children: ImageNode[]): FrameNode => ({ id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children });

  it("hugging width follows a fixed height with the natural aspect", () => {
    const r = lay(free(img("i", { kind: "hug" }, { kind: "fixed", mm: 4 })));
    expect(r.byId.get("i")!.box).toMatchObject({ w: 8, h: 4 });
  });

  it("hugging height follows a fixed width", () => {
    const r = lay(free(img("i", { kind: "fixed", mm: 6 }, { kind: "hug" }, { src: "tall.png" })));
    expect(r.byId.get("i")!.box).toMatchObject({ w: 6, h: 12 });
  });

  it("hugging both uses the default size for the longer side; rotation swaps the aspect", () => {
    expect(lay(free(img("i", { kind: "hug" }, { kind: "hug" }))).byId.get("i")!.box).toMatchObject({ w: DEFAULT_2D_MM, h: DEFAULT_2D_MM / 2 });
    expect(lay(free(img("i", { kind: "hug" }, { kind: "fixed", mm: 4 }, { rotate: 90 }))).byId.get("i")!.box).toMatchObject({ w: 2, h: 4 });
  });

  it("falls back to square when the image size is unknown", () => {
    const r = lay(free(img("i", { kind: "hug" }, { kind: "fixed", mm: 4 })), () => undefined);
    expect(r.byId.get("i")!.box).toMatchObject({ w: 4, h: 4 });
  });

  it("follows the cross size in a stack", () => {
    const row: FrameNode = { id: "root", type: "frame", layout: "row", align: "stretch", w: { kind: "fill" }, h: { kind: "fill" }, children: [img("i", { kind: "hug" }, { kind: "fill" })] };
    expect(lay(row).byId.get("i")!.box).toMatchObject({ w: 20, h: 10 });
    const col: FrameNode = { ...row, layout: "column", children: [img("i", { kind: "fill" }, { kind: "hug" })] };
    expect(lay(col).byId.get("i")!.box).toMatchObject({ w: 30, h: 15 });
  });

  it("resolves {{field}} sources before asking for the size", () => {
    const root = free(img("i", { kind: "hug" }, { kind: "fixed", mm: 4 }, { src: "{{a}}" }));
    const r = layout({ template: tpl(root), width: 30, height: 10, measurer: fake, imageSize: sizes, label: { values: { a: "tall.png" } } });
    expect(r.byId.get("i")!.box).toMatchObject({ w: 2, h: 4 });
  });
});
