/**
 * Table / grid element: pure geometry (tracks, cell boxes, grid lines).
 * Painting is in table-paint.ts.
 *
 * Columns and rows are sized like stack children: fixed mm, hug (their content)
 * or fill (share what is left, by weight). When fixed + hug tracks need more
 * than the box, everything is scaled down so the grid always fits its box.
 */
import type { TableNode, TableSize, TextNode } from "./schema";

export const DEFAULT_TABLE_BORDER_MM = 0.2;
export const DEFAULT_CELL_PADDING_MM = 0.3;

/** Resolve track sizes (columns or rows) along an available length. */
export function tableTracks(sizes: TableSize[], avail: number, natural: number[]): number[] {
  const out = sizes.map((s, i) => (s.kind === "fixed" ? Math.max(0, s.mm) : s.kind === "hug" ? Math.max(0, natural[i] ?? 0) : 0));
  const weights = sizes.map((s) => (s.kind === "fill" ? Math.max(0, s.weight ?? 1) : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const used = out.reduce((a, b) => a + b, 0);
  if (total > 0 && used <= avail) {
    const free = avail - used;
    return out.map((v, i) => (weights[i] ? (free * weights[i]) / total : v));
  }
  // Too much (or nothing to fill): scale everything to the box.
  return used > 0 ? out.map((v) => (v * avail) / used) : out;
}

/** Number of columns / rows (cells may be ragged; sizes define the grid). */
export const tableDims = (n: Pick<TableNode, "cols" | "rows">) => ({ cols: n.cols.length, rows: n.rows.length });

export const cellText = (n: Pick<TableNode, "cells">, r: number, c: number) => n.cells[r]?.[c] ?? "";

export const isHeaderCell = (n: Pick<TableNode, "header">, r: number, c: number) =>
  (n.header === "row" || n.header === "both" ? r === 0 : false) || (n.header === "column" || n.header === "both" ? c === 0 : false);

export const tableBorderMm = (n: Pick<TableNode, "border" | "borderMm">) => (n.border === "none" ? 0 : (n.borderMm ?? DEFAULT_TABLE_BORDER_MM));

/** Which grid lines show: index 0 and `count` are the outer edges. */
export function lineShown(n: Pick<TableNode, "border">, axis: "v" | "h", i: number, count: number) {
  const outer = i === 0 || i === count;
  switch (n.border ?? "all") {
    case "none":
      return false;
    case "outer":
      return outer;
    case "inner":
      return !outer;
    case "rows":
      return axis === "h";
    case "columns":
      return axis === "v";
    default:
      return true;
  }
}

/** A cell as a virtual text node, so cells reuse the text pipeline (fitting, pixel fonts, rich text). */
export function cellNode(n: TableNode, r: number, c: number): TextNode {
  const header = isHeaderCell(n, r, c);
  return {
    id: `${n.id}/r${r}c${c}`,
    type: "text",
    text: cellText(n, r, c),
    font: n.font,
    sizePt: n.sizePt,
    minSizePt: n.minSizePt,
    fit: n.fit ?? "shrink",
    align: n.colAlign?.[c] ?? n.align ?? "left",
    valign: "middle",
    uppercase: n.uppercase,
    color: n.color,
    weight: header && (n.headerStyle ?? "bold") === "bold" ? 700 : n.weight,
    w: { kind: "fill" },
    h: { kind: "fill" },
  };
}

export interface TableGrid {
  /** Column boundaries (cols + 1), relative to the box. */
  xs: number[];
  /** Row boundaries (rows + 1). */
  ys: number[];
}

/**
 * Grid boundaries for a box. `natural` = content sizes of each column / row
 * (text + padding + border), used by hug tracks.
 */
export function tableGrid(n: Pick<TableNode, "cols" | "rows">, w: number, h: number, natural: { cols: number[]; rows: number[] }): TableGrid {
  const acc = (a: number[]) => a.reduce<number[]>((xs, v) => [...xs, xs[xs.length - 1] + v], [0]);
  return { xs: acc(tableTracks(n.cols, w, natural.cols)), ys: acc(tableTracks(n.rows, h, natural.rows)) };
}

/**
 * Content box of a cell inside the grid: inset by the grid lines (outer lines
 * lie fully inside the table, inner ones are centred on the boundary) and the
 * cell padding. Units follow the inputs (mm or px).
 */
export function cellBox(g: TableGrid, r: number, c: number, borderW: number, pad: number) {
  const lastC = g.xs.length - 1, lastR = g.ys.length - 1;
  const inset = (i: number, last: number) => (i === 0 || i === last ? borderW : borderW / 2);
  const x0 = g.xs[c] + inset(c, lastC) + pad;
  const x1 = g.xs[c + 1] - inset(c + 1, lastC) - pad;
  const y0 = g.ys[r] + inset(r, lastR) + pad;
  const y1 = g.ys[r + 1] - inset(r + 1, lastR) - pad;
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Cell under a point (box-relative), or null. Used by the editor. */
export function cellAt(g: TableGrid, x: number, y: number): { r: number; c: number } | null {
  const c = g.xs.findIndex((v, i) => i < g.xs.length - 1 && x >= v && x < g.xs[i + 1]);
  const r = g.ys.findIndex((v, i) => i < g.ys.length - 1 && y >= v && y < g.ys[i + 1]);
  return r < 0 || c < 0 ? null : { r, c };
}

/* ------------------------------------------------------ editing helpers */

const blankRow = (cols: number) => Array.from({ length: cols }, () => "");

/** Insert a column at `at` (default: end). */
export function addTableColumn<T extends Pick<TableNode, "cols" | "cells" | "rows" | "colAlign">>(n: T, at = n.cols.length, size: TableSize = { kind: "fill" }): T {
  const cols = [...n.cols];
  cols.splice(at, 0, size);
  const cells = n.rows.map((_, r) => {
    const row = [...(n.cells[r] ?? blankRow(n.cols.length))];
    while (row.length < n.cols.length) row.push("");
    row.splice(at, 0, "");
    return row;
  });
  const colAlign = n.colAlign ? [...n.colAlign.slice(0, at), null, ...n.colAlign.slice(at)] : undefined;
  return { ...n, cols, cells, ...(colAlign ? { colAlign } : {}) };
}

export function removeTableColumn<T extends Pick<TableNode, "cols" | "cells" | "colAlign">>(n: T, at: number): T {
  if (n.cols.length <= 1) return n;
  const colAlign = n.colAlign ? n.colAlign.filter((_, i) => i !== at) : undefined;
  return { ...n, cols: n.cols.filter((_, i) => i !== at), cells: n.cells.map((row) => row.filter((_, i) => i !== at)), ...(colAlign ? { colAlign } : {}) };
}

export function addTableRow<T extends Pick<TableNode, "cols" | "cells" | "rows">>(n: T, at = n.rows.length, size: TableSize = { kind: "fill" }): T {
  const rows = [...n.rows];
  rows.splice(at, 0, size);
  const cells = [...n.cells];
  while (cells.length < n.rows.length) cells.push(blankRow(n.cols.length));
  cells.splice(at, 0, blankRow(n.cols.length));
  return { ...n, rows, cells };
}

export function removeTableRow<T extends Pick<TableNode, "cells" | "rows">>(n: T, at: number): T {
  if (n.rows.length <= 1) return n;
  return { ...n, rows: n.rows.filter((_, i) => i !== at), cells: n.cells.filter((_, i) => i !== at) };
}

export function setTableCell<T extends Pick<TableNode, "cells" | "rows" | "cols">>(n: T, r: number, c: number, text: string): T {
  const cells = n.rows.map((_, i) => {
    const row = [...(n.cells[i] ?? [])];
    while (row.length < n.cols.length) row.push("");
    return row;
  });
  if (cells[r]) cells[r][c] = text;
  return { ...n, cells };
}
