/**
 * Mockup scenes: objects drawn on a 2D canvas at true physical scale (mm),
 * with labels composited from the real 1-bit render (ribbon ink on stock).
 *
 * Framework-free (no React / DOM beyond a 2D context) so it can render
 * headlessly and be reused elsewhere.
 */
import { cornerRadiusMm, createCanvas, labelPixels, paintInk, paintStock, rng, type LabelSize, type PrinterProfile, type Swatch } from "@labebal/core";

type Ctx = CanvasRenderingContext2D;

export interface LabelArt {
  /** 1-bit render at printer resolution (dot = black). */
  dots: HTMLCanvasElement;
  size: LabelSize;
  printer: PrinterProfile;
}

export type Background = "mat" | "white" | "transparent";

export interface SceneOptions {
  material: Swatch;
  ribbon: Swatch;
  background: Background;
  /** Images a scene may use (photos), keyed by scene asset name. */
  images?: Record<string, CanvasImageSource | undefined>;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  /** Default label size id for this object. */
  sizeId: string;
  widthMm: number;
  heightMm: number;
  /** Asset images the scene needs (URL by name), loaded by the page. */
  assets?: Record<string, string>;
  /** Label centre (mm, scene coordinates) for a given label size. */
  slot: (size: LabelSize) => { cx: number; cy: number };
  /**
   * Background object, drawn in mm units. Cached per (scene, k, seed,
   * background, loaded assets), so it must not depend on anything else in `o`.
   */
  back: (ctx: Ctx, o: SceneOptions, seed: number, k: number) => void;
  /** Optional overlay after the label (e.g. clear window cover), mm units. */
  front?: (ctx: Ctx, o: SceneOptions, size: LabelSize, seed: number, k: number) => void;
  /** Custom label placement (e.g. wrapped around a cable); default = flat label. */
  label?: (ctx: Ctx, art: LabelArt, o: SceneOptions, at: { cx: number; cy: number }, k: number, light: number, seed: number) => void;
}

/* ----------------------------------------------------------------- helpers */

function roundedPoly(ctx: Ctx, pts: [number, number][], r: number | number[]) {
  ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const rr = Array.isArray(r) ? r[i] : r;
    if (i === 0) ctx.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    ctx.arcTo(p1[0], p1[1], p2[0], p2[1], rr);
  }
  ctx.closePath();
}

function pill(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, (y1 - y0) / 2);
}

/**
 * 2D context on a software-backed canvas. Thousands of tiny fills are ~1000x
 * cheaper there than on a GPU canvas, which round-trips per draw call.
 */
function cpuContext(c: HTMLCanvasElement): Ctx {
  return (c.getContext("2d", { willReadFrequently: true }) ?? c.getContext("2d")) as Ctx;
}

/** Side of the tiled speckle pattern, output px. */
const NOISE_TILE = 256;
const noiseTiles = new Map<string, HTMLCanvasElement>();

/** A seamless-enough tile of 1.3 px speckles (white / black, varying alpha), built once per look. */
function noiseTile(density: number, alpha: number) {
  const key = `${density}|${alpha}`;
  let tile = noiseTiles.get(key);
  if (!tile) {
    tile = createCanvas(NOISE_TILE, NOISE_TILE);
    const tc = cpuContext(tile);
    const r = rng(0x5eed + Math.round(density * 1000));
    const n = Math.round(NOISE_TILE * NOISE_TILE * density);
    for (let i = 0; i < n; i++) {
      tc.globalAlpha = alpha * (0.4 + r());
      tc.fillStyle = r() > 0.55 ? "#fff" : "#000";
      tc.fillRect(r() * NOISE_TILE, r() * NOISE_TILE, 1.3, 1.3);
    }
    noiseTiles.set(key, tile);
  }
  return tile;
}

/**
 * Speckle texture inside the current clip (mm units; dot size = 1.3 output px).
 * One pattern fill of a cached noise tile, offset by `seed` so copies differ.
 */
function speckle(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, density: number, seed: number, alpha = 0.08) {
  const pat = ctx.createPattern(noiseTile(density, alpha), "repeat");
  if (!pat) return;
  const r = rng(seed);
  const ox = Math.floor(r() * NOISE_TILE), oy = Math.floor(r() * NOISE_TILE);
  // Pattern space is output px: scale by 1/k into mm, shifted by the seed offset.
  pat.setTransform?.({ a: 1 / k, b: 0, c: 0, d: 1 / k, e: x - ox / k, f: y - oy / k });
  ctx.save();
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function background(ctx: Ctx, o: SceneOptions, w: number, h: number, k: number, seed: number) {
  if (o.background === "transparent") return;
  ctx.fillStyle = o.background === "mat" ? "#5b6066" : "#ffffff";
  ctx.fillRect(0, 0, w, h);
  if (o.background === "mat") speckle(ctx, 0, 0, w, h, k, 0.05, seed, 0.05);
}

/** Soft drop shadow for a path (shadow params are in output px, not mm). */
function withShadow(ctx: Ctx, k: number, blurMm: number, offMm: number, alpha: number, draw: () => void) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blurMm * k;
  ctx.shadowOffsetY = offMm * k;
  ctx.shadowOffsetX = offMm * k * 0.3;
  draw();
  ctx.restore();
}

/**
 * Flat label: drop shadow, stock (finish, corner radius) and ink in the
 * printable band. Drawn in output pixels for crisp dots.
 */
export function drawFlatLabel(ctx: Ctx, art: LabelArt, o: SceneOptions, at: { cx: number; cy: number }, k: number, light: number, seed: number) {
  const { size, printer, dots } = art;
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cx = m.a * at.cx + m.c * at.cy + m.e, cy = m.b * at.cx + m.d * at.cy + m.f;
  const w = size.widthMm * k, h = size.heightMm * k, r = cornerRadiusMm(size) * k;
  const b = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h), r };
  const clear = o.material.finish === "clear";
  if (!clear)
    withShadow(ctx, 1, 0.5 * k, 0.18 * k, 0.45, () => {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, r);
      ctx.fillStyle = `rgb(${o.material.rgb.join(",")})`;
      ctx.fill();
    });
  paintStock(ctx, o.material, b, light, seed);
  const px = labelPixels(size, printer);
  const bw = (px.w / px.dpmm) * k, bh = (px.h / px.dpmm) * k;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
  ctx.clip();
  paintInk(ctx, dots, o.ribbon, { x: b.x + (b.w - bw) / 2, y: b.y + (b.h - bh) / 2, w: bw, h: bh }, light);
  ctx.restore();
  // Edge: a hairline so light stock reads against light objects.
  ctx.beginPath();
  ctx.roundRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, r);
  ctx.strokeStyle = clear ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------- other scenes */

/**
 * Akro-Mils style parts cabinet drawer, seen straight on: black cabinet frame,
 * frosted clear polypropylene front, a ribbed pull lip overhanging at the top,
 * and the flat area below the lip where the label goes. Sizes from the
 * maker's drawings and the measured label areas (large ~100 x 25 mm, small ~45 x 15 mm).
 */
interface DrawerSpec {
  /** Drawer front, mm. */
  w: number;
  h: number;
  /** Height of the pull lip at the top of the front, mm. */
  lip: number;
  /** Centre divider seen through the front (large drawers). */
  divider: boolean;
}

const DRAWER_LARGE: DrawerSpec = { w: 112, h: 54, lip: 17, divider: true };
const DRAWER_SMALL: DrawerSpec = { w: 50, h: 40, lip: 13, divider: false };
/** Cabinet frame around the drawer, mm. */
const DRAWER_FRAME = 5;

const frostFill = (alpha: number) => `rgba(222,228,233,${alpha})`;

function drawAkroDrawer(ctx: Ctx, o: SceneOptions, seed: number, k: number, d: DrawerSpec) {
  const M = DRAWER_FRAME;
  const W = d.w + 2 * M, H = d.h + 2 * M;
  const x0 = M, y0 = M, x1 = M + d.w, y1 = M + d.h;
  const lipY = y0 + d.lip;
  background(ctx, o, W, H, k, seed + 3);

  // Black cabinet frame and the dark cell the drawer slides into.
  withShadow(ctx, k, 2, 1, 0.5, () => {
    ctx.fillStyle = "#141416";
    ctx.beginPath();
    ctx.roundRect(0.6, 0.6, W - 1.2, H - 1.2, 1.2);
    ctx.fill();
  });
  const fg = ctx.createLinearGradient(0, 0, 0, H);
  fg.addColorStop(0, "#232326");
  fg.addColorStop(0.5, "#161618");
  fg.addColorStop(1, "#0e0e10");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.roundRect(0.6, 0.6, W - 1.2, H - 1.2, 1.2);
  ctx.fill();
  speckle(ctx, 0.6, 0.6, W - 1.2, H - 1.2, k, 0.3, seed, 0.06);
  // Rails: lit top edges of the horizontal bars.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0.6, 0.9, W - 1.2, 0.25);
  ctx.fillRect(0.6, y1 + 1.2, W - 1.2, 0.25);
  ctx.fillStyle = "#070708";
  ctx.fillRect(x0 - 0.9, y0 - 0.9, d.w + 1.8, d.h + 1.8);

  // What is behind the frosted front: the drawer's inside and a few parts.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y0, d.w, d.h, [1.5, 1.5, 1.2, 1.2]);
  ctx.clip();
  const ig = ctx.createLinearGradient(0, y0, 0, y1);
  ig.addColorStop(0, "#2b2e31");
  ig.addColorStop(1, "#3d4144");
  ctx.fillStyle = ig;
  ctx.fillRect(x0, y0, d.w, d.h);
  const r = rng(seed);
  for (let i = 0; i < Math.round(d.w * 0.6); i++) {
    ctx.fillStyle = ["#8e959b", "#b49a5c", "#5f656a", "#a7adb2"][i % 4];
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(x0 + 2 + r() * (d.w - 4), y1 - 2 - r() * (d.h - d.lip) * 0.55, 0.8 + r() * 1.6, 0.4 + r() * 0.8, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Frosted front below the lip.
  const bg = ctx.createLinearGradient(0, lipY, 0, y1);
  bg.addColorStop(0, frostFill(0.62));
  bg.addColorStop(0.5, frostFill(0.7));
  bg.addColorStop(1, frostFill(0.64));
  ctx.fillStyle = bg;
  ctx.fillRect(x0, lipY - 2, d.w, y1 - lipY + 2);
  speckle(ctx, x0, lipY - 2, d.w, y1 - lipY + 2, k, 0.2, seed + 1, 0.05);
  // Seen through the front: top rim of the drawer's sides and the bottom edge, both a bit brighter.
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(x0 + 1, lipY + 2.6, d.w - 2, 0.35);
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(x0 + 1, lipY + 2.95, d.w - 2, 0.3);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(x0 + 1, y1 - 2.2, d.w - 2, 0.3);
  if (d.divider) {
    const cx = (x0 + x1) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(cx - 1.6, lipY + 3, 0.45, y1 - lipY - 5);
    ctx.fillRect(cx + 1.15, lipY + 3, 0.45, y1 - lipY - 5);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(cx - 1.15, lipY + 3, 2.3, y1 - lipY - 5);
  }
  // Thicker side walls catch light at the edges.
  const sg = ctx.createLinearGradient(x0, 0, x0 + 2, 0);
  sg.addColorStop(0, "rgba(255,255,255,0.35)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  ctx.fillRect(x0, lipY, 2, d.h);
  const sg2 = ctx.createLinearGradient(x1, 0, x1 - 2, 0);
  sg2.addColorStop(0, "rgba(255,255,255,0.28)");
  sg2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg2;
  ctx.fillRect(x1 - 2, lipY, 2, d.h);
  // The lip overhangs: soft shadow on the front just below it.
  const sh = ctx.createLinearGradient(0, lipY, 0, lipY + 3.5);
  sh.addColorStop(0, "rgba(0,0,0,0.32)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(x0, lipY, d.w, 3.5);
  ctx.restore();

  // Little feet at the bottom corners.
  ctx.fillStyle = "rgba(230,235,238,0.55)";
  for (const fx of [x0 + 2.5, x1 - 4]) ctx.fillRect(fx, y1 - 0.2, 1.5, 0.6);

  // Pull lip: a curved scoop across the top, a touch wider than the front.
  const lx0 = x0 - 0.5, lx1 = x1 + 0.5, ly0 = y0 - 0.6;
  const lipPath = () => {
    ctx.beginPath();
    ctx.roundRect(lx0, ly0, lx1 - lx0, lipY - ly0, [1.6, 1.6, 2.6, 2.6]);
  };
  withShadow(ctx, k, 0.8, 0.5, 0.35, () => {
    lipPath();
    ctx.fillStyle = "rgba(40,44,48,0.9)";
    ctx.fill();
  });
  ctx.save();
  lipPath();
  ctx.clip();
  const lg = ctx.createLinearGradient(0, ly0, 0, lipY);
  lg.addColorStop(0, "rgba(150,158,164,0.70)");
  lg.addColorStop(0.3, "rgba(180,188,194,0.66)");
  lg.addColorStop(0.7, "rgba(206,213,218,0.70)");
  lg.addColorStop(0.87, "rgba(232,237,240,0.82)");
  lg.addColorStop(1, "rgba(150,158,164,0.78)");
  ctx.fillStyle = lg;
  ctx.fillRect(lx0, ly0, lx1 - lx0, lipY - ly0);
  // Ribbed thumb grip in the middle, wider at the top.
  const rw0 = d.w * 0.62, rw1 = d.w * 0.5;
  const ry0 = ly0 + d.lip * 0.16, ry1 = ly0 + d.lip * 0.66;
  const cx = (x0 + x1) / 2;
  ctx.beginPath();
  ctx.moveTo(cx - rw0 / 2, ry0);
  ctx.lineTo(cx + rw0 / 2, ry0);
  ctx.lineTo(cx + rw1 / 2, ry1);
  ctx.lineTo(cx - rw1 / 2, ry1);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.save();
  ctx.clip();
  const pitch = d.lip > 15 ? 0.75 : 0.6;
  for (let y = ry0 + pitch / 2; y < ry1; y += pitch) {
    ctx.fillStyle = "rgba(60,68,74,0.22)";
    ctx.fillRect(cx - rw0 / 2, y, rw0, 0.16);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(cx - rw0 / 2, y + 0.16, rw0, 0.12);
  }
  ctx.restore();
  // Panel edges.
  ctx.strokeStyle = "rgba(90,98,104,0.35)";
  ctx.lineWidth = 0.18;
  ctx.stroke();
  // Gloss along the rounded bottom edge of the lip.
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(lx0 + 2, lipY - 2.1, lx1 - lx0 - 4, 0.3);
  ctx.restore();
  lipPath();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 0.22;
  ctx.stroke();
  ctx.strokeStyle = "rgba(40,46,52,0.35)";
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(lx0 + 2.6, lipY + 0.08);
  ctx.lineTo(lx1 - 2.6, lipY + 0.08);
  ctx.stroke();
  // Outline of the front.
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.roundRect(x0, y0, d.w, d.h, [1.5, 1.5, 1.2, 1.2]);
  ctx.stroke();
}

function drawerScene(id: string, name: string, description: string, sizeId: string, d: DrawerSpec): Scene {
  return {
    id,
    name,
    description,
    sizeId,
    widthMm: d.w + 2 * DRAWER_FRAME,
    heightMm: d.h + 2 * DRAWER_FRAME,
    // Label centred on the flat area below the lip.
    slot: () => ({ cx: DRAWER_FRAME + d.w / 2, cy: DRAWER_FRAME + d.lip + (d.h - d.lip) / 2 + 0.4 }),
    back: (ctx, o, seed, k) => drawAkroDrawer(ctx, o, seed, k, d),
  };
}

const CABLE_Y = 12;
function drawCable(ctx: Ctx, o: SceneOptions, seed: number, k: number) {
  background(ctx, o, 80, 50, k, seed + 5);
  withShadow(ctx, k, 1.5, 1.2, 0.45, () => {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, CABLE_Y - 3, 80, 6);
  });
  const g = ctx.createLinearGradient(0, CABLE_Y - 3, 0, CABLE_Y + 3);
  g.addColorStop(0, "#0b0b0c");
  g.addColorStop(0.3, "#3c3c41");
  g.addColorStop(0.45, "#26262a");
  g.addColorStop(1, "#060607");
  ctx.fillStyle = g;
  ctx.fillRect(0, CABLE_Y - 3, 80, 6);
}

function cableLabel(ctx: Ctx, art: LabelArt, o: SceneOptions, at: { cx: number; cy: number }, k: number, light: number, seed: number) {
  // Flag hanging from the cable, plus the wrap around the cable.
  drawFlatLabel(ctx, art, o, at, k, light, seed);
  const w = art.size.widthMm;
  const x0 = at.cx - w / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, CABLE_Y - 3.3, w, 6.6 + 1.6, 0.6);
  ctx.clip();
  const m = o.material;
  ctx.fillStyle = m.finish === "clear" ? "rgba(255,255,255,0.15)" : `rgb(${m.rgb.join(",")})`;
  ctx.fillRect(x0, CABLE_Y - 3.3, w, 8.2);
  const g = ctx.createLinearGradient(0, CABLE_Y - 3.3, 0, CABLE_Y + 4.9);
  g.addColorStop(0, "rgba(0,0,0,0.45)");
  g.addColorStop(0.3, "rgba(255,255,255,0.35)");
  g.addColorStop(0.6, "rgba(0,0,0,0.05)");
  g.addColorStop(0.8, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0.15)");
  ctx.fillStyle = g;
  ctx.fillRect(x0, CABLE_Y - 3.3, w, 8.2);
  ctx.restore();
}

function drawBox(ctx: Ctx, o: SceneOptions, seed: number, k: number) {
  background(ctx, o, 76, 58, k, seed + 9);
  withShadow(ctx, k, 2.5, 1.4, 0.45, () => {
    ctx.fillStyle = "#b8925f";
    ctx.beginPath();
    ctx.roundRect(4, 4, 68, 50, 0.8);
    ctx.fill();
  });
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(4, 4, 68, 50, 0.8);
  ctx.clip();
  const g = ctx.createLinearGradient(4, 4, 72, 54);
  g.addColorStop(0, "#cfa874");
  g.addColorStop(1, "#b48d5a");
  ctx.fillStyle = g;
  ctx.fillRect(4, 4, 68, 50);
  // Corrugation hint + fibres.
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#000";
  for (let x = 4; x < 72; x += 1.4) ctx.fillRect(x, 4, 0.5, 50);
  ctx.globalAlpha = 1;
  speckle(ctx, 4, 4, 68, 50, k, 0.2, seed, 0.08);
  // Tuck flap seam.
  ctx.fillStyle = "rgba(60,40,15,0.35)";
  ctx.fillRect(4, 14, 68, 0.35);
  ctx.fillStyle = "rgba(255,240,210,0.25)";
  ctx.fillRect(4, 14.4, 68, 0.2);
  ctx.restore();
}

function drawBag(ctx: Ctx, o: SceneOptions, seed: number, k: number) {
  background(ctx, o, 64, 76, k, seed + 11);
  withShadow(ctx, k, 2, 1, 0.35, () => {
    ctx.fillStyle = "rgba(150,155,160,0.9)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 68, 1);
    ctx.fill();
  });
  // Anti-static bag: metallised, translucent grey with wrinkles.
  const g = ctx.createLinearGradient(4, 4, 60, 72);
  g.addColorStop(0, "#aeb3b8");
  g.addColorStop(0.35, "#d6d9dc");
  g.addColorStop(0.55, "#a2a7ac");
  g.addColorStop(0.8, "#c8ccd0");
  g.addColorStop(1, "#9da2a7");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 68, 1);
  ctx.fill();
  const r = rng(seed);
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 9; i++) {
    const x = 4 + r() * 56;
    const lg = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, `rgba(255,255,255,${0.12 + r() * 0.15})`);
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(x - 3, 4, 6, 68);
  }
  ctx.restore();
  // Zip.
  ctx.fillStyle = "rgba(90,95,100,0.6)";
  ctx.fillRect(4, 11, 56, 0.6);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(4, 11.8, 56, 0.3);
}

/* ------------------------------------------------------------- catalogue */

export const SCENES: Scene[] = [
  drawerScene("drawer", "Parts drawer, large", "Akro-Mils style large drawer: frosted clear front under a ribbed pull lip; label area about 100 x 25 mm.", "zpl-drawer-large", DRAWER_LARGE),
  drawerScene("drawer-small", "Parts drawer, small", "Akro-Mils style small drawer: frosted clear front under a ribbed pull lip; label area about 45 x 15 mm.", "zpl-drawer-small", DRAWER_SMALL),
  {
    id: "cable",
    name: "Cable flag",
    description: "Flag label hanging from a 6 mm cable.",
    sizeId: "n1-14x30",
    widthMm: 80,
    heightMm: 50,
    slot: (size) => ({ cx: 40, cy: CABLE_Y + 4.6 + size.heightMm / 2 }),
    back: drawCable,
    label: cableLabel,
  },
  {
    id: "box",
    name: "Small box",
    description: "Kraft shipping / product box, label on the lid.",
    sizeId: "m2-50x30",
    widthMm: 76,
    heightMm: 58,
    slot: () => ({ cx: 38, cy: 34 }),
    back: drawBox,
  },
  {
    id: "bag",
    name: "Anti-static bag",
    description: "Zip anti-static bag, label below the zip.",
    sizeId: "m2-40x30",
    widthMm: 64,
    heightMm: 76,
    slot: () => ({ cx: 32, cy: 34 }),
    back: drawBag,
  },
];

export const sceneById = (id: string) => SCENES.find((s) => s.id === id) ?? SCENES[0];

/** Gap between objects in a row, mm. */
export const ROW_GAP_MM = 4;

/* ------------------------------------------------------ static layer cache */

/** Pre-rendered scene backgrounds (the expensive part), most recently used last. */
const layerCache = new Map<string, HTMLCanvasElement>();
/** Pixel budget for cached layers (~4 bytes each). */
const LAYER_CACHE_PX = 16e6;

function releaseCanvas(c: HTMLCanvasElement) {
  c.width = c.height = 0;
}

/** The scene's `back` drawn once into its own canvas at `k` px/mm. */
function backLayer(scene: Scene, o: SceneOptions, seed: number, k: number, cache: boolean) {
  const loaded = Object.keys(scene.assets ?? {}).filter((name) => o.images?.[name]);
  const key = [scene.id, k, seed, o.background, loaded.join(",")].join("|");
  const hit = layerCache.get(key);
  if (hit) {
    layerCache.delete(key);
    layerCache.set(key, hit);
    return hit;
  }
  const layer = createCanvas(Math.round(scene.widthMm * k), Math.round(scene.heightMm * k));
  const ctx = cpuContext(layer);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  scene.back(ctx, o, seed, k);
  if (cache) {
    layerCache.set(key, layer);
    let px = 0;
    for (const c of layerCache.values()) px += c.width * c.height;
    for (const [oldKey, c] of layerCache) {
      if (px <= LAYER_CACHE_PX || c === layer) break;
      px -= c.width * c.height;
      layerCache.delete(oldKey);
      releaseCanvas(c);
    }
  }
  return layer;
}

/** Drop all cached scene layers (e.g. when the page unmounts). */
export function clearMockupCache() {
  for (const c of layerCache.values()) releaseCanvas(c);
  layerCache.clear();
}

/**
 * Largest px/mm <= `k` that keeps a row of `n` objects within the pixel budget
 * (browsers crash or silently fail on huge canvases).
 */
export function mockupScale(scene: Scene, n: number, k: number, maxPixels = 12e6, maxSide = 16384) {
  const count = Math.max(1, n);
  const wMm = count * scene.widthMm + (count - 1) * ROW_GAP_MM;
  const hMm = scene.heightMm;
  const fit = Math.min(k, Math.sqrt(maxPixels / (wMm * hMm)), maxSide / wMm, maxSide / hMm);
  // Whole px/mm keeps object offsets on whole pixels.
  return Math.max(1, Math.floor(fit));
}

/**
 * Render a row of objects, one per label, into `canvas` at `k` px/mm.
 * Scene backgrounds come from a cache unless `cache` is false (one-off exports).
 * Returns the physical size of the result in mm.
 */
export function renderMockup(canvas: HTMLCanvasElement, scene: Scene, arts: LabelArt[], o: SceneOptions, k: number, cache = true) {
  const n = Math.max(1, arts.length);
  const wMm = n * scene.widthMm + (n - 1) * ROW_GAP_MM;
  const hMm = scene.heightMm;
  const cw = Math.round(wMm * k), ch = Math.round(hMm * k);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (o.background !== "transparent" && n > 1) {
    ctx.fillStyle = o.background === "mat" ? "#5b6066" : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (let i = 0; i < n; i++) {
    const art = arts[i];
    const seed = 17 + i * 101;
    const light = 0.25 + ((i * 0.37) % 0.5);
    const x0 = Math.round(i * (scene.widthMm + ROW_GAP_MM) * k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backLayer(scene, o, seed, k, cache), x0, 0);
    ctx.setTransform(k, 0, 0, k, x0, 0);
    if (art) {
      const at = scene.slot(art.size);
      ctx.save();
      (scene.label ?? drawFlatLabel)(ctx, art, o, at, k, light, seed);
      ctx.restore();
      if (scene.front) {
        ctx.save();
        scene.front(ctx, o, art.size, seed, k);
        ctx.restore();
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { wMm, hMm };
}
