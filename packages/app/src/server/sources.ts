/**
 * Live-linked data sources: a dataset can follow a CSV URL (incl. Google
 * Sheets) or a JSON API. "Sync now" (or the scheduler, every N minutes while
 * the server runs) fetches it through the SSRF-guarded `safeFetch`, maps it
 * to records and upserts them by the key column (or replaces all rows when
 * there is no key). Last status / error is stored on the source row.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { parseTable } from "@labebal/core";
import { jsonToRecords, normalizeSheetUrl, type SourceField } from "@labebal/core/integrations";
import { getDb } from "../db";
import { dataSources } from "../db/schema";
import { addRows, applyDatasetLabels, replaceRows } from "./datasets";
import { safeFetch } from "./safe-fetch";
import { emitWebhook } from "./webhooks";

/** Rows taken from one sync (same as the row API's limit). */
export const MAX_SOURCE_ROWS = 50_000;
export const SOURCE_TIMEOUT_MS = 20_000;
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** Shortest schedule. */
export const MIN_INTERVAL_MINUTES = 5;

export interface SourceConfig {
  kind: "csv" | "json";
  url: string;
  headerName?: string | null;
  /** Write-only: omitted on read; undefined on save keeps the stored value, null clears it. */
  headerValue?: string | null;
  rowsPath?: string | null;
  fields?: SourceField[];
  keyColumn?: string | null;
  mode?: "upsert" | "replace";
  applyLabels?: boolean;
  intervalMinutes?: number | null;
}

export interface SourceInfo extends Omit<SourceConfig, "headerValue"> {
  datasetId: string;
  hasHeaderValue: boolean;
  /** The URL actually fetched (Google Sheets links become their CSV export). */
  fetchUrl: string;
  lastSyncAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  nextSyncAt: string | null;
  syncing: boolean;
}

type Row = typeof dataSources.$inferSelect;

const g = globalThis as unknown as { __labebalSyncing?: Set<string> };
const syncing = (g.__labebalSyncing ??= new Set());

const toInfo = (r: Row): SourceInfo => ({
  datasetId: r.datasetId,
  kind: r.kind,
  url: r.url,
  fetchUrl: fetchUrlOf(r),
  headerName: r.headerName,
  hasHeaderValue: !!r.headerValue,
  rowsPath: r.rowsPath,
  fields: r.fields,
  keyColumn: r.keyColumn,
  mode: r.mode,
  applyLabels: r.applyLabels,
  intervalMinutes: r.intervalMinutes,
  lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
  lastStatus: r.lastStatus ?? null,
  lastError: r.lastError,
  lastResult: r.lastResult ?? null,
  nextSyncAt: r.intervalMinutes ? new Date((r.lastSyncAt?.getTime() ?? Date.now()) + r.intervalMinutes * 60_000).toISOString() : null,
  syncing: syncing.has(r.datasetId),
});

const fetchUrlOf = (c: Pick<SourceConfig, "kind" | "url">) => (c.kind === "csv" ? normalizeSheetUrl(c.url) : c.url.trim());

export async function listSources(): Promise<SourceInfo[]> {
  const db = await getDb();
  return (await db.select().from(dataSources)).map(toInfo);
}

export async function getSource(datasetId: string): Promise<SourceInfo | undefined> {
  const db = await getDb();
  const [r] = await db.select().from(dataSources).where(eq(dataSources.datasetId, datasetId));
  return r && toInfo(r);
}

export async function saveSource(datasetId: string, c: SourceConfig): Promise<SourceInfo> {
  const db = await getDb();
  const set = {
    kind: c.kind,
    url: c.url.trim(),
    ...(c.headerName !== undefined ? { headerName: c.headerName?.trim() || null } : {}),
    ...(c.headerValue !== undefined ? { headerValue: c.headerValue || null } : {}),
    rowsPath: c.rowsPath?.trim() || null,
    fields: (c.fields ?? []).filter((f) => f.column.trim() && f.path.trim()),
    keyColumn: c.keyColumn?.trim() || null,
    mode: c.mode ?? (c.keyColumn ? "upsert" : "replace"),
    applyLabels: c.applyLabels ?? false,
    intervalMinutes: c.intervalMinutes ? Math.max(MIN_INTERVAL_MINUTES, Math.round(c.intervalMinutes)) : null,
    updatedAt: new Date(),
  } as const;
  await db
    .insert(dataSources)
    .values({ datasetId, ...set })
    .onConflictDoUpdate({ target: dataSources.datasetId, set });
  return (await getSource(datasetId))!;
}

export async function deleteSource(datasetId: string) {
  const db = await getDb();
  await db.delete(dataSources).where(eq(dataSources.datasetId, datasetId));
}

/** Fetch a source and turn it into records keyed by column name. */
export async function fetchRecords(c: SourceConfig & { headerValue?: string | null }): Promise<{ records: Record<string, string>[]; columns: string[]; warnings: string[]; truncated: boolean }> {
  const headers: Record<string, string> = { accept: c.kind === "json" ? "application/json" : "text/csv, text/plain;q=0.9, */*;q=0.1" };
  if (c.headerName?.trim() && c.headerValue) headers[c.headerName.trim().toLowerCase()] = c.headerValue;
  const res = await safeFetch(fetchUrlOf(c), { headers, timeoutMs: SOURCE_TIMEOUT_MS, maxBytes: SOURCE_MAX_BYTES });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${new URL(res.url).host}${res.text ? `: ${res.text.slice(0, 200).trim()}` : ""}`);
  let records: Record<string, string>[];
  let warnings: string[] = [];
  if (c.kind === "json") {
    let data: unknown;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new Error(`Response is not JSON (starts with "${res.text.slice(0, 40)}")`);
    }
    records = jsonToRecords(data, { rowsPath: c.rowsPath ?? undefined, fields: c.fields });
  } else {
    if (/^\s*<(!doctype|html)/i.test(res.text)) throw new Error("Got a web page, not CSV. For Google Sheets share the sheet as 'anyone with the link' or use File > Share > Publish to web > CSV.");
    const t = parseTable(res.text);
    warnings = t.warnings.slice(0, 5);
    records = t.rows.map((r) => Object.fromEntries(t.columns.map((col) => [col.name, r.values[col.id] ?? ""])));
  }
  const truncated = records.length > MAX_SOURCE_ROWS;
  if (truncated) records = records.slice(0, MAX_SOURCE_ROWS);
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
  return { records, columns, warnings, truncated };
}

/** Try a configuration without saving: first rows + columns. */
export async function previewSource(c: SourceConfig, datasetId?: string) {
  let headerValue = c.headerValue;
  if (headerValue === undefined && datasetId) {
    const db = await getDb();
    const [r] = await db.select({ v: dataSources.headerValue }).from(dataSources).where(eq(dataSources.datasetId, datasetId));
    headerValue = r?.v;
  }
  const r = await fetchRecords({ ...c, headerValue });
  return { total: r.records.length, columns: r.columns, sample: r.records.slice(0, 5), warnings: r.warnings, truncated: r.truncated };
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  fetched?: number;
  added?: number;
  updated?: number;
  removed?: number;
  rows?: number;
  newColumns?: { id: string; name: string }[];
  labels?: { created: number; updated: number } | { error: string };
  truncated?: boolean;
  warnings?: string[];
  ms?: number;
}

/** Fetch and merge now. Overlapping syncs of the same dataset are refused. */
export async function syncSource(datasetId: string): Promise<SyncResult | undefined> {
  const db = await getDb();
  const [src] = await db.select().from(dataSources).where(eq(dataSources.datasetId, datasetId));
  if (!src) return undefined;
  if (syncing.has(datasetId)) return { ok: false, error: "A sync is already running" };
  syncing.add(datasetId);
  const t0 = Date.now();
  let result: SyncResult;
  try {
    const { records, warnings, truncated } = await fetchRecords(src);
    const useKey = src.mode === "upsert" && src.keyColumn;
    const r = useKey ? await addRows(datasetId, records, { mode: "upsert", keyColumn: src.keyColumn! }) : await replaceRows(datasetId, records);
    if (!r) throw new Error("dataset not found");
    result = {
      ok: true,
      fetched: records.length,
      added: r.added,
      updated: r.updated,
      removed: "removed" in r ? (r.removed as number) : 0,
      rows: r.rows,
      newColumns: r.newColumns,
      truncated,
      warnings,
    };
    if (src.applyLabels) {
      try {
        const l = await applyDatasetLabels(datasetId);
        if (l) result.labels = { created: l.created, updated: l.updated };
      } catch (e) {
        result.labels = { error: (e as Error).message };
      }
    }
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  } finally {
    syncing.delete(datasetId);
  }
  result.ms = Date.now() - t0;
  await db
    .update(dataSources)
    .set({ lastSyncAt: new Date(), lastStatus: result.ok ? "ok" : "error", lastError: result.error ?? null, lastResult: result as unknown as Record<string, unknown> })
    .where(eq(dataSources.datasetId, datasetId));
  void emitWebhook(result.ok ? "source.synced" : "source.failed", { datasetId, ...result });
  return result;
}

/** Sync every scheduled source whose interval has passed (called by the scheduler). */
export async function syncDueSources() {
  const db = await getDb();
  const rs = await db.select().from(dataSources).where(and(isNotNull(dataSources.intervalMinutes)));
  const now = Date.now();
  for (const r of rs) {
    if (!r.intervalMinutes || syncing.has(r.datasetId)) continue;
    if (r.lastSyncAt && now - r.lastSyncAt.getTime() < r.intervalMinutes * 60_000) continue;
    await syncSource(r.datasetId).catch((e) => console.error("source sync", r.datasetId, e));
  }
}
