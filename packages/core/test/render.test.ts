/**
 * Renderer snapshot tests: render the Label Muncher headlessly
 * (@napi-rs/canvas behind the core canvas seam) at several label sizes and
 * compare a hash of the 1-bit output. PNGs of every case are written to
 * test/__snapshots__/png so a changed hash can be reviewed visually (git diff).
 *
 * Update after an intended change: `npx vitest run -u`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import { BUILTIN_FONTS, PRINTERS, SIZES, labelPixels, renderLabel, renderTestPattern, setCanvasFactory, sizeById } from "../src";
import { muncherLabels, muncherTemplate } from "./fixtures/muncher";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(here, "../../../packages/app/assets/fonts");
const pngDir = join(here, "__snapshots__", "png");

beforeAll(() => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
  mkdirSync(pngDir, { recursive: true });
});
afterAll(() => setCanvasFactory(null));

/** Pack the 1-bit image (dot = 1) and hash it. */
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

const save = (name: string, c: HTMLCanvasElement) =>
  writeFileSync(join(pngDir, `${name}.png`), (c as unknown as import("@napi-rs/canvas").Canvas).toBuffer("image/png"));

const printer = (model: string) => PRINTERS.find((p) => p.model === model)!;
const labels = ["Snacks", "Odd socks", "Mystery cables", "Spare screws"].map(
  (n) => muncherLabels.find((l) => l.name === n)!,
);
const sizes = ["n1-14x22", "n1-14x30", "n1-14x50", "m2-20x10", "m2-25x15", "m2-30x15", "m2-50x30"].map((id) => sizeById(id)!);

describe("Label Muncher renders stably", () => {
  for (const size of sizes) {
    for (const label of labels) {
      const name = `${size.id}--${label.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      it(name, () => {
        const p = printer(size.printer);
        const px = labelPixels(size, p);
        const { canvas } = renderLabel(muncherTemplate, label, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: 0.5, invert: false });
        save(name, canvas);
        const r = digest(canvas);
        expect(r.grey).toBe(0); // strictly 1-bit
        expect(r.dots).toBeGreaterThan(0);
        expect(r).toMatchSnapshot();
      });
    }
  }
});

describe("test pattern", () => {
  for (const id of ["n1-14x30", "m2-30x15"]) {
    it(id, () => {
      const size = SIZES.find((s) => s.id === id)!;
      const px = labelPixels(size, printer(size.printer));
      const c = renderTestPattern({ ...px, caption: `${size.printer} D2 +0/+0` });
      save(`pattern--${id}`, c);
      const r = digest(c);
      expect(r.grey).toBe(0);
      expect(r).toMatchSnapshot();
    });
  }
});
