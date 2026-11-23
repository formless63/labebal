"use client";
/** Browser client for /api/counters (types mirror server/counters.ts). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CounterDef, ReservedRange } from "@labebal/core";
import { json } from "../data/api";
import { apiRoot } from "../../lib/base";

export interface CounterValueInfo {
  key: string;
  next: number;
  nextNow: number;
  period: string;
  watched: string | null;
  updatedAt: string;
}

export interface CounterInfo extends CounterDef {
  name: string;
  values: CounterValueInfo[];
  updatedAt: string;
}

export interface CounterLogEntry {
  counter: string;
  key: string;
  from: number;
  to: number;
  source: string;
  at: string;
}

export interface ReserveItem {
  counter: string;
  n: number;
  key?: string;
  templateId?: string;
  values?: Record<string, string>;
  labelId?: string;
}

export const COUNTERS_KEY = ["counters"] as const;
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchCounters = () => fetch(`${apiRoot()}/counters`).then((r) => json<CounterInfo[]>(r));
export const fetchCounter = (id: string) => fetch(`${apiRoot()}/counters/${encodeURIComponent(id)}?limit=20`).then((r) => json<CounterInfo & { log: CounterLogEntry[] }>(r));

export async function reserveCounters(items: ReserveItem[], source?: string): Promise<ReservedRange[]> {
  if (!items.length) return [];
  const r = await fetch(`${apiRoot()}/counters/reserve`, jsonInit("POST", { items, source })).then((res) => json<{ reservations: ReservedRange[] }>(res));
  return r.reservations;
}

export const useCounters = () => useQuery({ queryKey: COUNTERS_KEY, queryFn: fetchCounters });

export function useCounterActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: COUNTERS_KEY });
  return {
    save: useMutation({ mutationFn: (d: CounterDef) => fetch(`${apiRoot()}/counters`, jsonInit("POST", d)).then((r) => json<CounterInfo>(r)), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => fetch(`${apiRoot()}/counters/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<void>(r)), onSuccess: done }),
    setValue: useMutation({
      mutationFn: ({ id, key, next }: { id: string; key?: string; next?: number }) =>
        fetch(`${apiRoot()}/counters/${encodeURIComponent(id)}/value`, jsonInit("PUT", { key, next })).then((r) => json<CounterInfo>(r)),
      onSuccess: done,
    }),
  };
}
