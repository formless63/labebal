"use client";
/** Icon search and the icon source the core renderer draws from (SVGs from /api/icons/<id>, any set). */
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tell the core renderer where icons come from. Called by the app's entry
 * (client.tsx): the package is marked side-effect free, so a bundler drops a
 * module that only registers itself when imported.
 */
export function registerIconSource() {
  if (typeof window === "undefined") return;
  setIconSource(async (id, filled) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(iconUrl(id, filled));
        if (res.ok) return await res.text();
        // Unknown icon: no point asking again. Server busy or restarting: try again.
        if (res.status < 500 || attempt >= 2) throw Object.assign(new Error(`icon ${id}: ${res.status}`), { final: true });
      } catch (err) {
        if ((err as { final?: boolean }).final || attempt >= 2) throw err;
      }
      await wait(400 * 2 ** attempt);
    }
  });
}
