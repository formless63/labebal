"use client";
/**
 * Folders, favourites and pins for the label list.
 *
 * - Folders are derived from label tags: a tag `folder:Drawers/Screws` puts the
 *   label in that folder (one per label, `/` nests). No schema change, and
 *   other systems can set folders through the API's `tags`.
 * - Favourites, pins and open folders are per person: on the server for a
 *   signed-in user, else in this browser. Empty folders created here are
 *   shared with the team. Both synced by features/settings/sync.tsx.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Label } from "@labebal/core";

export const FOLDER_TAG = "folder:";

export const folderOf = (l: Pick<Label, "tags">): string => {
  const t = l.tags?.find((x) => x.startsWith(FOLDER_TAG));
  return t ? normalizeFolder(t.slice(FOLDER_TAG.length)) : "";
};

export const normalizeFolder = (path: string) =>
  path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");

/** The label with its folder tag replaced ("" = no folder). */
export function withFolder(l: Label, path: string): Label {
  const p = normalizeFolder(path);
  const tags = (l.tags ?? []).filter((t) => !t.startsWith(FOLDER_TAG));
  if (p) tags.push(FOLDER_TAG + p);
  const { tags: _old, ...rest } = l;
  void _old;
  return tags.length ? { ...rest, tags } : rest;
}

/** Tags shown as tags (without the folder tag). */
export const plainTags = (l: Pick<Label, "tags">) => (l.tags ?? []).filter((t) => !t.startsWith(FOLDER_TAG));

export interface FolderNode {
  path: string;
  name: string;
  depth: number;
  /** Labels in this folder and below. */
  count: number;
}

/** Every folder (and parent folder) in use, sorted as a tree. */
export function folderTree(labels: Pick<Label, "tags">[]): FolderNode[] {
  const counts = new Map<string, number>();
  for (const l of labels) {
    const f = folderOf(l);
    if (!f) continue;
    const parts = f.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((path) => ({ path, name: path.split("/").pop()!, depth: path.split("/").length - 1, count: counts.get(path)! }));
}

/** In `folder` or one of its subfolders. */
export const inFolder = (l: Pick<Label, "tags">, folder: string) => {
  const f = folderOf(l);
  return f === folder || f.startsWith(folder + "/");
};

export interface TreeFolder {
  path: string;
  name: string;
  depth: number;
  folders: TreeFolder[];
  labels: Label[];
  /** Labels in this folder and below. */
  count: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Labels arranged as a folder tree (root = path ""). `extra` adds folders that
 * have no labels yet (created in this browser, kept until something is moved in).
 */
export function buildTree(labels: Label[], extra: string[] = []): TreeFolder {
  const root: TreeFolder = { path: "", name: "", depth: -1, folders: [], labels: [], count: 0 };
  const index = new Map<string, TreeFolder>([["", root]]);
  const ensure = (path: string): TreeFolder => {
    const hit = index.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf("/");
    const parent = ensure(cut < 0 ? "" : path.slice(0, cut));
    const node: TreeFolder = { path, name: path.slice(cut + 1), depth: parent.depth + 1, folders: [], labels: [], count: 0 };
    parent.folders.push(node);
    index.set(path, node);
    return node;
  };
  for (const p of extra) if (normalizeFolder(p)) ensure(normalizeFolder(p));
  for (const l of labels) ensure(folderOf(l)).labels.push(l);
  const sort = (n: TreeFolder): number => {
    n.folders.sort((a, b) => byName(a.name, b.name));
    n.labels.sort((a, b) => byName(a.name, b.name));
    return (n.count = n.labels.length + n.folders.reduce((sum, c) => sum + sort(c), 0));
  };
  sort(root);
  return root;
}

/** Folder path of `l` after renaming folder `from` to `to` (subfolders move with it); null if unaffected. */
export function renamedFolder(l: Pick<Label, "tags">, from: string, to: string): string | null {
  const f = folderOf(l);
  if (f !== from && !f.startsWith(from + "/")) return null;
  return normalizeFolder(normalizeFolder(to) + f.slice(from.length));
}

/** Parent folders of a path, outermost first ("A/B/C" -> ["A", "A/B"]). */
export const ancestors = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
};

interface LibraryPrefs {
  favourites: string[];
  pinned: string[];
  /** Folders expanded in the label tree. */
  openFolders: string[];
  /** Folders created here that have no labels yet. */
  newFolders: string[];
  toggleFavourite: (id: string) => void;
  togglePin: (id: string) => void;
  setFolderOpen: (path: string, open: boolean) => void;
  addFolder: (path: string) => void;
  dropNewFolder: (path: string) => void;
}

export const useLibraryPrefs = create<LibraryPrefs>()(
  persist(
    (set, get) => ({
      favourites: [],
      pinned: [],
      toggleFavourite: (id) => set({ favourites: get().favourites.includes(id) ? get().favourites.filter((x) => x !== id) : [...get().favourites, id] }),
      togglePin: (id) => set({ pinned: get().pinned.includes(id) ? get().pinned.filter((x) => x !== id) : [...get().pinned, id] }),
      openFolders: [],
      newFolders: [],
      setFolderOpen: (path, open) => {
        const rest = get().openFolders.filter((p) => p !== path);
        set({ openFolders: open ? [...rest, path] : rest });
      },
      addFolder: (path) => {
        const p = normalizeFolder(path);
        if (p && !get().newFolders.includes(p)) set({ newFolders: [...get().newFolders, p] });
      },
      dropNewFolder: (path) => set({ newFolders: get().newFolders.filter((p) => p !== path) }),
    }),
    { name: "labebal:library-prefs" },
  ),
);
