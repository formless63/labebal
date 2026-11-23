"use client";
/**
 * Registers the app's icon source with the core renderer (SVGs from
 * /api/icons/<id>, any set). Import for its side effect wherever labels are rendered.
 */
import { setIconSource } from "@labebal/core";
import { apiRoot } from "../../lib/base";

export const iconsApi = () => `${apiRoot()}/icons`;

export interface IconHit {
  /** Value for an icon node: `set:name` (Tabler: plain name). */
  id: string;
  name: string;
  set: string;
  filled: boolean;
}

export interface IconSetInfo {
  id: string;
  label: string;
  title: string;
  count: number;
  license: { title: string; spdx?: string; url?: string };
  author?: { name: string; url?: string };
  filled: boolean;
  note?: string;
}

/** Search icons by name / alias / tags; `set` = "all" (default) or a set id. */
export async function searchIcons(q: string, opts: { set?: string; limit?: number } = {}): Promise<IconHit[]> {
  const sp = new URLSearchParams({ q, limit: String(opts.limit ?? 60) });
  if (opts.set && opts.set !== "all") sp.set("set", opts.set);
  const res = await fetch(`${iconsApi()}?${sp}`);
  if (!res.ok) throw new Error(`icon search failed: ${res.status}`);
  return res.json();
}

export async function fetchIconSets(): Promise<IconSetInfo[]> {
  const res = await fetch(`${iconsApi()}/sets`);
  if (!res.ok) throw new Error(`icon sets failed: ${res.status}`);
  return res.json();
}

/** SVG URL for an icon id (`:` is percent-encoded). */
export const iconUrl = (id: string, filled = false) => `${iconsApi()}/${encodeURIComponent(id)}${filled ? "?filled=1" : ""}`;

if (typeof window !== "undefined")
  setIconSource(async (id, filled) => {
    const res = await fetch(iconUrl(id, filled));
    if (!res.ok) throw new Error(`icon ${id}: ${res.status}`);
    return res.text();
  });
