import { describe, expect, it } from "vitest";
import { findColumn, planRowMerge, type DataColumn } from "../src/data";

const columns: DataColumn[] = [
  { id: "sku", name: "SKU" },
  { id: "name", name: "Name" },
];

describe("planRowMerge", () => {
  it("updates rows found in `existing`, inserts the rest, adds columns", () => {
    const existing = new Map([["a", "r-1"]]);
    const p = planRowMerge(columns, [{ SKU: "A", Name: "Alpha" }, { sku: "B", Qty: 3 }, { SKU: " a ", Qty: 1 }], { keyColumn: "SKU", existing });
    expect(p.keyColumn).toBe("sku");
    expect(p.newColumns).toEqual([{ id: "qty", name: "Qty" }]);
    expect(p.columns.map((c) => c.id)).toEqual(["sku", "name", "qty"]);
    expect(p.updates).toEqual([{ id: "r-1", values: { sku: "a", name: "Alpha", qty: "1" } }]);
    expect(p.inserts.map((r) => r.values)).toEqual([{ sku: "B", qty: "3" }]);
    expect(p.updated).toBe(2);
  });

  it("combines records with the same new key into one insert", () => {
    const p = planRowMerge(columns, [{ SKU: "N", Name: "one" }, { SKU: "n", Name: "two" }], { keyColumn: "sku" });
    expect(p.inserts).toHaveLength(1);
    expect(p.inserts[0].values.name).toBe("two");
    expect(p.updated).toBe(1);
  });

  it("append mode ignores keys; no key column means append", () => {
    const existing = new Map([["a", "r-1"]]);
    expect(planRowMerge(columns, [{ SKU: "A" }], { mode: "append", keyColumn: "sku", existing }).inserts).toHaveLength(1);
    expect(planRowMerge(columns, [{ SKU: "A" }, { SKU: "A" }], {}).inserts).toHaveLength(2);
  });

  it("finds columns by id or loose name", () => {
    expect(findColumn(columns, "s_k_u")?.id).toBe("sku");
    expect(findColumn(columns, undefined)).toBeUndefined();
  });
});
