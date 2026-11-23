"use client";
/**
 * Icon favourites and recently used icons. Kept in localStorage; for a
 * signed-in user the settings sync also keeps them on the server, per person.
 */
import { useSyncExternalStore } from "react";

const KEY = "labebal.icons.v1";
const MAX_RECENT = 24;

export interface IconPrefs {
  favourites: string[];
  recent: string[];
}

const EMPTY: IconPrefs = { favourites: [], recent: [] };
let cache: IconPrefs | null = null;
const listeners = new Set<() => void>();

function read(): IconPrefs {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<IconPrefs> | null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    cache = { favourites: list(v?.favourites), recent: list(v?.recent) };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: IconPrefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: keep the in-memory copy.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};

export const useIconPrefs = () => useSyncExternalStore(subscribe, read, () => EMPTY);

/** For the settings sync (features/settings/sync.ts): signed-in users keep these on the server. */
export const readIconPrefs = read;
export const setIconPrefs = (next: IconPrefs) => {
  const cur = read();
  if (JSON.stringify(cur) !== JSON.stringify(next)) write(next);
};
export function onIconPrefsChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function toggleFavourite(id: string) {
  const p = read();
  write({ ...p, favourites: p.favourites.includes(id) ? p.favourites.filter((x) => x !== id) : [id, ...p.favourites] });
}

export function addRecent(id: string) {
  if (!id || id.includes("{{")) return;
  const p = read();
  write({ ...p, recent: [id, ...p.recent.filter((x) => x !== id)].slice(0, MAX_RECENT) });
}

/** Forget a deleted custom icon. */
export function forgetIcon(id: string) {
  const p = read();
  write({ favourites: p.favourites.filter((x) => x !== id), recent: p.recent.filter((x) => x !== id) });
}
