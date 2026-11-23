"use client";
import { useState } from "react";
import { useSearchParams } from "../../lib/router";
import { IconDatabase, IconWand } from "@tabler/icons-react";
import { Page } from "../../components/app-shell";
import { useLibrary } from "../labels/api";
import { cn } from "../../lib/utils";
import { useDataset, useDatasets } from "./api";
import { DatasetEditor } from "./DatasetEditor";
import { NewDatasetDialog } from "./NewDatasetDialog";
import { TemplateRulesPanel } from "./TemplateRulesPanel";
import { Hint } from "./ui";

/** Sidebar pick: a dataset id, or the template rules view. */
type View = { kind: "dataset"; id: string } | { kind: "rules"; templateId?: string };

/** Data: tables of records that become labels (CSV, spreadsheet paste, API), and template rules. */
export function DataPage() {
  const sp = useSearchParams();
  const rulesFor = sp.get("rules") ?? undefined;
  // `?dataset=<id>&q=<text>` opens a dataset filtered to matching rows (Scan > Open row).
  const openId = sp.get("dataset") ?? undefined;
  const openQ = sp.get("q") ?? undefined;
  const list = useDatasets();
  const { data: lib } = useLibrary();
  const [view, setView] = useState<View | null>(rulesFor ? { kind: "rules", templateId: rulesFor } : openId ? { kind: "dataset", id: openId } : null);
  // Follow later ?dataset= changes (scanning again while on this page).
  const [seen, setSeen] = useState(`${openId}|${openQ}`);
  if (`${openId}|${openQ}` !== seen) {
    setSeen(`${openId}|${openQ}`);
    if (openId) setView({ kind: "dataset", id: openId });
  }
  const activeId = view?.kind === "dataset" ? view.id : view ? null : (list.data?.[0]?.id ?? null);
  const ds = useDataset(activeId);
  const tplName = (id?: string) => lib?.templates.find((t) => t.id === id)?.name;
  const withRules = lib?.templates.filter((t) => t.rules?.rules.length).length ?? 0;

  return (
    <Page title="Data" actions={<NewDatasetDialog onCreated={(id) => setView({ kind: "dataset", id })} />} className="max-w-[1600px]">
      <Hint>
        Keep your records here (drawer contents, products, stock) and turn every row into a label. Import a CSV, paste from a spreadsheet, or send rows from
        another system with the API (Settings &gt; API access).
      </Hint>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {list.data?.map((d) => (
            <button
              key={d.id}
              onClick={() => setView({ kind: "dataset", id: d.id })}
              className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-accent", d.id === activeId && "bg-accent")}
            >
              <div className="truncate text-sm font-medium">{d.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {d.rows} rows{tplName(d.templateId) ? ` · ${tplName(d.templateId)}` : " · not linked"}
              </div>
            </button>
          ))}
          {list.isLoading && <Hint className="px-3">Loading…</Hint>}
          {list.data?.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              <IconDatabase className="mx-auto mb-2" />
              No data yet. Click &quot;New data&quot;.
            </div>
          )}
          <div className="border-t pt-2">
            <button
              onClick={() => setView({ kind: "rules", templateId: view?.kind === "rules" ? view.templateId : undefined })}
              className={cn("flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-accent", view?.kind === "rules" && "bg-accent")}
            >
              <IconWand className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">Template rules</span>
                <span className="block text-xs text-muted-foreground">{withRules ? `${withRules} template${withRules === 1 ? "" : "s"} with rules` : "Style every label of a template"}</span>
              </span>
            </button>
          </div>
        </nav>
        <div className="min-w-0">
          {view?.kind === "rules" && lib && <TemplateRulesPanel lib={lib} templateId={view.templateId} onTemplate={(templateId) => setView({ kind: "rules", templateId })} />}
          {view?.kind !== "rules" && ds.error && <p className="text-destructive">Could not load: {String(ds.error)}</p>}
          {view?.kind !== "rules" && ds.data && lib && (
            <DatasetEditor
              key={`${ds.data.id}|${ds.data.id === openId ? openQ : ""}`}
              initial={ds.data}
              lib={lib}
              onDeleted={() => setView(null)}
              initialQuery={ds.data.id === openId && openQ ? { q: openQ } : undefined}
            />
          )}
        </div>
      </div>
    </Page>
  );
}
