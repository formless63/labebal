import { describe, expect, it } from "vitest";
import { printerFor, sizeById, type PrinterSnapshot } from "@labebal/core";
import type { PrintContext } from "../labels/print";
import { printerSetup } from "./targets";

const printer = printerFor("M2_H");
const size = sizeById("m2-50x30")!;
const snap = { model: "M2_H", device: { serial: "T000000001" } } as unknown as PrinterSnapshot;
const ctx = { settings: { printer: "M2_H", sizeId: size.id, offsets: { M2_H: { x: 1, y: 1 } } }, printer, size } as unknown as PrintContext;
const offsets = (r: ReturnType<typeof printerSetup>) => (r.ctx.settings as { offsets?: Record<string, unknown> }).offsets?.M2_H;

describe("printerSetup offsets", () => {
  it("uses the model offset when the printer has none of its own", () => {
    expect(offsets(printerSetup(snap, ctx, { models: {}, profiles: {} }))).toEqual({ x: 1, y: 1 });
  });
  it("uses this browser's profile offset", () => {
    const profiles = { "sn:T000000001": { key: "sn:T000000001", name: "", model: "M2_H", offset: { x: 0, y: 3 } } };
    expect(offsets(printerSetup(snap, ctx, { models: {}, profiles }))).toEqual({ x: 0, y: 3 });
  });
  it("prefers the calibration saved against the serial", () => {
    const profiles = { "sn:T000000001": { key: "sn:T000000001", name: "", model: "M2_H", offset: { x: 0, y: 3 } } };
    const shared = { "sn:T000000001": { offset: { x: 0, y: 6 }, source: "calibrated" as const } };
    expect(offsets(printerSetup(snap, ctx, { models: {}, profiles, shared }))).toEqual({ x: 0, y: 6 });
  });
});
