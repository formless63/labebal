"use client";
/**
 * Library data access (TanStack Query). Edits update the cache immediately and
 * are saved to the server debounced, so typing in fields stays smooth.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { partsUsedBy, setLibraryParts, type Label, type LabelComponent, type Library, type Template, type TextStyle } from "@labebal/core";
import type { LibraryWithPacks } from "../packs/types";
import { whoHeader } from "./history-client";
import { apiRoot } from "../../lib/base";

export const LIBRARY_KEY = ["library"] as const;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * The library's text styles and components are registered with core as soon
 * as the library arrives or changes, so every render (thumbnails, previews,
 * printing) resolves them; see core parts.ts.
 */
const register = <L extends Library>(lib: L) => {
  setLibraryParts({ styles: lib.styles ?? [], components: lib.components ?? [] });
  return lib;
};

/** Includes `packs` (which items come from which pack); disabled packs' items are left out. */
export const fetchLibrary = () => fetch(`${apiRoot()}/library`).then((r) => json<LibraryWithPacks>(r)).then(register);

export function useLibrary() {
  return useQuery({ queryKey: LIBRARY_KEY, queryFn: fetchLibrary, staleTime: 30_000 });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(key: string, fn: () => void, ms = 400) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    fn();
  }, ms));
}

const patchCache = (qc: QueryClient, fn: (lib: Library) => Library) =>
  qc.setQueryData<Library>(LIBRARY_KEY, (lib) => (lib ? register(fn(lib)) : lib));

/** New identity for templates using a changed part, so memoised previews redraw. */
function touchUsers(lib: Library, uses: (t: Template, parts: Library) => boolean): Library {
  return { ...lib, templates: lib.templates.map((t) => (uses(t, lib) ? { ...t } : t)) };
}
const usesStyle = (id: string) => (t: Template, lib: Library) => partsUsedBy(t, lib).styles.some((s) => s.id === id);
const usesComponent = (id: string) => (t: Template, lib: Library) => partsUsedBy(t, lib).components.some((c) => c.id === id);

const upsert = <T extends { id: string }>(list: T[] | undefined, item: T) =>
  list?.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...(list ?? []), item];

export function useLibraryActions() {
  const qc = useQueryClient();
  const onError = (e: unknown) => {
    console.error(e);
    void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
  };

  return {
    saveLabel(label: Label, opts: { immediate?: boolean } = {}) {
      patchCache(qc, (lib) => {
        const exists = lib.labels.some((l) => l.id === label.id);
        return { ...lib, labels: exists ? lib.labels.map((l) => (l.id === label.id ? label : l)) : [...lib.labels, label] };
      });
      const put = () =>
        fetch(`${apiRoot()}/labels/${encodeURIComponent(label.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(label),
        }).then(json).catch(onError);
      if (opts.immediate) void put();
      else debounce(`label:${label.id}`, put);
    },

    async deleteLabel(id: string) {
      patchCache(qc, (lib) => ({ ...lib, labels: lib.labels.filter((l) => l.id !== id) }));
      await fetch(`${apiRoot()}/labels/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json).catch(onError);
    },

    /** With `immediate`, resolves to whether the server accepted the save. */
    saveTemplate(t: Template, opts: { immediate?: boolean } = {}): Promise<boolean> | undefined {
      patchCache(qc, (lib) => {
        const exists = lib.templates.some((x) => x.id === t.id);
        return { ...lib, templates: exists ? lib.templates.map((x) => (x.id === t.id ? t : x)) : [...lib.templates, t] };
      });
      const put = () =>
        fetch(`${apiRoot()}/templates/${encodeURIComponent(t.id)}`, {
          method: "PUT",
          // who made the change, for the version history.
          headers: { "content-type": "application/json", ...whoHeader() },
          body: JSON.stringify(t),
        }).then(json).then(() => true, (e) => (onError(e), false));
      if (opts.immediate) return put();
      debounce(`template:${t.id}`, put, 600);
      return undefined;
    },

    /** Save a shared text style (debounced unless `immediate`); every text using it follows. */
    saveStyle(s: TextStyle, opts: { immediate?: boolean } = {}) {
      patchCache(qc, (lib) => touchUsers({ ...lib, styles: upsert(lib.styles, s) }, usesStyle(s.id)));
      const put = () =>
        fetch(`${apiRoot()}/styles/${encodeURIComponent(s.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
          .then(json)
          .then(() => true, (e) => (onError(e), false));
      if (opts.immediate) return put();
      debounce(`style:${s.id}`, put, 500);
      return undefined;
    },

    async deleteStyle(id: string) {
      patchCache(qc, (lib) => touchUsers({ ...lib, styles: (lib.styles ?? []).filter((s) => s.id !== id) }, usesStyle(id)));
      await fetch(`${apiRoot()}/styles/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json).catch(onError);
    },

    /** Save a component (debounced unless `immediate`); every instance follows. */
    saveComponent(c: LabelComponent, opts: { immediate?: boolean } = {}): Promise<boolean> | undefined {
      patchCache(qc, (lib) => touchUsers({ ...lib, components: upsert(lib.components, c) }, usesComponent(c.id)));
      const put = () =>
        fetch(`${apiRoot()}/components/${encodeURIComponent(c.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(c) })
          .then(json)
          .then(() => true, (e) => (onError(e), false));
      if (opts.immediate) return put();
      debounce(`component:${c.id}`, put, 600);
      return undefined;
    },

    async deleteComponent(id: string) {
      patchCache(qc, (lib) => ({ ...lib, components: (lib.components ?? []).filter((c) => c.id !== id) }));
      await fetch(`${apiRoot()}/components/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json).catch(onError);
    },

    async importLibrary(lib: Pick<Library, "templates" | "labels" | "styles" | "components">) {
      const res = await fetch(`${apiRoot()}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lib),
      }).then((r) => json<{ templates: number; labels: number }>(r));
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      return res;
    },
  };
}
