import { describe, expect, it } from "vitest";
import {
  autoMapFields,
  createLink,
  datasetToLabels,
  guessKeyColumn,
  keyedLabelId,
  mergeRows,
  parseTable,
  slugify,
  toCsv,
  type Dataset,
} from "../src/data";
import type { Template } from "../src/schema";

const tpl: Template = {
  id: "t-drawer-bin",
  name: "Drawer",
  schema: 2,
  design: { w: 30, h: 12 },
  root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [] },
  fields: [
    { key: "title", label: "Part name", type: "text" },
    { key: "spec", label: "Spec", type: "text" },
    { key: "icon", label: "Icon", type: "text" },
  ],
};

describe("parseTable", () => {
  it("parses CSV with quotes and a header", () => {
    const t = parseTable('SKU,Part Name,Spec\nSCR-1,"M3, socket",8 mm\n\nNUT-1,M3 nut,"say ""hi"""\n');
    expect(t.columns).toEqual([
      { id: "sku", name: "SKU" },
      { id: "part_name", name: "Part Name" },
      { id: "spec", name: "Spec" },
    ]);
    expect(t.rows.map((r) => r.values)).toEqual([
      { sku: "SCR-1", part_name: "M3, socket", spec: "8 mm" },
      { sku: "NUT-1", part_name: "M3 nut", spec: 'say "hi"' },
    ]);
  });

  it("parses spreadsheet paste (tabs), blank and duplicate headers", () => {
    const t = parseTable("Name\t\tName\r\na\tb\tc\r\nd\te\r\n");
    expect(t.columns.map((c) => c.id)).toEqual(["name", "column_2", "name_2"]);
    expect(t.rows[1].values).toEqual({ name: "d", column_2: "e", name_2: "" });
  });

  it("strips a BOM and round-trips to CSV", () => {
    const t = parseTable('﻿a,b\n1,"x,y"');
    expect(t.columns[0].id).toBe("a");
    expect(toCsv(t)).toBe('a,b\r\n1,"x,y"');
  });
});

describe("mapping", () => {
  const t = parseTable("Item,SKU,Part name,Icon,Category\nScrew,S-1,M3,screw,Screws\nNut,S-2,M3 nut,,Nuts");
  it("auto-matches fields by key or label", () => {
    expect(autoMapFields(tpl.fields, t.columns)).toEqual({ title: "part_name", icon: "icon" });
  });
  it("guesses the key column", () => {
    expect(guessKeyColumn(t.columns, t.rows)).toBe("sku");
    expect(guessKeyColumn(t.columns, [])).toBeUndefined();
  });
  it("derives stable ids", () => {
    expect(slugify(" M3 × 8 Socket ")).toBe("m3-8-socket");
    expect(keyedLabelId("t-drawer-bin", "SCR-M3/8")).toBe("l-drawer-bin-scr-m3-8");
  });
});

describe("datasetToLabels", () => {
  const t = parseTable("SKU,Part name,Spec,Category\nS-1,M3 screw,8 mm,Screws\nN-1,M3 nut,,Nuts\nN-1,Dup,,Nuts\n,No key,,Other");
  const d: Dataset = { id: "ds1", name: "Bins", ...t, link: createLink(t, tpl) };
  d.link!.keyColumn = "sku";
  d.link!.rules = {
    mode: "first",
    rules: [
      { id: "r1", when: { column: "category", op: "equals", value: "screws" }, then: { values: { icon: "screw" } } },
      { id: "r2", when: { column: "category", op: "equals", value: "nuts" }, then: { values: { icon: "hexagon" }, invert: true } },
    ],
  };

  it("builds one label per row with mapping + rules", () => {
    const out = datasetToLabels(d, d.rows, [tpl]);
    expect(out[0].label).toEqual({
      id: "l-drawer-bin-s-1",
      templateId: "t-drawer-bin",
      name: "S-1",
      values: { title: "M3 screw", spec: "8 mm", icon: "screw" },
      tags: ["dataset:ds1"],
    });
    expect(out[0].matched).toEqual(["r1"]);
    expect(out[1].label.invert).toBe(true);
    expect(out[1].problems).toEqual([expect.stringMatching(/Same key/)]);
    expect(out[3].label.id).toBe(`l-drawer-bin-${d.rows[3].id}`);
    expect(out[3].problems[0]).toMatch(/Key is empty/);
  });

  it("uses the name column and flags unknown templates", () => {
    const out = datasetToLabels({ ...d, link: { ...d.link!, nameColumn: "part_name", templateId: "t-gone" } }, d.rows.slice(0, 1), [tpl]);
    expect(out[0].label.name).toBe("M3 screw");
    expect(out[0].problems).toEqual(['Template "t-gone" not found']);
  });

  it("returns nothing without a link", () => {
    expect(datasetToLabels({ ...d, link: undefined })).toEqual([]);
  });
});

describe("mergeRows", () => {
  const base: Dataset = { id: "d", name: "d", ...parseTable("SKU,Name\nA,Alpha\nB,Beta") };
  it("upserts by key column (name or id), adds new columns", () => {
    const r = mergeRows(base, [{ sku: "a", Name: "Alpha 2" }, { SKU: "C", Name: "Gamma", Qty: 5 }], { keyColumn: "SKU" });
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.dataset.columns.map((c) => c.id)).toEqual(["sku", "name", "qty"]);
    expect(r.dataset.rows.map((x) => x.values)).toEqual([
      { sku: "a", name: "Alpha 2", qty: "" },
      { sku: "B", name: "Beta", qty: "" },
      { sku: "C", name: "Gamma", qty: "5" },
    ]);
    expect(base.rows[0].values.name).toBe("Alpha");
  });
  it("appends without a key", () => {
    const r = mergeRows(base, [{ SKU: "A", Name: "again" }], { mode: "append", keyColumn: "sku" });
    expect(r).toMatchObject({ added: 1, updated: 0 });
    expect(r.dataset.rows).toHaveLength(3);
  });
});
