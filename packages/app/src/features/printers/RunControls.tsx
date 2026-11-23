"use client";
/** Progress of running prints (per printer) with pause / resume / cancel, and stopped runs to continue. */
import { useState } from "react";
import { IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label, Library } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { usePrinters } from "../labels/printer";
import { useLabelStore } from "../labels/store";
import { printOn, useRunStore, type StoppedRun } from "./runs";
import { printerKey, shortModel } from "./targets";

/** One bar per printer that is printing. */
export function RunProgress() {
  const list = usePrinters();
  const busy = list.filter((p) => p.busy && p.progress);
  if (!busy.length) return null;
  return (
    <div className="space-y-3 border-t px-3 py-2 text-xs">
      {busy.map((p) => {
        const pr = p.progress!;
        return (
          <div key={p.id} className="space-y-1" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {list.length > 1 && <b>{shortModel(p.model)}: </b>}
                {p.paused ? "Paused" : `Label ${Math.min(pr.done + 1, pr.total)} of ${pr.total}`}
                {!p.paused && pr.current ? ` · ${pr.current}` : ""}
              </span>
              {p.paused ? (
                <Button size="icon-sm" variant="ghost" title="Resume printing" onClick={() => p.connection.resume()}>
                  <IconPlayerPlay />
                </Button>
              ) : (
                <Button size="icon-sm" variant="ghost" title="Pause after the labels being printed now" onClick={() => p.connection.pause()}>
                  <IconPlayerPause />
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" title="Stop printing" onClick={() => p.connection.cancel()}>
                <IconPlayerStop />
              </Button>
            </div>
            <progress className="w-full" max={pr.total} value={pr.done} />
            {p.paused && <p className="text-muted-foreground">The printer finishes the few labels already sent, then waits. Press play to go on.</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Runs that stopped part-way: continue from label N, or dismiss. */
export function StoppedRuns({ lib }: { lib: Library }) {
  const stopped = useRunStore((s) => s.stopped);
  if (!stopped.length) return null;
  return (
    <div className="space-y-2 border-t px-3 py-2">
      {stopped.map((r) => (
        <StoppedRunCard key={r.id} run={r} lib={lib} />
      ))}
    </div>
  );
}

function StoppedRunCard({ run, lib }: { run: StoppedRun; lib: Library }) {
  const list = usePrinters();
  const dismiss = useRunStore((s) => s.dismiss);
  const removeItems = useLabelStore((s) => s.removeItems);
  const o = run.outcome;
  const next = o.nextLabel ?? o.total + 1;
  const [from, setFrom] = useState(next);
  // Same slot, else the same physical printer reconnected, else the only connected printer of that model.
  const live = list.filter((p) => p.connected);
  const sameModel = live.filter((p) => p.model === run.ctx.printer.model);
  const conn =
    live.find((p) => p.id === run.printerId && p.model === run.ctx.printer.model) ??
    live.find((p) => run.printerKey && printerKey(p) === run.printerKey) ??
    (sameModel.length === 1 ? sameModel[0] : undefined);
  const ready = !!conn?.connected && !conn.busy;
  const items = run.items.map((i) => ({ label: lib.labels.find((l) => l.id === i.labelId), qty: i.qty })).filter((i): i is { label: Label; qty: number } => !!i.label);
  const done = next - 1;

  async function go() {
    if (!conn) return;
    dismiss(run.id);
    try {
      const out = await printOn(lib, { id: conn.connection.id, key: printerKey(conn), name: run.printerName, ctx: run.ctx, connection: conn.connection }, items, { ...run.opts, startAt: from }, run.queueIds);
      if (out.status === "done") {
        toast.success(`Finished: printed labels ${from} to ${out.total}`);
        if (run.queueIds?.length && !run.opts.range) removeItems(run.queueIds);
      }
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1">
          <b>{o.status === "cancelled" ? "Stopped" : "Printing stopped"}</b> on the {run.printerName} after {done} of {o.total} labels
          {o.error ? `: ${o.error}` : "."}
        </p>
        <Button size="icon-sm" variant="ghost" className="size-6" title="Dismiss" onClick={() => dismiss(run.id)}>
          <IconX />
        </Button>
      </div>
      {next <= o.total && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Continue from label</span>
          <Input
            type="number"
            className="h-7 w-16"
            min={1}
            max={o.total}
            value={from}
            onChange={(e) => setFrom(Math.max(1, Math.min(o.total, e.target.valueAsNumber || 1)))}
            aria-label="Continue from label number"
            title="Check the last label that came out complete; reprint from the next one (or from that one if it is damaged)."
          />
          <Button size="sm" className="h-7" disabled={!ready || !items.length} onClick={go} title={ready ? "" : "Connect the printer again first"}>
            <IconRefresh /> Continue
          </Button>
        </div>
      )}
    </div>
  );
}
