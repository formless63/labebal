/** Table / grid painting (browser / headless canvas). Geometry is in table.ts. */
import type { TableContent } from "./layout";
import { drawRich } from "./richtext-canvas";
import type { TableNode } from "./schema";
import { DEFAULT_CELL_PADDING_MM, cellBox, isHeaderCell, lineShown, tableBorderMm, tableGrid } from "./table";
import { drawText } from "./text";
import { createCanvas } from "./canvas";
import { pixelFont } from "./fonts";

type PxBox = { x: number; y: number; w: number; h: number };

/** ctx paint (fill style + composite op) is set by the caller for the node's colour. */
export function paintTable(ctx: CanvasRenderingContext2D, n: TableNode, b: PxBox, dpmm: number, content: TableContent) {
  if (b.w < 1 || b.h < 1 || !n.cols.length || !n.rows.length) return;
  const bmm = tableBorderMm(n);
  const lw = bmm > 0 ? Math.max(1, Math.round(bmm * dpmm)) : 0;
  const padMm = n.cellPaddingMm ?? DEFAULT_CELL_PADDING_MM;
  const pad = Math.round(padMm * dpmm);
  // Natural (hug) track sizes count padding and one border in mm; the cells
  // below inset whole dots (rounded padding, a full outer line plus half an
  // inner one). Add the difference so hugged content still fits at its size
  // (pixel fonts would otherwise drop to a smaller whole-dot scale).
  const toPx = (v: number[]) =>
    v.map((mm, i) => {
      const inset = (j: number) => (j === 0 || j === v.length ? lw : lw / 2);
      return mm * dpmm + Math.max(0, 2 * (pad - padMm * dpmm) + inset(i) + inset(i + 1) - bmm * dpmm);
    });
  const g = tableGrid(n, b.w, b.h, { cols: toPx(content.natural.cols), rows: toPx(content.natural.rows) });
  // Snap boundaries to whole dots so lines and cells meet cleanly.
  g.xs = g.xs.map((v) => Math.round(v));
  g.ys = g.ys.map((v) => Math.round(v));
  const color = String(ctx.fillStyle);
  const op = ctx.globalCompositeOperation;

  const textBox = (r: number, c: number) => ({ ...cellBox(g, r, c, lw, pad), dpmm });
  const sizePt = pixelFont(n.font) ? sharedPixelSize(n, content, textBox) : content.sizePt;

  ctx.save();
  ctx.translate(b.x, b.y);
  if (lw) {
    const cols = g.xs.length - 1, rows = g.ys.length - 1;
    // Outer lines sit inside the table; inner lines are centred on the boundary.
    const at = (v: number, i: number, last: number) => (i === 0 ? v : i === last ? v - lw : v - Math.floor(lw / 2));
    g.xs.forEach((x, i) => lineShown(n, "v", i, cols) && ctx.fillRect(at(x, i, cols), 0, lw, g.ys[rows]));
    g.ys.forEach((y, i) => lineShown(n, "h", i, rows) && ctx.fillRect(0, at(y, i, rows), g.xs[cols], lw));
  }
  for (let r = 0; r < n.rows.length; r++)
    for (let c = 0; c < n.cols.length; c++) {
      const cell = content.cells[r]?.[c];
      const invert = isHeaderCell(n, r, c) && n.headerStyle === "invert";
      if (invert) {
        // Header cell: flip its area, then the text flips back (white on black).
        const full = cellBox(g, r, c, lw, 0);
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(full.x, full.y, full.w, full.h);
      } else {
        ctx.globalCompositeOperation = op;
        ctx.fillStyle = color;
      }
      if (!cell || (!cell.text.trim() && !cell.rich)) continue;
      const box = textBox(r, c);
      if (box.w < 1 || box.h < 1) continue;
      if (cell.rich) drawRich(ctx, cell.node, cell.rich, sizePt, box);
      else drawText(ctx, cell.node, cell.text, sizePt, box);
    }
  ctx.restore();
}

/**
 * Pixel-font tables: the size every cell can use (the smallest fitted size),
 * so all cells share one whole dots-per-font-pixel scale instead of each cell
 * snapping to its own (a roomier cell would otherwise jump to the next scale).
 */
function sharedPixelSize(n: TableNode, content: TableContent, box: (r: number, c: number) => PxBox & { dpmm: number }) {
  const scratch = createCanvas(1, 1).getContext("2d")!;
  let size = content.sizePt;
  for (let r = 0; r < n.rows.length; r++)
    for (let c = 0; c < n.cols.length; c++) {
      const cell = content.cells[r]?.[c];
      const b = box(r, c);
      if (!cell || (!cell.text.trim() && !cell.rich) || b.w < 1 || b.h < 1) continue;
      const used = cell.rich ? drawRich(scratch, cell.node, cell.rich, content.sizePt, b) : drawText(scratch, cell.node, cell.text, content.sizePt, b);
      size = Math.min(size, used);
    }
  return size;
}
