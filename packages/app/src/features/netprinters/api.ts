"use client";
/**
 * Network printers (Zebra / ZPL over the network, printed through the server):
 * the list, its printer profiles, and admin actions. See server/netprinters.ts.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { setExtraPrinters, type PrinterProfile } from "@labebal/core";
import { json, send } from "../data/api";
import { useLabelStore } from "../labels/store";
import { apiRoot } from "../../lib/base";

export interface NetPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  language: "zpl";
  model: string;
  dpi: number;
  headDots: number;
  thermal: "direct" | "transfer" | "both";
  updatedAt: string;
  updatedBy: string;
}

export interface NetPrinterDetection {
  model: string;
  firmware: string;
  dpi: number;
  headDots: number;
  printWidth?: number;
  method?: "direct" | "transfer";
  mediaType?: string;
  darkness?: number;
}

export interface NetPrinterStatus {
  reachable: boolean;
  error?: string;
  paperOut?: boolean;
  paused?: boolean;
  headOpen?: boolean;
  ribbonOut?: boolean;
  overTemp?: boolean;
  underTemp?: boolean;
  thermalTransfer?: boolean;
  remaining?: number;
  queued?: number;
  problem?: string;
}

export const NET_PRINTERS_KEY = ["netprinters"] as const;
export const netModel = (id: string) => `zpl:${id}`;
export const netIdOfModel = (model: string | null | undefined) => (model?.startsWith("zpl:") ? model.slice(4) : null);

export const fetchNetPrinters = () => fetch(`${apiRoot()}/netprinters`).then((r) => json<NetPrinter[]>(r));
export const fetchNetStatus = (id: string) =>
  fetch(`${apiRoot()}/netprinters/${encodeURIComponent(id)}/status`).then(async (r) => (await r.json()) as NetPrinterStatus);

export function useNetPrinters() {
  return useQuery({ queryKey: NET_PRINTERS_KEY, queryFn: fetchNetPrinters, staleTime: 60_000 });
}

/** A network printer as a printer profile (model "zpl:<id>"), so pickers, sizes and rendering treat it like any printer. */
export function netProfile(p: NetPrinter): PrinterProfile {
  const dpmm = p.dpi / 25.4;
  return {
    model: netModel(p.id),
    name: p.name,
    dpi: p.dpi,
    headDots: p.headDots,
    direction: "top",
    // Darkness relative to the printer's own setting (^MD).
    densityMin: -15,
    densityMax: 15,
    densityDefault: 0,
    densityRelative: true,
    maxTapeMm: Math.floor((p.headDots / dpmm) * 10) / 10 + 2,
    family: "zpl",
    thermal: p.thermal,
    custom: true,
  };
}

/** Bumped when the network printer profiles change, so derived printer lists re-render. */
export const useNetProfiles = create<{ version: number; list: NetPrinter[] }>(() => ({ version: 0, list: [] }));

/**
 * Keeps core's printer list in step with the server's network printers, and
 * reconnects the toolbar's printer when it is a network one (no pairing needed,
 * so a reload shouldn't lose it). Mounted once.
 */
export function NetPrintersSync() {
  const { data } = useNetPrinters();
  useEffect(() => {
    if (!data) return;
    setExtraPrinters(data.map(netProfile));
    useNetProfiles.setState((s) => ({ version: s.version + 1, list: data }));
    const id = netIdOfModel(useLabelStore.getState().settings.printer);
    const np = id ? data.find((p) => p.id === id) : undefined;
    if (np) void import("./connect").then(({ connectNetworkPrinter, netConnection }) => (netConnection(np.id)?.getSnapshot().connected ? null : connectNetworkPrinter(np))).catch(() => {});
  }, [data]);
  return null;
}

export function useNetPrinterActions() {
  const qc = useQueryClient();
  const after = () => qc.invalidateQueries({ queryKey: NET_PRINTERS_KEY });
  return {
    detect: (host: string, port: number) => send(`${apiRoot()}/netprinters/detect`, "POST", { host, port }).then((r) => json<NetPrinterDetection>(r)),
    add: async (p: { name: string; host: string; port: number; thermal?: NetPrinter["thermal"]; dpi?: number; headDots?: number; model?: string }) => {
      const r = await send(`${apiRoot()}/netprinters`, "POST", p).then((x) => json<NetPrinter>(x));
      await after();
      return r;
    },
    update: async (id: string, patch: Partial<Pick<NetPrinter, "name" | "host" | "port" | "thermal" | "dpi" | "headDots">>) => {
      const r = await send(`${apiRoot()}/netprinters/${encodeURIComponent(id)}`, "PATCH", patch).then((x) => json<NetPrinter>(x));
      await after();
      return r;
    },
    remove: async (id: string) => {
      await send(`${apiRoot()}/netprinters/${encodeURIComponent(id)}`, "DELETE").then((x) => json<void>(x));
      await after();
    },
  };
}
