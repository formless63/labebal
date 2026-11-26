/**
 * Font registry.
 *
 * Pixel fonts look bad when scaled by an arbitrary factor and thresholded to
 * 1-bit: edges land mid-dot and leave stray nubs. For fonts registered here the
 * renderer rasterises text at the font's native pixel size (every outline sits
 * on the grid) and scales that bitmap up dot-for-dot.
 *
 * `pxPerEm` = unitsPerEm / grid step. Measure a font with
 * `detectPixelGrid(buffer)` (fontgrid.ts) or
 * `tsx packages/core/scripts/font-grid.ts font.ttf`.
 */
export interface PixelFont {
  /** Font pixels per em: the px size at which one font pixel = one canvas pixel. */
  pxPerEm: number;
  /** Baseline-to-baseline distance in font pixels. */
  linePx: number;
}

export interface FontDef {
  family: string;
  /** URL of the font file (served statically or from asset storage). */
  url: string;
  pixel?: PixelFont;
}

const registry = new Map<string, FontDef>();
/** Families of the built-in fonts (authoritative unless explicitly replaced). */
const builtinFamilies = new Set<string>();

/** Suffix given to an uploaded font whose family name clashes with a built-in or system font. */
export const UPLOADED_SUFFIX = " (uploaded)";

/** True for built-in (bundled) and generic system font families. */
export const isBuiltinFont = (family: string) => builtinFamilies.has(family) || SYSTEM_FONTS.includes(family);

/**
 * Family name an uploaded font is registered under: its own name, or with
 * " (uploaded)" appended when that would shadow a built-in / system font
 * (unless `replace` is set, i.e. the user explicitly chose to replace it).
 */
export const uploadedFamily = (family: string, replace = false) => (!replace && isBuiltinFont(family) ? family + UPLOADED_SUFFIX : family);

/**
 * Register a font. Built-in families are never silently overwritten: a clashing
 * font is registered as "<family> (uploaded)" unless `opts.replace` is set.
 * Returns the definition actually registered (use its `family`).
 */
export function registerFont(def: FontDef, opts: { replace?: boolean } = {}): FontDef {
  const own = registry.get(def.family);
  const clash = isBuiltinFont(def.family) && !(own && own.url === def.url);
  const out = clash && !opts.replace ? { ...def, family: def.family + UPLOADED_SUFFIX } : def;
  registry.set(out.family, out);
  return out;
}

export const fontDef = (family: string) => registry.get(family);
export const pixelFont = (family: string) => registry.get(family)?.pixel;
export const registeredFonts = () => [...registry.values()];

/**
 * Printer dots per font pixel for a wanted scale `k` (dots per font pixel,
 * usually fractional): the nearest whole number, at least 1. A pixel font drawn
 * at a fractional scale gets uneven strokes (some font pixels 1 dot wide, others
 * 2) and loses its look, so every pixel-font size decision goes through here.
 * Below half a dot per font pixel nothing faithful can be drawn and `k` is
 * returned unchanged (preflight flags it).
 */
export const wholePixelScale = (k: number) => (k < 0.5 ? k : Math.max(1, Math.round(k)));

/**
 * Largest whole scale that fits in `room` (dots per font pixel available), or
 * `room` itself when not even 1 fits.
 */
export const fittingPixelScale = (room: number) => (room >= 1 ? Math.floor(room + 1e-6) : room);

/** Built-in fonts (served from /fonts in the app). Brand and pixel fonts come as uploads or with a pack (installed as font assets). */
export const BUILTIN_FONTS: FontDef[] = [
  // Label fonts (SIL OFL, variable weight: 600-800 prints solid on 203 dpi thermal; licences in assets/fonts/licenses).
  { family: "Atkinson Hyperlegible Next", url: "/fonts/AtkinsonHyperlegibleNext.ttf" },
  { family: "Roboto Condensed", url: "/fonts/RobotoCondensed.ttf" },
  { family: "JetBrains Mono", url: "/fonts/JetBrainsMono.ttf" },
];
/** Default font for new text: legible at small sizes on thermal printers. */
export const LABEL_FONT = "Atkinson Hyperlegible Next";
/** Generic families that are always available without loading. */
export const SYSTEM_FONTS = ["sans-serif", "serif", "monospace", "Arial", "Verdana", "Georgia", "Courier New", "Impact"];

for (const f of BUILTIN_FONTS) {
  registry.set(f.family, f);
  builtinFamilies.add(f.family);
}

/** Put a built-in font back after it was replaced (e.g. the replacing upload was deleted). */
export function restoreBuiltinFont(family: string) {
  const f = BUILTIN_FONTS.find((b) => b.family === family);
  if (f) registry.set(f.family, f);
}

/**
 * Load registered fonts into the document (browser only). Uses a single
 * weight range so the browser never synthesises bold on single-face fonts.
 */
const faces = new Map<string, { url: string; face: FontFace }>();

let fontBase = "";
/**
 * Where the built-in fonts are served (their `url` is "/fonts/<file>"): the
 * app calls this once, e.g. setFontBase("/labels/api/static"). Default "" =
 * the site root.
 */
export const setFontBase = (base: string) => {
  fontBase = base.replace(/\/+$/, "");
};
let apiBase = "";
/**
 * Where labebal's API is mounted, e.g. setAssetBase("/labels/api"). Stored
 * documents keep the portable "/api/assets/<id>" form, and this prefix is
 * applied when the browser loads one. Default "" = "/api" at the site root.
 */
export const setAssetBase = (base: string) => {
  apiBase = base.replace(/\/+$/, "");
};
/**
 * A stored font or picture URL as the browser should load it: built-in fonts
 * ("/fonts/...") and uploaded assets ("/api/assets/...") follow the mount;
 * anything else (data:, https:, blob:) is unchanged.
 */
export const assetUrl = (url: string) => {
  if (url.startsWith("/fonts/")) return fontBase + url;
  if (apiBase && url.startsWith("/api/assets/")) return apiBase + url.slice(4);
  return url;
};
/** A font's URL as the browser should load it. */
export const fontUrl = assetUrl;

export async function loadFonts(families?: string[]) {
  if (typeof document === "undefined") return;
  const wanted = families ? registeredFonts().filter((f) => families.includes(f.family)) : registeredFonts();
  await Promise.all(
    wanted.map(async (f) => {
      const mine = faces.get(f.family);
      if (mine?.url === f.url) return;
      if (!mine && [...document.fonts].some((ff) => ff.family.replace(/"/g, "") === f.family && ff.status === "loaded")) return;
      const face = new FontFace(f.family, `url(${fontUrl(f.url)})`, { weight: "100 900" });
      try {
        await face.load();
        // A replaced font (same family, other file): drop the old face first.
        if (mine) document.fonts.delete(mine.face);
        document.fonts.add(face);
        faces.set(f.family, { url: f.url, face });
      } catch (e) {
        console.warn(`font ${f.family} failed to load`, e);
      }
    }),
  );
}
