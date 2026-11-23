import { describe, expect, it } from "vitest";
import { sizeById } from "@labebal/core";
import { pickTarget, printerNeeded, printerTakes } from "./route-tile";

describe("board tile routing", () => {
  it("knows which printers take a size", () => {
    expect(printerTakes("M2_H", "m2-50x30")).toBe(true);
    expect(printerTakes("N1", "m2-50x30")).toBe(false);
    expect(printerTakes(null, "m2-50x30")).toBe(false);
  });

  it("prefers the printer already set up for the size, then the first printer", () => {
    const targets = [
      { model: "M2_H", sizeId: "m2-50x30", primary: true },
      { model: "M2_H", sizeId: "m2-40x12", primary: false },
      { model: "N1", sizeId: "n1-14x40", primary: false },
    ];
    expect(pickTarget("m2-40x12", targets)).toBe(1);
    expect(pickTarget("m2-25x10", targets)).toBe(0);
    expect(pickTarget("n1-14x30", targets)).toBe(2);
    expect(pickTarget("pt-12x45", targets)).toBe(-1);
  });

  it("names the printer a size needs", () => {
    expect(printerNeeded(sizeById("pt-12x45"))).toBe("the P-touch");
    expect(printerNeeded(sizeById("zpl-drawer-large"))).toBe("a network label printer");
    expect(printerNeeded(sizeById("m2-50x30"))).toBe("an M2");
  });
});
