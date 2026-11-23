"use client";
/**
 * Uploaded fonts: stored as assets (kind "font") with meta
 * `{ family, pixel?: { pxPerEm, linePx } }`, registered with the core font
 * registry so the renderer and font pickers see them.
 */
import { useQuery } from "@tanstack/react-query";
import { BUILTIN_FONTS, loadFonts, registerFont, restoreBuiltinFont, uploadedFamily, type FontDef, type PixelFont } from "@labebal/core";
import { apiRoot } from "../../lib/base";

export interface FontAsset {
  id: string;
  name: string;
  kind: "font";
  mime: string;
  size: number;
  url: string;
  meta: FontMeta;
}

export interface FontMeta {
  family?: string;
  pixel?: PixelFont;
  /** The user chose to use this font instead of the built-in font with the same name. */
  replaceBuiltin?: boolean;
}

export const FONTS_KEY = ["assets", "font"] as const;

/** The family name stored with / read from the font file (before clash handling). */
export const familyOf = (a: Pick<FontAsset, "name" | "meta">) => a.meta?.family?.trim() || a.name.replace(/\.(ttf|otf|woff2?)$/i, "");

/** Registered family: gets " (uploaded)" when it would shadow a built-in font, unless the user chose to replace it. */
export const fontDefOf = (a: FontAsset): FontDef => ({ family: uploadedFamily(familyOf(a), !!a.meta?.replaceBuiltin), url: a.url, pixel: validPixel(a.meta?.pixel) });

const validPixel = (p: PixelFont | undefined) =>
  p && p.pxPerEm > 0 && p.linePx > 0 ? { pxPerEm: Math.round(p.pxPerEm), linePx: Math.round(p.linePx) } : undefined;

export async function fetchFontAssets(): Promise<FontAsset[]> {
  const res = await fetch(`${apiRoot()}/assets?kind=font`);
  if (!res.ok) throw new Error(`fonts: ${res.status}`);
  return res.json();
}

/** Register (and load into the document) uploaded fonts. */
export async function registerFontAssets(assets: FontAsset[]) {
  const defs = assets.map((a) => registerFont(fontDefOf(a), { replace: !!a.meta?.replaceBuiltin }));
  // Built-ins no longer replaced by an upload (deleted, or replacing switched off) come back.
  const restored = BUILTIN_FONTS.filter((b) => !defs.some((d) => d.family === b.family)).map((b) => b.family);
  restored.forEach(restoreBuiltinFont);
  await loadFonts([...defs.map((d) => d.family), ...restored]);
  return defs;
}

let ready: Promise<void> | null = null;
/** Resolves once uploaded fonts are registered and loaded (never rejects). */
export function uploadedFontsReady(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  ready ??= fetchFontAssets()
    .then(registerFontAssets)
    .then(() => undefined)
    .catch((e) => console.warn("uploaded fonts not loaded", e));
  return ready;
}

/** Uploaded font assets (registered as a side effect). */
export function useFontAssets() {
  return useQuery({
    queryKey: FONTS_KEY,
    queryFn: async () => {
      const assets = await fetchFontAssets();
      await registerFontAssets(assets);
      return assets;
    },
    staleTime: 60_000,
  });
}

/** Every font a label can use: built-in + uploaded (for font pickers). */
export function useFonts(): FontDef[] {
  const { data } = useFontAssets();
  const uploaded = (data ?? []).map(fontDefOf);
  const names = new Set(uploaded.map((f) => f.family));
  return [...BUILTIN_FONTS.filter((f) => !names.has(f.family)), ...uploaded];
}

const MIME: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };

/** Read a font file: family name + pixel grid (best effort; WOFF2 can't be parsed). */
export async function inspectFontFile(file: File): Promise<FontMeta> {
  const fallback = file.name.replace(/\.(ttf|otf|woff2?)$/i, "");
  try {
    const { inspectFont } = await import("@labebal/core/fontgrid"); // opentype.js: only load when needed
    const info = inspectFont(await file.arrayBuffer());
    return { family: info.family || fallback, pixel: info.pixel };
  } catch {
    return { family: fallback };
  }
}

export async function uploadFont(file: File, meta: FontMeta): Promise<FontAsset> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typed = new File([file], file.name, { type: MIME[ext] ?? (file.type || "font/ttf") });
  const form = new FormData();
  form.set("file", typed);
  form.set("kind", "font");
  form.set("meta", JSON.stringify(meta));
  const res = await fetch(`${apiRoot()}/assets`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `upload failed: ${res.status}`);
  return res.json();
}

export async function saveFontMeta(id: string, meta: FontMeta) {
  const res = await fetch(`${apiRoot()}/assets/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

export async function deleteFontAsset(id: string) {
  const res = await fetch(`${apiRoot()}/assets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
