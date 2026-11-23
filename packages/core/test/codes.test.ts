import { beforeAll, describe, expect, it } from "vitest";
import { encodeCode, fit1dModule, fit2d, layoutCode, linearModules, loadCodeEncoder, quietModules, type EncodedCode } from "../src/codes";

beforeAll(() => loadCodeEncoder());

describe("module sizing", () => {
  it("fits the largest whole-dot module and centres it", () => {
    expect(fit2d(100, 60, 21, 21)).toEqual({ module: 2, x: 29, y: 9, w: 42, h: 42 });
    expect(fit2d(84, 84, 21, 21)).toEqual({ module: 4, x: 0, y: 0, w: 84, h: 84 });
    expect(fit2d(20, 20, 21, 21).module).toBe(0);
    expect(fit1dModule(200, 95)).toBe(2);
    expect(fit1dModule(94, 95)).toBe(0);
  });
});

describe("encoding", () => {
  it("encodes 2D codes as module matrices", () => {
    const q = encodeCode("qrcode", "hello", "M");
    expect(q).toMatchObject({ kind: "2d", cols: 21, rows: 21 });
    const big = encodeCode("qrcode", "hello", "H");
    expect(big && !(big instanceof Error) && big.kind === "2d" && big.cols).toBeGreaterThanOrEqual(21);
    expect(encodeCode("datamatrix", "HELLO WORLD 123")).toMatchObject({ kind: "2d", cols: 16, rows: 16 });
  });

  it("encodes 1D codes as bar widths", () => {
    const e = encodeCode("ean13", "590123412345");
    expect(e).toMatchObject({ kind: "1d", modules: 95 });
    if (!e || e instanceof Error || e.kind !== "1d") throw new Error("no ean");
    expect(e.chars?.map((c) => c.ch).join("")).toBe("5901234123457"); // check digit added
    expect(e.guards.filter(Boolean).length).toBe(6);
    expect(encodeCode("upca", "03600029145")).toMatchObject({ kind: "1d", modules: 95 });
    expect(encodeCode("code39", "abc-12")).toMatchObject({ kind: "1d", text: "ABC-12" });
    expect(encodeCode("code128", "ABC-123")).toMatchObject({ kind: "1d" });
  });

  it("returns an Error for invalid data", () => {
    expect(encodeCode("ean13", "123")).toBeInstanceOf(Error);
    expect(encodeCode("qrcode", "")).toBeInstanceOf(Error);
  });
});

describe("layoutCode", () => {
  it("draws QR modules on whole dots", () => {
    const q = encodeCode("qrcode", "hello")!;
    if (q instanceof Error) throw q;
    const l = layoutCode(q, 100, 50, { dpmm: 8 })!;
    expect(l.module).toBe(2);
    for (const r of l.rects) {
      expect(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w)).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(29);
      expect(r.x + r.w).toBeLessThanOrEqual(29 + 42);
    }
  });

  it("sizes 1D bars by integer modules and adds text", () => {
    const c = encodeCode("code128", "ABC-123")!;
    if (c instanceof Error || c.kind !== "1d") throw new Error();
    const l = layoutCode(c, 300, 80, { dpmm: 8, showText: true })!;
    expect(l.module).toBe(Math.floor(300 / c.modules));
    const left = Math.min(...l.rects.map((r) => r.x));
    const right = Math.max(...l.rects.map((r) => r.x + r.w));
    expect(right - left).toBe(c.modules * l.module);
    expect(Math.abs(left - (300 - right))).toBeLessThanOrEqual(1); // centred
    expect(l.texts).toHaveLength(1);
    expect(l.rects[0].h).toBeLessThan(80);
    expect(layoutCode(c, 300, 80, { dpmm: 8 })!.rects[0].h).toBe(80);
  });

  it("reserves room for EAN digits outside the guards", () => {
    const e = encodeCode("ean13", "5901234123457")!;
    if (e instanceof Error || e.kind !== "1d") throw new Error();
    const span = linearModules("ean13", "5901234123457");
    expect(span).toBeGreaterThan(95);
    const l = layoutCode(e, span * 2, 100, { dpmm: 8, showText: true })!;
    expect(l.module).toBe(2);
    expect(l.texts).toHaveLength(13);
    expect(Math.min(...l.texts.map((t) => t.x))).toBeGreaterThanOrEqual(0);
    expect(layoutCode(e, 94, 100, { dpmm: 8 })).toBeNull();
  });
});

describe("quiet zone", () => {
  it("reserves quiet modules around 2D codes and keeps whole-dot modules", async () => {
    await loadCodeEncoder();
    const q = encodeCode("qrcode", "https://example.com", "M") as Extract<EncodedCode, { kind: "2d" }>;
    const plain = layoutCode(q, 120, 120, { dpmm: 8 })!;
    const quiet = layoutCode(q, 120, 120, { dpmm: 8, quiet: quietModules("qrcode") })!;
    expect(quiet.module).toBeLessThanOrEqual(plain.module);
    const minX = Math.min(...quiet.rects.map((r) => r.x));
    expect(minX).toBeGreaterThanOrEqual(4 * quiet.module);
    expect(Number.isInteger(quiet.module)).toBe(true);
  });
  it("uses standard widths", () => {
    expect(quietModules("qrcode")).toBe(4);
    expect(quietModules("datamatrix")).toBe(1);
    expect(quietModules("code128")).toBe(10);
  });
});
