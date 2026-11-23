"use client";
/**
 * Putting a 1-bit dot bitmap on screen without losing dots.
 *
 * A canvas stretched by CSS is resampled by the browser: `pixelated` (nearest
 * neighbour) drops whole dot rows/columns when a dot is smaller than a device
 * pixel, and gives uneven dots at fractional ratios; smooth filtering also
 * skips dots below 1:2. Which rows go missing depends on the device pixel ratio
 * (browser zoom, OS scaling) and the label size. So we size the canvas in
 * whole device pixels and decide the scaling ourselves:
 *  - a whole number of device pixels per dot: draw the dots, let `pixelated`
 *    blow them up exactly;
 *  - large fractional ratios (>= 3): same, dots differ by at most one pixel;
 *  - otherwise: area-average the dots into the device-pixel canvas (smooth,
 *    every dot contributes, nothing is dropped).
 */
import { useSyncExternalStore } from "react";

function subscribeDpr(cb: () => void) {
  // A resolution query only fires once, when the ratio leaves that value: re-arm each time.
  let mq: MediaQueryList | null = null;
  const arm = () => {
    mq?.removeEventListener("change", onChange);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", onChange);
  };
  const onChange = () => {
    arm();
    cb();
  };
  arm();
  window.addEventListener("resize", cb);
  return () => {
    mq?.removeEventListener("change", onChange);
    window.removeEventListener("resize", cb);
  };
}

/** Device pixels per CSS pixel; follows browser zoom and moving between screens. */
export function useDevicePixelRatio() {
  return useSyncExternalStore(
    subscribeDpr,
    () => window.devicePixelRatio || 1,
    () => 1,
  );
}

/**
 * Snap a screen scale (CSS px per mm) down so each printer dot is a whole
 * number of device pixels, unless that would keep less than `minKeep` of the
 * size (then the dots are resampled smoothly instead).
 */
export function crispScale(scale: number, dpmm: number, dpr: number, minKeep = 0.9) {
  const perDot = (scale * dpr) / dpmm;
  const k = Math.floor(perDot + 1e-6);
  if (k < 1) return scale;
  const snapped = (k * dpmm) / dpr;
  return snapped >= scale * minKeep ? Math.min(scale, snapped) : scale;
}

export interface BandBox {
  /** CSS px relative to the label's top-left, aligned to device pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Backing size in device pixels. */
  devW: number;
  devH: number;
}

/** Where the printable band (w × h dots, starting bandX/bandY mm into the label) goes on screen. */
export function bandBox(w: number, h: number, dpmm: number, bandX: number, bandY: number, scale: number, dpr: number): BandBox {
  const devW = Math.max(1, Math.round((w / dpmm) * scale * dpr));
  const devH = Math.max(1, Math.round((h / dpmm) * scale * dpr));
  return {
    left: Math.round(bandX * scale * dpr) / dpr,
    top: Math.round(bandY * scale * dpr) / dpr,
    width: devW / dpr,
    height: devH / dpr,
    devW,
    devH,
  };
}

const isWhole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;

/** True when the dots are drawn 1:1 and the browser scales them up with `pixelated`. */
export function usesPixelated(w: number, h: number, devW: number, devH: number) {
  const fx = devW / w, fy = devH / h;
  return fx >= 1 && fy >= 1 && ((isWhole(fx) && isWhole(fy)) || Math.min(fx, fy) >= 3);
}

/**
 * Area-average a w × h coverage map (1 = dot) into W × H pixels. Each output
 * pixel gets the fraction of its area covered by dots, so no dot is skipped.
 */
export function resampleCoverage(cov: ArrayLike<number>, w: number, h: number, W: number, H: number): Float32Array {
  const spans = (n: number, N: number) => {
    const step = n / N;
    const out: { i: number; wt: number }[][] = [];
    for (let X = 0; X < N; X++) {
      const a = X * step, b = a + step;
      const cell: { i: number; wt: number }[] = [];
      for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b - 1e-9)); i++) {
        const wt = Math.min(b, i + 1) - Math.max(a, i);
        if (wt > 0) cell.push({ i, wt: wt / step });
      }
      out.push(cell);
    }
    return out;
  };
  const sx = spans(w, W), sy = spans(h, H);
  const tmp = new Float32Array(W * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let X = 0; X < W; X++) {
      let s = 0;
      for (const { i, wt } of sx[X]) s += cov[row + i] * wt;
      tmp[y * W + X] = s;
    }
  }
  const out = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let s = 0;
      for (const { i, wt } of sy[Y]) s += tmp[i * W + X] * wt;
      out[Y * W + X] = Math.min(1, s);
    }
  }
  return out;
}

/**
 * Paint the dots of `src` (black = dot, as rendered by renderLabel) into
 * `target` as `rgb` on transparent, sized devW × devH device pixels (or 1:1
 * when the browser can upscale them with `pixelated`, see usesPixelated).
 */
export function paintDots(src: HTMLCanvasElement, target: HTMLCanvasElement, devW: number, devH: number, rgb: readonly [number, number, number] = [0, 0, 0]) {
  const { width: w, height: h } = src;
  const d = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const oneToOne = usesPixelated(w, h, devW, devH);
  const W = oneToOne ? w : devW, H = oneToOne ? h : devH;
  if (target.width !== W) target.width = W;
  if (target.height !== H) target.height = H;
  const ctx = target.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const o = img.data;
  if (oneToOne) {
    for (let i = 0; i < d.length; i += 4) {
      o[i] = rgb[0];
      o[i + 1] = rgb[1];
      o[i + 2] = rgb[2];
      o[i + 3] = d[i] < 128 ? 255 : 0;
    }
  } else {
    const cov = new Uint8Array(w * h);
    for (let p = 0; p < cov.length; p++) cov[p] = d[p * 4] < 128 ? 1 : 0;
    const a = resampleCoverage(cov, w, h, W, H);
    for (let p = 0; p < a.length; p++) {
      o[p * 4] = rgb[0];
      o[p * 4 + 1] = rgb[1];
      o[p * 4 + 2] = rgb[2];
      o[p * 4 + 3] = Math.round(a[p] * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}
