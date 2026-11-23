import { desc, eq } from "drizzle-orm";
import { sanitizeSvg } from "@labebal/core";
import { getDb } from "../db";
import { assets } from "../db/schema";

/** `icon`: sanitised SVGs used as `custom:<id>` icons. */
export type AssetKind = "image" | "font" | "icon";
export const ASSET_KINDS: readonly AssetKind[] = ["image", "font", "icon"];
export interface AssetInfo {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
  meta: Record<string, unknown>;
  url: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED: Record<AssetKind, RegExp> = {
  image: /^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/,
  font: /^(font\/(ttf|otf|woff2?)|application\/(x-font-ttf|x-font-otf|font-woff|octet-stream))$/,
  icon: /^image\/svg\+xml$/,
};
const MAX_ICON_BYTES = 512 * 1024;

const info = ({ id, name, kind, mime, size, meta }: Omit<typeof assets.$inferSelect, "data" | "createdAt">): AssetInfo => ({ id, name, kind, mime, size, meta, url: `/api/assets/${id}` });

export async function listAssets(kind?: AssetKind) {
  const db = await getDb();
  const cols = { id: assets.id, name: assets.name, kind: assets.kind, mime: assets.mime, size: assets.size, meta: assets.meta };
  const q = db.select(cols).from(assets).orderBy(desc(assets.createdAt));
  return (kind ? await q.where(eq(assets.kind, kind)) : await q).map(info);
}

export async function getAsset(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  return row;
}

export async function createAsset(file: File, kind: AssetKind, meta: Record<string, unknown> = {}) {
  if (file.size > MAX_BYTES) throw new Error("file too large (max 8 MB)");
  const svgName = /\.svg$/i.test(file.name);
  const mime = (kind === "icon" && svgName ? "image/svg+xml" : file.type) || (kind === "font" ? "font/ttf" : "application/octet-stream");
  if (!ALLOWED[kind].test(mime)) throw new Error(`unsupported ${kind} type: ${mime}`);
  let data = Buffer.from(await file.arrayBuffer());
  if (kind === "icon") {
    // Untrusted markup: keep only shapes and presentation attributes.
    if (data.length > MAX_ICON_BYTES) throw new Error("icon too large (max 512 kB)");
    const clean = sanitizeSvg(data.toString("utf8"));
    if (!clean) throw new Error("no drawable shapes found in this SVG");
    data = Buffer.from(clean, "utf8");
  }
  const db = await getDb();
  const row = {
    id: `a-${crypto.randomUUID()}`,
    name: file.name,
    kind,
    mime,
    size: data.length,
    data,
    meta,
  };
  await db.insert(assets).values(row);
  return info(row);
}

export async function updateAssetMeta(id: string, meta: Record<string, unknown>) {
  const db = await getDb();
  await db.update(assets).set({ meta }).where(eq(assets.id, id));
}

export async function deleteAsset(id: string) {
  const db = await getDb();
  await db.delete(assets).where(eq(assets.id, id));
}
