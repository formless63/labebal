import { describe, expect, it } from "vitest";
import {
  alignBoxes,
  applyPatch,
  cloneWithFreshIds,
  distributeBoxes,
  duplicateNodes,
  effectiveNode,
  findParent,
  findPath,
  insertNode,
  isInside,
  moveNode,
  nodesUsingField,
  patchNode,
  prunePatches,
  removeNodes,
  renameField,
  renameLabelField,
  renamePlaceholder,
  setVariantPatch,
  snapAxis,
  subtreeIds,
  topmost,
  unwrapNode,
  wrapNodes,
  addToVariant,
  copyVariantPatches,
  hideInVariant,
  isVariantOnly,
  markVariantOnly,
  moveNodes,
  variantsShowing,
} from "../src/edit";
import { effectiveRoot } from "../src/layout";
import { findNode, type FrameNode, type LabelNode, type Template, type TextNode } from "../src/schema";

const rect = (id: string, x = 0, y = 0, w = 2, h = 2): LabelNode => ({ id, type: "rect", fill: "black", x, y, w: { kind: "fixed", mm: w }, h: { kind: "fixed", mm: h } });
const text = (id: string, t: string): TextNode => ({ id, type: "text", text: t, font: "x", sizePt: 8, color: "black", w: { kind: "hug" }, h: { kind: "hug" } });

const tree = (): FrameNode => ({
  id: "root",
  type: "frame",
  layout: "free",
  w: { kind: "fill" },
  h: { kind: "fill" },
  children: [
    rect("a", 1, 1),
    {
      id: "col",
      type: "frame",
      layout: "column",
      x: 10,
      y: 2,
      w: { kind: "hug" },
      h: { kind: "hug" },
      padding: [1, 0, 0, 2],
      children: [text("t1", "{{title}}"), text("t2", "{{ title:x }} and {{detail}}")],
    },
    rect("b", 5, 5),
  ],
});

const tpl = (): Template => ({
  id: "t",
  name: "t",
  schema: 2,
  design: { w: 30, h: 10 },
  root: tree(),
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "detail", label: "Detail", type: "text" },
  ],
  variants: [{ id: "v", name: "v", when: { maxW: 20 }, patches: { t1: { text: "{{title}}!" } as Partial<LabelNode>, gone: { hidden: true } } }],
});

describe("queries", () => {
  it("finds parents, paths and containment", () => {
    const r = tree();
    expect(findParent(r, "t1")?.id).toBe("col");
    expect(findParent(r, "root")).toBeNull();
    expect(findPath(r, "t2")?.map((n) => n.id)).toEqual(["root", "col", "t2"]);
    expect(isInside(r, "col", "t2")).toBe(true);
    expect(isInside(r, "a", "t2")).toBe(false);
    expect(subtreeIds(r)).toEqual(["root", "a", "col", "t1", "t2", "b"]);
    expect(topmost(r, ["t1", "col", "a"])).toEqual(["col", "a"]);
  });
});

describe("transforms", () => {
  it("patches immutably and removes undefined keys", () => {
    const r = tree();
    const p = patchNode(r, "a", { x: 3, y: undefined });
    expect(findPath(p, "a")?.at(-1)).toMatchObject({ x: 3 });
    expect("y" in findPath(p, "a")!.at(-1)!).toBe(false);
    expect(findPath(r, "a")?.at(-1)?.x).toBe(1);
    // untouched subtree is shared
    expect(p.children[1]).toBe(r.children[1]);
    expect(applyPatch({ a: 1, b: 2 }, { b: undefined })).toEqual({ a: 1 });
  });

  it("inserts, removes and moves", () => {
    let r = insertNode(tree(), "col", rect("c"), 1);
    expect((r.children[1] as FrameNode).children.map((c) => c.id)).toEqual(["t1", "c", "t2"]);
    r = removeNodes(r, ["c", "root"]);
    expect(subtreeIds(r)).toEqual(["root", "a", "col", "t1", "t2", "b"]);
    r = moveNode(r, "b", "col", 0);
    expect((r.children[1] as FrameNode).children.map((c) => c.id)).toEqual(["b", "t1", "t2"]);
    // reorder within the same parent
    r = moveNode(r, "a", "root", 1);
    expect(r.children.map((c) => c.id)).toEqual(["col", "a"]);
    // impossible moves are no-ops
    expect(moveNode(r, "col", "col")).toBe(r);
    expect(moveNode(r, "root", "col")).toBe(r);
    expect(moveNode(r, "a", "t1")).toBe(r);
  });

  it("clones with fresh ids and duplicates next to the original", () => {
    const col = tree().children[1];
    const { node, idMap } = cloneWithFreshIds(col);
    expect(Object.keys(idMap)).toEqual(["col", "t1", "t2"]);
    expect(subtreeIds(node)).toEqual(Object.values(idMap));
    expect(new Set(subtreeIds(node)).size).toBe(3);

    const d = duplicateNodes(tree(), ["a", "t1"]);
    expect(d.ids).toHaveLength(2);
    expect(d.root.children[1].id).toBe(d.ids[0]);
    expect(d.root.children[1]).toMatchObject({ x: 2, y: 2 }); // offset in free frame
    const col2 = d.root.children[2] as FrameNode;
    expect(col2.children[1].id).toBe(d.ids[1]);
    expect(col2.children[1].x).toBeUndefined(); // no offset in stacks
  });

  it("wraps siblings in a frame and unwraps again", () => {
    const w = wrapNodes(tree(), ["b", "a"], "free", { id: "g" })!;
    expect(w.root.children.map((c) => c.id)).toEqual(["g", "col"]);
    const g = w.root.children[0] as FrameNode;
    expect(g).toMatchObject({ x: 1, y: 1, w: { kind: "fixed", mm: 6 }, h: { kind: "fixed", mm: 6 } });
    expect(g.children.map((c) => [c.id, c.x, c.y])).toEqual([["a", 0, 0], ["b", 4, 4]]);

    const u = unwrapNode(w.root, "g");
    expect(u.children.map((c) => [c.id, c.x, c.y])).toEqual([["a", 1, 1], ["b", 5, 5], ["col", 10, 2]]);

    const row = wrapNodes(tree(), ["t1", "t2"], "row", { id: "r" })!;
    const inner = (row.root.children[1] as FrameNode).children[0] as FrameNode;
    expect(inner).toMatchObject({ id: "r", layout: "row", w: { kind: "hug" } });
    expect(wrapNodes(tree(), ["a", "t1"], "row")).toBeNull(); // not siblings
    expect(wrapNodes(tree(), ["root"], "row")).toBeNull();
  });

  it("unwraps a stack frame using boxes when given", () => {
    const u = unwrapNode(tree(), "col", { t1: { x: 12, y: 3, w: 4, h: 1 }, t2: { x: 12, y: 4, w: 4, h: 1 } });
    expect(u.children.map((c) => [c.id, c.x, c.y])).toEqual([["a", 1, 1], ["t1", 12, 3], ["t2", 12, 4], ["b", 5, 5]]);
    // without boxes: frame position + padding
    const v = unwrapNode(tree(), "col");
    expect(v.children[1]).toMatchObject({ id: "t1", x: 12, y: 3 });
    expect(unwrapNode(tree(), "a").children).toHaveLength(3);
  });
});

describe("variants", () => {
  it("merges and clears variant patches", () => {
    let t = tpl();
    expect((effectiveNode(t, "t1", "v") as TextNode).text).toBe("{{title}}!");
    expect((effectiveNode(t, "t1") as TextNode).text).toBe("{{title}}");
    t = setVariantPatch(t, "v", "a", { hidden: true });
    expect(t.variants![0].patches.a).toEqual({ hidden: true });
    t = setVariantPatch(t, "v", "a", { hidden: undefined });
    expect("a" in t.variants![0].patches).toBe(false);
    expect(Object.keys(prunePatches(t).variants![0].patches)).toEqual(["t1"]);
  });
});

describe("fields", () => {
  it("renames placeholders, including args and spacing", () => {
    expect(renamePlaceholder("{{title}} {{ title:x }} {{titles}}", "title", "name")).toBe("{{name}} {{ name:x }} {{titles}}");
  });

  it("renames a field across the tree and variant patches", () => {
    const t = renameField(tpl(), "title", "name");
    expect(t.fields.map((f) => f.key)).toEqual(["name", "detail"]);
    const col = t.root.children[1] as FrameNode;
    expect((col.children[0] as TextNode).text).toBe("{{name}}");
    expect((col.children[1] as TextNode).text).toBe("{{ name:x }} and {{detail}}");
    expect((t.variants![0].patches.t1 as Partial<TextNode>).text).toBe("{{name}}!");
    // refuses clashes
    expect(renameField(tpl(), "title", "detail")).toEqual(tpl());
    expect(nodesUsingField(t, "name")).toEqual(["t1", "t2"]);
  });

  it("renames label values", () => {
    const l = { id: "l", templateId: "t", name: "l", values: { title: "A", detail: "B" } };
    expect(renameLabelField(l, "title", "name").values).toEqual({ detail: "B", name: "A" });
  });
});

describe("align, distribute, snap", () => {
  const boxes = [
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 5, y: 3, w: 4, h: 1 },
    { x: 20, y: 1, w: 2, h: 2 },
  ];
  it("aligns to the union or explicit bounds", () => {
    expect(alignBoxes(boxes, "right").map((d) => d.dx)).toEqual([20, 13, 0]);
    expect(alignBoxes(boxes, "vcenter").map((d) => d.dy)).toEqual([1, -1.5, 0]);
    expect(alignBoxes([boxes[0]], "hcenter", { x: 0, y: 0, w: 10, h: 10 })).toEqual([{ dx: 4, dy: 0 }]);
  });
  it("distributes with equal gaps", () => {
    // span 22, sizes 8 -> gaps 7
    expect(distributeBoxes(boxes, "h").map((d) => d.dx)).toEqual([0, 4, 0]);
    expect(distributeBoxes(boxes.slice(0, 2), "h")).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
  it("snaps to the nearest line within the threshold", () => {
    expect(snapAxis([1, 2, 3], [3.4, 10], 0.5)).toEqual({ offset: expect.closeTo(0.4), line: 3.4 });
    expect(snapAxis([1, 2, 3], [10], 0.5)).toBeNull();
  });
});

describe("multi-node moves", () => {
  const ids = (f: FrameNode) => f.children.map((c) => c.id);

  it("moves several siblings as a block, keeping their tree order", () => {
    expect(ids(moveNodes(tree(), ["b", "a"], "root", 1))).toEqual(["col", "a", "b"]);
    expect(ids(moveNodes(tree(), ["a", "b"], "root", 0))).toEqual(["a", "b", "col"]);
    expect(ids(moveNodes(tree(), ["a", "b"], "root", -1))).toEqual(["col", "a", "b"]);
  });

  it("moves nodes from different parents into a frame and skips impossible moves", () => {
    const r = moveNodes(tree(), ["t2", "a"], "col", 0);
    expect(ids(r)).toEqual(["col", "b"]);
    expect(ids(findNode(r, "col") as FrameNode)).toEqual(["a", "t2", "t1"]);
    // A frame can't go into itself; its children travel with it.
    expect(moveNodes(tree(), ["col"], "col", 0)).toEqual(tree());
    const nested = moveNodes(tree(), ["col", "t1"], "root", 0);
    expect(ids(nested)).toEqual(["col", "a", "b"]);
    expect(ids(findNode(nested, "col") as FrameNode)).toEqual(["t1", "t2"]);
    expect(moveNodes(tree(), ["root"], "col")).toEqual(tree());
  });

  it("duplicate reports old -> new ids for the whole subtree", () => {
    const r = duplicateNodes(tree(), ["col"]);
    expect(Object.keys(r.idMap).sort()).toEqual(["col", "t1", "t2"]);
    expect(r.idMap.col).toBe(r.ids[0]);
  });
});

describe("structural edits in variants", () => {
  const shown = (t: Template, w: number, id: string) => !!findNode(effectiveRoot(t, w, 10).root, id);

  it("adds variant-only nodes (hidden in the base, shown by the variant)", () => {
    const t = addToVariant(tpl(), "v", "root", rect("new"), 1);
    expect(findPath(t.root, "new")?.at(-1)?.hidden).toBe(true);
    expect(t.variants![0].patches.new).toEqual({ hidden: false });
    expect(t.root.children.map((c) => c.id)).toEqual(["a", "new", "col", "b"]);
    expect(shown(t, 15, "new")).toBe(true); // variant applies (maxW 20)
    expect(shown(t, 30, "new")).toBe(false);
    expect(variantsShowing(t, "new")).toEqual(["v"]);
    expect(isVariantOnly(t, "new", "v")).toBe(true);
    expect(isVariantOnly(t, "a", "v")).toBe(false);
    // Unknown variant: no-op.
    expect(markVariantOnly(tpl(), "nope", ["a"])).toEqual(tpl());
  });

  it("deleting in a variant hides there, and removes nodes that only existed for it", () => {
    const t = hideInVariant(addToVariant(tpl(), "v", "root", rect("new")), "v", ["a", "new", "t1", "col"]);
    expect(findPath(t.root, "new")).toBeNull();
    expect(t.variants![0].patches.new).toBeUndefined();
    expect(findPath(t.root, "a")).not.toBeNull();
    expect(t.variants![0].patches.a).toEqual({ hidden: true });
    // t1 is inside col: only col is hidden, t1 keeps its own patch.
    expect(t.variants![0].patches.col).toEqual({ hidden: true });
    expect(t.variants![0].patches.t1).toEqual({ text: "{{title}}!" });
    expect(shown(t, 15, "a")).toBe(false);
    expect(shown(t, 30, "a")).toBe(true);
  });

  it("keeps a node shown by two variants when one deletes it", () => {
    let t: Template = { ...tpl(), variants: [...tpl().variants!, { id: "w", name: "w", when: { minW: 50 }, patches: {} }] };
    t = addToVariant(t, "v", "root", rect("new"));
    t = setVariantPatch(t, "w", "new", { hidden: false });
    expect(isVariantOnly(t, "new", "v")).toBe(false);
    t = hideInVariant(t, "v", ["new"]);
    expect(findPath(t.root, "new")).not.toBeNull();
    expect(variantsShowing(t, "new")).toEqual(["w"]);
  });

  it("copies a variant's patches to duplicated nodes", () => {
    const d = duplicateNodes(tpl().root, ["col"]);
    const t = markVariantOnly(copyVariantPatches({ ...tpl(), root: d.root }, "v", d.idMap), "v", d.ids);
    expect(t.variants![0].patches[d.idMap.t1]).toEqual({ text: "{{title}}!" });
    expect(t.variants![0].patches[d.ids[0]]).toEqual({ hidden: false });
    expect(shown(t, 30, d.ids[0])).toBe(false);
    expect(shown(t, 15, d.ids[0])).toBe(true);
  });
});
