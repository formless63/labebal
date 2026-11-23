import { describe, expect, it } from "vitest";
import { layout, type TextMeasurer } from "../src/layout";
import type { FrameNode, Template } from "../src/schema";

const fake: TextMeasurer = { measure: (_n, text, sizePt) => ({ w: text.length * sizePt * 0.1, h: sizePt * 0.1 }) };
const tpl = (root: FrameNode): Template => ({ id: "t", name: "t", schema: 2, design: { w: 30, h: 10 }, root, fields: [] });
const run = (t: Template, w: number, h: number) => layout({ template: t, width: w, height: h, measurer: fake });

describe("floating children in a row / column", () => {
  const root: FrameNode = {
    id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, gap: 1, padding: [1, 1, 1, 1], align: "stretch",
    children: [
      { id: "a", type: "rect", fill: "black", w: { kind: "fixed", mm: 4 }, h: { kind: "fill" } },
      { id: "badge", type: "rect", fill: "black", float: true, x: 20, y: 0.5, w: { kind: "fixed", mm: 3 }, h: { kind: "fixed", mm: 2 } },
      { id: "b", type: "rect", fill: "black", w: { kind: "fill" }, h: { kind: "fill" } },
    ],
  };

  it("leaves the line-up alone and sits at its own position", () => {
    const r = run(tpl(root), 30, 10);
    // Without the badge in the flow: 30 - 2 padding - 1 gap - 4 = 23.
    expect(r.byId.get("b")!.box).toEqual({ x: 6, y: 1, w: 23, h: 8 });
    expect(r.byId.get("badge")!.box).toEqual({ x: 21, y: 1.5, w: 3, h: 2 });
  });

  it("is drawn on top (after the line-up) and follows its anchors on other sizes", () => {
    const pinned = { ...root, children: root.children.map((c) => (c.id === "badge" ? { ...c, ax: "end" as const } : c)) };
    const r = run(tpl(pinned), 40, 10);
    expect(r.items.at(-1)!.node.id).toBe("badge");
    // Keeps its distance from the right edge: design 28 - 20 - 3 = 5 mm.
    expect(r.byId.get("badge")!.box.x).toBeCloseTo(1 + 38 - 5 - 3);
  });

  it("doesn't count towards a hugging stack's size", () => {
    const hug: FrameNode = { id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [{ ...root, id: "inner", w: { kind: "hug" }, h: { kind: "hug" }, padding: undefined, children: [root.children[0], { ...root.children[1], h: { kind: "fixed", mm: 9 } }] }] };
    const r = run(tpl(hug), 30, 10);
    expect(r.byId.get("inner")!.box.w).toBeCloseTo(4);
  });
});
