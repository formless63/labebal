"use client";
import { useState } from "react";
import { useRouter } from "../../lib/router";
import { IconPackages, IconPencil, IconPlaylistAdd, IconPlus, IconPrinter, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Library } from "@labebal/core";
import { Page } from "../../components/app-shell";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Hint, Pick } from "../data/ui";
import { useLibrary } from "../labels/api";
import { usePrintContext } from "../labels/context";
import { printLabels } from "../labels/print";
import { askForPrintValues } from "../print-form/ask";
import { usePrinter } from "../labels/printer";
import { useLabelStore } from "../labels/store";
import { newRunId, useRunActions, useRuns, type Run } from "./api";

const total = (r: Run) => r.items.reduce((a, i) => a + i.qty, 0);

function RunEditor({ run, lib, onDone }: { run: Run; lib: Library; onDone: () => void }) {
  const [draft, setDraft] = useState(run);
  const { save } = useRunActions();
  const setItem = (i: number, qty: number) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, qty } : x)) });
  const unused = lib.labels.filter((l) => !draft.items.some((i) => i.labelId === l.id));

  async function submit() {
    try {
      await save.mutateAsync(draft);
      toast.success("Run saved");
      onDone();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-3">
      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Run name" className="font-medium" />
      <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes (optional), e.g. when to print this" />
      <ul className="divide-y rounded-md border">
        {draft.items.map((it, i) => (
          <li key={it.labelId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{lib.labels.find((l) => l.id === it.labelId)?.name ?? <em className="text-muted-foreground">deleted label</em>}</span>
            <Input type="number" className="h-8 w-20" min={0} max={9999} value={it.qty} onChange={(e) => setItem(i, e.target.valueAsNumber || 0)} aria-label="Quantity" />
            <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>
              <IconX />
            </Button>
          </li>
        ))}
      </ul>
      <Pick
        value={undefined}
        onChange={(id) => id && setDraft({ ...draft, items: [...draft.items, { labelId: id, qty: 1 }] })}
        placeholder="Add a label…"
        options={unused.map((l) => ({ value: l.id, label: l.name }))}
        className="w-full"
      />
      <div className="flex gap-2">
        <Button disabled={save.isPending || !draft.name.trim()} onClick={submit}>
          Save
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RunCard({ run, lib }: { run: Run; lib: Library }) {
  const [editing, setEditing] = useState(false);
  const ctx = usePrintContext();
  const p = usePrinter();
  const enqueue = useLabelStore((s) => s.enqueue);
  const router = useRouter();
  const { remove } = useRunActions();
  const items = run.items.map((i) => ({ ...i, label: lib.labels.find((l) => l.id === i.labelId) }));
  const missing = items.filter((i) => !i.label).length;
  const printable = items.filter((i) => i.label && i.qty > 0).map((i) => ({ label: i.label!, qty: i.qty }));

  function load() {
    for (const i of printable) enqueue(i.label.id, i.qty);
    toast.success(`Added ${printable.reduce((a, i) => a + i.qty, 0)} labels to the print queue`, { action: { label: "Go to Print", onClick: () => router.push("/") } });
  }

  async function printNow() {
    try {
      const asked = await askForPrintValues(lib, printable); // print-time form
      if (!asked) return;
      await printLabels(lib, printable, ctx, { source: `run:${run.id}`, ...asked });
      toast.success(`Printed "${run.name}"`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {editing ? (
        <RunEditor run={run} lib={lib} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-medium">{run.name}</h2>
              <p className="text-xs text-muted-foreground">
                {run.items.length} labels · {total(run)} prints
                {missing ? ` · ${missing} deleted label${missing === 1 ? "" : "s"} skipped` : ""}
              </p>
            </div>
            <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => setEditing(true)}>
              <IconPencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Delete run"
              onClick={async () =>
                (await confirmDialog({ title: `Delete the run "${run.name}"?`, description: "The labels themselves are kept.", confirmLabel: "Delete", destructive: true })) && remove.mutate(run.id)
              }
            >
              <IconTrash />
            </Button>
          </div>
          {run.notes && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{run.notes}</p>}
          <ul className="max-h-48 overflow-y-auto text-sm">
            {items.map((i) => (
              <li key={i.labelId} className="flex justify-between gap-2 py-0.5">
                <span className={i.label ? "truncate" : "truncate text-muted-foreground line-through"}>{i.label?.name ?? "deleted label"}</span>
                <span className="text-muted-foreground tabular-nums">× {i.qty}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!printable.length} onClick={load}>
              <IconPlaylistAdd /> Load into queue
            </Button>
            <Button disabled={!printable.length || !p.connected || p.busy} onClick={printNow} title={p.connected ? "" : "Connect the printer first (top right)"}>
              <IconPrinter /> Print now
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Stock runs: saved batches of labels x quantity. */
export function RunsPage() {
  const { data: runs, isLoading } = useRuns();
  const { data: lib } = useLibrary();
  const queue = useLabelStore((s) => s.queue);
  const { create } = useRunActions();

  const newRun = async (fromQueue: boolean) => {
    const items = fromQueue ? queue.filter((q) => q.qty > 0).map((q) => ({ labelId: q.labelId, qty: q.qty })) : [];
    await create.mutateAsync({ id: newRunId(), name: fromQueue ? "Run from print queue" : "New run", notes: "", items });
    toast.success("Run created. Click the pencil to rename or change it.");
  };

  return (
    <Page
      title="Stock runs"
      actions={
        <>
          <Button variant="outline" disabled={!queue.length} onClick={() => newRun(true)} title="Save the current print queue as a run">
            <IconPlaylistAdd /> From print queue
          </Button>
          <Button onClick={() => newRun(false)}>
            <IconPlus /> New run
          </Button>
        </>
      }
    >
      <Hint>A run is a saved batch, e.g. &quot;Cable restock: 5 of each length&quot;. Load it into the print queue to adjust, or print it straight away.</Hint>
      {isLoading && <Hint>Loading…</Hint>}
      {runs?.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <IconPackages className="mx-auto mb-2" />
          No runs yet. Fill the print queue and click &quot;Save as run&quot;, or start a new run here.
        </div>
      )}
      {lib && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runs?.map((r) => <RunCard key={r.id} run={r} lib={lib} />)}
        </div>
      )}
    </Page>
  );
}
