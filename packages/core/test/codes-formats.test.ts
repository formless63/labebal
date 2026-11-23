/** the extra symbologies (rMQR, Micro QR, Code 93, ITF-14, EAN-8, GS1-128, GS1 DataMatrix, PDF417, Aztec). */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CODE_FORMATS,
  CODE_FORMAT_IDS,
  codeAspect,
  codeProblem,
  encodeCode,
  fitRows,
  is2d,
  isSquare2d,
  layoutCode,
  linearModules,
  loadCodeEncoder,
  quietModules,
  type Encoded2d,
} from "../src/codes";
import type { CodeFormat } from "../src/schema";

beforeAll(() => loadCodeEncoder());

const enc2d = (f: CodeFormat, v: string) => {
  const e = encodeCode(f, v);
  if (!e || e instanceof Error || e.kind !== "2d") throw new Error(`${f}: ${e}`);
  return e;
};
const enc1d = (f: CodeFormat, v: string) => {
  const e = encodeCode(f, v);
  if (!e || e instanceof Error || e.kind !== "1d") throw new Error(`${f}: ${e}`);
  return e;
};
const wholeDots = (l: NonNullable<ReturnType<typeof layoutCode>>) =>
  l.rects.every((r) => [r.x, r.y, r.w, r.h].every(Number.isInteger)) && Number.isInteger(l.module) && Number.isInteger(l.moduleH);

describe("every format", () => {
  for (const f of CODE_FORMAT_IDS) {
    it(`${f} encodes its example and lays out on whole dots`, () => {
      const info = CODE_FORMATS[f];
      const e = encodeCode(f, info.example);
      if (!e || e instanceof Error) throw new Error(`${f}: ${e}`);
      expect(e.kind).toBe(info.shape === "1d" ? "1d" : "2d");
      expect(is2d(f)).toBe(info.shape !== "1d");
      const l = layoutCode(e, 600, 200, { dpmm: 11.8, quiet: quietModules(f) })!;
      expect(l).not.toBeNull();
      expect(wholeDots(l)).toBe(true);
      expect(l.module).toBeGreaterThanOrEqual(1);
      // Symbol inside the box, with the quiet zone left free on the sides.
      expect(l.bounds.x).toBeGreaterThanOrEqual(quietModules(f) * l.module);
      expect(l.bounds.x + l.bounds.w).toBeLessThanOrEqual(600 - quietModules(f) * l.module);
      expect(l.bounds.y + l.bounds.h).toBeLessThanOrEqual(200);
    });
  }
});

describe("2D formats", () => {
  it("square codes have square modules", () => {
    for (const f of ["microqr", "aztec", "gs1datamatrix"] as CodeFormat[]) {
      expect(isSquare2d(f)).toBe(true);
      const e = enc2d(f, CODE_FORMATS[f].example);
      expect(e.cols).toBe(e.rows);
      const l = layoutCode(e, 100, 100, { dpmm: 8 })!;
      expect(l.module).toBe(l.moduleH);
      expect(l.module).toBe(Math.floor(100 / e.cols));
    }
    expect(enc2d("microqr", "12345").cols).toBe(13); // M2 (M1 has no error correction level M)
  });

  it("rMQR offers one shape per height and picks the biggest module for the box", () => {
    const e = enc2d("rmqr", "SKU-00042");
    expect(e.shapes!.length).toBeGreaterThan(1);
    expect(e.shapes!.every((s) => s.rows < s.cols)).toBe(true);
    // N1 band: 96 dots tall, long label. A square QR would be limited by the height.
    const l = layoutCode(e, 400, 96, { dpmm: 8, quiet: quietModules("rmqr") })!;
    expect(wholeDots(l)).toBe(true);
    expect(l.rows).toBeLessThan(l.cols);
    expect((l.rows + 4) * l.module).toBeLessThanOrEqual(96);
    expect((l.cols + 4) * l.module).toBeLessThanOrEqual(400);
    const qr = layoutCode(enc2d("qrcode", "SKU-00042"), 400, 96, { dpmm: 8, quiet: 4 })!;
    expect(l.module).toBeGreaterThan(qr.module);
    // A flatter box picks a flatter shape.
    const flat = layoutCode(e, 400, 30, { dpmm: 8 })!;
    expect(flat.rows).toBeLessThanOrEqual(l.rows);
    expect(flat.rows * flat.module).toBeLessThanOrEqual(30);
  });

  it("rMQR maps error correction to the levels it has", () => {
    expect(encodeCode("rmqr", "HI", "L")).not.toBeInstanceOf(Error); // L -> M
    expect(encodeCode("microqr", "HI", "H")).not.toBeInstanceOf(Error); // H -> Q
  });

  it("PDF417 rows are 2-3 modules tall on whole dots", () => {
    const e = enc2d("pdf417", "HELLO WORLD 1234567890");
    expect(e.rowRatio).toBe(3);
    expect(e.shapes!.length).toBeGreaterThan(3);
    const l = layoutCode(e, 500, 120, { dpmm: 11.8, quiet: 2 })!;
    expect(wholeDots(l)).toBe(true);
    expect(l.moduleH).toBeGreaterThanOrEqual(2 * l.module);
    expect(l.moduleH).toBeLessThanOrEqual(3 * l.module);
    expect(l.bounds.h).toBe(l.rows * l.moduleH);
    // A tall narrow box picks fewer columns than a long flat one.
    const tall = layoutCode(e, 120, 500, { dpmm: 11.8 })!;
    expect(tall.cols).toBeLessThan(l.cols);
  });

  it("fitRows accepts squat rows before giving up", () => {
    expect(fitRows(100, 30, 50, 10, 3)).toEqual({ module: 1, rowH: 3 });
    expect(fitRows(100, 20, 50, 10, 3)).toEqual({ module: 1, rowH: 2 });
    expect(fitRows(100, 19, 50, 10, 3).module).toBe(0);
  });

  it("rectangular codes report their aspect for hug sizing", () => {
    expect(codeAspect("qrcode", "x")).toBe(1);
    expect(codeAspect("code128", "x")).toBeUndefined();
    const s = enc2d("rmqr", "AB") as Encoded2d;
    expect(codeAspect("rmqr", "AB")).toBeCloseTo(s.cols / s.rows);
    expect(codeAspect("pdf417", "AB")!).toBeGreaterThan(1);
  });
});

describe("1D formats", () => {
  it("EAN-8 adds the check digit and draws digits under the bars", () => {
    const e = enc1d("ean8", "9638507");
    expect(e.modules).toBe(67);
    expect(e.chars!.map((c) => c.ch).join("")).toBe("96385074");
    expect(e.guards.filter(Boolean).length).toBe(6);
    expect(linearModules("ean8", "9638507")).toBeGreaterThan(67);
  });

  it("ITF-14, Code 93 and GS1-128 encode", () => {
    expect(enc1d("itf14", "0001234560001").modules).toBeGreaterThan(100);
    expect(enc1d("code93", "abc-1").text).toBe("ABC-1");
    expect(enc1d("gs1_128", "(01)09521234543213").modules).toBeGreaterThan(100);
  });

  it("uses the standard quiet zones", () => {
    expect(quietModules("ean8")).toBe(7);
    expect(quietModules("ean13")).toBe(11);
    expect(quietModules("itf14")).toBe(10);
    expect(quietModules("microqr")).toBe(2);
    expect(quietModules("rmqr")).toBe(2);
    expect(quietModules("aztec")).toBe(0);
  });
});

describe("validation messages", () => {
  it("explain what each format takes", () => {
    expect(codeProblem("ean8", "12")).toMatch(/EAN-8 can only hold 7 digits/);
    expect(codeProblem("ean8", "96385075")).toMatch(/check digit/);
    expect(codeProblem("itf14", "00012345600013")).toMatch(/check digit/);
    expect(codeProblem("itf14", "12ab")).toMatch(/13 digits/);
    expect(codeProblem("gs1_128", "0109521234543213")).toMatch(/GS1/);
    expect(codeProblem("gs1datamatrix", "(01)123")).toMatch(/GS1/);
    expect(codeProblem("microqr", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toMatch(/Too much/);
    expect(codeProblem("code93", "ok")).toBe(""); // upper-cased
    expect(codeProblem("qrcode", "")).toBe("");
    expect(codeProblem("qrcode", "anything")).toBe("");
  });
});

describe("more symbologies", () => {
  it("EAN / UPC add-ons: shorter bars with their digits above", () => {
    const e = enc1d("ean13", "590123412345 12");
    expect(e.modules).toBeGreaterThan(95);
    expect(e.chars!.filter((c) => c.top).map((c) => c.ch).join("")).toBe("12");
    const l = layoutCode(e, 800, 200, { dpmm: 8, showText: true })!;
    const top = l.texts.filter((t) => t.y < 100);
    expect(top).toHaveLength(2);
    expect(Math.min(...l.rects.map((r) => r.y))).toBe(0); // main bars from the top
    expect(l.rects.some((r) => r.y > 0)).toBe(true); // add-on bars lower
    expect(enc1d("upca", "03600029145 12345").chars!.filter((c) => c.top)).toHaveLength(5);
  });

  it("4-state postal codes keep each bar's height and position", () => {
    for (const f of ["uspsimb", "royalmail"] as CodeFormat[]) {
      const e = enc1d(f, CODE_FORMATS[f].example);
      expect(e.spans).toBeDefined();
      const l = layoutCode(e, 900, 60, { dpmm: 8 })!;
      expect(new Set(l.rects.map((r) => `${r.y}/${r.h}`)).size).toBeGreaterThanOrEqual(3);
      expect(wholeDots(l)).toBe(true);
    }
  });

  it("tidies values into what the encoder wants", () => {
    expect(enc1d("codabar", "40156").text).toBe("A40156A");
    expect(enc1d("codabar", "b40156d").text).toBe("B40156D");
    expect(enc1d("upce", "123456").text).toBe("0123456");
    expect(enc1d("itf", "12345").text).toBe("012345");
  });

  it("rectangular Data Matrix picks a flat shape for a flat box", () => {
    const e = enc2d("datamatrixrect", "SKU-00042");
    expect(e.shapes!.length).toBeGreaterThan(1);
    const l = layoutCode(e, 400, 60, { dpmm: 8 })!;
    expect(l.cols / l.rows).toBeGreaterThan(2);
  });

  it("explains bad values in plain words", () => {
    expect(codeProblem("pharmacode", "2")).toMatch(/3 to 131070/);
    expect(codeProblem("uspsimb", "0123")).toMatch(/20 digits/);
    expect(codeProblem("databar", "(01)0952123454321")).toBe("");
  });
});
