import { describe, expect, it } from "vitest";
import { polygonPoints } from "../src/render";

describe("polygonPoints", () => {
  it("inscribes a triangle in its box, point up", () => {
    const p = polygonPoints({ sides: 3 }, { x: 0, y: 0, w: 10, h: 10 });
    expect(p).toHaveLength(3);
    expect(p[0][0]).toBeCloseTo(5);
    expect(p[0][1]).toBeCloseTo(0);
    expect(Math.max(...p.map((q) => q[1]))).toBeCloseTo(10);
    expect(Math.min(...p.map((q) => q[0]))).toBeCloseTo(0);
  });
  it("makes stars with inner points", () => {
    const p = polygonPoints({ sides: 5, star: true, innerRatio: 0.5 }, { x: 0, y: 0, w: 20, h: 20 });
    expect(p).toHaveLength(10);
  });
  it("clamps sides", () => {
    expect(polygonPoints({ sides: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toHaveLength(3);
    expect(polygonPoints({ sides: 99 }, { x: 0, y: 0, w: 1, h: 1 })).toHaveLength(24);
  });
});
