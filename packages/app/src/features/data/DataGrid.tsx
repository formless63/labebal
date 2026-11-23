"use client";
/**
 * Spreadsheet-like row editor for datasets of any size. Rows are fetched from
 * the server in pages as you scroll (TanStack Virtual keeps only the visible
 * rows in the DOM); cell edits are optimistic and patched in batches.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconArrowDown, IconArrowUp, IconColumnInsertRight, IconPlus, IconRowInsertBottom, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { columnIdFor, type DataColumn, type DataRow } from "@labebal/core";
import { confirmDialog, promptDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import {
  createCellSaver,
  emptySelection,
  fetchRows,
  isSelected,
  rowsKey,
  selectionSize,
  toggleSelected,
  useDatasetActions,
  type RowPage,
  type RowQuery,
  type Selection,
} from "./api";

const PAGE = 100;
const ROW_H = 32;
const COL_W = 176;
const CHECK_W = 40;

function ColumnHeader({
  col,
  isKey,
  sort,
  onSort,
  onRename,
  onDelete,
}: {
  col: DataColumn;
  isKey: boolean;
  sort?: "asc" | "desc";
  onSort: (dir: "asc" | "desc" | undefined) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Input
        autoFocus
        defaultValue={col.name}
        className="h-7"
        onBlur={(e) => {
          if (e.target.value.trim()) onRename(e.target.value.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left font-medium hover:bg-accent" title="Sort, rename or remove this column">
          <span className="truncate">{col.name}</span>
          {isKey && <span className="rounded bg-primary/10 px-1 text-[10px] font-normal text-primary">key</span>}
          {sort === "asc" && <IconArrowUp className="ml-auto size-3.5 shrink-0" />}
          {sort === "desc" && <IconArrowDown className="ml-auto size-3.5 shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onSort("asc")}>Sort A → Z</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSort("desc")}>Sort Z → A</DropdownMenuItem>
        {sort && <DropdownMenuItem onSelect={() => onSort(undefined)}>Original order</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setEditing(true)}>Rename column</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
          Remove column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One editable cell; keeps its own text while focused so refetches don't fight typing. */
const Cell = memo(function Cell({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value;
  return (
    <input
      className="h-full w-full truncate border-l bg-transparent px-2 outline-none focus:bg-background focus:ring-2 focus:ring-ring/50 focus:ring-inset"
      value={shown}
      onFocus={() => {
        setText(value);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      aria-label={label}
    />
  );
});

export interface GridProps {
  datasetId: string;
  columns: DataColumn[];
  keyColumn?: string;
  onColumnsChange: (columns: DataColumn[]) => void;
  query: RowQuery;
  onQueryChange: (q: RowQuery) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Rows matching the current search (reported once the first page loads). */
  onTotal?: (n: number) => void;
}

export function DataGrid({ datasetId, columns, keyColumn, onColumnsChange, query, onQueryChange, selection, onSelect, onTotal }: GridProps) {
  const qc = useQueryClient();
  const { addRows, deleteRows } = useDatasetActions();
  const [search, setSearch] = useState(query.q ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const saver = useMemo(() => createCellSaver(datasetId, (e) => toast.error(`Could not save: ${e.message}`)), [datasetId]);

  // Debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => search.trim() !== (query.q ?? "") && onQueryChange({ ...query, q: search.trim() || undefined }), 250);
    return () => clearTimeout(t);
  }, [search, query, onQueryChange]);

  // Flush pending edits when leaving (keepalive survives navigation).
  useEffect(() => () => void saver.flush(true), [saver]);

  const pageQuery = (p: number) => ({
    queryKey: [...rowsKey(datasetId), query, p] as const,
    queryFn: () => fetchRows(datasetId, { ...query, offset: p * PAGE, limit: PAGE }),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  // Page 0 gives the total; the virtualizer then says which pages are on screen.
  const first = useQuery(pageQuery(0));
  const total = first.data?.total ?? 0;
  const loading = first.isLoading;
  useEffect(() => onTotal?.(total), [total, onTotal]);

  // The compiler skips memoizing this component (known TanStack Virtual limitation); it re-renders on scroll anyway.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 15,
  });
  const items = virt.getVirtualItems();
  const firstPage = items.length ? Math.floor(items[0].index / PAGE) : 0;
  const lastPage = items.length ? Math.floor(items[items.length - 1].index / PAGE) : 0;
  const wanted = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage + i).filter((p) => p > 0);
  const pages = useQueries({ queries: wanted.map((p) => ({ ...pageQuery(p), placeholderData: undefined })) });
  const byPage = new Map<number, RowPage>();
  if (first.data) byPage.set(0, first.data);
  wanted.forEach((p, i) => pages[i].data && byPage.set(p, pages[i].data!));

  const rowAt = (i: number): DataRow | undefined => byPage.get(Math.floor(i / PAGE))?.rows[i % PAGE];

  const setCell = (rowId: string, col: string, v: string) => {
    saver.set(rowId, col, v);
    qc.setQueriesData<RowPage>({ queryKey: rowsKey(datasetId) }, (pg) =>
      pg && pg.rows.some((r) => r.id === rowId) ? { ...pg, rows: pg.rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [col]: v } } : r)) } : pg,
    );
  };

  const shownAll = selection.mode === "filter";
  const count = selectionSize(selection, total);

  async function addRow() {
    await saver.flush();
    try {
      await addRows.mutateAsync({ id: datasetId, rows: [{}], mode: "append" });
      setSearch("");
      onQueryChange({});
      // Scroll to the new last row once the count refreshes.
      setTimeout(() => virt.scrollToIndex(Number.MAX_SAFE_INTEGER, { align: "end" }), 300);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addColumn() {
    const name = (
      await promptDialog({
        title: "Add a column",
        label: "Column name",
        placeholder: "e.g. Location",
        confirmLabel: "Add column",
        validate: (v) => (!v.trim() ? "Type a name" : columns.some((c) => c.name.toLowerCase() === v.trim().toLowerCase()) ? "There is already a column with that name" : undefined),
      })
    )?.trim();
    if (!name) return;
    const id = columnIdFor(name, new Set(columns.map((c) => c.id)));
    onColumnsChange([...columns, { id, name }]);
  }

  async function removeColumn(c: DataColumn) {
    const ok = await confirmDialog({ title: `Remove the column "${c.name}"?`, description: "Its values are deleted from every row.", confirmLabel: "Remove column", destructive: true });
    if (ok) onColumnsChange(columns.filter((x) => x.id !== c.id));
  }

  async function deleteSelected() {
    const ok = await confirmDialog({
      title: `Delete ${count} row${count === 1 ? "" : "s"}?`,
      description: "Labels already created from them are kept.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await saver.flush();
    try {
      const r = await deleteRows.mutateAsync(
        selection.mode === "ids" ? { id: datasetId, rowIds: [...selection.ids] } : { id: datasetId, filter: { ...selection.filter, excludeIds: [...selection.except] } },
      );
      toast.success(`Deleted ${r.deleted} row${r.deleted === 1 ? "" : "s"}`);
      onSelect(emptySelection());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const loadedRows = [...byPage.values()].flatMap((p) => p.rows);
  const headerChecked = shownAll ? (selection.except.size ? "indeterminate" : true) : selection.ids.size ? "indeterminate" : false;
  const width = CHECK_W + columns.length * COL_W;
  const gridCols = `${CHECK_W}px repeat(${columns.length}, ${COL_W}px)`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <IconSearch className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 w-56 pr-7 pl-8" placeholder="Search rows" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch("")} aria-label="Clear search">
              <IconX className="size-3.5" />
            </button>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={addRow} disabled={addRows.isPending}>
          <IconRowInsertBottom /> Add row
        </Button>
        <Button size="sm" variant="outline" onClick={addColumn}>
          <IconColumnInsertRight /> Add column
        </Button>
        <Button size="sm" variant="destructive" disabled={!count || deleteRows.isPending} onClick={deleteSelected}>
          <IconTrash /> Delete selected
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {count ? `${count} selected · ` : ""}
          {query.q ? `${total} matching` : `${total} rows`}
        </span>
      </div>
      {query.q && total > 0 && !shownAll && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button size="xs" variant="outline" onClick={() => onSelect({ mode: "filter", filter: { q: query.q, column: query.column }, except: new Set() })}>
            Select all {total} matching rows
          </Button>
        </div>
      )}
      <div ref={scrollRef} className="relative h-[min(65vh,720px)] overflow-auto rounded-lg border text-sm" role="grid" aria-rowcount={total}>
        <div style={{ width, minWidth: "100%" }}>
          <div className="sticky top-0 z-10 grid border-b bg-muted" style={{ gridTemplateColumns: gridCols, height: ROW_H + 4 }} role="row">
            <div className="flex items-center justify-center">
              <Checkbox
                checked={headerChecked}
                onCheckedChange={(v) => {
                  if (!v || headerChecked) return onSelect(emptySelection());
                  if (query.q) return onSelect({ mode: "filter", filter: { q: query.q, column: query.column }, except: new Set() });
                  onSelect({ mode: "filter", filter: {}, except: new Set() });
                }}
                aria-label={query.q ? "Select all matching rows" : "Select all rows"}
              />
            </div>
            {columns.map((c) => (
              <div key={c.id} className="flex min-w-0 items-center border-l px-1" role="columnheader">
                <ColumnHeader
                  col={c}
                  isKey={c.id === keyColumn}
                  sort={query.sort === c.id ? (query.dir ?? "asc") : undefined}
                  onSort={(dir) => onQueryChange({ ...query, sort: dir ? c.id : undefined, dir })}
                  onRename={(name) => onColumnsChange(columns.map((x) => (x.id === c.id ? { ...x, name } : x)))}
                  onDelete={() => void removeColumn(c)}
                />
              </div>
            ))}
          </div>
          <div className="relative" style={{ height: virt.getTotalSize() }}>
            {items.map((v) => {
              const r = rowAt(v.index);
              const sel = r ? isSelected(selection, r.id) : false;
              return (
                <div
                  key={r?.id ?? `i${v.index}`}
                  role="row"
                  aria-rowindex={v.index + 1}
                  className={cn("absolute left-0 grid w-full border-b hover:bg-muted/30", sel && "bg-primary/5")}
                  style={{ top: v.start, height: ROW_H, gridTemplateColumns: gridCols }}
                >
                  {r ? (
                    <>
                      <div className="flex items-center justify-center">
                        <Checkbox checked={sel} onCheckedChange={(on) => onSelect(toggleSelected(selection, r.id, !!on))} aria-label="Select row" />
                      </div>
                      {columns.map((c) => (
                        <Cell key={c.id} value={r.values[c.id] ?? ""} label={c.name} onChange={(val) => setCell(r.id, c.id, val)} />
                      ))}
                    </>
                  ) : (
                    <div className="col-span-full flex items-center px-3 text-xs text-muted-foreground">Loading…</div>
                  )}
                </div>
              );
            })}
          </div>
          {!loading && total === 0 && (
            <div className="p-6 text-center text-muted-foreground">
              {query.q ? (
                "No rows match the search."
              ) : (
                <>
                  No rows yet.{" "}
                  <Button variant="link" onClick={addRow}>
                    <IconPlus /> Add a row
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {loadedRows.length === 0 && loading && <p className="text-xs text-muted-foreground">Loading rows…</p>}
    </div>
  );
}
