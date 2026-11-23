"use client";
/** Custom SVG icons: assets of kind "icon", used as `custom:<assetId>`. */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { CUSTOM_ICON_SET, formatIconId } from "@labebal/core";
import { apiRoot } from "../../lib/base";

export interface CustomIconAsset {
  id: string;
  name: string;
  size: number;
  meta: { title?: string } & Record<string, unknown>;
}

export const CUSTOM_ICONS_KEY = ["icon-assets"] as const;

export const customIconId = (assetId: string) => formatIconId(CUSTOM_ICON_SET, assetId);
export const customIconTitle = (a: Pick<CustomIconAsset, "name" | "meta">) => (typeof a.meta.title === "string" && a.meta.title.trim()) || a.name.replace(/\.svg$/i, "");

export const useCustomIcons = () =>
  useQuery({
    queryKey: CUSTOM_ICONS_KEY,
    queryFn: async (): Promise<CustomIconAsset[]> => {
      const r = await fetch(`${apiRoot()}/assets?kind=icon`);
      if (!r.ok) throw new Error(`icons: ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
  });

const failed = async (r: Response) => {
  const body = (await r.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `${r.status} ${r.statusText}`);
};

/** Upload one SVG (sanitised server-side). Title defaults to the file name. */
export async function uploadCustomIcon(file: File, title?: string): Promise<CustomIconAsset> {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("kind", "icon");
  fd.set("meta", JSON.stringify({ title: title ?? file.name.replace(/\.svg$/i, "") }));
  const r = await fetch(`${apiRoot()}/assets`, { method: "POST", body: fd });
  if (!r.ok) throw await failed(r);
  return r.json();
}

export async function renameCustomIcon(a: CustomIconAsset, title: string) {
  const r = await fetch(`${apiRoot()}/assets/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...a.meta, title }) });
  if (!r.ok) throw await failed(r);
}

export async function deleteCustomIcon(id: string) {
  const r = await fetch(`${apiRoot()}/assets/${id}`, { method: "DELETE" });
  if (!r.ok) throw await failed(r);
}

/** Refresh everything that lists icons after a change. */
export const invalidateIcons = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: CUSTOM_ICONS_KEY }), qc.invalidateQueries({ queryKey: ["icons"] }), qc.invalidateQueries({ queryKey: ["icon-sets"] })]);
