"use client";
/**
 * Stock and ribbons for pickers: built-in plus the team's own (Settings >
 * Stock and ribbons). Re-renders when someone adds or edits one.
 */
import { useMemo } from "react";
import { MATERIALS, RIBBONS, type Swatch } from "@labebal/core";
import { useLabelStore } from "./store";

export function useSwatches(): { materials: Swatch[]; ribbons: Swatch[] } {
  const customMaterials = useLabelStore((s) => s.settings.customMaterials);
  const customRibbons = useLabelStore((s) => s.settings.customRibbons);
  return useMemo(
    () => ({
      materials: [...MATERIALS, ...(customMaterials ?? []).map((m) => ({ ...m, custom: true }))],
      ribbons: [...RIBBONS, ...(customRibbons ?? []).map((r) => ({ ...r, custom: true }))],
    }),
    [customMaterials, customRibbons],
  );
}

/** Picker options, custom ones marked. */
export const swatchOptions = (list: Swatch[]) => list.map((m) => ({ value: m.id, label: m.custom ? `${m.name} (yours)` : m.name }));
