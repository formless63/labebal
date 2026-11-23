import { describe, expect, it } from "vitest";
import { bandBox, crispScale, resampleCoverage, usesPixelated } from "./dots";

const M2 = 300 / 25.4;
const N1 = 203 / 25.4;

describe("crispScale", () => {
  it("snaps down to whole device pixels per dot", () => {
    // 26 px/mm at 1.25x on N1: 4.07 device px per dot -> 4.
    const s = crispScale(26, N1, 1.25);
    expect((s * 1.25) / N1).toBeCloseTo(4, 9);
    expect(s).toBeLessThanOrEqual(26);
  });
  it("keeps the scale when snapping would shrink it too much", () => {
    // 1.36 device px per dot -> 1 would keep 74 %.
    expect(crispScale(10.7, M2, 1.5, 0.9)).toBe(10.7);
    expect(crispScale(10.7, M2, 1.5, 0.7)).toBeCloseTo(M2 / 1.5, 9);
  });
  it("leaves sub-pixel dots alone", () => {
    expect(crispScale(4, M2, 1)).toBe(4);
  });
});

describe("bandBox", () => {
  it("uses whole device pixels and aligns the band to them", () => {
    for (const dpr of [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]) {
      const b = bandBox(352, 177, M2, 0.1, 0.0, 10.7, dpr);
      expect(Number.isInteger(b.devW) && Number.isInteger(b.devH)).toBe(true);
      expect(b.width * dpr).toBeCloseTo(b.devW, 9);
      expect(Number.isInteger(Math.round(b.left * dpr * 1e6) / 1e6)).toBe(true);
    }
  });
});

describe("usesPixelated", () => {
  it("only for whole or large ratios", () => {
    expect(usesPixelated(240, 96, 480, 192)).toBe(true);
    expect(usesPixelated(240, 96, 240, 96)).toBe(true);
    expect(usesPixelated(240, 96, 300, 120)).toBe(false); // 1.25: would give uneven dots
    expect(usesPixelated(240, 96, 200, 80)).toBe(false); // < 1: would drop dots
    expect(usesPixelated(240, 96, 800, 320)).toBe(true); // 3.33
  });
});

describe("resampleCoverage", () => {
  it("keeps every one-dot line when shrinking (no dropped rows)", () => {
    const w = 40, h = 40;
    const cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x++) cov[y * w + x] = 1; // a line every 3rd row
    for (const H of [13, 17, 23, 29, 31]) {
      const out = resampleCoverage(cov, w, h, w, H);
      // Total ink is preserved (area average), so no line vanishes.
      const ink = out.reduce((a, v) => a + v, 0) * (h / H);
      expect(ink).toBeCloseTo(cov.reduce((a, v) => a + v, 0), 3);
      // And every output row near a line gets some of it.
      for (let Y = 0; Y < H; Y++) {
        const y0 = Math.floor((Y * h) / H), y1 = Math.ceil(((Y + 1) * h) / H);
        const hasLine = Array.from({ length: y1 - y0 }, (_, i) => y0 + i).some((y) => y % 3 === 0);
        if (hasLine) expect(out[Y * w]).toBeGreaterThan(0);
      }
    }
  });
  it("is exact at 1:1 and integer upscales", () => {
    const cov = [1, 0, 0, 1];
    expect(Array.from(resampleCoverage(cov, 2, 2, 2, 2))).toEqual([1, 0, 0, 1]);
    expect(Array.from(resampleCoverage(cov, 2, 2, 4, 2))).toEqual([1, 1, 0, 0, 0, 0, 1, 1]);
  });
});
