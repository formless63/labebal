/**
 * Painters for image / icon / code nodes, plus asset preloading.
 *
 * Rendering is synchronous, so anything that must be fetched or decoded
 * (images, icon SVGs, the barcode encoder) is loaded up front by
 * `preloadAssets` and cached here; painters draw from the cache (or a
 * placeholder if missing).
 *
 * Every painter works at device resolution and produces a dot mask that is
 * painted with the node's paint (black / white / invert) already set on ctx.
 */
import { codeEncoderReady, encodeCode, friendlyCodeError, is2d, layoutCode, loadCodeEncoder, quietModules } from "./codes";
import { ditherImage, fitRect } from "./dither";
import { drawIcon, iconSource, parseIconId, parseIconSvg, type IconData } from "./icons";
import { setImageSizer } from "./layout";
import { makeCanvas, maskOf, paintMask } from "./paint";
import { resolveLabel } from "./rules";
import { labelContext } from "./tokens";
import { inlineIconIds } from "./richtext";
import { assetUrl } from "./fonts";
import { resolveTemplate } from "./parts";
import {
  BOUND_PROPS,
  fillPlaceholders,
  walk,
  type CodeNode,
  type IconNode,
  type ImageNode,
  type Label,
  type LabelNode,
  type RenderContext,
  type Rotation,
  type Template,
} from "./schema";

export type PxBox = { x: number; y: number; w: number; h: number };

/* ------------------------------------------------------------------ caches */

interface LoadedImage {
  img: HTMLImageElement;
  w: number;
  h: number;
}
const images = new Map<string, LoadedImage | "error">();
const imageLoads = new Map<string, Promise<void>>();
const icons = new Map<string, IconData | "error">();
const iconLoads = new Map<string, Promise<void>>();
/** Rendered dot masks, keyed by everything that affects them. */
const masks = new Map<string, { mask: Uint8Array; w: number; h: number }>();

const remember = (key: string, v: { mask: Uint8Array; w: number; h: number }) => {
  if (masks.size > 300) masks.clear();
  masks.set(key, v);
  return v;
};

const iconKey = (name: string, filled: boolean) => `${name}\u0000${filled ? 1 : 0}`;

/** When a load failed (ill-formed ids are not in here: they stay failed). */
const iconFailed = new Map<string, number>();

/** Status of an icon in the cache ("none": no icon source, or not a well-formed id). */
export const iconStatus = (name: string, filled = false): "loaded" | "error" | "loading" | "missing" | "none" => {
  const id = name.trim();
  if (!iconSource() || !parseIconId(id)) return "none";
  const key = iconKey(id, filled);
  const v = icons.get(key);
  return v === "error" ? "error" : v ? "loaded" : iconLoads.has(key) ? "loading" : "missing";
};

/** Status of an image URL in the cache. */
export const imageStatus = (src: string): "loaded" | "error" | "loading" | "missing" => {
  const v = images.get(src);
  return v === "error" ? "error" : v ? "loaded" : imageLoads.has(src) ? "loading" : "missing";
};

/** Natural size (px) of a decoded image, or undefined while it is not loaded (or failed). */
export const imageSize = (src: string): { w: number; h: number } | undefined => {
  const v = images.get(src);
  return v && v !== "error" ? { w: v.w, h: v.h } : undefined;
};
// Layout stays pure: it only sees this accessor (tests inject their own).
setImageSizer(imageSize);

/* ----------------------------------------------------------------- preload */

/** Every distinct value a bound property takes across the base tree, variants and label overrides. */
function boundValues(t: Template, raw: Pick<Label, "values" | "overrides">, context: RenderContext) {
  // Template rules may set icons / images (same as layout() sees).
  const label = resolveLabel(t, raw) ?? raw;
  const values = { ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...label.values };
  context = labelContext(t, raw as { id?: string }, values, context);
  const out: { node: LabelNode; value: string }[] = [];
  walk(t.root, (n) => {
    const key = (BOUND_PROPS as Record<string, string>)[n.type];
    if (!key) return;
    const variants = [n, ...(t.variants ?? []).map((v) => v.patches[n.id]), label.overrides?.[n.id]].filter(Boolean) as Partial<LabelNode>[];
    // Flags such as `filled` may be patched too (label overrides win over variants).
    const merged = Object.assign({}, ...variants) as LabelNode;
    for (const p of variants) {
      const raw = (p as Record<string, unknown>)[key];
      if (typeof raw !== "string") continue;
      const value = fillPlaceholders(raw, values, context);
      // Variants may only apply at some sizes: load for the base node and the fully patched one.
      out.push({ node: merged, value });
      if (merged !== n) out.push({ node: n, value });
    }
  });
  return out;
}

async function loadImage(src: string) {
  if (images.has(src)) return;
  let p = imageLoads.get(src);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(assetUrl(src));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let blob = await res.blob();
        let size: { w: number; h: number } | null = null;
        if (blob.type.includes("svg") || /\.svg($|\?)/i.test(src)) {
          const fixed = sizedSvg(await blob.text());
          size = fixed.size;
          blob = new Blob([fixed.svg], { type: "image/svg+xml" });
        }
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        images.set(src, { img, w: size?.w || img.naturalWidth || 100, h: size?.h || img.naturalHeight || 100 });
      } catch (e) {
        console.warn(`image ${src.slice(0, 80)} failed to load`, e);
        images.set(src, "error");
      } finally {
        imageLoads.delete(src);
      }
    })();
    imageLoads.set(src, p);
  }
  await p;
}

/** Give an SVG explicit width/height (from its viewBox) so browsers rasterise it at any size. */
export function sizedSvg(svg: string): { svg: string; size: { w: number; h: number } | null } {
  const m = /<svg\b([^>]*)>/i.exec(svg);
  if (!m) return { svg, size: null };
  const attrs = m[1];
  const get = (k: string) => new RegExp(`\\s${k}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
  const vb = get("viewBox")?.split(/[\s,]+/).map(Number);
  const w = parseFloat(get("width") ?? "") || vb?.[2] || 0;
  const h = parseFloat(get("height") ?? "") || vb?.[3] || 0;
  if (!w || !h) return { svg, size: null };
  const pct = (v?: string) => !v || /%$/.test(v);
  let head = attrs;
  if (pct(get("width"))) head = head.replace(/\swidth\s*=\s*["'][^"']*["']/i, "") + ` width="${w}"`;
  if (pct(get("height"))) head = head.replace(/\sheight\s*=\s*["'][^"']*["']/i, "") + ` height="${h}"`;
  return { svg: svg.replace(m[0], `<svg${head}>`), size: { w, h } };
}

async function loadIcon(name: string, filled: boolean) {
  const key = iconKey(name, filled);
  const src = iconSource();
  // A failed load is not for good: ask again after a while (a server restart, an icon uploaded later).
  if (icons.get(key) === "error" && Date.now() - (iconFailed.get(key) ?? Infinity) > 15_000) icons.delete(key);
  if (icons.has(key) || !src || !name) return;
  // Ill-formed ids (e.g. an unfilled field) paint the placeholder without a request.
  if (!parseIconId(name)) return void icons.set(key, "error");
  let p = iconLoads.get(key);
  if (!p) {
    p = src(name, filled)
      .then((svg) => void icons.set(key, parseIconSvg(svg)))
      .catch((e) => {
        console.warn(`icon ${name} failed to load`, e);
        icons.set(key, "error");
        iconFailed.set(key, Date.now());
      })
      .finally(() => iconLoads.delete(key));
    iconLoads.set(key, p);
  }
  await p;
}

/** Load everything the template needs for these labels before rendering. */
export async function preloadAssets(raw: Template, labels: Pick<Label, "values">[] = [], context: RenderContext = {}): Promise<void> {
  // Components and styles as layout sees them (their icons, images and fonts load too).
  const template = resolveTemplate(raw);
  const jobs: Promise<void>[] = [];
  let codes = false;
  for (const label of labels.length ? labels : [{ values: {} }]) {
    for (const { node, value } of boundValues(template, label as Pick<Label, "values" | "overrides">, context)) {
      if (node.type === "image" && value) jobs.push(loadImage(value));
      else if (node.type === "icon" && value) jobs.push(loadIcon(value.trim(), !!node.filled));
      else if (node.type === "code") codes = true;
    }
  }
  // Inline icons in rich text and table cells.
  for (const label of labels.length ? labels : [{ values: {} }]) for (const id of inlineIconIds(template, label as Pick<Label, "values" | "overrides">)) jobs.push(loadIcon(id, false));
  if (codes && !codeEncoderReady()) jobs.push(loadCodeEncoder().catch((e) => console.warn("barcode encoder failed to load", e)));
  await Promise.all(jobs);
}

/* ---------------------------------------------------------------- painting */

/** Placeholder: crossed box, so missing content is obvious on screen. */
function placeholder(ctx: CanvasRenderingContext2D, b: PxBox) {
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.moveTo(b.x + b.w, b.y);
  ctx.lineTo(b.x, b.y + b.h);
  ctx.stroke();
}

/**
 * Run `draw` in the node's rotated frame. The inner box starts at (0, 0) and
 * has width/height swapped for 90/270; all offsets stay on whole dots.
 */
function rotated(ctx: CanvasRenderingContext2D, rot: Rotation | undefined, b: PxBox, draw: (w: number, h: number) => void) {
  ctx.save();
  ctx.translate(b.x, b.y);
  switch (rot ?? 0) {
    case 90:
      ctx.translate(b.w, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(b.w, b.h);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, b.h);
      ctx.rotate(-Math.PI / 2);
      break;
  }
  const turned = rot === 90 || rot === 270;
  draw(turned ? b.h : b.w, turned ? b.w : b.h);
  ctx.restore();
}

/** ctx paint (fill/stroke style + composite op) is already set by the caller. */
export function paintImage(ctx: CanvasRenderingContext2D, n: ImageNode, b: PxBox, _dpmm: number, src: string) {
  if (b.w < 1 || b.h < 1) return;
  const hit = src ? images.get(src) : undefined;
  if (!hit || hit === "error") return placeholder(ctx, b);
  rotated(ctx, n.rotate, b, (w, h) => {
    const key = ["img", src, w, h, n.fit, n.dither, n.threshold ?? 128, n.invertImage ? 1 : 0].join("\u0000");
    const m =
      masks.get(key) ??
      remember(key, (() => {
        const c = makeCanvas(w, h);
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "high";
        const r = fitRect(hit.w, hit.h, w, h, n.fit);
        x.drawImage(hit.img, r.x, r.y, r.w, r.h);
        const mask = ditherImage(x.getImageData(0, 0, w, h), { method: n.dither, threshold: n.threshold, invert: n.invertImage });
        return { mask, w, h };
      })());
    paintMask(ctx, m.mask, m.w, m.h, 0, 0);
  });
}

export function paintIcon(ctx: CanvasRenderingContext2D, n: IconNode, b: PxBox, dpmm: number, icon: string) {
  const name = icon.trim();
  const data = icons.get(iconKey(name, !!n.filled));
  if (!data || data === "error") return placeholder(ctx, b);
  rotated(ctx, n.rotate, b, (w, h) => {
    const size = Math.min(w, h);
    if (size < 1) return;
    const strokePx = n.strokeMm ? Math.max(1, n.strokeMm * dpmm) : undefined;
    const key = ["icon", name, n.filled ? 1 : 0, size, strokePx ?? ""].join("\u0000");
    const m =
      masks.get(key) ??
      remember(key, (() => {
        const c = makeCanvas(size, size);
        drawIcon(c.getContext("2d", { willReadFrequently: true })!, data, size, strokePx);
        return { mask: maskOf(c), w: size, h: size };
      })());
    paintMask(ctx, m.mask, m.w, m.h, Math.floor((w - size) / 2), Math.floor((h - size) / 2));
  });
}

/** Inline icon (rich text, table cells): a `size` px square at (x, y); ctx paint is set by the caller. */
export function paintIconAt(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, size: number) {
  const name = icon.trim();
  const s = Math.round(size);
  if (s < 1) return;
  const [px, py] = [Math.round(x), Math.round(y)];
  const data = icons.get(iconKey(name, false));
  if (!data || data === "error") return placeholder(ctx, { x: px, y: py, w: s, h: s });
  const key = ["icon", name, 0, s, ""].join("\u0000");
  const m =
    masks.get(key) ??
    remember(key, (() => {
      const c = makeCanvas(s, s);
      drawIcon(c.getContext("2d", { willReadFrequently: true })!, data, s);
      return { mask: maskOf(c), w: s, h: s };
    })());
  paintMask(ctx, m.mask, m.w, m.h, px, py);
}

/** What the code painter did, for preflight checks (dots, canvas coordinates). */
export interface CodeFacts {
  /** Nothing to encode (empty value): nothing printed. */
  empty?: boolean;
  /** Encoder not loaded yet: placeholder painted, facts unknown. */
  pending?: boolean;
  /** The value can't be encoded in this format (plain-language reason). */
  error?: string;
  /** Not even a 1-dot module fits the box. */
  tooSmall?: boolean;
  /** Module width / height in dots. */
  module?: number;
  moduleH?: number;
  /** Symbol bounds (bars / modules only) on the canvas. */
  symbol?: PxBox;
  /** Standard quiet zone for the format (modules) and whether the node reserves it. */
  quietModules: number;
  quietZone: boolean;
}

/** Map a rect from a node's rotated frame (inner size w x h) back to canvas coordinates. */
function unrotate(r: PxBox, rot: Rotation | undefined, b: PxBox, w: number, h: number): PxBox {
  switch (rot ?? 0) {
    case 90:
      return { x: b.x + h - (r.y + r.h), y: b.y + r.x, w: r.h, h: r.w };
    case 180:
      return { x: b.x + w - (r.x + r.w), y: b.y + h - (r.y + r.h), w: r.w, h: r.h };
    case 270:
      return { x: b.x + r.y, y: b.y + w - (r.x + r.w), w: r.h, h: r.w };
    default:
      return { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h };
  }
}

export function paintCode(ctx: CanvasRenderingContext2D, n: CodeNode, b: PxBox, dpmm: number, value: string): CodeFacts {
  const facts: CodeFacts = { quietModules: quietModules(n.format), quietZone: !!n.quietZone };
  // Nothing to encode (e.g. an empty field): print nothing rather than a placeholder cross.
  if (!value.trim()) return { ...facts, empty: true };
  const enc = encodeCode(n.format, value, n.ecc);
  if (!enc || enc instanceof Error) {
    placeholder(ctx, b);
    return enc ? { ...facts, error: friendlyCodeError(n.format, enc) } : { ...facts, pending: true };
  }
  rotated(ctx, n.rotate, b, (w, h) => {
    const l = layoutCode(enc, w, h, { showText: n.showText && !is2d(n.format), dpmm, quiet: n.quietZone ? facts.quietModules : 0 });
    if (!l) {
      facts.tooSmall = true;
      return placeholder(ctx, { x: 0, y: 0, w, h });
    }
    facts.module = l.module;
    facts.moduleH = l.moduleH;
    facts.symbol = unrotate(l.bounds, n.rotate, b, w, h);
    for (const r of l.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    for (const t of l.texts) {
      ctx.font = `${t.px}px monospace`;
      ctx.textAlign = t.align;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t.str, t.x, t.y);
    }
  });
  return facts;
}
