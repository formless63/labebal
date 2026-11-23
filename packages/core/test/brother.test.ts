import { describe, expect, it } from "vitest";
import { BROTHER_D610_MAGIC, brotherLabelJob, brotherPrintInfo, brotherRasterLines, parseBrotherStatus } from "../src/brother";
import type { Bitmap1 } from "../src/zpl-print";

function bitmap(width: number, height: number, dot: (x: number, y: number) => boolean): Bitmap1 {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (dot(x, y)) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
  return { width, height, bytesPerRow, data };
}

/** Pins set in raster line `x`. */
function pins(lines: Uint8Array, x: number) {
  const o = x * 19;
  const out: number[] = [];
  for (let p = 0; p < 128; p++) if (lines[o + 3 + (15 - (p >> 3))] & (1 << (p & 7))) out.push(p);
  return out;
}

describe("Brother raster", () => {
  it("centres the image on the head, bottom row on the lowest pin", () => {
    // 70 dots tall (12 mm tape): offset 64 - 35 = 29. Only the bottom row of column 0, and the top row of column 1.
    const b = bitmap(3, 70, (x, y) => (x === 0 && y === 69) || (x === 1 && y === 0));
    const lines = brotherRasterLines(b);
    expect(lines.length).toBe(3 * 19);
    expect([...lines.subarray(0, 3)]).toEqual([0x47, 0x10, 0x00]);
    expect(pins(lines, 0)).toEqual([29]);
    expect(pins(lines, 1)).toEqual([29 + 69]);
    expect(pins(lines, 2)).toEqual([]);
  });

  it("builds the whole job in order", () => {
    const b = bitmap(200, 128, () => false);
    const job = brotherLabelJob(b, 24);
    expect([...job.subarray(0, 4)]).toEqual([0x1b, 0x69, 0x61, 0x01]);
    expect([...job.subarray(4, 17)]).toEqual([...brotherPrintInfo(24, 200)]);
    expect([...brotherPrintInfo(24, 200)]).toEqual([0x1b, 0x69, 0x7a, 0, 0, 24, 0, 200, 0, 0, 0, 0x02, 0]);
    expect([...job.subarray(17, 24)]).toEqual([...BROTHER_D610_MAGIC]);
    expect(job.length).toBe(4 + 13 + 7 + 200 * 19 + 1);
    expect(job[job.length - 1]).toBe(0x1a);
  });

  it("reads the status block", () => {
    const b = new Uint8Array(32);
    b[0] = 0x80;
    b[1] = 0x20;
    b[2] = 0x42;
    b[10] = 12;
    b[11] = 0x01;
    b[24] = 0x06;
    b[25] = 0x08;
    expect(parseBrotherStatus(b)).toMatchObject({ statusType: 0, media: { widthMm: 12, type: "Laminated tape", materialId: "yellow", ribbonId: "black", tapeColour: "Yellow", textColour: "Black" } });
    b[9] = 0x10;
    expect(parseBrotherStatus(b)?.problem).toBe("The cover is open.");
    expect(parseBrotherStatus(new Uint8Array(10))).toBeNull();
  });
});
