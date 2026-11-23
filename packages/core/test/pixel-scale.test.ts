/**
 * Pixel fonts must print as pixel art at every label size: each font pixel is
 * the same whole number of printer dots (k x k), so strokes keep their weight
 * and the logo looks the same, only bigger or smaller. A fractional scale makes
 * some font pixels 1 dot and others 2 (uneven, "thin" text).
 *
 * Checked on the real templates: every ink run (horizontal and vertical) inside
 * a pixel-font text box must be a multiple of the scale the text was drawn at.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import {
  BUILTIN_FONTS, CanvasMeasurer, PRINTERS, SIZES, labelPixels, pixelFont, renderLabel, setCanvasFactory, wholePixelScale,
  type LabelNode, type Template, type TextNode,
} from "../src";
import { muncherLabels, muncherTemplate } from "./fixtures/muncher";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/app/assets/fonts");

beforeAll(() => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
});
afterAll(() => setCanvasFactory(null));

type Box = { x: number; y: number; w: number; h: number };

/** Lengths of black runs, rows and columns, inside a box (1 dot of slack around it). */
function inkRuns(c: HTMLCanvasElement, b: Box) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < c.width && y < c.height && d[(y * c.width + x) * 4] === 0;
  const runs: number[] = [];
  const scan = (n: number, m: number, at: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let j = -1; j <= m; j++) {
        if (at(i, j)) r++;
        else if (r) runs.push(r), (r = 0);
      }
    }
  };
  scan(b.h, b.w, (i, j) => ink(b.x + j, b.y + i));
  scan(b.w, b.h, (i, j) => ink(b.x + i, b.y + j));
  return runs;
}

const printerOf = (model: string) => PRINTERS.find((p) => p.model === model)!;
const labels = ["Snacks", "Odd socks", "Tuesday"].map((n) => muncherLabels.find((l) => l.name === n)!);

describe("pixel fonts render at whole dots per font pixel", () => {
  it("wholePixelScale picks the nearest whole scale, never below 1", () => {
    expect([0.6, 1, 1.4, 1.5, 1.63, 2.49, 3.2].map(wholePixelScale)).toEqual([1, 1, 1, 2, 2, 2, 3]);
    expect(wholePixelScale(0.3)).toBeCloseTo(0.3); // nothing faithful possible: unchanged
  });

  it("the measurer reports snapped sizes when it knows the resolution", () => {
    const n: TextNode = { id: "t", type: "text", text: "PIXEL", font: "Test Pixel 8", sizePt: 5.4, color: "black", w: { kind: "hug" }, h: { kind: "hug" } };
    const dpmm = 203 / 25.4;
    const m = new CanvasMeasurer(dpmm).measure(n, "PIXEL", 5.4);
    const free = new CanvasMeasurer().measure(n, "PIXEL", 5.4);
    const k = wholePixelScale((5.4 * (25.4 / 72) * dpmm) / pixelFont("Test Pixel 8")!.pxPerEm);
    // Whole dots, exactly k dots per font pixel.
    expect(Math.abs(m.h * dpmm - Math.round(m.h * dpmm))).toBeLessThan(1e-6);
    expect(m.h / free.h).toBeCloseTo(k / ((5.4 * (25.4 / 72) * dpmm) / 8));
  });

  for (const size of SIZES.filter((s) => s.printer === "N1" || s.printer === "M2_H")) {
    const printer = printerOf(size.printer);
    it(`Label Muncher on ${size.id} (${printer.dpi} dpi)`, () => {
      const px = labelPixels(size, printer);
      for (const marginMm of [0.5, 1])
        for (const label of labels) {
          const { canvas, facts, layout } = renderLabel(muncherTemplate, label, {
            w: px.w, h: px.h, dpmm: px.dpmm, marginMm, invert: false, labelMm: { w: size.widthMm, h: size.heightMm },
          });
          for (const it of layout.items) {
            // Ink runs are measured on black text.
            if (it.node.type !== "text" || it.node.color !== "black" || !pixelFont(it.node.font)) continue;
            const f = facts.get(it.node.id);
            const k = f?.text?.pixelScale;
            if (!f || k === undefined || k < 1) continue; // box too small for even 1 dot per font pixel
            const where = `${size.id} m${marginMm} ${label.name} ${it.node.id} k=${k}`;
            expect(Number.isInteger(k), where).toBe(true);
            const off = inkRuns(canvas, f.box).filter((r) => r % k);
            expect(off, where).toEqual([]);
          }
        }
    });
  }

  it("the logo steps up through whole scales as the label grows", () => {
    // Fixed-size text: k follows the size in whole steps (1, 1, 2, 2, 3, ...), never in between.
    const scales: number[] = [];
    for (const sizePt of [3, 4, 5, 6, 7, 8, 9, 10, 12]) {
      const t = tpl([{ id: "logo", type: "text", text: "PIXEL", font: "Test Pixel 8", sizePt, fit: "fixed", color: "black", w: { kind: "fill" }, h: { kind: "fill" } }]);
      const { facts } = renderLabel(t, { values: {} }, { w: 400, h: 240, dpmm: 300 / 25.4, marginMm: 0.5, invert: false });
      scales.push(facts.get("logo")!.text!.pixelScale!);
    }
    expect(scales.every(Number.isInteger)).toBe(true);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(new Set(scales).size).toBeGreaterThan(2);
  });

  for (const [name, extra] of [
    ["shrink to fit", { fit: "shrink" }],
    ["fill the box", { fit: "fill" }],
    ["rotated + justified", { fit: "shrink", rotate: 270, align: "justify" }],
    ["letter-spaced", { fit: "shrink", letterSpacing: 0.37 }],
    ["outlined", { fit: "shrink", stroke: "black", strokeMm: 0.2, color: "white" }],
  ] as const) {
    it(`${name}: whole scale at 203 and 300 dpi, any box size`, () => {
      for (const dpi of [203, 300])
        for (const boxMm of [4.3, 5.1, 6.7, 8.9, 11.3]) {
          const dpmm = dpi / 25.4;
          const node = { id: "x", type: "text", text: "NOM\nMUNCH", font: "Test Pixel 12", sizePt: 40, color: "black", w: { kind: "fill" }, h: { kind: "fill" }, ...extra } as TextNode;
          const side = Math.round((boxMm + 1) * dpmm);
          const { canvas, facts } = renderLabel(tpl([node]), { values: {} }, { w: side * 2, h: side, dpmm, marginMm: 0.5, invert: false });
          const f = facts.get("x")!;
          const k = f.text!.pixelScale!;
          const where = `${name} ${dpi}dpi box ${boxMm} k=${k}`;
          expect(Number.isInteger(k), where).toBe(true);
          if (name !== "outlined") expect(inkRuns(canvas, f.box).filter((r) => r % k), where).toEqual([]);
        }
    });
  }

  it("rich text runs use whole scales", () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (const dpi of [203, 300])
      for (const sizePt of [7, 9, 11, 14]) {
        const dpmm = dpi / 25.4;
        // A (no-op) span makes it rich text: laid out and drawn by richtext-canvas.
        const node: TextNode = {
          id: "r", type: "text", text: "EXTRA CRUNCH", font: "Test Pixel 12", sizePt, color: "black", w: { kind: "fill" }, h: { kind: "fill" },
          spans: [{ start: 0, end: 5, scale: 1 }],
        };
        const { canvas, facts } = renderLabel(tpl([node]), { values: {} }, { w: Math.round(60 * dpmm), h: Math.round(14 * dpmm), dpmm, marginMm: 0.5, invert: false });
        const runs = inkRuns(canvas, facts.get("r")!.box);
        const k = wholePixelScale((sizePt * (25.4 / 72) * dpmm) / pixelFont("Test Pixel 12")!.pxPerEm);
        // Every run is a whole number of font pixels at k dots each.
        expect(runs.reduce(gcd) % k, `${dpi}dpi ${sizePt}pt k=${k}`).toBe(0);
      }
  });
});

function tpl(children: LabelNode[]): Template {
  return {
    id: "t", name: "t", schema: 2, design: { w: 30, h: 12 }, fields: [],
    root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children },
  };
}
