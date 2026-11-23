/**
 * Library parts: shared text styles and component instances (parts.ts), as
 * layout, render and preflight see them.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUILTIN_FONTS,
  PRINTERS,
  applyTextStyle,
  bundleToJson,
  componentDeps,
  detachInstance,
  detachInstancesOf,
  detachStyleIn,
  makeBundle,
  parseBundle,
  templateAssetRefs,
  detachTextStyle,
  expandInstance,
  getLibraryParts,
  labelPixels,
  layout,
  partsUsedBy,
  preflight,
  preloadAssets,
  renderLabel,
  resolveTemplate,
  setCanvasFactory,
  setLibraryParts,
  sizeById,
  templateNodeId,
  tokensUsed,
  withTextStyle,
  wouldCycle,
  type ComponentNode,
  type FrameNode,
  type LabelNode,
  type LabelComponent,
  type LibraryParts,
  type Template,
  type TextMeasurer,
  type TextNode,
  type TextStyle,
} from "../src";
import { muncherLabels, muncherTemplate } from "./fixtures/muncher";

const fake: TextMeasurer = { measure: (_n, text, sizePt) => ({ w: text.length * sizePt * 0.1, h: sizePt * 0.1 }) };

const text = (id: string, extra: Partial<TextNode> = {}): TextNode => ({
  id, type: "text", text: id.toUpperCase(), font: "Arial", sizePt: 8, color: "black", w: { kind: "hug" }, h: { kind: "hug" }, ...extra,
});

const tpl = (children: FrameNode["children"], extra: Partial<Template> = {}): Template => ({
  id: "t", name: "t", schema: 2, design: { w: 40, h: 12 }, fields: [{ key: "title", label: "Title", type: "text", default: "HELLO" }],
  root: { id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children },
  ...extra,
});

/* ------------------------------------------------------------------ styles */

describe("text styles", () => {
  const heading: TextStyle = { id: "s-head", name: "Heading", font: "Test Pixel 12", sizePt: 12, weight: 700, uppercase: true, letterSpacing: 0.1 };

  it("replace the text's own values, overrides win", () => {
    const n = text("a", { style: "s-head", sizePt: 6, letterSpacing: 0.5, align: "center", styleOverrides: ["letterSpacing"] });
    const r = applyTextStyle(n, [heading]);
    expect(r).toMatchObject({ font: "Test Pixel 12", sizePt: 12, weight: 700, uppercase: true, letterSpacing: 0.5 });
    // Optional props the style leaves out go back to the default.
    expect(r.align).toBeUndefined();
    // Required props it leaves out keep the node's own.
    expect(r.color).toBe("black");
  });

  it("leave the text alone when the style is unknown", () => {
    const n = text("a", { style: "nope" });
    expect(applyTextStyle(n, [heading])).toBe(n);
  });

  it("apply in layout; variants and label overrides still win", () => {
    const t = tpl([text("a", { style: "s-head", x: 1, y: 1 })], {
      variants: [{ id: "v", name: "small", when: { maxW: 30 }, patches: { a: { sizePt: 5 } } }],
    });
    const parts = { styles: [heading] };
    const big = layout({ template: t, width: 40, height: 12, measurer: fake, parts });
    expect(big.byId.get("a")!.sizePt).toBe(12);
    expect(big.byId.get("a")!.text).toBe("A");
    const small = layout({ template: t, width: 25, height: 12, measurer: fake, parts });
    expect(small.byId.get("a")!.sizePt).toBe(5);
    const label = layout({ template: t, width: 40, height: 12, measurer: fake, parts, label: { values: {}, overrides: { a: { sizePt: 3 } } } });
    expect(label.byId.get("a")!.sizePt).toBe(3);
  });

  it("changing the style changes every text using it", () => {
    const t = tpl([text("a", { style: "s-head" }), text("b", { style: "s-head", x: 0, y: 6 })]);
    const run = (s: TextStyle) => layout({ template: t, width: 40, height: 12, measurer: fake, parts: { styles: [s] } });
    expect(run(heading).byId.get("b")!.sizePt).toBe(12);
    expect(run({ ...heading, sizePt: 7 }).byId.get("b")!.sizePt).toBe(7);
    expect(run({ ...heading, sizePt: 7 }).byId.get("a")!.sizePt).toBe(7);
  });

  it("can be applied (values copied in) and detached (look kept)", () => {
    const n = withTextStyle(text("a", { styleOverrides: ["font"] }), heading);
    expect(n).toMatchObject({ style: "s-head", sizePt: 12, font: "Test Pixel 12" });
    expect(n.styleOverrides).toBeUndefined();
    const d = detachTextStyle({ ...n, sizePt: 4 }, [heading]);
    expect(d.style).toBeUndefined();
    expect(d.sizePt).toBe(12);
  });

  it("leave templates without parts untouched (same object)", () => {
    const t = tpl([text("a")]);
    expect(resolveTemplate(t, { styles: [heading] })).toBe(t);
    expect(resolveTemplate(muncherTemplate)).toBe(muncherTemplate);
  });
});

/* -------------------------------------------------------------- components */

const badge: LabelComponent = {
  id: "c-badge",
  name: "Badge",
  design: { w: 10, h: 4 },
  root: {
    id: "croot", type: "frame", layout: "row", gap: 1, align: "center", fill: "black", w: { kind: "fill" }, h: { kind: "fill" },
    children: [
      { id: "ic", name: "Icon", type: "icon", icon: "star", color: "white", w: { kind: "fixed", mm: 3 }, h: { kind: "fixed", mm: 3 } },
      text("lbl", { name: "Label", text: "{{title}}", color: "white", style: "s-small" }),
    ],
  },
};
const small: TextStyle = { id: "s-small", name: "Small", font: "Arial", sizePt: 5 };
const inst = (id: string, extra: Partial<ComponentNode> = {}): ComponentNode => ({ id, type: "component", ref: "c-badge", w: { kind: "fixed", mm: 10 }, h: { kind: "fixed", mm: 4 }, ...extra });
const parts: LibraryParts = { styles: [small], components: [badge] };

describe("component instances", () => {
  it("expand to a frame with the component's settings and the instance's size and place", () => {
    const f = expandInstance(inst("i1", { x: 3, y: 2, name: "My badge" }), parts);
    expect(f).toMatchObject({ id: "i1", type: "frame", layout: "row", gap: 1, fill: "black", x: 3, y: 2, name: "My badge", w: { kind: "fixed", mm: 10 } });
    expect(f.children.map((c) => c.id)).toEqual(["i1/ic", "i1/lbl"]);
    expect(templateNodeId("i1/lbl")).toBe("i1");
    // The component's own (fill) size is not used.
    expect(expandInstance(inst("i2", { w: { kind: "hug" } }), parts).w).toEqual({ kind: "hug" });
  });

  it("lay out every instance from the one component, with styles applied inside", () => {
    const t = tpl([inst("i1", { x: 1, y: 1 }), inst("i2", { x: 20, y: 6 })]);
    const r = layout({ template: t, width: 40, height: 12, measurer: fake, parts });
    for (const [id, x, y] of [["i1", 1, 1], ["i2", 20, 6]] as const) {
      expect(r.byId.get(id)!.box).toMatchObject({ x, y, w: 10, h: 4 });
      expect(r.byId.get(`${id}/ic`)!.box.x).toBeCloseTo(x);
      expect(r.byId.get(`${id}/lbl`)!.box.x).toBeCloseTo(x + 4);
      expect(r.byId.get(`${id}/lbl`)!.text).toBe("HELLO");
      expect(r.byId.get(`${id}/lbl`)!.sizePt).toBe(5);
    }
    // Editing the component updates every instance.
    const bigger: LabelComponent = { ...badge, root: { ...badge.root, gap: 2 } };
    const r2 = layout({ template: t, width: 40, height: 12, measurer: fake, parts: { ...parts, components: [bigger] } });
    expect(r2.byId.get("i1/lbl")!.box.x).toBeCloseTo(1 + 5);
    expect(r2.byId.get("i2/lbl")!.box.x).toBeCloseTo(20 + 5);
  });

  it("apply instance overrides (text, visibility), also into nested instances", () => {
    const t = tpl([inst("i1", { overrides: { lbl: { text: "SALE" }, ic: { hidden: true } } })]);
    const r = layout({ template: t, width: 40, height: 12, measurer: fake, parts });
    expect(r.byId.get("i1/lbl")!.text).toBe("SALE");
    expect(r.byId.has("i1/ic")).toBe(false);

    const outer: LabelComponent = {
      id: "c-outer", name: "Outer", design: { w: 20, h: 5 },
      root: { id: "o", type: "frame", layout: "column", w: { kind: "fill" }, h: { kind: "fill" }, children: [inst("nb", { overrides: { lbl: { text: "INNER" } } })] },
    };
    const p2 = { ...parts, components: [badge, outer] };
    const t2 = tpl([{ id: "o1", type: "component", ref: "c-outer", w: { kind: "fixed", mm: 20 }, h: { kind: "fixed", mm: 5 }, overrides: { "nb/ic": { hidden: true } } }]);
    const r2 = layout({ template: t2, width: 40, height: 12, measurer: fake, parts: p2 });
    expect(r2.byId.get("o1/nb/lbl")!.text).toBe("INNER");
    expect(r2.byId.has("o1/nb/ic")).toBe(false);
    expect(partsUsedBy(t2, p2).components.map((c) => c.id).sort()).toEqual(["c-badge", "c-outer"]);
    expect(partsUsedBy(t2, p2).styles.map((s) => s.id)).toEqual(["s-small"]);
  });

  it("variants and label overrides reach the instance and its contents", () => {
    const t = tpl([inst("i1")], { variants: [{ id: "v", name: "narrow", when: { maxW: 30 }, patches: { i1: { x: 5 }, "i1/lbl": { text: "N" } } }] });
    const r = layout({ template: t, width: 25, height: 12, measurer: fake, parts });
    expect(r.byId.get("i1")!.box.x).toBeCloseTo(5);
    expect(r.byId.get("i1/lbl")!.text).toBe("N");
    const l = layout({ template: t, width: 40, height: 12, measurer: fake, parts, label: { values: {}, overrides: { "i1/lbl": { text: "L" } } } });
    expect(l.byId.get("i1/lbl")!.text).toBe("L");
  });

  it("lay out empty (no crash) for a missing component or a cycle", () => {
    const missing = layout({ template: tpl([{ ...inst("i1"), ref: "gone" }]), width: 40, height: 12, measurer: fake, parts });
    expect(missing.byId.get("i1")!.node).toMatchObject({ type: "frame", children: [] });

    const a: LabelComponent = { id: "a", name: "A", design: { w: 5, h: 5 }, root: { id: "ar", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [{ id: "tob", type: "component", ref: "b", w: { kind: "fill" }, h: { kind: "fill" } }] } };
    const b: LabelComponent = { id: "b", name: "B", design: { w: 5, h: 5 }, root: { id: "br", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [text("bt"), { id: "toa", type: "component", ref: "a", w: { kind: "fill" }, h: { kind: "fill" } }] } };
    const cyc = { components: [a, b] };
    const r = layout({ template: tpl([{ id: "i", type: "component", ref: "a", w: { kind: "fixed", mm: 5 }, h: { kind: "fixed", mm: 5 } }]), width: 40, height: 12, measurer: fake, parts: cyc });
    expect(r.byId.has("i/tob/bt")).toBe(true);
    // a -> b -> a stops at the second a.
    expect(r.byId.get("i/tob/toa")!.node).toMatchObject({ type: "frame", children: [] });
    expect(wouldCycle("a", "b", cyc)).toBe(true);
    expect(wouldCycle("c-badge", "a", parts)).toBe(false);
    expect([...componentDeps("a", cyc)].sort()).toEqual(["a", "b"]);
    // A component placed inside itself.
    const self: LabelComponent = { ...a, root: { ...a.root, children: [{ id: "me", type: "component", ref: "a", w: { kind: "fill" }, h: { kind: "fill" } }] } };
    const r2 = layout({ template: tpl([{ id: "i", type: "component", ref: "a", w: { kind: "fixed", mm: 5 }, h: { kind: "fixed", mm: 5 } }]), width: 40, height: 12, measurer: fake, parts: { components: [self] } });
    expect(r2.byId.get("i/me")!.node).toMatchObject({ children: [] });
  });

  it("keep mirrors inside the component pointing at its own frames", () => {
    const flag: LabelComponent = {
      id: "c-flag", name: "Flag", design: { w: 30, h: 6 },
      root: {
        id: "fr", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" },
        children: [
          { id: "half", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [{ ...text("t1"), x: 1, y: 1 }] },
          { id: "copy", type: "frame", layout: "free", mirror: { of: "half", mode: "repeat" }, w: { kind: "fill" }, h: { kind: "fill" }, children: [] },
        ],
      },
    };
    const t = tpl([{ id: "f1", type: "component", ref: "c-flag", w: { kind: "fixed", mm: 30 }, h: { kind: "fixed", mm: 6 } }]);
    const r = layout({ template: t, width: 40, height: 12, measurer: fake, parts: { components: [flag] } });
    const copies = r.items.filter((it) => it.copyOf);
    expect(copies.map((c) => c.copyOf)).toContain("f1/t1");
  });

  it("detach into a plain group with fresh ids and overrides baked in", () => {
    let k = 0;
    const f = detachInstance(inst("i1", { x: 2, overrides: { lbl: { text: "X" } } }), parts, (n) => `${n.type}-${++k}`);
    expect(f).toMatchObject({ id: "i1", type: "frame", name: "Badge", x: 2, fill: "black" });
    expect(f.children.map((c) => c.id)).toEqual(["icon-1", "text-2"]);
    expect((f.children[1] as TextNode).text).toBe("X");
    // Styles stay linked.
    expect((f.children[1] as TextNode).style).toBe("s-small");
  });

  it("detach everywhere before deleting a component or a style (same look)", () => {
    const t = tpl([inst("i1"), text("other")]);
    const root = detachInstancesOf(t.root, "c-badge", parts, (n) => `${n.type}-x`);
    expect(root.children[0]).toMatchObject({ id: "i1", type: "frame" });
    expect(detachInstancesOf(t.root, "nope", parts, (n) => n.id)).toBe(t.root);
    const styled = tpl([text("a", { style: "s-small", sizePt: 9 })]);
    const d = detachStyleIn(styled.root, "s-small", [small]).children[0] as TextNode;
    expect(d.style).toBeUndefined();
    expect(d.sizePt).toBe(5);
  });

  it("travel in shared template files", async () => {
    const t = tpl([inst("i1")]);
    const used = partsUsedBy(t, parts);
    const b = await parseBundle(bundleToJson(makeBundle(t, [], [], used)));
    expect(b.components?.map((c) => c.id)).toEqual(["c-badge"]);
    expect(b.styles?.map((s) => s.id)).toEqual(["s-small"]);
    expect(templateAssetRefs(t, [], used).fonts).toContain("Arial");
  });

  it("use the registered library parts by default (layout, tokens)", () => {
    const before = getLibraryParts();
    try {
      setLibraryParts(parts);
      const t = tpl([inst("i1")]);
      expect(layout({ template: t, width: 40, height: 12, measurer: fake }).byId.get("i1/lbl")!.text).toBe("HELLO");
      expect(tokensUsed(t).has("title")).toBe(true);
    } finally {
      setLibraryParts(before);
    }
  });
});

/* --------------------------------------------------- rendering (headless) */

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/app/assets/fonts");

describe("render of instances", () => {
  beforeAll(() => {
    setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
    for (const f of BUILTIN_FONTS) GlobalFonts.registerFromPath(join(fontsDir, f.url.replace(/^\/fonts\//, "")), f.family);
  });
  afterAll(() => setCanvasFactory(null));

  // The wordmark lockup as a component, placed where the inline one was.
  const face = muncherTemplate.root.children.find((c) => c.id === "face") as FrameNode;
  const brand = face.children.find((c) => c.id === "noise") as FrameNode;
  const logo: LabelComponent = { id: "c-logo", name: "Wordmark", design: { w: 7, h: 4 }, root: { ...brand, w: { kind: "fill" }, h: { kind: "fill" } } };
  const withInstance: Template = {
    ...muncherTemplate,
    root: { ...muncherTemplate.root, children: muncherTemplate.root.children.map((c) => (c.id === "face" ? { ...face, children: face.children.map((n): LabelNode => (n.id === "noise" ? { id: "noise", type: "component", ref: "c-logo", w: { kind: "fill" }, h: { kind: "hug" } } : n)) } : c)) },
  };
  const bits = (c: HTMLCanvasElement) => Buffer.from(c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data).toString("base64");

  for (const sizeId of ["n1-14x30", "n1-14x40", "m2-15x50", "m2-25x50"]) {
    it(`draws the lockup in a component exactly like the inline one (${sizeId})`, async () => {
      const size = sizeById(sizeId) ?? sizeById("n1-14x40")!;
      const printer = PRINTERS.find((p) => p.model === size.printer) ?? PRINTERS[0];
      const px = labelPixels(size, printer);
      const o = { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: 0.5, invert: true };
      const label = muncherLabels[0];
      await preloadAssets(withInstance, [label]);
      const a = renderLabel(muncherTemplate, label, o);
      const before = getLibraryParts();
      setLibraryParts({ components: [logo] });
      try {
        const b = renderLabel(withInstance, label, o);
        expect(b.layout.byId.get("noise/big")!.box).toEqual(a.layout.byId.get("big")!.box);
        expect(bits(b.canvas)).toBe(bits(a.canvas));
        // Preflight issues inside the instance are reported on the instance.
        const issues = preflight(withInstance, label, { ...o, labelMm: { w: size.widthMm, h: size.heightMm } }, b);
        expect(issues.every((i) => !i.nodeId?.includes("/"))).toBe(true);
      } finally {
        setLibraryParts(before);
      }
    });
  }
});
