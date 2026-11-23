"use client";
import { useState } from "react";
import { IconPrinter, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Collation, Library } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { RunProgress, StoppedRuns } from "../printers/RunControls";
import { printOn, routeQueue } from "../printers/runs";
import { usePrinterTargets } from "../printers/targets";
import { Hint } from "../printers/ui";
import { SaveQueueAsRun } from "../runs/SaveQueueAsRun";
import { PreflightBadge } from "../preflight";
import { isInverted, usePrintContext } from "./context";
import { countRun } from "./print";
import { askForPrintValues } from "../print-form/ask";
import { useLabelStore } from "./store";

export function PrintQueue({ lib }: { lib: Library }) {
  const ctx = usePrintContext();
  const targets = usePrinterTargets();
  const queue = useLabelStore((s) => s.queue);
  const collation: Collation = ctx.settings.collation ?? "grouped";
  const { setQty, removeFromQueue, clearQueue, updateItem, setAllTicked, removeItems, setSettings } = useLabelStore.getState();
  const [range, setRange] = useState("");
  const [starting, setStarting] = useState(false);

  const items = queue.flatMap((q) => {
    const label = lib.labels.find((l) => l.id === q.labelId);
    return label ? [{ item: q, label }] : [];
  });
  const ticked = items.filter((i) => !i.item.off && i.item.qty > 0);
  const routed = routeQueue(lib, ticked, targets);
  const routeOf = new Map(routed.map((r) => [r.item.id, r]));
  const groups = new Map<string, typeof routed>();
  for (const r of routed) if (r.target) groups.set(r.target, [...(groups.get(r.target) ?? []), r]);
  const multi = targets.length > 1;
  const rangeUsable = groups.size <= 1;
  const run = countRun(ticked.map((i) => i.item), rangeUsable ? range : "");
  const anyBusy = targets.some((t) => t.snapshot.busy);
  const showOrder = ticked.length > 1 && ticked.some((i) => i.item.qty > 1);
  const allTicked = items.length > 0 && items.every((i) => !i.item.off);

  async function printTicked() {
    if (run.error || !groups.size) return;
    // Print-time form (fields marked "ask when printing"), once for the whole queue.
    const asked = await askForPrintValues(lib, ticked.map((i) => ({ label: i.label, qty: i.item.qty })));
    if (!asked) return;
    setStarting(true);
    try {
      const results = await Promise.allSettled(
        [...groups].map(async ([tid, rs]) => {
          const t = targets.find((x) => x.id === tid)!;
          const ids = rs.map((r) => r.item.id);
          const out = await printOn(lib, t, rs.map((r) => ({ label: r.label, qty: r.item.qty })), { ...asked, collation, range: rangeUsable ? range : undefined, source: "queue" }, ids);
          if (out.status === "done" && !(rangeUsable && range.trim())) removeItems(ids);
          return out;
        }),
      );
      for (const r of results) {
        if (r.status === "rejected") toast.error(String(r.reason));
        else if (r.value.status === "done") toast.success(`Printed ${r.value.printed} label${r.value.printed === 1 ? "" : "s"}${multi ? ` on the ${r.value.printerName}` : ""}`);
        else if (r.value.status === "failed") toast.error(`Printing stopped on the ${r.value.printerName}: ${r.value.error ?? "unknown error"}`);
      }
    } finally {
      setStarting(false);
    }
  }

  const printLabel = !rangeUsable || !range.trim() || run.error ? `Print ${run.total} label${run.total === 1 ? "" : "s"}` : `Print ${run.count} of ${run.total}`;

  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <div className="flex items-center gap-2 p-3">
        {items.length > 0 && <Checkbox checked={allTicked} onCheckedChange={(v) => setAllTicked(v === true)} aria-label="Tick all labels" title="Tick or untick all" />}
        <h2 className="flex-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Print queue</h2>
        <span className="text-xs text-muted-foreground">
          {run.total} label{run.total === 1 ? "" : "s"}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-y">
          {items.map(({ item: q, label }) => {
            const t = lib.templates.find((x) => x.id === label.templateId);
            const r = routeOf.get(q.id);
            const routedTo = r?.target ? targets.find((x) => x.id === r.target) : undefined;
            return (
              <li key={q.id} className={`space-y-1 px-3 py-2 ${q.off ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2">
                  <Checkbox checked={!q.off} onCheckedChange={(v) => updateItem(q.id, { off: v !== true })} aria-label={`Print ${label.name}`} title="Only ticked labels are printed" />
                  <span className="min-w-0 flex-1 text-sm">
                    {label.name}
                    {isInverted(label, t, ctx.settings.invertAll) && <span className="text-muted-foreground"> (inverted)</span>}
                  </span>
                  <PreflightBadge template={t} label={label} />
                  <Input type="number" className="h-8 w-16" min={0} max={999} value={q.qty} onChange={(e) => setQty(q.id, e.target.valueAsNumber || 0)} aria-label={`Copies of ${label.name}`} title="Copies" />
                  <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => removeFromQueue(q.id)}>
                    <IconX />
                  </Button>
                </div>
                {multi && (
                  <div className="flex items-center gap-1 pl-6 text-xs text-muted-foreground">
                    <span>Printer</span>
                    <Select value={q.printerKey && targets.some((x) => x.key === q.printerKey) ? q.printerKey : "auto"} onValueChange={(v) => updateItem(q.id, { printerKey: v === "auto" ? undefined : v })}>
                      <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Best fit{routedTo && !r?.pinned ? ` (${routedTo.name}, ${routedTo.ctx.size.name})` : ""}</SelectItem>
                        {targets
                          .filter((x) => x.key)
                          .map((x) => (
                            <SelectItem key={x.id} value={x.key!}>
                              {x.name} · {x.ctx.size.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-2 text-sm text-muted-foreground">Empty. Use + on a label, or &quot;Add to queue&quot;.</li>}
        </ul>
      </ScrollArea>

      {ticked.length > 0 && (run.total > 1 || showOrder) && (
        <div className="space-y-2 border-t px-3 py-2 text-xs">
          {showOrder && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Copies</span>
              <ToggleGroup type="single" variant="outline" size="sm" value={collation} onValueChange={(v) => v && setSettings({ collation: v as Collation })}>
                <ToggleGroupItem value="grouped" className="text-xs" title="All copies of a label one after another: A A B B">
                  Together
                </ToggleGroupItem>
                <ToggleGroupItem value="collated" className="text-xs" title="One of each label, then the next set: A B A B">
                  In sets
                </ToggleGroupItem>
              </ToggleGroup>
              <Hint>
                With several copies: <b>Together</b> prints A, A, B, B (copies side by side). <b>In sets</b> prints A, B, A, B, so each set comes off the roll complete.
              </Hint>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="print-range" className="text-muted-foreground">
              Only labels
            </label>
            <Input
              id="print-range"
              className="h-7 w-28 text-xs"
              placeholder="all"
              value={rangeUsable ? range : ""}
              disabled={!rangeUsable}
              onChange={(e) => setRange(e.target.value)}
            />
            <Hint>
              {rangeUsable
                ? "Print part of the run, e.g. 40-80, or 1-5, 12. Labels are numbered in the order they come out of the printer (all copies counted)."
                : "Not available while the labels go to more than one printer."}
            </Hint>
          </div>
          {run.error && <p className="text-destructive">{run.error}</p>}
        </div>
      )}

      <RunProgress />
      <StoppedRuns lib={lib} />

      <div className="flex flex-wrap gap-2 border-t p-3">
        <Button disabled={!targets.length || anyBusy || starting || !run.total || !!run.error || !groups.size} onClick={printTicked} title={targets.length ? "" : "Connect a printer first"}>
          <IconPrinter /> {printLabel}
        </Button>
        <Button variant="outline" disabled={!queue.length} onClick={clearQueue}>
          Clear
        </Button>
        <SaveQueueAsRun />
      </div>
      {multi && groups.size > 1 && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          Prints on {groups.size} printers at once: {[...groups].map(([id, rs]) => `${targets.find((t) => t.id === id)?.name} (${rs.reduce((n, r) => n + r.item.qty, 0)})`).join(", ")}.
        </p>
      )}
    </aside>
  );
}
