"use client";
/** Stock runs data access (TanStack Query). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { json } from "../data/api";
import { apiRoot } from "../../lib/base";

export interface RunItem {
  labelId: string;
  qty: number;
}

export interface Run {
  id: string;
  name: string;
  notes: string;
  items: RunItem[];
  updatedAt?: string;
}

export const RUNS_KEY = ["runs"] as const;

export const newRunId = () => `run-${crypto.randomUUID().slice(0, 8)}`;

export function useRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: () => fetch(`${apiRoot()}/runs`).then((r) => json<Run[]>(r)) });
}

export function useRunActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: RUNS_KEY });

  const create = useMutation({
    mutationFn: (r: Run) => fetch(`${apiRoot()}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }).then((x) => json<Run>(x)),
    onSuccess: refresh,
  });
  const save = useMutation({
    mutationFn: (r: Run) =>
      fetch(`${apiRoot()}/runs/${encodeURIComponent(r.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }).then((x) => json<Run>(x)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => fetch(`${apiRoot()}/runs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((x) => json<void>(x)),
    onSuccess: refresh,
  });
  return { create, save, remove };
}
