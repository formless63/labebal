"use client";
import { useDeferredValue, useState } from "react";
import { useRouter } from "../../lib/router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBan, IconHistory, IconPlaylistAdd, IconPrinter, IconRestore, IconSearch, IconUser } from "@tabler/icons-react";
import { toast } from "sonner";
import { materialById, ribbonById, type Label, type LabelNode, type Library, type Template } from "@labebal/core";
import { Page } from "../../components/app-shell";
import { promptDialog } from "../../components/dialogs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { json } from "../data/api";
import { Hint, Pick } from "../data/ui";
import { useLibrary } from "../labels/api";
import { usePrintContext } from "../labels/context";
import { whoHeader } from "../labels/history-client";
import { printLabels } from "../labels/print";
import { usePrinter } from "../labels/printer";
import { useLabelStore } from "../labels/store";
import { useRuns } from "../runs/api";
import { apiRoot } from "../../lib/base";

interface HistoryItem {
  labelId: string;
  name: string;
  templateId: string;
  templateName?: string;
  qty: number;
  invert: boolean;
  values?: Record<string, string>;
  overrides?: Record<string, Partial<LabelNode>>;
  templateVersion?: number;
  thumb?: string;
}

interface HistoryEntry {
  id: string;
  printedAt: string;
  source: string;
  printer: string;
  sizeId: string;
  sizeName: string;
  material: string;
  ribbon: string;
  invertAll: boolean;
  totalQty: number;
  items: HistoryItem[];
  client: string;
  who: string;
  voidedAt: string | null;
  voidReason: string;
  voidedBy: string;
}

interface Snapshot extends HistoryEntry {
  templates: { templateId: string; version: number; doc: Template }[];
}

const PAGE = 50;

const SOURCES = [
  { value: "queue", label: "Print queue" },
  { value: "label", label: "Single label" },
  { value: "run:", label: "Stock runs" },
  { value: "dataset:", label: "Data" },
  { value: "reprint:", label: "Reprints" },
];

const VOIDED = [
  { value: "exclude", label: "Hide voided" },
  { value: "only", label: "Only voided" },
];

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What was printed, when, on what, from where. Entries keep a snapshot so they can be reprinted exactly, or voided. */
export function HistoryPage() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<string | undefined>();
  const [who, setWhoFilter] = useState<string | undefined>();
  const [voided, setVoided] = useState<string | undefined>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reprinting, setReprinting] = useState<HistoryEntry | null>(null);
  const search = useDeferredValue(q.trim());
  const { data: runs } = useRuns();
  const qc = useQueryClient();

  const people = useQuery({ queryKey: ["history", "people"], queryFn: () => fetch(`${apiRoot()}/history/people`).then((r) => json<{ who: string; jobs: number }[]>(r)) });
  const params = { q: search, source, who, voided, from, to };
  const hist = useInfiniteQuery({
    queryKey: ["history", params],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: String(PAGE) });
      if (search) sp.set("q", search);
      if (source) sp.set("source", source);
      if (who) sp.set("who", who);
      if (voided) sp.set("voided", voided);
      if (from) sp.set("from", new Date(`${from}T00:00`).toISOString());
      if (to) sp.set("to", new Date(new Date(`${to}T00:00`).getTime() + 86_400_000).toISOString());
      if (pageParam) sp.set("before", pageParam);
      return fetch(`${apiRoot()}/history?${sp}`).then((r) => json<HistoryEntry[]>(r));
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].printedAt : undefined),
  });
  const entries = hist.data?.pages.flat() ?? [];
  const filtered = !!(q || source || who || voided || from || to);

  const sourceName = (s: string) => {
    if (s.startsWith("run:")) return `Run: ${runs?.find((r) => r.id === s.slice(4))?.name ?? "deleted run"}`;
    if (s.startsWith("dataset:")) return "Data";
    if (s.startsWith("reprint:")) return "Reprint";
    return SOURCES.find((x) => x.value === s)?.label ?? (s || "Unknown");
  };

  async function setVoid(e: HistoryEntry, v: boolean) {
    let reason = "";
    if (v) {
      const r = await promptDialog({ title: "Void this print?", description: "It stays in the history, marked as void (e.g. a mis-print or the wrong roll).", label: "Reason", placeholder: "Smudged, wrong roll…", confirmLabel: "Void" });
      if (r === null) return;
      reason = r;
    }
    const res = await fetch(`${apiRoot()}/history/${e.id}`, { method: "PATCH", headers: { "content-type": "application/json", ...whoHeader() }, body: JSON.stringify({ voided: v, reason }) });
    if (!res.ok) return toast.error(`Couldn't update: ${res.status}`);
    toast.success(v ? "Marked as void" : "No longer void");
    void qc.invalidateQueries({ queryKey: ["history"] });
  }

  return (
    <Page title="History">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <IconSearch className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search label names" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Pick value={source} onChange={setSource} none="From anywhere" options={SOURCES} size="default" aria-label="Printed from" />
        <Pick
          value={who}
          onChange={setWhoFilter}
          none="By anyone"
          options={[...(people.data ?? []).map((p) => ({ value: p.who, label: `${p.who} (${p.jobs})` })), { value: "-", label: "Name not set" }]}
          size="default"
          aria-label="Printed by"
        />
        <Pick value={voided} onChange={setVoided} none="Voided too" options={VOIDED} size="default" aria-label="Voided prints" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          to <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <Button variant="ghost" onClick={() => (setQ(""), setSource(undefined), setWhoFilter(undefined), setVoided(undefined), setFrom(""), setTo(""))}>
            Clear filters
          </Button>
        )}
      </div>

      {hist.error && <p className="text-destructive">Could not load history: {String(hist.error)}</p>}
      {hist.isLoading && <Hint>Loading…</Hint>}
      {!hist.isLoading && !entries.length && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <IconHistory className="mx-auto mb-2" />
          {filtered ? "Nothing printed matches these filters." : "Nothing printed yet. Every print is listed here."}
        </div>
      )}

      <ul className="divide-y rounded-xl border bg-card">
        {entries.map((e) => (
          <li key={e.id} className={cn("flex flex-wrap items-start gap-4 p-4", e.voidedAt && "bg-muted/40")}>
            <div className="w-40 shrink-0 text-sm">
              <div className={cn("font-medium", e.voidedAt && "line-through decoration-destructive")}>{fmt.format(new Date(e.printedAt))}</div>
              <div className="text-xs text-muted-foreground">{sourceName(e.source)}</div>
              {e.who && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <IconUser className="size-3.5" /> {e.who}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {e.voidedAt && (
                <div className="text-sm text-destructive">
                  Void{e.voidReason ? `: ${e.voidReason}` : ""}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ({fmt.format(new Date(e.voidedAt))}
                    {e.voidedBy ? `, ${e.voidedBy}` : ""})
                  </span>
                </div>
              )}
              {e.items.some((i) => i.thumb) && (
                <div className="flex flex-wrap gap-1.5">
                  {e.items
                    .filter((i) => i.thumb)
                    .slice(0, 8)
                    .map((i, n) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={n} src={i.thumb} alt={i.name} title={`${i.name} ×${i.qty}`} className="h-10 rounded-[2px] bg-white ring-1 ring-border" style={{ imageRendering: "pixelated" }} />
                    ))}
                </div>
              )}
              <div className="text-sm">
                {e.items.slice(0, 6).map((i, n) => (
                  <span key={n}>
                    {n > 0 && ", "}
                    {i.name}
                    <span className="text-muted-foreground"> ×{i.qty}</span>
                    {i.templateVersion && <span className="text-muted-foreground"> (v{i.templateVersion})</span>}
                    {i.invert && <span className="text-muted-foreground"> (inverted)</span>}
                  </span>
                ))}
                {e.items.length > 6 && <span className="text-muted-foreground"> and {e.items.length - 6} more</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary">{e.totalQty} printed</Badge>
                <Badge variant="outline">{e.printer}</Badge>
                <Badge variant="outline">{e.sizeName}</Badge>
                <Badge variant="outline">
                  {materialById(e.material).id === e.material ? materialById(e.material).name : e.material} stock, {ribbonById(e.ribbon).id === e.ribbon ? ribbonById(e.ribbon).name : e.ribbon} ribbon
                </Badge>
                {e.client && <Badge variant="outline">{e.client}</Badge>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setReprinting(e)}>
                <IconPlaylistAdd /> Reprint
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void setVoid(e, !e.voidedAt)}>
                {e.voidedAt ? <IconRestore /> : <IconBan />} {e.voidedAt ? "Unvoid" : "Void"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {hist.hasNextPage && (
        <Button variant="outline" disabled={hist.isFetchingNextPage} onClick={() => void hist.fetchNextPage()}>
          Show older
        </Button>
      )}
      {reprinting && <ReprintDialog entry={reprinting} onClose={() => setReprinting(null)} />}
    </Page>
  );
}

/**
 * Reprint: "as printed" uses the snapshot (values + the template version it
 * printed with), "with current design" uses today's template and label.
 */
function ReprintDialog({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const [mode, setMode] = useState<"snapshot" | "current">("snapshot");
  const [busy, setBusy] = useState(false);
  const { data: lib } = useLibrary();
  const ctx = usePrintContext();
  const p = usePrinter();
  const enqueue = useLabelStore((s) => s.enqueue);
  const router = useRouter();
  const qc = useQueryClient();
  const snap = useQuery({ queryKey: ["history", "snapshot", entry.id], queryFn: () => fetch(`${apiRoot()}/history/${entry.id}?snapshot=1`).then((r) => json<Snapshot>(r)) });
  const items = entry.items.filter((i) => i.qty > 0);
  const have = new Set(lib?.labels.map((l) => l.id));
  const haveT = new Set(lib?.templates.map((t) => t.id));
  const snapshotOk = items.every((i) => i.values) && !!snap.data;
  const missingVersions = items.filter((i) => !snap.data?.templates.some((t) => t.templateId === i.templateId && t.version === i.templateVersion));

  /** Library + items to print for the chosen mode. */
  function build(): { lib: Library; items: { label: Label; qty: number }[]; skipped: number } | null {
    if (!lib) return null;
    if (mode === "current") {
      const ok = items.filter((i) => have.has(i.labelId));
      return { lib, items: ok.map((i) => ({ label: lib.labels.find((l) => l.id === i.labelId)!, qty: i.qty })), skipped: items.length - ok.length };
    }
    const templates = new Map<string, Template>();
    const out: { label: Label; qty: number }[] = [];
    let skipped = 0;
    items.forEach((i, n) => {
      const v = snap.data?.templates.find((t) => t.templateId === i.templateId && t.version === i.templateVersion);
      const t = v?.doc ?? lib.templates.find((x) => x.id === i.templateId);
      if (!t || !i.values) return void skipped++;
      // One template per version (two versions of a template can be in one job).
      const tid = `${t.id}@${i.templateVersion ?? "current"}`;
      templates.set(tid, { ...t, id: t.id });
      out.push({ label: { id: `${i.labelId}#${n}`, templateId: t.id, name: i.name, values: i.values, ...(i.overrides ? { overrides: i.overrides } : {}), invert: i.invert }, qty: i.qty });
    });
    // Same template id with different versions can't share a library: print per template version.
    return { lib: { version: 2, templates: [...templates.values()], labels: out.map((o) => o.label) }, items: out, skipped };
  }

  async function printNow() {
    const b = build();
    if (!b?.items.length) return toast.error("Nothing left to reprint");
    setBusy(true);
    try {
      // Snapshot items already carry their final invert; don't flip them again.
      const pctx = mode === "snapshot" ? { ...ctx, settings: { ...ctx.settings, invertAll: false } } : ctx;
      const groups = new Map<string, { label: Label; qty: number }[]>();
      b.items.forEach((it, n) => {
        const key = mode === "snapshot" ? `${it.label.templateId}@${items[n]?.templateVersion ?? ""}` : "all";
        groups.set(key, [...(groups.get(key) ?? []), it]);
      });
      for (const [key, group] of groups) {
        const t = mode === "snapshot" ? (snap.data?.templates.find((v) => `${v.templateId}@${v.version}` === key)?.doc ?? b.lib.templates.find((x) => x.id === group[0].label.templateId)) : undefined;
        const glib: Library = mode === "snapshot" && t ? { version: 2, templates: [t], labels: group.map((g) => g.label) } : b.lib;
        await printLabels(glib, group, pctx, { source: `reprint:${entry.id}` });
      }
      toast.success(`Reprinted ${b.items.reduce((a, i) => a + i.qty, 0)} labels`, { description: b.skipped ? `${b.skipped} skipped (deleted since).` : undefined });
      void qc.invalidateQueries({ queryKey: ["history"] });
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toQueue() {
    const ok = items.filter((i) => have.has(i.labelId));
    for (const i of ok) enqueue(i.labelId, i.qty);
    const gone = items.length - ok.length;
    toast.success(`Added ${ok.reduce((a, i) => a + i.qty, 0)} labels to the print queue`, {
      description: gone ? `${gone} label${gone === 1 ? " was" : "s were"} deleted since and skipped.` : undefined,
      action: { label: "Go to Print", onClick: () => router.push("/") },
    });
    onClose();
  }

  const sizeDiffers = entry.sizeId !== ctx.size.id;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reprint</DialogTitle>
          <DialogDescription>
            {entry.totalQty} label{entry.totalQty === 1 ? "" : "s"} printed {fmt.format(new Date(entry.printedAt))} on {entry.sizeName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", mode === "snapshot" && "border-primary ring-1 ring-primary", !snapshotOk && "opacity-60")}>
            <input type="radio" name="mode" checked={mode === "snapshot"} disabled={!snapshotOk} onChange={() => setMode("snapshot")} />
            <span className="text-sm">
              <span className="font-medium">As printed</span>
              <span className="block text-muted-foreground">
                {snapshotOk
                  ? `The same values and the design version it was printed with${missingVersions.length ? " (some versions are gone: those use the current design)" : ""}.`
                  : snap.isLoading
                    ? "Loading the snapshot…"
                    : "This entry is older than snapshots; use the current design."}
              </span>
            </span>
          </label>
          <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", mode === "current" && "border-primary ring-1 ring-primary")}>
            <input type="radio" name="mode" checked={mode === "current"} onChange={() => setMode("current")} />
            <span className="text-sm">
              <span className="font-medium">With current design</span>
              <span className="block text-muted-foreground">Today&apos;s templates and label values{items.some((i) => !have.has(i.labelId) || !haveT.has(i.templateId)) ? "; labels deleted since are skipped" : ""}.</span>
            </span>
          </label>
          {sizeDiffers && <p className="text-sm text-amber-600">Printed on {entry.sizeName}; the printer is now set to {ctx.size.name}.</p>}
          {!p.connected && <p className="text-sm text-muted-foreground">Connect the printer (top right) to print from here.</p>}
        </div>
        <DialogFooter>
          {mode === "current" && (
            <Button variant="outline" onClick={toQueue}>
              <IconPlaylistAdd /> Add to queue
            </Button>
          )}
          <Button disabled={!p.connected || p.busy || busy || (mode === "snapshot" && !snapshotOk)} onClick={() => void printNow()}>
            <IconPrinter /> Print now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
