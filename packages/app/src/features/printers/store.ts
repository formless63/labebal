"use client";
/**
 * Printer settings. Model defaults, profiles and roll usage are team settings:
 * kept here (localStorage) as the working copy and synced with the server by
 * features/settings/sync.tsx (profiles' `lastSeen` stays per browser).
 * - model defaults: label type override and locked print task per printer model
 * - saved printer profiles: one per physical printer (by serial), with a name and
 *   optional overrides (label size for a second printer, label type, print task, offsets)
 * - roll / ribbon usage counted per RFID serial (prints from every browser add up)
 * - a copy of the shared (server) calibrations, keyed like the profiles ("sn:<serial>"),
 *   so printing still uses them offline; refreshed by CalibrationSync
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addUsage, type ConsumableUsage, type MediaKind, type PrintTaskName } from "@labebal/core";
import type { Offset } from "../labels/calibration";

export interface ModelDefaults {
  /** Label type for this model instead of "from the stock / roll". */
  mediaKind?: MediaKind;
  /** Print task version used instead of auto-detection. */
  printTask?: PrintTaskName;
}

export interface SavedPrinter {
  /** Serial number (or Bluetooth name) of the printer. */
  key: string;
  /** Name shown in the app ("" = the model name). */
  name: string;
  model: string;
  /** Label size / stock loaded in this printer (used when it is not the main printer). */
  sizeId?: string;
  material?: string;
  /** Overrides of the model defaults for this one printer. */
  mediaKind?: MediaKind;
  printTask?: PrintTaskName;
  offset?: Offset;
  lastSeen?: number;
}

/** Calibration saved on the server against a printer's serial (shared by every browser). */
export interface SharedCalibration {
  offset: Offset;
  /** "suggested" = taken from the model's typical offset, not measured on this printer. */
  source: "calibrated" | "suggested";
  updatedBy?: string;
  updatedAt?: string;
}

interface State {
  models: Record<string, ModelDefaults>;
  profiles: Record<string, SavedPrinter>;
  usage: Record<string, ConsumableUsage>;
  shared: Record<string, SharedCalibration>;
  /** Printers (keys) for which the model suggestion was declined. */
  hintDismissed: string[];
  setShared: (all: Record<string, SharedCalibration>) => void;
  putShared: (key: string, cal: SharedCalibration | undefined) => void;
  dismissHint: (key: string) => void;
  setModel: (model: string, patch: Partial<ModelDefaults>) => void;
  saveProfile: (key: string, patch: Partial<SavedPrinter> & { model?: string }) => void;
  removeProfile: (key: string) => void;
  recordUsage: (key: string, info: { kind: "roll" | "ribbon"; barcode: string; total: number; used: number }, n: number) => void;
  forgetUsage: (key: string) => void;
}

/** Drop keys whose value is undefined (so "back to automatic" really clears the override). */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const usePrinterStore = create<State>()(
  persist(
    (set, get) => ({
      models: {},
      profiles: {},
      usage: {},
      shared: {},
      hintDismissed: [],
      setShared: (all) => set({ shared: all }),
      putShared: (key, cal) => {
        const { [key]: _old, ...rest } = get().shared;
        void _old;
        set({ shared: cal ? { ...rest, [key]: cal } : rest });
      },
      dismissHint: (key) => set({ hintDismissed: [...new Set([...get().hintDismissed, key])] }),
      setModel: (model, patch) => set({ models: { ...get().models, [model]: clean({ ...get().models[model], ...patch }) } }),
      saveProfile: (key, patch) => {
        const prev = get().profiles[key];
        const next = clean(Object.assign({ key, name: "", model: "" }, prev, patch) as SavedPrinter);
        set({ profiles: { ...get().profiles, [key]: next } });
      },
      removeProfile: (key) => {
        const { [key]: _gone, ...rest } = get().profiles;
        void _gone;
        set({ profiles: rest });
      },
      recordUsage: (key, info, n) => set({ usage: addUsage(get().usage, key, info, n) }),
      forgetUsage: (key) => {
        const { [key]: _gone, ...rest } = get().usage;
        void _gone;
        set({ usage: rest });
      },
    }),
    { name: "labebal:printers", partialize: (s) => ({ models: s.models, profiles: s.profiles, usage: s.usage, shared: s.shared, hintDismissed: s.hintDismissed }) },
  ),
);
