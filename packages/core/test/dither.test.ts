import { describe, expect, it } from "vitest";
import { BAYER8, ditherGray, ditherImage, fitRect, toGray } from "../src/dither";

const flat = (w: number, h: number, v: number) => new Float32Array(w * h).fill(v);
const ones = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe("dither", () => {
  it("Bayer matrix is a permutation of 0..63 with the classic first rows", () => {
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect([...BAYER8.slice(0, 8)]).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect([...BAYER8.slice(8, 16)]).toEqual([48, 16, 56, 24, 50, 18, 58, 26]);
  });

  it("threshold splits at the threshold", () => {
    const g = Float32Array.from([0, 100, 127, 128, 200, 255]);
    expect([...ditherGray(g, 6, 1, { method: "threshold" })]).toEqual([1, 1, 1, 0, 0, 0]);
    expect([...ditherGray(g, 6, 1, { method: "threshold", threshold: 101 })]).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it.each(["floyd-steinberg", "atkinson", "ordered"] as const)("%s keeps black/white solid and greys proportional", (method) => {
    expect(ones(ditherGray(flat(16, 16, 0), 16, 16, { method }))).toBe(256);
    expect(ones(ditherGray(flat(16, 16, 255), 16, 16, { method }))).toBe(0);
    const half = ones(ditherGray(flat(32, 32, 128), 32, 32, { method })) / 1024;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    const quarter = ones(ditherGray(flat(32, 32, 192), 32, 32, { method })) / 1024;
    // Atkinson drops a quarter of the error, so light greys come out lighter.
    expect(quarter).toBeGreaterThan(method === "atkinson" ? 0.1 : 0.18);
    expect(quarter).toBeLessThan(0.32);
  });

  it("threshold param biases diffusion", () => {
    const light = ones(ditherGray(flat(32, 32, 128), 32, 32, { method: "floyd-steinberg", threshold: 64 }));
    const dark = ones(ditherGray(flat(32, 32, 128), 32, 32, { method: "floyd-steinberg", threshold: 192 }));
    expect(light).toBeLessThan(dark);
  });

  it("composites alpha over white and inverts only opaque pixels", () => {
    // [opaque black, transparent black, opaque white]
    const img = { width: 3, height: 1, data: Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]) };
    expect([...toGray(img)]).toEqual([0, 255, 255]);
    expect([...ditherImage(img, { method: "threshold" })]).toEqual([1, 0, 0]);
    expect([...ditherImage(img, { method: "threshold", invert: true })]).toEqual([0, 0, 1]);
  });
});

describe("fitRect", () => {
  it("contains, covers and stretches", () => {
    expect(fitRect(200, 100, 50, 50, "contain")).toEqual({ x: 0, y: 12.5, w: 50, h: 25 });
    expect(fitRect(200, 100, 50, 50, "cover")).toEqual({ x: -25, y: 0, w: 100, h: 50 });
    expect(fitRect(200, 100, 50, 50, "stretch")).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });
});
