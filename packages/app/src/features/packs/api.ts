"use client";
/** Packs: TanStack Query hooks over /api/packs (see server/packs.ts). */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LIBRARY_KEY } from "../labels/api";
import { FONTS_KEY } from "../fonts/fonts-client";
import { json, send } from "../data/api";
import type { LibraryWithPacks, PackSourceView, PacksView, RemovePlanView, SyncResult } from "./types";
import { apiRoot } from "../../lib/base";

export const PACKS_KEY = ["packs"] as const;

export function usePacks() {
  return useQuery({ queryKey: PACKS_KEY, queryFn: () => fetch(`${apiRoot()}/packs`).then((r) => json<PacksView>(r)) });
}

/** Pack name + "changed here" for a library item (from the library's pack overlay). */
export function packOf(lib: LibraryWithPacks | undefined, kind: "template" | "label", id: string) {
  const it = lib?.packs?.items[`${kind}:${id}`];
  if (!it) return null;
  const p = lib!.packs!.packs.find((x) => x.id === it.pack);
  return { id: it.pack, name: p?.name ?? it.pack, version: p?.version ?? "", changed: it.changed };
}

export function usePackActions() {
  const qc = useQueryClient();
  const after = async (libraryToo = true) => {
    await qc.invalidateQueries({ queryKey: PACKS_KEY });
    void qc.invalidateQueries({ queryKey: ["pack-updates"] });
    if (libraryToo) {
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      void qc.invalidateQueries({ queryKey: FONTS_KEY });
      void qc.invalidateQueries({ queryKey: ["datasets"] });
      void qc.invalidateQueries({ queryKey: ["assets"] });
    }
  };
  return {
    addSource: async (input: string, token?: string, accountId?: string) => {
      const r = await send(`${apiRoot()}/packs/sources`, "POST", { input, token: token || null, accountId: accountId || null }).then((x) => json<PackSourceView>(x));
      await after(false);
      return r;
    },
    setToken: async (id: string, token: string | null) => {
      await send(`${apiRoot()}/packs/sources/${encodeURIComponent(id)}`, "PATCH", { token }).then((x) => json<void>(x));
      await after(false);
    },
    removeSource: async (id: string) => {
      await send(`${apiRoot()}/packs/sources/${encodeURIComponent(id)}`, "DELETE").then((x) => json<void>(x));
      await after(false);
    },
    refresh: async (id: string) => {
      const r = await send(`${apiRoot()}/packs/sources/${encodeURIComponent(id)}/refresh`, "POST").then((x) => json<PackSourceView>(x));
      await after(false);
      return r;
    },
    install: async (sourceId: string, packId: string, labelIds?: string[] | null) => {
      const r = await send(`${apiRoot()}/packs/install`, "POST", { sourceId, packId, labelIds: labelIds ?? null }).then((x) => json<SyncResult>(x));
      await after();
      return r;
    },
    update: async (id: string) => {
      const r = await send(`${apiRoot()}/packs/installed/${encodeURIComponent(id)}/update`, "POST").then((x) => json<SyncResult>(x));
      await after();
      return r;
    },
    setEnabled: async (id: string, enabled: boolean) => {
      await send(`${apiRoot()}/packs/installed/${encodeURIComponent(id)}`, "PATCH", { enabled }).then((x) => json<void>(x));
      await after();
    },
    removePlan: (id: string) => fetch(`${apiRoot()}/packs/installed/${encodeURIComponent(id)}`).then((x) => json<RemovePlanView>(x)),
    remove: async (id: string, keepChanged: boolean) => {
      const r = await send(`${apiRoot()}/packs/installed/${encodeURIComponent(id)}${keepChanged ? "?keepChanged=1" : ""}`, "DELETE").then((x) => json<{ removed: number; kept: number }>(x));
      await after();
      return r;
    },
    reset: async (sel: { packId?: string; items?: { kind: "template" | "label" | "dataset" | "asset"; id: string }[] }) => {
      const r = await send(`${apiRoot()}/packs/reset`, "POST", sel).then((x) => json<{ reset: number; skipped: string[] }>(x));
      await after();
      return r;
    },
  };
}

export interface ExportPackInput {
  manifest: { id: string; name: string; version: string; description?: string; author?: string; folder?: string };
  templateIds: string[];
  labelIds: string[];
  datasets: boolean;
}

/** POST /api/packs/export and download the zip. */
export async function downloadPack(input: ExportPackInput) {
  const res = await send(`${apiRoot()}/packs/export`, "POST", input);
  if (!res.ok) await json(res);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${input.manifest.id}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return JSON.parse(res.headers.get("x-labebal-counts") ?? "{}") as Record<string, number>;
}
