import { afterEach, describe, expect, it } from "vitest";
import { feedLengthMm, labelPixels, matchRoll, otherSizesFor, printerFor, setCustomSizes, sizeById, sizesFor, tapeWidthMm, usableSizes } from "../src";

afterEach(() => setCustomSizes([]));

describe("label sizes across printers", () => {
  it("N1 14 mm rolls fit the M2 and print turned (tape across the head)", () => {
    const n1 = sizeById("n1-14x30")!;
    expect(tapeWidthMm(n1)).toBe(14);
    expect(feedLengthMm(n1)).toBe(30);
    expect(otherSizesFor("M2_H").map((s) => s.id)).toContain("n1-14x30");
    const px = labelPixels(n1, printerFor("M2_H"));
    // Reading orientation 30 x 14 mm at 300 dpi; 14 mm across the head, multiple of 8.
    expect(px.w).toBe(Math.round(30 * px.dpmm));
    expect(px.h % 8).toBe(0);
    expect(px.h).toBeLessThanOrEqual(Math.round(14 * px.dpmm));
  });
  it("M2 die-cut rolls wider than the N1 takes are not offered for it", () => {
    expect(otherSizesFor("N1").some((s) => s.id === "m2-30x15")).toBe(false);
    expect(usableSizes("N1").every((s) => tapeWidthMm(s) <= 15)).toBe(true);
  });
  it("custom sizes join the lookups for printers they fit", () => {
    setCustomSizes([{ id: "custom-38x19", printer: "M2_H", name: "38 × 19 mm", widthMm: 38, heightMm: 19, feed: "top" }]);
    expect(sizeById("custom-38x19")?.custom).toBe(true);
    expect(sizesFor("M2_H").some((s) => s.id === "custom-38x19")).toBe(true);
    expect(sizesFor("N1").some((s) => s.id === "custom-38x19")).toBe(false);
  });
  it("a roll learned as an N1 size is still recognised in an M2", () => {
    const roll = { barcode: "X1", serial: "s", total: 210, used: 0, type: 1 };
    expect(matchRoll(roll, printerFor("M2_H"), { X1: { sizeId: "n1-14x30" } })?.sizeId).toBe("n1-14x30");
  });
});
