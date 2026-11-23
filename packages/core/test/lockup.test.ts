/**
 * Lockups (FrameNode.lockup): a logo laid out at its design size and scaled as
 * one unit. Pure layout with a fake measurer, then the Label Muncher's
 * wordmark rendered at real label sizes with pixel-font snapping.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import {
  BUILTIN_FONTS, CanvasMeasurer, LOCKUP_SLACK, PRINTERS, SIZES, contentSize, labelPixels, layout, pixelFont, renderLabel, setCanvasFactory, sizeById,
  type FrameNode, type LayoutResult, type Template, type TextMeasurer, type TextNode,
} from "../src";
import { muncherLabels, muncherTemplate } from "./fixtures/muncher";

/** 1 pt = 0.1 mm per character wide, 0.1 mm tall. */
const fake: TextMeasurer = {
  measure: (_n, text, sizePt) => ({ w: Math.max(...text.split("\n").map((l) => l.length)) * sizePt * 0.1, h: text.split("\n").length * sizePt * 0.1 }),
};

const word = (id: string, text: string, sizePt: number): TextNode => ({
  id, type: "text", text, font: "x", sizePt, rotate: 270, align: "justify", fit: "shrink", color: "black", w: { kind: "hug" }, h: { kind: "fill" },
});

/** Design 30 x 10: a lockup column (two rotated words + a bar) beside a filling panel. */
const logoTemplate = (scaleText = false): Template => ({
  id: "t", name: "t", schema: 2, design: { w: 30, h: 10 }, scaleText, fields: [],
  root: {
    id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, padding: [1, 1, 1, 1], gap: 0.5, align: "stretch",
    children: [
      {
        id: "logo", type: "frame", layout: "row", lockup: true, w: { kind: "hug" }, h: { kind: "fill" }, gap: 0.4, align: "stretch",
        children: [word("big", "ABCDE", 10), { id: "bar", type: "rect", fill: "black", w: { kind: "fixed", mm: 0.3 }, h: { kind: "fill" } }, word("small", "ABCDEF", 8)],
      },
      { id: "panel", type: "rect", fill: "black", w: { kind: "fill" }, h: { kind: "fill" } },
    ],
  },
});

const rel = (r: LayoutResult, id: string) => {
  const o = r.byId.get("logo")!.box, b = r.byId.get(id)!.box;
  return { x: b.x - o.x, y: b.y - o.y, w: b.w, h: b.h };
};

describe("lockup layout (no pixel snapping)", () => {
  const t = logoTemplate();
  // Packed natural size at k = 1: width 1 + 0.4 + 0.3 + 0.4 + 0.8 (rotated text heights,
  // gaps, bar), length 5 (the first word's letters; the designed length is 8).
  const nat = { w: 2.9, h: 5 };

  for (const [w, h] of [[60, 20], [45, 12], [30, 10], [24, 6]]) {
    it(`scales as one unit and fills the length at ${w} x ${h}`, () => {
      const r = layout({ template: t, width: w, height: h, measurer: fake });
      const k = Math.min((w - 2) / nat.w, (h - 2) / nat.h); // largest k at which the packed logo fits
      const logo = r.byId.get("logo")!.box;
      // Hugging width follows k; the length is the space available (the scaled design length is larger).
      expect(logo.w).toBeCloseTo(nat.w * k);
      expect(logo.h).toBeCloseTo(Math.min(8 * k, h - 2));
      // One k for everything: text sizes (ratio kept), widths, gaps, the bar.
      expect(r.byId.get("big")!.sizePt).toBeCloseTo(10 * k);
      expect(r.byId.get("small")!.sizePt).toBeCloseTo(8 * k);
      expect(rel(r, "big").w).toBeCloseTo(1 * k);
      expect(rel(r, "bar")).toMatchObject({ x: expect.closeTo(1.4 * k), w: expect.closeTo(0.3 * k) });
      expect(rel(r, "small")).toMatchObject({ x: expect.closeTo(2.1 * k), w: expect.closeTo(0.8 * k) });
      // Both words justified over the same, full length.
      expect(r.byId.get("big")!.box.h).toBeCloseTo(logo.h);
      expect(r.byId.get("small")!.box.h).toBeCloseTo(logo.h);
      // The panel takes the rest of the row.
      expect(r.byId.get("panel")!.box.w).toBeCloseTo(w - 2 - 0.5 - logo.w);
    });
  }

  it("keeps its aspect and is centred in a box of another shape", () => {
    // Free layout: the lockup's box stretches with the label, the logo keeps its shape.
    const logo = { ...(logoTemplate().root.children[0] as FrameNode), x: 0, y: 0, w: { kind: "fixed", mm: 2.9 }, h: { kind: "fixed", mm: 8 }, ax: "stretch", ay: "stretch" } as FrameNode;
    const tt: Template = { ...logoTemplate(), root: { id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [logo] } };
    const r = layout({ template: tt, width: 30, height: 30, measurer: fake });
    const b = r.byId.get("logo")!.box;
    // Stretched box: 2.9 x 28; the logo is width-bound (k = 1) and centred vertically.
    expect(b.w).toBeCloseTo(2.9);
    expect(b.h).toBeCloseTo(8);
    expect(b.y + b.h / 2).toBeCloseTo(14);
    expect(r.byId.get("big")!.sizePt).toBeCloseTo(10);
  });
});

/* ------------------------------------------------- pixel fonts, real sizes */

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/app/assets/fonts");
beforeAll(() => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
});
afterAll(() => setCanvasFactory(null));

const printerOf = (model: string) => PRINTERS.find((p) => p.model === model)!;
const PT_TO_MM = 25.4 / 72;

function renderLogo(sizeId: string) {
  const size = sizeById(sizeId)!;
  const px = labelPixels(size, printerOf(size.printer));
  return { ...renderLabel(muncherTemplate, muncherLabels[0], { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: 0.5, invert: false }), dpmm: px.dpmm };
}

describe("wordmark lockup at real sizes", () => {
  // The "narrow" variant hides the wordmark below 22 mm of content width.
  const shown = SIZES.filter((s) => s.printer === "N1" || s.printer === "M2_H").filter((s) => contentSize({ ...labelPixels(s, printerOf(s.printer)), marginMm: 0.5 }).width > 22);

  for (const size of shown) {
    it(`${size.id}: whole dots per font pixel, ratio kept, fits its box`, () => {
      const { layout: L, facts, dpmm } = renderLogo(size.id);
      const big = L.byId.get("big")!, small = L.byId.get("small")!, face = L.byId.get("face")!, noise = L.byId.get("noise")!;
      const kb = facts.get("big")!.text!.pixelScale!, ks = facts.get("small")!.text!.pixelScale!;
      // Too small for one dot per font pixel: nothing faithful is possible.
      if (kb < 1 || ks < 1) return;
      expect(Number.isInteger(kb) && Number.isInteger(ks), `${kb} ${ks}`).toBe(true);
      // Drawn exactly at the snapped sizes (no further shrinking in the box).
      const step = pixelFont("Test Pixel 8")!.pxPerEm / (PT_TO_MM * dpmm);
      expect(big.sizePt! / step).toBeCloseTo(kb);
      expect(small.sizePt! / step).toBeCloseTo(ks);
      // The first word stays the larger one, within one step of the designed ratio.
      expect(kb).toBeGreaterThanOrEqual(ks);
      expect(Math.abs(kb * (3.6 / 5.4) - ks)).toBeLessThanOrEqual(1);
      // Inside the face and centred in it.
      expect(noise.box.w).toBeLessThanOrEqual(face.box.w * (1 + LOCKUP_SLACK) + 1e-6);
      expect(noise.box.x + noise.box.w / 2).toBeCloseTo(face.box.x + face.box.w / 2, 5);
    });
  }

  it("grows with the label", () => {
    const ks = ["m2-30x20", "m2-40x30", "m2-50x30"].map((id) => renderLogo(id).facts.get("big")!.text!.pixelScale!);
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
    expect(ks[ks.length - 1]).toBeGreaterThan(ks[0]);
  });
});
