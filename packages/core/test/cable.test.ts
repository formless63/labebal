import { describe, expect, it } from "vitest";
import { cableWrapMm, mirrorCopyId } from "../src/cable";
import { layout, type TextMeasurer } from "../src/layout";
import type { FrameNode, MirrorSpec, Template } from "../src/schema";

const fake: TextMeasurer = { measure: (_n, text, sizePt) => ({ w: text.length * sizePt * 0.1, h: sizePt * 0.1 }) };

/** [A 20 mm][wrap for a 5 mm cable][B mirrors A], A holds a 2 x 3 mm mark at (1, 2) and a left-aligned text. */
const flag = (mode: MirrorSpec["mode"]): Template => {
  const root: FrameNode = {
    id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" },
    children: [
      {
        id: "a", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" },
        children: [
          { id: "mark", type: "rect", fill: "black", x: 1, y: 2, w: { kind: "fixed", mm: 2 }, h: { kind: "fixed", mm: 3 } },
          { id: "txt", type: "text", text: "{{t}}", font: "x", sizePt: 10, align: "left", color: "black", x: 4, y: 0, w: { kind: "fixed", mm: 10 }, h: { kind: "fixed", mm: 4 } },
        ],
      },
      { id: "wrap", type: "frame", layout: "free", wrapDiameterMm: 5, w: { kind: "fixed", mm: 1 }, h: { kind: "fill" }, children: [] },
      { id: "b", type: "frame", layout: "free", mirror: { of: "a", mode }, w: { kind: "fill" }, h: { kind: "fill" }, children: [] },
    ],
  };
  return { id: "t", name: "t", schema: 2, design: { w: 60, h: 12 }, root, fields: [{ key: "t", label: "T", type: "text" }] };
};

const run = (t: Template) => layout({ template: t, width: 60, height: 12, measurer: fake, label: { values: { t: "AB" } } });

describe("cable wrap zone", () => {
  it("is the circumference plus a little overlap", () => {
    expect(cableWrapMm(5)).toBeCloseTo(Math.PI * 5 + 0.5);
    expect(cableWrapMm(0)).toBeCloseTo(0.5);
    const r = run(flag("repeat"));
    const wrap = r.byId.get("wrap")!.box;
    expect(wrap.w).toBeCloseTo(cableWrapMm(5));
    // The two halves share the rest.
    expect(r.byId.get("a")!.box.w).toBeCloseTo((60 - cableWrapMm(5)) / 2);
    expect(r.byId.get("b")!.box.x).toBeCloseTo(wrap.x + wrap.w);
  });

  it("follows a column's height", () => {
    const t = flag("repeat");
    t.root.layout = "column";
    for (const c of t.root.children) [c.w, c.h] = [c.h, c.w];
    const r = layout({ template: t, width: 12, height: 60, measurer: fake });
    expect(r.byId.get("wrap")!.box.h).toBeCloseTo(cableWrapMm(5));
  });
});

describe("mirrored halves", () => {
  const ids = (r: ReturnType<typeof run>) => r.items.map((i) => i.node.id);

  it("repeat copies the source layout into the mirror frame, after it in paint order", () => {
    const r = run(flag("repeat"));
    const a = r.byId.get("a")!.box, b = r.byId.get("b")!.box;
    const copy = r.byId.get(mirrorCopyId("b", "mark"))!;
    expect(copy.copyOf).toBe("mark");
    expect(copy.node.locked).toBe(true);
    expect(copy.box.x - b.x).toBeCloseTo(r.byId.get("mark")!.box.x - a.x);
    expect(copy.box.y).toBeCloseTo(2);
    expect(copy.depth).toBe(r.byId.get("b")!.depth + 1);
    expect(ids(r).indexOf(copy.node.id)).toBe(ids(r).indexOf("b") + 1);
    expect(r.byId.get(mirrorCopyId("b", "txt"))!.text).toBe("AB");
  });

  it("reflect flips positions left-right (not the letters) and swaps alignment", () => {
    const r = run(flag("reflect"));
    const b = r.byId.get("b")!.box;
    const copy = r.byId.get(mirrorCopyId("b", "mark"))!;
    // 1 mm from A's outer edge -> 1 mm from B's outer (right) edge.
    expect(b.x + b.w - (copy.box.x + copy.box.w)).toBeCloseTo(1);
    expect(copy.box.y).toBeCloseTo(2);
    const txt = r.byId.get(mirrorCopyId("b", "txt"))!.node;
    expect(txt.type === "text" && txt.align).toBe("right");
    expect(txt.rotate ?? 0).toBe(0);
  });

  it("rotate turns the half 180 degrees", () => {
    const r = run(flag("rotate"));
    const b = r.byId.get("b")!.box;
    const copy = r.byId.get(mirrorCopyId("b", "mark"))!;
    expect(b.x + b.w - (copy.box.x + copy.box.w)).toBeCloseTo(1);
    expect(b.y + b.h - (copy.box.y + copy.box.h)).toBeCloseTo(2);
    expect(r.byId.get(mirrorCopyId("b", "txt"))!.node.rotate).toBe(180);
  });

  it("ignores missing sources and self-references", () => {
    const t = flag("repeat");
    (t.root.children[2] as FrameNode).mirror = { of: "nope", mode: "repeat" };
    expect(run(t).items.some((i) => i.copyOf)).toBe(false);
    (t.root.children[0] as FrameNode).mirror = { of: "root", mode: "repeat" };
    expect(run(t).items.some((i) => i.copyOf)).toBe(false);
  });
});
