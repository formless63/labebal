/**
 * Rich text and table rendering, headless (same harness as render.test.ts).
 * PNGs land in test/__snapshots__/png for review.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import { BUILTIN_FONTS, PRINTERS, labelPixels, renderLabel, setCanvasFactory, sizeById, type FrameNode, type LabelNode, type Template } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/app/assets/fonts");
const pngDir = join(here, "__snapshots__", "png");

beforeAll(() => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
  mkdirSync(pngDir, { recursive: true });
});
afterAll(() => setCanvasFactory(null));

function digest(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const bits = new Uint8Array(Math.ceil((c.width * c.height) / 8));
  let dots = 0, grey = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i] !== 0 && d[i] !== 255) grey++;
    if (d[i] === 0) {
      bits[p >> 3] |= 128 >> (p & 7);
      dots++;
    }
  }
  return { w: c.width, h: c.height, dots, grey, sha: createHash("sha256").update(bits).digest("hex").slice(0, 16) };
}

const tpl = (children: LabelNode[], layout: FrameNode["layout"] = "row"): Template => ({
  id: "t", name: "t", schema: 2, design: { w: 29, h: 13 }, fields: [{ key: "sig", label: "Snack", type: "text", default: "Crunch" }],
  root: { id: "root", type: "frame", layout, w: { kind: "fill" }, h: { kind: "fill" }, padding: [0.3, 0.3, 0.3, 0.3], children },
});

const pixel = "Test Pixel 12";
const RICH = "NOM {{icon:mdi:cookie}} {{sig}}\nsmall INV";

const cases: Record<string, Template> = {
  "rich-pixel": tpl([
    {
      id: "t1", type: "text", font: pixel, sizePt: 9, color: "black", w: { kind: "fill" }, h: { kind: "fill" }, align: "center",
      text: RICH,
      spans: [{ start: 0, end: 3, bold: true }, { start: RICH.indexOf("small"), end: RICH.indexOf("small") + 5, scale: 0.6 }, { start: RICH.indexOf("INV"), end: RICH.length, invert: true }],
    },
  ]),
  "table-pixel": tpl([
    {
      id: "tb", type: "table", font: pixel, sizePt: 7, color: "black", w: { kind: "fill" }, h: { kind: "fill" },
      cols: [{ kind: "hug" }, { kind: "fill" }], rows: [{ kind: "fill" }, { kind: "fill" }, { kind: "fill" }],
      cells: [["Bag", "Snack"], ["20", "{{sig}}"], ["15", "Chewy"]], header: "row", headerStyle: "invert", borderMm: 0.15,
    },
  ]),
};

describe("rich text and tables render to clean 1-bit", () => {
  for (const sizeId of ["n1-14x30", "m2-30x15"]) {
    for (const [name, t] of Object.entries(cases)) {
      it(`${name} ${sizeId}`, () => {
        const size = sizeById(sizeId)!;
        const px = labelPixels(size, PRINTERS.find((p) => p.model === size.printer)!);
        const { canvas } = renderLabel(t, { values: {} }, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: 0.5, invert: false });
        writeFileSync(join(pngDir, `${name}--${sizeId}.png`), (canvas as unknown as import("@napi-rs/canvas").Canvas).toBuffer("image/png"));
        const r = digest(canvas);
        expect(r.grey).toBe(0);
        expect(r.dots).toBeGreaterThan(50);
        expect(r).toMatchSnapshot();
      });
    }
  }
});
