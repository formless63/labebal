/**
 * Calibration test pattern (1-bit, printer resolution, reading orientation):
 *
 *  - 1-dot frame on the outermost printable dots, and a second frame 1 mm in,
 *  - 1 mm ruler ticks along all edges (longer every 5 mm),
 *  - a centre cross,
 *  - darkness steps: solid, 75 / 50 / 25 % dot patterns and 1-2-3 dot lines,
 *  - a caption (printer, density, offset) in a built-in 3x5 dot font.
 *
 * Print it, compare the frame / cross with the physical label edges and
 * enter the shift as the printer's x/y offset.
 */
import { createCanvas } from "./canvas";

export interface TestPatternOptions {
  w: number;
  h: number;
  dpmm: number;
  /** Text printed in the corner, e.g. "N1 D2 +0/+0". Upper-case A-Z, 0-9, + - / . : × */
  caption?: string;
}

/* 3x5 dot font, rows top to bottom, 3 bits each (MSB = left). */
const GLYPHS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7], "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7], "6": [7, 4, 7, 5, 7], "7": [7, 1, 1, 2, 2], "8": [7, 5, 7, 5, 7], "9": [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [5, 7, 7, 7, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], "+": [0, 2, 7, 2, 0], "-": [0, 0, 7, 0, 0], "/": [1, 1, 2, 4, 4],
  ".": [0, 0, 0, 0, 2], ":": [0, 2, 0, 2, 0], "×": [0, 5, 2, 5, 0], " ": [0, 0, 0, 0, 0], _: [0, 0, 0, 0, 7],
};

/** Draw dot-font text; returns width in dots. `s` = dots per font pixel. */
export function drawDotText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s = 1) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    g.forEach((row, r) => {
      for (let c = 0; c < 3; c++) if (row & (4 >> c)) ctx.fillRect(cx + c * s, y + r * s, s, s);
    });
    cx += 4 * s;
  }
  return cx - x - s;
}

export function renderTestPattern(o: TestPatternOptions): HTMLCanvasElement {
  const { w, h, dpmm } = o;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  const mm = (v: number) => Math.round(v * dpmm);

  // Outer frame on the outermost dots, inner frame 1 mm in.
  const frame = (inset: number) => {
    ctx.fillRect(inset, inset, w - 2 * inset, 1);
    ctx.fillRect(inset, h - 1 - inset, w - 2 * inset, 1);
    ctx.fillRect(inset, inset, 1, h - 2 * inset);
    ctx.fillRect(w - 1 - inset, inset, 1, h - 2 * inset);
  };
  frame(0);
  if (Math.min(w, h) > mm(4)) frame(mm(1));

  // Ruler ticks every mm from the centre outwards (so the centre is a reference too).
  const tick = (i: number) => (i % 10 === 0 ? mm(1.6) : i % 5 === 0 ? mm(1.1) : mm(0.6));
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let i = 0; ; i++) {
    const dx = mm(i);
    if (cx - dx < 0 && cx + dx >= w) break;
    for (const x of i ? [cx - dx, cx + dx] : [cx]) {
      if (x < 0 || x >= w) continue;
      ctx.fillRect(x, 0, 1, tick(i));
      ctx.fillRect(x, h - tick(i), 1, tick(i));
    }
  }
  for (let i = 0; ; i++) {
    const dy = mm(i);
    if (cy - dy < 0 && cy + dy >= h) break;
    for (const y of i ? [cy - dy, cy + dy] : [cy]) {
      if (y < 0 || y >= h) continue;
      ctx.fillRect(0, y, tick(i), 1);
      ctx.fillRect(w - tick(i), y, tick(i), 1);
    }
  }

  // Centre cross with a 1 mm gap ring so the exact centre dot stays visible.
  const arm = Math.min(mm(2), Math.floor(Math.min(w, h) / 6));
  ctx.fillRect(cx - arm, cy, arm * 2 + 1, 1);
  ctx.fillRect(cx, cy - arm, 1, arm * 2 + 1);

  // Darkness steps along the bottom, below the cross: solid, 75/50/25 % patterns, 1/2/3-dot lines.
  const pad = mm(1.5);
  const cell = Math.max(4, Math.min(mm(2), Math.floor(h / 2 - arm - pad - 2)));
  const stepsY = h - pad - cell;
  let x = pad;
  const patterns: ((px: number, py: number) => boolean)[] = [
    () => true,
    (px, py) => !(px % 2 === 0 && py % 2 === 0),
    (px, py) => (px + py) % 2 === 0,
    (px, py) => px % 2 === 0 && py % 2 === 0,
  ];
  const limit = w - pad;
  for (const p of patterns) {
    if (x + cell > limit) break;
    for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) if (p(px, py)) ctx.fillRect(x + px, stepsY + py, 1, 1);
    x += cell + mm(0.5);
  }
  for (const lw of [1, 2, 3]) {
    if (x + lw > limit) break;
    ctx.fillRect(x, stepsY, lw, cell);
    x += lw + mm(0.5);
  }

  // Caption top-left, inside the inner frame; scaled to ~1.2 mm cap height.
  if (o.caption) {
    const s = Math.max(1, Math.round(mm(1.2) / 5));
    const tx = mm(1) + 2 + s, ty = mm(1) + 2 + s;
    if (ty + 5 * s < cy - arm) drawDotText(ctx, o.caption, tx, ty, s);
  }
  return canvas;
}
