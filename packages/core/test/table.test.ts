import { describe, expect, it } from "vitest";
import { layout, type TextMeasurer } from "../src/layout";
import type { FrameNode, TableNode, Template } from "../src/schema";
import { addTableColumn, addTableRow, cellAt, cellBox, cellNode, isHeaderCell, lineShown, removeTableColumn, removeTableRow, setTableCell, tableGrid, tableTracks } from "../src/table";

/** 1 pt = 0.1 mm per character wide, 0.1 mm tall. */
const fake: TextMeasurer = {
  measure: (_n, text, sizePt) => ({ w: Math.max(...text.split("\n").map((l) => l.length)) * sizePt * 0.1, h: text.split("\n").length * sizePt * 0.1 }),
};

const table = (extra: Partial<TableNode> = {}): TableNode => ({
  id: "tb", type: "table", font: "x", sizePt: 10, color: "black", w: { kind: "fill" }, h: { kind: "fill" },
  cols: [{ kind: "hug" }, { kind: "fill" }, { kind: "fixed", mm: 5 }],
  rows: [{ kind: "fill" }, { kind: "fill", weight: 2 }],
  cells: [["Pin", "Signal", "V"], ["{{p}}", "RGB", "5"]],
  borderMm: 0.2, cellPaddingMm: 0.3,
  ...extra,
});

describe("table tracks", () => {
  it("fixed, hug, then fill shares the rest by weight", () => {
    expect(tableTracks([{ kind: "fixed", mm: 4 }, { kind: "hug" }, { kind: "fill" }, { kind: "fill", weight: 3 }], 30, [0, 6, 0, 0])).toEqual([4, 6, 5, 15]);
  });
  it("scales down when content does not fit", () => {
    expect(tableTracks([{ kind: "fixed", mm: 10 }, { kind: "hug" }], 10, [0, 10])).toEqual([5, 5]);
  });
  it("grid boundaries and cell boxes", () => {
    const g = tableGrid({ cols: [{ kind: "fill" }, { kind: "fill" }], rows: [{ kind: "fixed", mm: 4 }] }, 20, 4, { cols: [0, 0], rows: [0] });
    expect(g).toEqual({ xs: [0, 10, 20], ys: [0, 4] });
    // Outer lines inset fully, inner by half.
    expect(cellBox(g, 0, 0, 0.2, 0.3)).toEqual({ x: 0.5, y: 0.5, w: expect.closeTo(9.1), h: expect.closeTo(3) });
    expect(cellAt(g, 12, 1)).toEqual({ r: 0, c: 1 });
    expect(cellAt(g, 25, 1)).toBeNull();
  });
});

describe("table in layout", () => {
  const tpl = (n: TableNode, design = { w: 40, h: 12 }): Template => ({
    id: "t", name: "t", schema: 2, design, fields: [{ key: "p", label: "Pin", type: "text", default: "20" }],
    root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [n] } as FrameNode,
  });

  it("resolves fields in cells and measures hug columns", () => {
    const r = layout({ template: tpl(table()), width: 40, height: 12, measurer: fake });
    const it = r.byId.get("tb")!;
    expect(it.table!.cells[1][0].text).toBe("20");
    // Column 0 hugs "Pin" (3 chars * 1 mm) + 2 * 0.3 padding + 0.2 border.
    expect(it.table!.natural.cols[0]).toBeCloseTo(3.8);
    const g = tableGrid(it.node as TableNode, it.box.w, it.box.h, it.table!.natural);
    expect(g.xs[1]).toBeCloseTo(3.8);
    expect(g.xs[3] - g.xs[2]).toBeCloseTo(5);
    expect(g.xs[2] - g.xs[1]).toBeCloseTo(40 - 3.8 - 5);
    expect(g.ys[1]).toBeCloseTo(4);
  });

  it("reflows to another size", () => {
    const r = layout({ template: tpl(table()), width: 20, height: 6, measurer: fake });
    const it = r.byId.get("tb")!;
    const g = tableGrid(it.node as TableNode, it.box.w, it.box.h, it.table!.natural);
    expect(g.xs[3]).toBeCloseTo(20);
    expect(g.ys[2]).toBeCloseTo(6);
  });

  it("hugging the table gives the content size", () => {
    const n = table({ w: { kind: "hug" }, h: { kind: "hug" }, cols: [{ kind: "hug" }, { kind: "hug" }], rows: [{ kind: "hug" }], cells: [["ab", "abcd"]] });
    const r = layout({ template: tpl(n), width: 40, height: 12, measurer: fake });
    expect(r.byId.get("tb")!.box.w).toBeCloseTo(2 + 0.8 + 4 + 0.8);
    expect(r.byId.get("tb")!.box.h).toBeCloseTo(1 + 0.8);
  });
});

describe("table helpers", () => {
  it("headers, borders and cell nodes", () => {
    const n = table({ header: "row", border: "outer" });
    expect(isHeaderCell(n, 0, 2)).toBe(true);
    expect(isHeaderCell(n, 1, 0)).toBe(false);
    expect(cellNode(n, 0, 1).weight).toBe(700);
    expect(lineShown(n, "v", 1, 3)).toBe(false);
    expect(lineShown(n, "v", 3, 3)).toBe(true);
    expect(lineShown({ border: "rows" }, "h", 1, 3)).toBe(true);
    expect(lineShown({ border: "rows" }, "v", 0, 3)).toBe(false);
  });

  it("add / remove rows and columns keeps cells aligned", () => {
    let n = addTableColumn(table(), 1);
    expect(n.cols).toHaveLength(4);
    expect(n.cells[0]).toEqual(["Pin", "", "Signal", "V"]);
    n = addTableRow(n, 0);
    expect(n.cells[0]).toEqual(["", "", "", ""]);
    n = setTableCell(n, 0, 1, "x");
    expect(n.cells[0][1]).toBe("x");
    n = removeTableRow(removeTableColumn(n, 1), 0);
    expect(n.cells).toEqual(table().cells);
  });
});
