"use client";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { datasetToLabels, matchedTemplateRules, type DataColumn, type DatasetLink, type Library } from "@labebal/core";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { isInverted, usePrintContext } from "../labels/context";
import { LabelPreview } from "../labels/LabelPreview";
import { fetchRows, isSelected, rowsKey, toggleSelected, type RowQuery, type Selection } from "./api";
import { Hint } from "./ui";
import { apiRoot } from "../../lib/base";

const PAGE = 24;

/**
 * One preview per row, exactly as it would print with the current printer /
 * size settings. Rows come a page at a time (the search from the Table tab
 * applies), so large datasets stay quick.
 */
export function PreviewPanel({
  dataset,
  lib,
  query,
  selection,
  onSelect,
}: {
  dataset: { id: string; name: string; columns: DataColumn[]; link?: DatasetLink };
  lib: Library;
  query: RowQuery;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const ctx = usePrintContext();
  const [page, setPage] = useState(0);
  const [onlySelected, setOnlySelected] = useState(false);
  const pickedIds = selection.mode === "ids" && onlySelected ? [...selection.ids] : undefined;
  const q: RowQuery = onlySelected && selection.mode === "filter" ? { q: selection.filter.q, column: selection.filter.column } : onlySelected ? {} : query;
  const res = useQuery({
    queryKey: [...rowsKey(dataset.id), "preview", q, pickedIds, page],
    queryFn: () =>
      pickedIds
        ? fetchRows(dataset.id, { ids: pickedIds.slice(page * PAGE, page * PAGE + PAGE), limit: PAGE }).then((r) => ({ ...r, total: pickedIds.length }))
        : fetchRows(dataset.id, { ...q, offset: page * PAGE, limit: PAGE }),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => {
    const rs = res.data?.rows ?? [];
    return onlySelected && selection.mode === "filter" ? rs.filter((r) => isSelected(selection, r.id)) : rs;
  }, [res.data, onlySelected, selection]);
  const built = useMemo(
    () => (dataset.link ? datasetToLabels({ ...dataset, rows }, rows, lib.templates) : []),
    [dataset, rows, lib.templates],
  );
  const existing = useMemo(() => new Set(lib.labels.map((l) => l.id)), [lib.labels]);
  // Duplicate keys across the whole dataset (not just this page): those rows would share one label.
  const keyColumn = dataset.link?.keyColumn;
  const dupes = useQuery({
    queryKey: [...rowsKey(dataset.id), "duplicates", keyColumn],
    queryFn: () =>
      fetch(`${apiRoot()}/datasets/${encodeURIComponent(dataset.id)}/duplicates`).then((r) => (r.ok ? (r.json() as Promise<{ value: string; count: number }[]>) : [])),
    enabled: !!keyColumn,
  });
  const keyName = dataset.columns.find((c) => c.id === keyColumn)?.name ?? keyColumn;
  const ruleName = (id: string) => {
    const i = dataset.link?.rules.rules.findIndex((r) => r.id === id) ?? -1;
    return dataset.link?.rules.rules[i]?.name || `Rule #${i + 1}`;
  };

  if (!dataset.link) return <Hint>Choose a label design on the &quot;Label design&quot; tab first.</Hint>;
  const total = res.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Previewing on <strong>{ctx.size.name}</strong> ({ctx.printer.name}). Change the size on the Print page.
          {!onlySelected && query.q ? ` Rows matching "${query.q}".` : ""}
        </span>
        <label className="ml-auto flex items-center gap-2">
          <Checkbox
            checked={onlySelected}
            onCheckedChange={(v) => {
              setOnlySelected(!!v);
              setPage(0);
            }}
          />{" "}
          Only selected rows
        </label>
      </div>
      {!!dupes.data?.length && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
            <IconAlertTriangle className="size-4" /> {dupes.data.length} {keyName} value{dupes.data.length === 1 ? " is" : "s are"} used by more than one row
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rows with the same {keyName} become the same label, so only the last one is kept. Make them unique, or pick a different key column on the
            &quot;Label design&quot; tab.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {dupes.data.slice(0, 12).map((d) => (
              <li key={d.value} className="rounded bg-background px-1.5 py-0.5 font-mono">
                {d.value || "(empty)"} ×{d.count}
              </li>
            ))}
            {dupes.data.length > 12 && <li className="text-muted-foreground">and {dupes.data.length - 12} more</li>}
          </ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {built.map(({ row, label, matched, problems }) => {
          const t = lib.templates.find((x) => x.id === label.templateId);
          const sel = isSelected(selection, row.id);
          const tplRules = t ? matchedTemplateRules(t, label) : [];
          return (
            <div key={row.id} className={`space-y-2 rounded-lg border p-3 ${sel ? "border-primary/60 bg-primary/5" : ""}`}>
              <div className="flex items-start gap-2">
                <Checkbox checked={sel} onCheckedChange={(v) => onSelect(toggleSelected(selection, row.id, !!v))} aria-label={`Select ${label.name}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{label.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{existing.has(label.id) ? "Label exists (will be updated)" : "New label"}</div>
                </div>
              </div>
              {t ? (
                <LabelPreview
                  template={t}
                  label={label}
                  invert={isInverted(label, t, ctx.settings.invertAll)}
                  size={ctx.size}
                  printer={ctx.printer}
                  material={ctx.settings.material}
                  ribbon={ctx.settings.ribbon}
                  marginMm={ctx.settings.marginMm}
                  scale={6}
                />
              ) : null}
              <div className="flex flex-wrap gap-1">
                {matched.map((id) => (
                  <Badge key={id} variant="secondary">
                    {ruleName(id)}
                  </Badge>
                ))}
                {tplRules.map((id) => (
                  <Badge key={`t-${id}`} variant="outline" title="Template rule">
                    {t?.rules?.rules.find((r) => r.id === id)?.name || "Template rule"}
                  </Badge>
                ))}
                {!matched.length && !tplRules.length && <span className="text-xs text-muted-foreground">No rule applied</span>}
              </div>
              {problems.map((p) => (
                <p key={p} className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                  <IconAlertTriangle className="size-3.5 shrink-0" /> {p}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      {total > PAGE && (
        <div className="flex items-center gap-2 text-sm">
          <Button size="icon-sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <IconChevronLeft />
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pages} ({total} rows)
          </span>
          <Button size="icon-sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
            <IconChevronRight />
          </Button>
        </div>
      )}
      {!res.isLoading && !built.length && <Hint>No rows to preview.</Hint>}
    </div>
  );
}
