"use client";
/**
 * Route: /quick. Phone / tablet print view: big touch targets, no editor.
 * Pick a label, a stock run or a recent print, set copies, connect, print.
 * Works offline once installed (library and fonts are cached; history is
 * queued, see features/pwa).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconBluetoothOff,
  IconCheck,
  IconHistory,
  IconMinus,
  IconPackages,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconTag,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label, Library } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useCan } from "../auth/me-client";
import { useLibrary } from "../labels/api";
import { isInverted, templateOf, usePrintContext } from "../labels/context";
import { LabelPreview } from "../labels/LabelPreview";
import { printLabels } from "../labels/print";
import { printers, usePrinter } from "../labels/printer";
import { ConnectMenu } from "../labels/ConnectMenu";
import { shortModel } from "../printers/targets";
import { useLabelStore } from "../labels/store";
import { useRuns, type Run } from "../runs/api";
import { useOnline } from "../pwa/PwaSetup";
import { apiRoot } from "../../lib/base";
import { useRouter, useSearchParams } from "../../lib/router";

type Tab = "labels" | "runs" | "recent";

interface RecentJob {
  id: string;
  printedAt: string;
  source: string;
  totalQty: number;
  items: { labelId: string; name: string; qty: number }[];
}

/** What the print button prints. */
type Pick = { kind: "label"; label: Label } | { kind: "run"; run: Run } | { kind: "recent"; job: RecentJob };

export function QuickPrint() {
  const { data: lib, error } = useLibrary();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, choose] = useState<Tab>("labels");
  // Boards moved to their own page: keep old /quick?board=<id> links working.
  const oldBoard = params.get("board");
  useEffect(() => {
    if (oldBoard) router.replace(`/boards/${encodeURIComponent(oldBoard)}`);
  }, [oldBoard, router]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [copies, setCopies] = useState(1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-3 pb-40 sm:p-4">
          <PrinterCard />
          <div role="tablist" aria-label="What to print" className="grid grid-cols-3 gap-2">
            {(
              [
                ["labels", "Labels", IconTag],
                ["runs", "Stock runs", IconPackages],
                ["recent", "Recent", IconHistory],
              ] as const
            ).map(([id, name, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  tab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
                onClick={() => choose(id)}
              >
                <Icon className="size-5" aria-hidden /> {name}
              </button>
            ))}
          </div>
          {error && !lib && <p className="text-destructive">Could not load labels: {String(error)}</p>}
          {!lib && !error && <p className="text-muted-foreground">Loading…</p>}
          {lib && tab === "labels" && <LabelPicker lib={lib} selected={pick?.kind === "label" ? pick.label.id : null} onPick={(label) => setPick({ kind: "label", label })} />}
          {lib && tab === "runs" && <RunPicker selected={pick?.kind === "run" ? pick.run.id : null} onPick={(run) => setPick({ kind: "run", run })} />}
          {lib && tab === "recent" && <RecentPicker selected={pick?.kind === "recent" ? pick.job.id : null} onPick={(job) => setPick({ kind: "recent", job })} />}
        </div>
      </div>
      {lib && pick && <PrintBar lib={lib} pick={pick} copies={copies} setCopies={setCopies} onClear={() => setPick(null)} />}
    </div>
  );
}

/* ----------------------------------------------------------- printer card */

function PrinterCard() {
  const p = usePrinter();
  const { settings, sizes, size } = usePrintContext();
  const set = useLabelStore((s) => s.setSettings);
  return (
    <section aria-label="Printer" className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <span className={cn("size-3 shrink-0 rounded-full", p.connected ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{p.connected ? shortModel(p.model) : "No printer connected"}</p>
          <p className="truncate text-sm text-muted-foreground" role="status">
            {p.status}
          </p>
        </div>
        {p.connected ? (
          <Button size="lg" variant="outline" className="h-12 px-4" onClick={() => void printers.remove(p.connection.id)}>
            <IconBluetoothOff /> Disconnect
          </Button>
        ) : (
          <ConnectMenu size="lg" className="h-12 px-4" />
        )}
      </div>
      {!p.connected && !p.supported.bluetooth && (
        <p className="rounded-lg bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
          This browser can&apos;t talk to Bluetooth printers: use a network printer, or Chrome on Android / Chrome or Edge on a computer.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Label size</span>
        <Select value={size.id} onValueChange={(sizeId) => set({ sizeId })}>
          <SelectTrigger className="h-11 flex-1" aria-label="Label size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizes.map((z) => (
              <SelectItem key={z.id} value={z.id} className="py-2.5">
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="sr-only">Printer {shortModel(settings.printer)}</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- pickers */

const itemClass = (on: boolean) =>
  cn(
    "flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card p-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
    on ? "border-primary ring-2 ring-primary" : "hover:bg-muted",
  );

function LabelPicker({ lib, selected, onPick }: { lib: Library; selected: string | null; onPick: (l: Label) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...lib.labels].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return needle ? all.filter((l) => `${l.name} ${Object.values(l.values).join(" ")} ${(l.tags ?? []).join(" ")}`.toLowerCase().includes(needle)) : all;
  }, [lib.labels, q]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="h-12 pl-10 text-base" placeholder="Search labels" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search labels" type="search" />
      </div>
      <ul className="space-y-2">
        {shown.slice(0, 200).map((l) => (
          <li key={l.id}>
            <button className={itemClass(selected === l.id)} onClick={() => onPick(l)} aria-pressed={selected === l.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{templateOf(lib, l)?.name ?? "Template missing"}</span>
              </span>
              {selected === l.id && <IconCheck className="size-6 text-primary" aria-hidden />}
            </button>
          </li>
        ))}
        {!shown.length && <li className="p-4 text-center text-muted-foreground">{q ? "No labels match." : "No labels yet."}</li>}
        {shown.length > 200 && <li className="p-2 text-center text-sm text-muted-foreground">Showing 200 of {shown.length}. Search to narrow down.</li>}
      </ul>
    </div>
  );
}

function RunPicker({ selected, onPick }: { selected: string | null; onPick: (r: Run) => void }) {
  const { data: runs, isLoading } = useRuns();
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!runs?.length) return <p className="p-4 text-center text-muted-foreground">No stock runs. Save a print queue as a run on the Print page.</p>;
  return (
    <ul className="space-y-2">
      {runs.map((r) => {
        const total = r.items.reduce((a, i) => a + i.qty, 0);
        return (
          <li key={r.id}>
            <button className={itemClass(selected === r.id)} onClick={() => onPick(r)} aria-pressed={selected === r.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {r.items.length} label{r.items.length === 1 ? "" : "s"}, {total} to print
                </span>
              </span>
              {selected === r.id && <IconCheck className="size-6 text-primary" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RecentPicker({ selected, onPick }: { selected: string | null; onPick: (j: RecentJob) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["history", { limit: 30 }],
    queryFn: () => fetch(`${apiRoot()}/history?limit=30`).then((r) => (r.ok ? (r.json() as Promise<RecentJob[]>) : [])),
  });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data?.length) return <p className="p-4 text-center text-muted-foreground">Nothing printed yet.</p>;
  return (
    <ul className="space-y-2">
      {data.map((j) => (
        <li key={j.id}>
          <button className={itemClass(selected === j.id)} onClick={() => onPick(j)} aria-pressed={selected === j.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{j.items.map((i) => i.name).join(", ")}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {new Date(j.printedAt).toLocaleString()} · {j.totalQty} label{j.totalQty === 1 ? "" : "s"}
              </span>
            </span>
            {selected === j.id && <IconCheck className="size-6 text-primary" aria-hidden />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- print bar */

function itemsFor(lib: Library, pick: Pick, copies: number): { label: Label; qty: number }[] {
  const byId = (id: string) => lib.labels.find((l) => l.id === id);
  const list =
    pick.kind === "label"
      ? [{ label: pick.label, qty: 1 }]
      : (pick.kind === "run" ? pick.run.items : pick.job.items).map((i) => ({ label: byId(i.labelId), qty: i.qty })).filter((i): i is { label: Label; qty: number } => !!i.label);
  return list.map((i) => ({ ...i, qty: i.qty * copies })).filter((i) => i.qty > 0);
}

function PrintBar({ lib, pick, copies, setCopies, onClear }: { lib: Library; pick: Pick; copies: number; setCopies: (n: number) => void; onClear: () => void }) {
  const ctx = usePrintContext();
  const p = usePrinter();
  const online = useOnline();
  const canPrint = useCan("printer");
  const items = itemsFor(lib, pick, copies);
  const total = items.reduce((a, i) => a + i.qty, 0);
  const title = pick.kind === "label" ? pick.label.name : pick.kind === "run" ? pick.run.name : "Reprint";
  const single = pick.kind === "label" ? pick.label : undefined;
  const template = templateOf(lib, single);
  const source = pick.kind === "label" ? "quick" : pick.kind === "run" ? `run:${pick.run.id}` : "reprint";

  const print = async () => {
    try {
      await printLabels(lib, items, ctx, { source });
      toast.success(`Printed ${total} label${total === 1 ? "" : "s"}${online ? "" : " (history is sent when back online)"}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 shadow-[0_-4px_16px_rgb(0_0_0/0.08)] backdrop-blur" role="region" aria-label="Print">
      <div className="mx-auto max-w-2xl space-y-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3">
          {single && template ? (
            <LabelPreview
              template={template}
              label={single}
              invert={isInverted(single, template, ctx.settings.invertAll)}
              size={ctx.size}
              printer={ctx.printer}
              material={ctx.settings.material}
              ribbon={ctx.settings.ribbon}
              marginMm={ctx.settings.marginMm}
              scale={Math.min(6, 140 / ctx.size.widthMm, 64 / ctx.size.heightMm)}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">
              {items.length} label{items.length === 1 ? "" : "s"} · {total} to print
            </p>
          </div>
          <Button variant="ghost" size="icon-lg" aria-label="Clear selection" onClick={onClear}>
            <IconX />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border" role="group" aria-label="Copies">
            <Button variant="ghost" className="size-12 rounded-xl" aria-label="Fewer copies" disabled={copies <= 1} onClick={() => setCopies(Math.max(1, copies - 1))}>
              <IconMinus className="size-5" />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              className="h-12 w-16 border-0 text-center text-lg shadow-none"
              value={copies}
              onChange={(e) => setCopies(Math.min(999, Math.max(1, e.target.valueAsNumber || 1)))}
              aria-label={pick.kind === "label" ? "Copies" : "Times each"}
            />
            <Button variant="ghost" className="size-12 rounded-xl" aria-label="More copies" onClick={() => setCopies(Math.min(999, copies + 1))}>
              <IconPlus className="size-5" />
            </Button>
          </div>
          <Button
            className="h-12 flex-1 text-base"
            disabled={!p.connected || p.busy || !total || !canPrint}
            onClick={() => void print()}
            title={!canPrint ? "Your role can't print" : !p.connected ? "Connect the printer first" : undefined}
          >
            <IconPrinter className="size-5" /> {p.busy ? "Printing…" : `Print ${total}`}
          </Button>
        </div>
        {p.busy && p.progress && <progress className="h-2 w-full" max={p.progress.total} value={p.progress.done} aria-label="Print progress" />}
        {!canPrint && <p className="text-sm text-muted-foreground">You can look, but your role can&apos;t print. Ask an admin for the printer role.</p>}
      </div>
    </div>
  );
}
