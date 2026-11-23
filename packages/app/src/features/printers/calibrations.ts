"use client";
/**
 * Calibration saved on the server against each printer's serial number, so a
 * printer calibrated once prints in the right place from every browser.
 *
 * The printer store keeps a copy (works offline); `useCalibrationSync` refreshes
 * it, and `saveSharedCalibration` / `forgetSharedCalibration` write through.
 * Printers without a serial (only a Bluetooth name) stay per-browser.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MODEL_CALIBRATION_HINTS } from "@labebal/core";
import type { Offset } from "../labels/calibration";
import { usePrinters } from "../labels/printer";
import { usePrinterStore, type SharedCalibration } from "./store";
import { printerKey, shortModel } from "./targets";
import { apiRoot } from "../../lib/base";

interface ApiCalibration {
  serial: string;
  model: string;
  name: string;
  offset: Offset;
  source: "calibrated" | "suggested";
  updatedBy: string;
  updatedAt: string;
}

/** "sn:<serial>" -> "<serial>", or null for printers keyed by Bluetooth name. */
export const serialOfKey = (key: string | null | undefined) => (key?.startsWith("sn:") ? key.slice(3) : null);

const toShared = (c: ApiCalibration): SharedCalibration => ({ offset: c.offset, source: c.source, updatedBy: c.updatedBy, updatedAt: c.updatedAt });

/** Load the shared calibrations into the printer store (mounted once in the app providers). */
export function useCalibrationSync() {
  const q = useQuery({
    queryKey: ["printer-calibrations"],
    queryFn: async (): Promise<ApiCalibration[]> => {
      const r = await fetch(`${apiRoot()}/printers`);
      if (!r.ok) throw new Error(`calibrations: ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!q.data) return;
    // Entries never stored on the server (no serial, or the save was refused) stay in this browser.
    const local = Object.entries(usePrinterStore.getState().shared).filter(([, c]) => !c.updatedAt);
    usePrinterStore.getState().setShared({ ...Object.fromEntries(local), ...Object.fromEntries(q.data.map((c) => [`sn:${c.serial}`, toShared(c)])) });
  }, [q.data]);
  return q;
}

/** This printer's own offset: the shared calibration, else this browser's profile offset. */
export function useOwnOffset(key: string | null | undefined) {
  const shared = usePrinterStore((s) => (key ? s.shared[key] : undefined));
  const profile = usePrinterStore((s) => (key ? s.profiles[key]?.offset : undefined));
  return shared ? { offset: shared.offset, source: shared.source, shared: true } : profile ? { offset: profile, source: "calibrated" as const, shared: false } : undefined;
}

/**
 * Loads the shared calibrations, and once per printer offers the typical offset
 * of its model when a printer without its own calibration connects.
 */
export function CalibrationSync() {
  const q = useCalibrationSync();
  const list = usePrinters();
  const offered = useRef(new Set<string>());
  useEffect(() => {
    if (!q.isSuccess) return;
    const ps = usePrinterStore.getState();
    for (const p of list) {
      const key = p.connected ? printerKey(p) : null;
      const hint = modelHint(p.model);
      if (!key || !hint || !p.model || offered.current.has(key)) continue;
      if (ps.shared[key] || ps.profiles[key]?.offset || ps.hintDismissed.includes(key)) continue;
      offered.current.add(key);
      const model = p.model;
      toast(`New ${shortModel(model)} printer`, {
        description: `Other ${shortModel(model)} printers needed their print moved ${describeOffset(hint.offset)}. Use the same for this one? You can check it with a test print in Settings.`,
        duration: 30_000,
        action: { label: "Use it", onClick: () => saveSharedCalibration(key, { model, name: ps.profiles[key]?.name, offset: hint.offset, source: "suggested" }) },
        cancel: { label: "No", onClick: () => usePrinterStore.getState().dismissHint(key) },
      });
    }
  }, [list, q.isSuccess]);
  return null;
}

/** "6 dots down", "2 dots left and 6 dots down". */
export function describeOffset(o: Offset) {
  const part = (n: number, pos: string, neg: string) => (n ? `${Math.abs(n)} dot${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? pos : neg}` : "");
  return [part(o.x, "right", "left"), part(o.y, "down", "up")].filter(Boolean).join(" and ") || "nowhere";
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Save this printer's offset: locally right away, on the server (for everyone)
 * shortly after the last change, so typing in the number boxes is one request.
 */
export function saveSharedCalibration(key: string, info: { model: string; name?: string; offset: Offset; source?: SharedCalibration["source"] }) {
  const source = info.source ?? "calibrated";
  usePrinterStore.getState().putShared(key, { offset: info.offset, source });
  const serial = serialOfKey(key);
  if (!serial) return;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(async () => {
      pending.delete(key);
      const r = await fetch(`${apiRoot()}/printers/${encodeURIComponent(serial)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: info.model, name: info.name ?? "", offset: info.offset, source }),
      }).catch(() => null);
      if (r?.ok) usePrinterStore.getState().putShared(key, toShared(await r.json()));
      else toast.error(r?.status === 403 ? "Saved in this browser only: you don't have permission to change printer settings for everyone." : "Couldn't save the printer position on the server; it is saved in this browser.");
    }, 600),
  );
}

/** Back to the model offset for this printer, for everyone. */
export async function forgetSharedCalibration(key: string) {
  clearTimeout(pending.get(key));
  pending.delete(key);
  usePrinterStore.getState().putShared(key, undefined);
  const serial = serialOfKey(key);
  if (!serial) return true;
  const r = await fetch(`${apiRoot()}/printers/${encodeURIComponent(serial)}`, { method: "DELETE" }).catch(() => null);
  return !!r?.ok;
}

/** Typical offset measured on another printer of this model, offered to new printers. */
export const modelHint = (model: string | null | undefined) => (model ? MODEL_CALIBRATION_HINTS[model] : undefined);
