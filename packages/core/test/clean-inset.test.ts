import { describe, expect, it } from "vitest";
import { cleanInset, labelPixels, printerFor, sizeById } from "../src";

describe("cleanInset (inverted 'inside the margin' / border)", () => {
  it("N1 14x30: the 12 mm band already leaves 1 mm strips, so only the ends come in", () => {
    const size = sizeById("n1-14x30")!;
    const px = labelPixels(size, printerFor("N1"));
    const inset = cleanInset({ ...px, marginMm: 1, labelMm: { w: size.widthMm, h: size.heightMm } });
    // N1 feeds left first: height is across the head (96 dots = 12 mm of 14 mm).
    expect(inset.y).toBe(0);
    expect(inset.x).toBe(Math.round((size.heightMm * px.dpmm - px.h) / 2));
  });
  it("a margin wider than the strip shows the same border all round", () => {
    const size = sizeById("n1-14x30")!;
    const px = labelPixels(size, printerFor("N1"));
    const inset = cleanInset({ ...px, marginMm: 2, labelMm: { w: size.widthMm, h: size.heightMm } });
    const strip = (size.heightMm * px.dpmm - px.h) / 2;
    expect(inset.x).toBe(Math.round(2 * px.dpmm));
    expect(inset.y).toBe(Math.round(2 * px.dpmm - strip));
  });
  it("without the label size it is the plain margin", () => {
    expect(cleanInset({ w: 240, h: 96, dpmm: 8, marginMm: 1 })).toEqual({ x: 8, y: 8 });
  });
});
