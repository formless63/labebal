/**
 * Regression tests from real printers (docs/printers/*-probe.json).
 */
import { describe, expect, it } from "vitest";
import { KNOWN_ROLLS, labelPixels, matchRoll, printerFor, sizeById } from "../src/media";
import { rollFromRfid } from "../src/printer";
import m2 from "../../../docs/printers/m2-probe.json";
import n1 from "../../../docs/printers/n1-probe.json";

describe("real M2 (firmware 1.50)", () => {
  const roll = rollFromRfid(m2.rfid as never)!;
  const printer = printerFor("M2_H");

  it("reads the roll and ribbon tags", () => {
    expect(roll.barcode).toBe("042225005");
    expect(roll.total).toBe(270);
    expect(roll.totalDots).toBe(396);
    expect(roll.gapDots).toBe(36);
    expect(roll.ribbon?.total).toBe(2880);
  });

  it("matches the 50 x 30 roll from its paper info (label 30 mm + 3 mm gap at 300 dpi)", () => {
    expect(matchRoll(roll, printer)?.sizeId).toBe("m2-50x30");
  });

  it("uses the full 576-dot head the printer reports", () => {
    expect(printer.headDots).toBe(m2.printerInfo.printheadWidth);
    expect(labelPixels(sizeById("m2-50x30")!, printer).w).toBe(576);
  });
});

describe("real N1 (firmware 4.08)", () => {
  it("recognises the laser gold roll by barcode (the N1 reports no paper info)", () => {
    const roll = rollFromRfid(n1.rfid as never)!;
    expect(roll.totalDots).toBeUndefined();
    expect(KNOWN_ROLLS[roll.barcode]).toEqual({ sizeId: "n1-14x30", materialId: "laser-gold" });
    expect(matchRoll(roll, printerFor("N1"))?.sizeId).toBe("n1-14x30");
  });
});
