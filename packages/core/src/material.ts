/**
 * Painting label stock and ribbon ink on a canvas (mockups, PNG export).
 * Works with any 2D canvas (browser or @napi-rs/canvas via the canvas seam).
 */
import { createCanvas } from "./canvas";
import type { Swatch } from "./media";

type Ctx = CanvasRenderingContext2D;

export interface StockRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius, px. */
  r: number;
}

/** Deterministic PRNG so exported mockups are stable. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function roundRect(ctx: Ctx, b: StockRect) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.r, b.w / 2, b.h / 2));
}

/**
 * Fill a label shape with the stock's look. `light` (0..1, default 0.3) moves
 * the specular glint / rainbow so a row of labels doesn't look copy-pasted.
 */
export function paintStock(ctx: Ctx, m: Swatch, b: StockRect, light = 0.3, seed = 1) {
  ctx.save();
  roundRect(ctx, b);
  ctx.clip();
  const rnd = rng(seed);
  const [r, g, bl] = m.rgb;
  const finish = m.finish ?? "paper";
  if (finish === "clear") {
    // Clear film: barely-there sheet with a gloss streak.
    ctx.fillStyle = `rgba(255,255,255,${m.alpha ?? 0.15})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  } else {
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  if (finish === "metallic" || finish === "matte") {
    const stops = m.sheen ?? [`rgb(${r},${g},${bl})`];
    const gr = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.35, b.y + b.h);
    stops.forEach((c, i) => gr.addColorStop(i / Math.max(1, stops.length - 1), c));
    ctx.globalAlpha = finish === "matte" ? 0.6 : 1;
    ctx.fillStyle = gr;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (finish === "metallic") {
      // Brushed grain.
      ctx.globalAlpha = 0.07;
      for (let y = b.y; y < b.y + b.h; y += 1) {
        ctx.fillStyle = rnd() > 0.5 ? "#fff" : "#000";
        ctx.fillRect(b.x, y, b.w, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  if (finish === "holographic") {
    const stops = m.sheen ?? ["#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f"];
    // Diffraction rainbow: a conic sweep centred off the label, so the colour
    // bands run diagonally across it like on the real foil.
    const cx = b.x + b.w * (0.15 + light * 0.7), cy = b.y + b.h * 1.6;
    const cg = ctx.createConicGradient(-Math.PI / 2 - 0.9 + light, cx, cy);
    const all = [...stops, ...stops, ...stops, stops[0]];
    all.forEach((c, i) => cg.addColorStop(i / (all.length - 1), c));
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = cg;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Fine laser-etched sparkle.
    const n = Math.round((b.w * b.h) / 18);
    for (let i = 0; i < n; i++) {
      const px = b.x + rnd() * b.w, py = b.y + rnd() * b.h;
      ctx.globalAlpha = 0.15 + rnd() * 0.35;
      ctx.fillStyle = stops[Math.floor(rnd() * stops.length)];
      ctx.fillRect(px, py, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
  }

  // Specular glint (not on paper / matte).
  if (finish === "metallic" || finish === "holographic" || finish === "gloss" || finish === "clear") {
    const gx = b.x + b.w * (light * 1.4 - 0.2);
    const gl = ctx.createLinearGradient(gx - b.w * 0.25, b.y, gx + b.w * 0.25, b.y + b.h);
    const a = finish === "gloss" ? 0.12 : finish === "clear" ? 0.35 : finish === "holographic" ? 0.32 : 0.5;
    gl.addColorStop(0, "rgba(255,255,255,0)");
    gl.addColorStop(0.5, `rgba(255,255,255,${a})`);
    gl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  if (finish === "paper" || finish === "matte") {
    // Paper tooth.
    const n = Math.round((b.w * b.h) / 30);
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = rnd() > 0.5 ? "#000" : "#fff";
      ctx.fillRect(b.x + rnd() * b.w, b.y + rnd() * b.h, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * Draw a 1-bit label render as ribbon ink into `dest` (scaled, nearest
 * neighbour). Metallic ribbons get a gradient + glint through the dot mask.
 */
export function paintInk(ctx: Ctx, dots: HTMLCanvasElement, ribbon: Swatch, dest: { x: number; y: number; w: number; h: number }, light = 0.3) {
  const sw = Math.max(1, Math.round(dest.w)), sh = Math.max(1, Math.round(dest.h));
  const ink = createCanvas(sw, sh);
  const ic = ink.getContext("2d")!;
  // Mask: dot -> opaque, no dot -> transparent.
  const src = dots.getContext("2d")!.getImageData(0, 0, dots.width, dots.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const dot = d[i] < 128;
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = dot ? 255 : 0;
  }
  const mask = createCanvas(dots.width, dots.height);
  mask.getContext("2d")!.putImageData(src, 0, 0);
  ic.imageSmoothingEnabled = false;
  ic.drawImage(mask, 0, 0, sw, sh);
  ic.globalCompositeOperation = "source-in";
  const [r, g, b] = ribbon.rgb;
  if (ribbon.sheen?.length) {
    const gr = ic.createLinearGradient(0, 0, sw * 0.4, sh);
    ribbon.sheen.forEach((c, i) => gr.addColorStop(i / Math.max(1, ribbon.sheen!.length - 1), c));
    ic.fillStyle = gr;
  } else ic.fillStyle = `rgb(${r},${g},${b})`;
  ic.fillRect(0, 0, sw, sh);
  if (ribbon.finish === "metallic") {
    const gx = sw * (light * 1.4 - 0.2);
    const gl = ic.createLinearGradient(gx - sw * 0.2, 0, gx + sw * 0.2, sh);
    gl.addColorStop(0, "rgba(255,255,255,0)");
    gl.addColorStop(0.5, "rgba(255,255,255,0.55)");
    gl.addColorStop(1, "rgba(255,255,255,0)");
    ic.globalCompositeOperation = "source-atop";
    ic.fillStyle = gl;
    ic.fillRect(0, 0, sw, sh);
  }
  ctx.drawImage(ink, dest.x, dest.y, dest.w, dest.h);
}
