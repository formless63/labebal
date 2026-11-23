import { describe, expect, it } from "vitest";
import { KNOWN_ROLLS, MATERIALS, matchRoll, printerFor, sizeById, type RollInfo } from "../src";
import { buildTable, materialFor, parseRollName } from "../scripts/known-rolls";

const roll = (barcode: string): RollInfo => ({ barcode, serial: "S1", total: 228, used: 0, type: 1 });
const n1 = printerFor("N1");

describe("KNOWN_ROLLS", () => {
  it("points only at existing N1 sizes and materials", () => {
    const materials = new Set(MATERIALS.map((m) => m.id));
    for (const [code, v] of Object.entries(KNOWN_ROLLS)) {
      expect(sizeById(v.sizeId)?.printer, code).toBe("N1");
      if (v.materialId) expect(materials.has(v.materialId), `${code} ${v.materialId}`).toBe(true);
    }
    expect(Object.keys(KNOWN_ROLLS).length).toBeGreaterThan(1000);
  });

  it("recognises catalogue rolls (niimbench catalogue)", () => {
    // Read from a real N1 tag.
    expect(matchRoll(roll("08062224"), n1)).toEqual({ sizeId: "n1-14x30", materialId: "laser-gold", sure: true });
    // EL14*30-190Laser Silver, EW14*30-190White, EW14*40-150White, EW14*50-125White, EW12*40-155白色.
    expect(matchRoll(roll("08062225"), n1)).toMatchObject({ sizeId: "n1-14x30", materialId: "laser-silver", sure: true });
    expect(matchRoll(roll("12242117"), n1)).toMatchObject({ sizeId: "n1-14x30", materialId: "white" });
    expect(matchRoll(roll("06222214"), n1)).toMatchObject({ sizeId: "n1-14x40", materialId: "white" });
    expect(matchRoll(roll("011626111"), n1)).toMatchObject({ sizeId: "n1-14x50", materialId: "white" });
    expect(matchRoll(roll("083124226"), n1)).toMatchObject({ sizeId: "n1-12x40", materialId: "white" });
    // EW14*28-200Round White and ET14*30-190CLEAR.
    expect(matchRoll(roll("021325259"), n1)).toMatchObject({ sizeId: "n1-14x28", materialId: "white" });
    expect(matchRoll(roll("08052213"), n1)).toMatchObject({ sizeId: "n1-14x30", materialId: "transparent" });
  });

  it("lets the user's own choice win", () => {
    expect(matchRoll(roll("08062224"), n1, { "08062224": { sizeId: "n1-14x40" } })).toMatchObject({ sizeId: "n1-14x40" });
  });
});

describe("scripts/known-rolls", () => {
  it("parses Niimbot roll names", () => {
    expect(parseRollName("EL14*30-190Laser Gold")).toEqual({ prefix: "EL", across: 14, length: 30, count: 190, colour: "Laser Gold" });
    expect(parseRollName("EL14*28-200LasrSlvr RND")?.colour).toBe("LasrSlvr");
    expect(parseRollName("EW14*30-190 (黄色)")?.colour).toBe("黄色");
    expect(parseRollName("φ3-1.6白色热缩管N系")).toBeNull();
    expect(materialFor("EW", "White")).toBe("white");
    expect(materialFor("EW", "红色")).toBe("red");
    expect(materialFor("ET", "")).toBe("transparent");
    // Designs: size only.
    expect(materialFor("EW", "Sky Buddies")).toBeUndefined();
  });

  it("keeps sizes we have, drops ambiguous and other printers' codes", () => {
    const n1Row = (barcode: string, name: string, w: number, h: number, codes: string[] = []) => ({ barcode, name, width_mm: w, height_mm: h, paper_type: 1, machines: ["N1", "B18"], codes });
    const { table } = buildTable([
      n1Row("1", "EW14*30-190White", 30, 14, ["111"]),
      n1Row("2", "EW14*40-150White", 40, 14, ["111"]),
      n1Row("3", "EW14*33-150White", 33, 14),
      n1Row("4", "EW14*30-190White", 40, 14),
      n1Row("5", "EW14*50-125Sky Buddies", 50, 14, ["555"]),
      { barcode: "555", name: "T50*30-230WHITE", width_mm: 50, height_mm: 30, paper_type: 1, machines: ["M2_H"], codes: [] },
    ]);
    expect(Object.fromEntries([...table].map(([k, v]) => [k, v.sizeId + (v.materialId ? `/${v.materialId}` : "")]))).toEqual({
      "1": "n1-14x30/white",
      "2": "n1-14x40/white",
      "5": "n1-14x50",
    });
  });
});
