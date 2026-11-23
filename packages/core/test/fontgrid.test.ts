import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEST_FONTS } from "./fixtures/fonts";
import { detectGrid, detectPixelGrid, inspectFont } from "../src/fontgrid";

const fontFile = (family: string) => readFileSync(TEST_FONTS.find((f) => f.family === family)!.file);

describe("pixel grid detection", () => {
  it.each([
    ["TestPixel12.otf", "Test Pixel 12", 12],
    ["TestPixel16.otf", "Test Pixel 16", 16],
    ["TestPixel8.otf", "Test Pixel 8", 8],
  ])("%s -> %s px/em", (file, family, pxPerEm) => {
    void file;
    const info = inspectFont(fontFile(family));
    expect(info.pixel?.pxPerEm).toBe(pxPerEm);
    expect(detectPixelGrid(fontFile(family))?.pxPerEm).toBe(pxPerEm);
    expect(info.family.length).toBeGreaterThan(0);
    // Line height is in the right ballpark of the hand-tuned registry value.
    const builtin = TEST_FONTS.find((f) => f.family === family)!;
    expect(Math.abs(info.pixel!.linePx - builtin.pixel!.linePx)).toBeLessThanOrEqual(1);
  });

  it("rejects off-grid coordinates", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i * 37.13) % 1000);
    expect(detectGrid(values, 1000)).toBeUndefined();
    expect(detectGrid(Array.from({ length: 50 }, (_, i) => (i % 9) * 125), 1000)).toBe(8);
  });
});
