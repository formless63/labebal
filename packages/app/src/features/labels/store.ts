"use client";
/**
 * Per-browser UI state: print settings and the print queue. Printing happens
 * from this browser, so these deliberately live in localStorage, not the server.
 *
 * Exception: `customSizes`, `customMaterials`, `customRibbons`, `learnedRolls` and `densityPresets` are team
 * settings. They are kept here as the working copy and synced with the server
 * by features/settings/sync.tsx.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PRINTERS, findPrinter, setCustomSizes, setCustomSwatches, sizesFor, usableSizes, type Collation, type LabelSize, type Swatch } from "@labebal/core";
import { presetDensity, type CalibrationSettings } from "./calibration";

export interface QueueItem {
  id: string;
  labelId: string;
  qty: number;
  /** Unticked: left out of "Print" (kept in the queue). */
  off?: boolean;
  /** Printer chosen by hand (saved printer key, see features/printers/targets.ts); unset = automatic. */
  printerKey?: string;
}

export interface PrintSettings extends CalibrationSettings {
  printer: string;
  sizeId: string;
  material: string;
  ribbon: string;
  density: number;
  marginMm: number;
  /** Global flip on top of each label's own invert setting. */
  invertAll: boolean;
  /** Order of multiple copies (queue print): "grouped" 1,1,2,2 (default) or "collated" 1,2,1,2. */
  collation?: Collation;
  /** Label sizes added by the user (other suppliers' rolls). */
  customSizes?: LabelSize[];
  /** Stock and ribbons added by the user (Settings > Stock and ribbons). */
  customMaterials?: Swatch[];
  customRibbons?: Swatch[];
  /** Team values for {{team:name}} (Settings > Team values; shared with the team). */
  teamValues?: Record<string, string>;
}

interface State {
  settings: PrintSettings;
  queue: QueueItem[];
  selectedLabelId: string | null;
  setSettings: (p: Partial<PrintSettings>) => void;
  setPrinter: (model: string) => void;
  select: (id: string | null) => void;
  enqueue: (labelId: string, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  updateItem: (id: string, patch: Partial<Pick<QueueItem, "off" | "printerKey">>) => void;
  setAllTicked: (on: boolean) => void;
  removeFromQueue: (id: string) => void;
  removeItems: (ids: string[]) => void;
  clearQueue: () => void;
}

const defaultSize = (model: string) => (model === "N1" ? "n1-14x30" : sizesFor(model)[0]?.id ?? "");

export const useLabelStore = create<State>()(
  persist(
    (set, get) => ({
      settings: {
        printer: "N1",
        sizeId: "n1-14x30",
        material: "white",
        ribbon: "black",
        density: PRINTERS[0].densityDefault,
        marginMm: 0.5,
        invertAll: false,
      },
      queue: [],
      selectedLabelId: null,
      setSettings: (p) => {
        const s = { ...get().settings, ...p };
        // Picking a stock applies its darkness preset unless darkness is set in the same call.
        if (p.material && p.material !== get().settings.material && p.density === undefined) s.density = presetDensity(s, s.printer, s.material);
        set({ settings: s });
      },
      setPrinter: (model) => {
        const s = get().settings;
        if (s.printer === model) return;
        const p = findPrinter(model);
        if (!p) return;
        const keepSize = usableSizes(model).some((z) => z.id === s.sizeId);
        set({ settings: { ...s, printer: model, density: presetDensity(s, model, s.material), sizeId: keepSize ? s.sizeId : defaultSize(model) } });
      },
      select: (id) => set({ selectedLabelId: id }),
      enqueue: (labelId, qty = 1) => {
        const q = get().queue;
        const hit = q.find((i) => i.labelId === labelId);
        set({
          queue: hit
            ? q.map((i) => (i === hit ? { ...i, qty: i.qty + qty } : i))
            : [...q, { id: crypto.randomUUID(), labelId, qty }],
        });
      },
      setQty: (id, qty) => set({ queue: get().queue.map((i) => (i.id === id ? { ...i, qty: Math.max(0, qty) } : i)) }),
      updateItem: (id, patch) => set({ queue: get().queue.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      setAllTicked: (on) => set({ queue: get().queue.map((i) => ({ ...i, off: !on })) }),
      removeFromQueue: (id) => set({ queue: get().queue.filter((i) => i.id !== id) }),
      removeItems: (ids) => set({ queue: get().queue.filter((i) => !ids.includes(i.id)) }),
      clearQueue: () => set({ queue: [] }),
    }),
    { name: "labebal:labels", partialize: (s) => ({ settings: s.settings, queue: s.queue, selectedLabelId: s.selectedLabelId }) },
  ),
);

// Custom sizes, stock and ribbons take part in every lookup (core keeps the lists).
{
  const s = useLabelStore.getState().settings;
  setCustomSizes(s.customSizes ?? []);
  setCustomSwatches({ materials: s.customMaterials ?? [], ribbons: s.customRibbons ?? [] });
}
useLabelStore.subscribe((st, prev) => {
  if (st.settings.customSizes !== prev.settings.customSizes) setCustomSizes(st.settings.customSizes ?? []);
  if (st.settings.customMaterials !== prev.settings.customMaterials || st.settings.customRibbons !== prev.settings.customRibbons)
    setCustomSwatches({ materials: st.settings.customMaterials ?? [], ribbons: st.settings.customRibbons ?? [] });
});
