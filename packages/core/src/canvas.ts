/**
 * Canvas factory seam. The renderer creates scratch / output canvases through
 * this so it can run outside the browser (Vitest with @napi-rs/canvas, a
 * server-side render worker). Browsers use document.createElement.
 */
export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

const domFactory: CanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

let factory: CanvasFactory = domFactory;

/** Install a non-DOM canvas implementation (e.g. `(w, h) => createCanvas(w, h)` from @napi-rs/canvas). */
export function setCanvasFactory(f: CanvasFactory | null) {
  factory = f ?? domFactory;
}

export const createCanvas = (w: number, h: number): HTMLCanvasElement => factory(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
