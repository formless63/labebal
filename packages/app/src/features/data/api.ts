"use client";
/** Dataset data access (TanStack Query). Rows are paged from the server; edits patch rows / cells. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DataColumn, DataRow, Dataset, DatasetLink } from "@labebal/core";
import { LIBRARY_KEY } from "../labels/api";
import { apiRoot } from "../../lib/base";

export interface DatasetSummary {
  id: string;
  name: string;
  columns: number;
  rows: number;
  templateId?: string;
  updatedAt: string;
}

/** A dataset without its rows (what the editor holds in memory). */
export interface DatasetMeta {
  id: string;
  name: string;
  columns: DataColumn[];
  link?: DatasetLink;
  rowCount: number;
  updatedAt: string;
}

export interface ApplyResult {
  created: number;
  updated: number;
  labelIds: string[];
  skipped: { rowId: string; reason: string }[];
}

export interface RowFilter {
  q?: string;
  column?: string;
  excludeIds?: string[];
}

export interface RowQuery {
  q?: string;
  column?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

export interface RowPage {
  total: number;
  offset: number;
  rows: DataRow[];
}

export interface AddRowsResult {
  added: number;
  updated: number;
  rows: number;
  ids: string[];
  newColumns: DataColumn[];
}

/**
 * Which rows batch actions apply to: picked ids, or "everything matching the
 * search" minus some (so 5,000 filtered rows never need to be listed).
 */
export type Selection = { mode: "ids"; ids: Set<string> } | { mode: "filter"; filter: RowFilter; except: Set<string> };

export const emptySelection = (): Selection => ({ mode: "ids", ids: new Set() });
export const isSelected = (s: Selection, id: string) => (s.mode === "ids" ? s.ids.has(id) : !s.except.has(id));
export const selectionSize = (s: Selection, matching: number) => (s.mode === "ids" ? s.ids.size : Math.max(0, matching - s.except.size));
export const toggleSelected = (s: Selection, id: string, on: boolean): Selection => {
  const set = new Set(s.mode === "ids" ? s.ids : s.except);
  if (on === (s.mode === "ids")) set.add(id);
  else set.delete(id);
  return s.mode === "ids" ? { mode: "ids", ids: set } : { ...s, except: set };
};
/** Body for endpoints that take a selection (`undefined` = all rows). */
export const selectionBody = (s: Selection): { rowIds?: string[]; filter?: RowFilter } | undefined =>
  s.mode === "ids" ? (s.ids.size ? { rowIds: [...s.ids] } : undefined) : { filter: { ...s.filter, excludeIds: [...s.except] } };

export const DATASETS_KEY = ["datasets"] as const;
const datasetKey = (id: string) => ["datasets", id] as const;
export const rowsKey = (id: string) => ["datasets", id, "rows"] as const;

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {}
    throw new Error(msg || `${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const send = (url: string, method: string, body?: unknown, init?: RequestInit) =>
  fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });

const base = (id: string) => `${apiRoot()}/datasets/${encodeURIComponent(id)}`;

export function rowsUrl(id: string, q: RowQuery & { offset?: number; limit?: number | "all"; ids?: string[] }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return `${base(id)}/rows?${sp}`;
}

export const fetchRows = (id: string, q: Parameters<typeof rowsUrl>[1]) => fetch(rowsUrl(id, q)).then((r) => json<RowPage>(r));

/** The whole dataset with rows (CSV export). */
export const fetchFullDataset = (id: string) => fetch(`${base(id)}?rows=all`).then((r) => json<Dataset>(r));

export function useDatasets() {
  return useQuery({ queryKey: DATASETS_KEY, queryFn: () => fetch(`${apiRoot()}/datasets`).then((r) => json<DatasetSummary[]>(r)) });
}

export function useDataset(id: string | null) {
  return useQuery({
    queryKey: datasetKey(id ?? ""),
    queryFn: () => fetch(base(id!)).then((r) => json<DatasetMeta>(r)),
    enabled: !!id,
  });
}

/** After row changes: refetch row pages, counts and the list. */
export function invalidateRows(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: rowsKey(id) });
  void qc.invalidateQueries({ queryKey: datasetKey(id), exact: true });
  void qc.invalidateQueries({ queryKey: DATASETS_KEY, exact: true });
}

export function useDatasetActions() {
  const qc = useQueryClient();
  const refreshList = () => qc.invalidateQueries({ queryKey: DATASETS_KEY, exact: true });

  const create = useMutation({
    mutationFn: (d: Dataset) => send(`${apiRoot()}/datasets`, "POST", d).then((r) => json<DatasetMeta>(r)),
    onSuccess: (d) => {
      qc.setQueryData(datasetKey(d.id), d);
      void refreshList();
    },
  });

  /** Save name / columns / link. */
  const patch = useMutation({
    mutationFn: ({ id, ...p }: { id: string; name?: string; columns?: DataColumn[]; link?: DatasetLink | null }) =>
      send(base(id), "PATCH", p).then((r) => json<DatasetMeta>(r)),
    onSuccess: () => void refreshList(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => send(base(id), "DELETE").then((r) => json<void>(r)),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: datasetKey(id) });
      void refreshList();
    },
  });

  const addRows = useMutation({
    mutationFn: ({ id, rows, mode, key }: { id: string; rows: Record<string, unknown>[]; mode?: "append" | "upsert"; key?: string }) =>
      send(`${base(id)}/rows`, "POST", { rows, mode, key }).then((r) => json<AddRowsResult>(r)),
    onSuccess: (_r, v) => invalidateRows(qc, v.id),
  });

  const deleteRows = useMutation({
    mutationFn: ({ id, ...body }: { id: string; rowIds?: string[]; filter?: RowFilter }) =>
      send(`${base(id)}/rows`, "DELETE", body).then((r) => json<{ deleted: number }>(r)),
    onSuccess: (_r, v) => invalidateRows(qc, v.id),
  });

  const applyLabels = useMutation({
    mutationFn: ({ id, ...body }: { id: string; rowIds?: string[]; filter?: RowFilter }) =>
      send(`${base(id)}/labels`, "POST", body).then((r) => json<ApplyResult>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIBRARY_KEY }),
  });

  return { create, patch, remove, addRows, deleteRows, applyLabels };
}

/**
 * Batches cell edits: changes collect per row and go out as one
 * `PATCH .../rows` shortly after typing stops (or on `flush`).
 */
export function createCellSaver(datasetId: string, onError: (e: Error) => void, delay = 400) {
  let pending = new Map<string, Record<string, string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();
  const flush = (keepalive = false) => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.size) return inflight;
    const updates = [...pending].map(([id, values]) => ({ id, values }));
    pending = new Map();
    inflight = inflight
      .then(() => send(`${base(datasetId)}/rows`, "PATCH", { updates }, keepalive ? { keepalive: true } : undefined))
      .then((r) => json<unknown>(r))
      .then(() => undefined)
      .catch((e: Error) => onError(e));
    return inflight;
  };
  return {
    set(rowId: string, column: string, value: string) {
      pending.set(rowId, { ...pending.get(rowId), [column]: value });
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    get dirty() {
      return pending.size > 0;
    },
  };
}
