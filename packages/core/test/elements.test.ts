import { describe, expect, it } from "vitest";
import { parseIconSvg } from "../src/icons";
import { dilate, subtract } from "../src/paint";
import { sizedSvg } from "../src/elements";
import { layout, type TextMeasurer } from "../src/layout";
import type { FrameNode, LabelNode, Template } from "../src/schema";

describe("dilate", () => {
  const w = 7, h = 7;
  const dot = new Uint8Array(w * h);
  dot[3 * w + 3] = 1;
  const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

  it("grows a square for pixel fonts and a disk otherwise", () => {
    expect(count(dilate(dot, w, h, 1, "square"))).toBe(9);
    expect(count(dilate(dot, w, h, 1, "disk"))).toBe(5);
    expect(count(dilate(dot, w, h, 2, "disk"))).toBe(13);
    expect(count(dilate(dot, w, h, 0))).toBe(1);
  });

  it("outline ring = dilation minus the shape", () => {
    expect(count(subtract(dilate(dot, w, h, 1, "square"), dot))).toBe(8);
  });

  it("clips at the edges", () => {
    const corner = new Uint8Array(w * h);
    corner[0] = 1;
    expect(count(dilate(corner, w, h, 1, "square"))).toBe(4);
  });
});

describe("icon svg parsing", () => {
  it("parses Tabler outline icons, dropping the bounding path", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 6l0 12" /><circle cx="12" cy="12" r="3" /><polyline points="1 2 3 4" /></svg>`;
    const icon = parseIconSvg(svg);
    expect(icon.viewBox).toEqual([0, 0, 24, 24]);
    expect(icon.stroke).toBe("currentColor");
    expect(icon.fill).toBe("none");
    expect(icon.strokeWidth).toBe(2);
    expect(icon.shapes.map((s) => s.tag)).toEqual(["path", "circle", "polyline"]);
    expect(icon.shapes[1].attrs).toMatchObject({ cx: "12", cy: "12", r: "3" });
  });

  it("parses filled icons", () => {
    const icon = parseIconSvg(`<svg viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M1 1h2v2z" /></svg>`);
    expect(icon.fill).toBe("currentColor");
    expect(icon.stroke).toBe("none");
    expect(icon.shapes).toHaveLength(1);
  });
});

describe("sizedSvg", () => {
  it("adds width/height from the viewBox", () => {
    const r = sizedSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect/></svg>`);
    expect(r.size).toEqual({ w: 40, h: 20 });
    expect(r.svg).toContain(`width="40"`);
    expect(r.svg).toContain(`height="20"`);
    expect(sizedSvg(`<svg width="10" height="5"></svg>`).size).toEqual({ w: 10, h: 5 });
  });
});

describe("intrinsic sizes", () => {
  const fake: TextMeasurer = { measure: (_n, text, pt) => ({ w: text.length * pt * 0.1, h: pt * 0.1 }) };
  const tpl = (children: LabelNode[], layoutKind: FrameNode["layout"] = "row"): Template => ({
    id: "t", name: "t", schema: 2, design: { w: 40, h: 12 }, fields: [],
    root: { id: "root", type: "frame", layout: layoutKind, align: "stretch", w: { kind: "fill" }, h: { kind: "fill" }, children },
  });
  const run = (t: Template, w = 40, h = 12) => layout({ template: t, width: w, height: h, measurer: fake });

  it("icons hugging their width are as wide as the row is tall", () => {
    const r = run(tpl([
      { id: "i", type: "icon", icon: "screw", color: "black", w: { kind: "hug" }, h: { kind: "fill" } },
      { id: "f", type: "rect", fill: "black", w: { kind: "fill" }, h: { kind: "fill" } },
    ]));
    expect(r.byId.get("i")!.box).toMatchObject({ w: 12, h: 12 });
    expect(r.byId.get("f")!.box.w).toBeCloseTo(28);
    expect(r.byId.get("i")!.text).toBe("screw");
  });

  it("square follows a fixed axis, defaults otherwise", () => {
    const r = run(tpl([
      { id: "a", type: "icon", icon: "x", color: "black", w: { kind: "fixed", mm: 5 }, h: { kind: "hug" }, alignSelf: "start" },
      { id: "b", type: "code", format: "qrcode", value: "x", color: "black", w: { kind: "hug" }, h: { kind: "hug" }, alignSelf: "start" },
      { id: "c", type: "icon", icon: "x", color: "black", w: { kind: "hug" }, h: { kind: "hug" }, alignSelf: "start" },
    ]), 40, 20);
    expect(r.byId.get("a")!.box).toMatchObject({ w: 5, h: 5 });
    expect(r.byId.get("b")!.box).toMatchObject({ w: 10, h: 10 });
    expect(r.byId.get("c")!.box).toMatchObject({ w: 6, h: 6 });
  });

  it("square in a free frame hugs to its resolved axis", () => {
    const r = run(tpl([{ id: "i", type: "icon", icon: "x", color: "black", x: 1, y: 1, w: { kind: "hug" }, h: { kind: "fixed", mm: 8 }, ay: "stretch" }], "free"), 40, 20);
    expect(r.byId.get("i")!.box.h).toBeCloseTo(16);
    expect(r.byId.get("i")!.box.w).toBeCloseTo(16);
  });

  it("1D codes hug a natural width at the default module", () => {
    const r = run(tpl([{ id: "c", type: "code", format: "code39", value: "AB", color: "black", w: { kind: "hug" }, h: { kind: "fixed", mm: 6 }, alignSelf: "start" }]), 60, 12);
    expect(r.byId.get("c")!.box.w).toBeCloseTo(16 * 4 * 0.25);
    expect(r.byId.get("c")!.box.h).toBe(6);
  });
});
