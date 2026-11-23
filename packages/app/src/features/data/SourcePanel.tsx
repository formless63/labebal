"use client";
/**
 * "Live source" tab: link a dataset to a CSV URL / Google Sheet / JSON API,
 * preview what it returns, sync now or every N minutes (server side).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCloudDownload, IconEye, IconLinkOff, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { DataColumn } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { LIBRARY_KEY } from "../labels/api";
import { invalidateRows, json, send } from "./api";
import { Hint, Pick } from "./ui";
import { apiRoot } from "../../lib/base";

export interface SourceInfo {
  datasetId: string;
  kind: "csv" | "json";
  url: string;
  fetchUrl: string;
  headerName: string | null;
  hasHeaderValue: boolean;
  rowsPath: string | null;
  fields: { column: string; path: string }[];
  keyColumn: string | null;
  mode: "upsert" | "replace";
  applyLabels: boolean;
  intervalMinutes: number | null;
  lastSyncAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastResult: SyncResult | null;
  nextSyncAt: string | null;
  syncing: boolean;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  fetched?: number;
  added?: number;
  updated?: number;
  removed?: number;
  rows?: number;
  newColumns?: DataColumn[];
  labels?: { created: number; updated: number } | { error: string };
  truncated?: boolean;
  warnings?: string[];
  ms?: number;
}

interface Preview {
  total: number;
  columns: string[];
  sample: Record<string, string>[];
  warnings: string[];
  truncated: boolean;
}

type Kind = "sheet" | "csv" | "json";

interface Draft {
  kind: Kind;
  url: string;
  headerName: string;
  /** undefined = keep the stored value. */
  headerValue?: string;
  rowsPath: string;
  fields: { column: string; path: string }[];
  keyColumn?: string;
  mode: "upsert" | "replace";
  applyLabels: boolean;
  interval: string;
}

const sourceKey = (id: string) => ["sources", id] as const;
const base = (id: string) => `${apiRoot()}/sources/${encodeURIComponent(id)}`;

const toDraft = (s: SourceInfo | null | undefined, keyColumn?: string): Draft => ({
  kind: s ? (s.kind === "json" ? "json" : s.url.includes("docs.google.com/spreadsheets") ? "sheet" : "csv") : "sheet",
  url: s?.url ?? "",
  headerName: s?.headerName ?? "",
  rowsPath: s?.rowsPath ?? "",
  fields: s?.fields ?? [],
  keyColumn: s?.keyColumn ?? keyColumn,
  mode: s?.mode ?? "upsert",
  applyLabels: s?.applyLabels ?? false,
  interval: s?.intervalMinutes ? String(s.intervalMinutes) : "",
});

const toBody = (d: Draft) => ({
  kind: d.kind === "json" ? "json" : "csv",
  url: d.url.trim(),
  headerName: d.headerName.trim() || null,
  ...(d.headerValue !== undefined ? { headerValue: d.headerValue || null } : {}),
  rowsPath: d.rowsPath.trim() || null,
  fields: d.kind === "json" ? d.fields.filter((f) => f.column.trim() && f.path.trim()) : [],
  keyColumn: d.keyColumn ?? null,
  mode: d.keyColumn ? d.mode : "replace",
  applyLabels: d.applyLabels,
  intervalMinutes: Number(d.interval) > 0 ? Number(d.interval) : null,
});

export function summarizeSync(r: SyncResult) {
  if (!r.ok) return r.error ?? "failed";
  const parts = [`${r.fetched} fetched`, `${r.added} added`, `${r.updated} updated`];
  if (r.removed) parts.push(`${r.removed} replaced`);
  if (r.newColumns?.length) parts.push(`new columns: ${r.newColumns.map((c) => c.name).join(", ")}`);
  if (r.labels) parts.push("error" in r.labels ? `labels: ${r.labels.error}` : `labels ${r.labels.created} created / ${r.labels.updated} updated`);
  if (r.truncated) parts.push("truncated to 50,000 rows");
  return parts.join(", ");
}

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleString();
};

export function SourcePanel({ dataset, onColumnsAdded }: { dataset: { id: string; columns: DataColumn[]; link?: { keyColumn?: string } }; onColumnsAdded: (columns: DataColumn[]) => void }) {
  const qc = useQueryClient();
  const src = useQuery({
    queryKey: sourceKey(dataset.id),
    queryFn: () => fetch(base(dataset.id)).then((r) => json<SourceInfo | null>(r)),
    refetchInterval: (q) => (q.state.data?.intervalMinutes || q.state.data?.syncing ? 30_000 : false),
  });
  const keyName = dataset.columns.find((c) => c.id === dataset.link?.keyColumn)?.name;
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined, keyName));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // Load the stored config once it arrives (state adjusted during render, not in an effect).
  if (src.isSuccess && loadedFor !== dataset.id) {
    setLoadedFor(dataset.id);
    setDraft(toDraft(src.data, keyName));
  }

  const save = useMutation({
    mutationFn: () => send(base(dataset.id), "PUT", toBody(draft)).then((r) => json<SourceInfo>(r)),
    onSuccess: (s) => {
      qc.setQueryData(sourceKey(dataset.id), s);
      setDraft((d) => ({ ...d, headerValue: undefined }));
    },
  });
  const sync = useMutation({
    mutationFn: () => send(`${base(dataset.id)}/sync`, "POST").then((r) => json<SyncResult>(r)),
    onSettled: () => void qc.invalidateQueries({ queryKey: sourceKey(dataset.id) }),
  });
  const test = useMutation({
    mutationFn: () => send(`${apiRoot()}/sources/preview`, "POST", { ...toBody(draft), datasetId: dataset.id }).then((r) => json<Preview>(r)),
    onSuccess: setPreview,
    onError: (e) => {
      setPreview(null);
      toast.error(`Could not fetch: ${(e as Error).message}`);
    },
  });

  async function saveAndSync() {
    try {
      await save.mutateAsync();
      const r = await sync.mutateAsync();
      if (r.ok) {
        toast.success("Synced", { description: summarizeSync(r) });
        if (r.newColumns?.length) onColumnsAdded(r.newColumns);
      } else toast.error(`Sync failed: ${r.error}`);
      invalidateRows(qc, dataset.id);
      if (r.labels) void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function unlink() {
    const ok = await confirmDialog({ title: "Unlink the live source?", description: "The rows stay; they just stop updating.", confirmLabel: "Unlink" });
    if (!ok) return;
    await send(base(dataset.id), "DELETE").then((r) => json<void>(r));
    qc.setQueryData(sourceKey(dataset.id), null);
    setDraft(toDraft(null, keyName));
    setPreview(null);
  }

  const s = src.data;
  const cols = preview?.columns ?? dataset.columns.map((c) => c.name);
  const busy = save.isPending || sync.isPending;
  const canSave = /^https?:\/\/.+/i.test(draft.url.trim());

  return (
    <div className="max-w-3xl space-y-5">
      <Hint>
        Keep this table in step with a spreadsheet or another system. The server fetches the source (on &quot;Sync now&quot; or on a schedule) and updates rows by
        the key column. Changes you make here to synced columns are overwritten on the next sync.
      </Hint>

      {s && (
        <div className={`rounded-lg border p-3 text-sm ${s.lastStatus === "error" ? "border-destructive/50 bg-destructive/5" : "bg-muted/30"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <strong>Linked</strong>
            <span className="text-muted-foreground">
              {s.lastSyncAt ? `last sync ${ago(s.lastSyncAt)}${s.lastStatus === "error" ? " failed" : ""}` : "never synced"}
              {s.intervalMinutes ? ` · every ${s.intervalMinutes} min` : " · manual"}
              {s.syncing ? " · syncing…" : ""}
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={busy} onClick={saveAndSync}>
                <IconRefresh className={sync.isPending ? "animate-spin" : undefined} /> Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={unlink} title="Unlink">
                <IconLinkOff />
              </Button>
            </div>
          </div>
          {s.lastStatus === "error" && s.lastError && <p className="mt-1 text-destructive">{s.lastError}</p>}
          {s.lastStatus === "ok" && s.lastResult && <p className="mt-1 text-muted-foreground">{summarizeSync(s.lastResult)}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Label className="pt-2">Source</Label>
        <Pick
          value={draft.kind}
          onChange={(v) => set({ kind: (v as Kind) ?? "sheet" })}
          options={[
            { value: "sheet", label: "Google Sheets" },
            { value: "csv", label: "CSV file at a URL" },
            { value: "json", label: "JSON API" },
          ]}
          className="w-60"
          aria-label="Source type"
        />

        <Label htmlFor="src-url" className="pt-2">
          URL
        </Label>
        <div className="space-y-1">
          <Input
            id="src-url"
            value={draft.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder={draft.kind === "sheet" ? "https://docs.google.com/spreadsheets/d/…/edit#gid=0" : draft.kind === "csv" ? "https://example.com/stock.csv" : "https://api.example.com/items"}
          />
          {draft.kind === "sheet" && (
            <Hint className="text-xs">
              Share the sheet as &quot;Anyone with the link can view&quot; (or File &gt; Share &gt; Publish to web) and paste its link; the open tab (gid) is used.
            </Hint>
          )}
        </div>

        {draft.kind !== "sheet" && (
          <>
            <Label className="pt-2">Header (optional)</Label>
            <div className="flex gap-2">
              <Input className="w-44" value={draft.headerName} onChange={(e) => set({ headerName: e.target.value })} placeholder="Authorization" aria-label="Header name" />
              <Input
                type="password"
                autoComplete="off"
                value={draft.headerValue ?? ""}
                onChange={(e) => set({ headerValue: e.target.value })}
                placeholder={s?.hasHeaderValue ? "•••••• (stored; type to replace)" : "Bearer …"}
                aria-label="Header value"
              />
              {s?.hasHeaderValue && draft.headerValue === undefined && (
                <Button variant="ghost" size="icon" title="Clear the stored value" onClick={() => set({ headerValue: "" })}>
                  <IconX />
                </Button>
              )}
            </div>
          </>
        )}

        {draft.kind === "json" && (
          <>
            <Label htmlFor="src-rows" className="pt-2">
              Rows at
            </Label>
            <div className="space-y-1">
              <Input id="src-rows" value={draft.rowsPath} onChange={(e) => set({ rowsPath: e.target.value })} placeholder="$.data.items[*]  (empty: the first list found)" className="font-mono text-xs" />
            </div>
            <Label className="pt-2">Columns</Label>
            <div className="space-y-2">
              {draft.fields.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={f.column} onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} placeholder="Column name" className="w-44" />
                  <Input value={f.path} onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) })} placeholder="path in each row, e.g. attrs.sku" className="font-mono text-xs" />
                  <Button variant="ghost" size="icon" onClick={() => set({ fields: draft.fields.filter((_, j) => j !== i) })} title="Remove">
                    <IconX />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => set({ fields: [...draft.fields, { column: "", path: "" }] })}>
                <IconPlus /> Add column
              </Button>
              <Hint className="text-xs">No columns: every field of each row becomes a column (nested fields as a.b).</Hint>
            </div>
          </>
        )}

        <Label className="pt-2">Match rows by</Label>
        <div className="space-y-1">
          <Pick
            value={draft.keyColumn}
            onChange={(v) => set({ keyColumn: v })}
            none="No key: replace all rows on every sync"
            options={[...new Set([...cols, ...(draft.keyColumn ? [draft.keyColumn] : [])])].map((c) => ({ value: c, label: c }))}
            className="w-72"
            aria-label="Key column"
          />
          <Hint className="text-xs">
            {draft.keyColumn ? "Rows with the same key are updated, new keys are added; rows missing from the source stay." : "Row ids change on every sync."}
          </Hint>
        </div>

        <Label htmlFor="src-interval" className="pt-2">
          Sync every
        </Label>
        <div className="flex items-center gap-2">
          <Input id="src-interval" type="number" min={0} className="w-24" value={draft.interval} onChange={(e) => set({ interval: e.target.value })} placeholder="off" />
          <span className="text-sm text-muted-foreground">minutes (min. 5; only while the server runs)</span>
        </div>

        <Label className="pt-1">After sync</Label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.applyLabels} onCheckedChange={(v) => set({ applyLabels: v })} /> Create / update the labels (needs a label design)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!canSave || test.isPending} onClick={() => test.mutate()}>
          <IconEye /> Test
        </Button>
        <Button disabled={!canSave || busy} onClick={saveAndSync}>
          <IconCloudDownload /> {s ? "Save and sync" : "Link and sync"}
        </Button>
        <Button
          variant="ghost"
          disabled={!canSave || busy}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => toast.success("Saved"),
              onError: (e) => toast.error((e as Error).message),
            })
          }
        >
          Save only
        </Button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm">
            <strong>{preview.total}</strong> rows{preview.truncated ? " (first 50,000 used)" : ""}, columns: {preview.columns.join(", ") || "none"}
          </div>
          {preview.warnings.map((w) => (
            <div key={w} className="text-xs text-amber-700 dark:text-amber-400">
              {w}
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  {preview.columns.slice(0, 12).map((c) => (
                    <th key={c} className="border-b px-2 py-1 text-left font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {preview.columns.slice(0, 12).map((c) => (
                      <td key={c} className="max-w-48 truncate border-b px-2 py-1">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
