"use client";
import { useQueryClient } from "@tanstack/react-query";
import type { Library } from "@labebal/core";
import { LIBRARY_KEY } from "../labels/api";
import { apiRoot } from "../../lib/base";

/** Template deletion (the shared library actions only save templates). */
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return async (id: string) => {
    qc.setQueryData<Library>(LIBRARY_KEY, (lib) => (lib ? { ...lib, templates: lib.templates.filter((t) => t.id !== id) } : lib));
    const r = await fetch(`${apiRoot()}/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      throw new Error(`${r.status} ${await r.text()}`);
    }
  };
}
