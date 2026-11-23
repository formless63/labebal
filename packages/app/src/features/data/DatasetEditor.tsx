"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../../lib/router";
import { useRouter } from "../../lib/router";
import { IconDownload, IconListCheck, IconPrinter, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { toCsv, type DataColumn, type DatasetLink, type Library } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useLabelStore } from "../labels/store";
import { emptySelection, fetchFullDataset, selectionBody, selectionSize, send, useDatasetActions, type DatasetMeta, type RowQuery, type Selection } from "./api";
import { DataGrid } from "./DataGrid";
import { ImportRowsDialog } from "./ImportRowsDialog";
import { LinkPanel } from "./LinkPanel";
import { PreviewPanel } from "./PreviewPanel";
import { RulesPanel } from "./RulesPanel";
import { SourcePanel } from "./SourcePanel";
import { apiRoot } from "../../lib/base";

const SAVE_DELAY = 700;

type MetaPatch = { name?: string; columns?: DataColumn[]; link?: DatasetLink | null };

/**
 * Edits one dataset. Name / columns / link save automatically (PATCH, only
 * what changed); rows are edited in the grid, which patches them itself.
 * Mount with `key={id}`.
 */
export function DatasetEditor({ initial, lib, onDeleted, initialQuery }: { initial: DatasetMeta; lib: Library; onDeleted: () => void; initialQuery?: RowQuery }) {
  const [draftMeta, setDraft] = useState(initial);
  // Row count follows the server (it changes with adds / deletes / imports).
  const draft = useMemo(() => ({ ...draftMeta, rowCount: initial.rowCount }), [draftMeta, initial.rowCount]);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [query, setQuery] = useState<RowQuery>(initialQuery ?? {});
  const [matching, setMatching] = useState(initial.rowCount);
  const [tab, setTab] = useState(initial.link && !initialQuery?.q ? "preview" : "rows");
  const [dirty, setDirty] = useState(false);
  const { patch, remove, applyLabels } = useDatasetActions();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<MetaPatch>({});
  const enqueue = useLabelStore((s) => s.enqueue);
  const router = useRouter();

  const persist = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const p = pending.current;
    pending.current = {};
    if (!Object.keys(p).length) return;
    try {
      await patch.mutateAsync({ id: draft.id, ...p });
      setDirty(false);
    } catch (e) {
      pending.current = { ...p, ...pending.current };
      toast.error(`Could not save: ${(e as Error).message}`);
      throw e;
    }
  };

  const change = (p: MetaPatch, save = true) => {
    setDraft((d) => ({ ...d, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.columns ? { columns: p.columns } : {}), ...(p.link !== undefined ? { link: p.link ?? undefined } : {}) }));
    if (!save) return;
    pending.current = { ...pending.current, ...p };
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist().catch(() => {}), SAVE_DELAY);
  };

  // Save pending edits when leaving the page / switching datasets.
  useEffect(
    () => () => {
      if (timer.current && Object.keys(pending.current).length) {
        clearTimeout(timer.current);
        void send(`${apiRoot()}/datasets/${encodeURIComponent(initial.id)}`, "PATCH", pending.current, { keepalive: true });
      }
    },
    [initial.id],
  );

  const onQueryChange = useCallback((q: RowQuery) => {
    setQuery(q);
    // "All matching" selections follow the search they were made with.
    setSelection((s) => (s.mode === "filter" ? emptySelection() : s));
  }, []);

  const count = selectionSize(selection, selection.mode === "filter" && !selection.filter.q ? draft.rowCount : matching);
  const scope =
    selection.mode === "ids" && !selection.ids.size
      ? `all ${draft.rowCount}`
      : selection.mode === "filter" && selection.filter.q
        ? `${count} matching "${selection.filter.q}"`
        : `${count} selected`;

  async function createLabels() {
    try {
      if (timer.current) await persist();
      const r = await applyLabels.mutateAsync({ id: draft.id, ...selectionBody(selection) });
      toast.success(`${r.created} label${r.created === 1 ? "" : "s"} created, ${r.updated} updated`, {
        description: r.skipped.length ? `${r.skipped.length} skipped: ${r.skipped[0].reason}` : undefined,
      });
      return r;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addToQueue() {
    const r = await createLabels();
    if (!r) return;
    for (const id of r.labelIds) enqueue(id, 1);
    toast.success(`Added ${r.labelIds.length} label${r.labelIds.length === 1 ? "" : "s"} to the print queue`, {
      action: { label: "Go to Print", onClick: () => router.push("/") },
    });
  }

  async function exportCsv() {
    try {
      const full = await fetchFullDataset(draft.id);
      const url = URL.createObjectURL(new Blob([toCsv(full)], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${draft.name}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Could not export: ${(e as Error).message}`);
    }
  }

  async function del() {
    const ok = await confirmDialog({
      title: `Delete the data "${draft.name}"?`,
      description: `All ${draft.rowCount} rows are deleted. Labels already created from it are kept.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = {};
    await remove.mutateAsync(draft.id);
    onDeleted();
  }

  const onTotal = useCallback((n: number) => setMatching(n), []);
  const addColumns = (cols: DataColumn[]) => change({ columns: [...draft.columns, ...cols.filter((c) => !draft.columns.some((x) => x.id === c.id))] }, false);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 max-w-sm text-base font-medium" value={draft.name} onChange={(e) => change({ name: e.target.value })} aria-label="Data name" />
        <span className="text-xs text-muted-foreground">{patch.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <ImportRowsDialog
            dataset={draft}
            onColumnsAdded={addColumns}
          />
          <Button variant="outline" onClick={exportCsv} title="Download as CSV">
            <IconDownload /> CSV
          </Button>
          <Button variant="ghost" onClick={del} title="Delete this data">
            <IconTrash />
          </Button>
        </div>
      </div>

      {draft.link && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm">
            Rows: <strong>{scope}</strong>
          </span>
          <Button size="sm" disabled={applyLabels.isPending || !draft.rowCount || (selection.mode === "filter" && !count)} onClick={() => void createLabels()}>
            <IconListCheck /> Create / update labels
          </Button>
          <Button size="sm" variant="outline" disabled={applyLabels.isPending || !draft.rowCount || (selection.mode === "filter" && !count)} onClick={addToQueue}>
            <IconPrinter /> Add {selection.mode === "ids" && !selection.ids.size ? "all" : "selected"} to print queue
          </Button>
          {(selection.mode === "filter" || selection.ids.size > 0) && (
            <Button size="sm" variant="ghost" onClick={() => setSelection(emptySelection())}>
              Clear selection
            </Button>
          )}
          <Link href="/" className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">
            Open Print page
          </Link>
        </div>
      )}

      {!draft.link && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
          <span>Next step: choose which label design these rows print with.</span>
          <Button size="sm" onClick={() => setTab("link")}>
            Choose label design
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rows">Table</TabsTrigger>
          <TabsTrigger value="link">Label design</TabsTrigger>
          <TabsTrigger value="rules">Rules{draft.link?.rules.rules.length ? ` (${draft.link.rules.rules.length})` : ""}</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="source">Live source</TabsTrigger>
        </TabsList>
        <TabsContent value="rows" className="space-y-2 pt-3" forceMount hidden={tab !== "rows"}>
          <DataGrid
            datasetId={draft.id}
            columns={draft.columns}
            keyColumn={draft.link?.keyColumn}
            onColumnsChange={(columns) => change({ columns })}
            query={query}
            onQueryChange={onQueryChange}
            selection={selection}
            onSelect={setSelection}
            onTotal={onTotal}
          />
          <p className="text-xs text-muted-foreground">
            ID for the API: <code className="select-all">{draft.id}</code>
          </p>
        </TabsContent>
        <TabsContent value="link" className="pt-3">
          <LinkPanel dataset={draft} lib={lib} onChange={(link) => change({ link })} />
        </TabsContent>
        <TabsContent value="rules" className="pt-3">
          <RulesPanel dataset={draft} lib={lib} onChange={(link) => change({ link })} />
        </TabsContent>
        <TabsContent value="source" className="pt-3">
          <SourcePanel dataset={draft} onColumnsAdded={addColumns} />
        </TabsContent>
        <TabsContent value="preview" className="pt-3">
          <PreviewPanel key={JSON.stringify(query)} dataset={draft} lib={lib} query={query} selection={selection} onSelect={setSelection} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
