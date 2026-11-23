"use client";
/** Settings section: persistent counters (view, edit next number, reset, define). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconChevronRight, IconPencil, IconPlus, IconRotate, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { COUNTER_ID, formatCounter, type CounterDef, type CounterReset, type CounterScope } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { fetchCounter, useCounterActions, useCounters, type CounterInfo, type CounterValueInfo } from "./api";

const SCOPES: Record<CounterScope, string> = { global: "One sequence", template: "Per template", value: "Per field value (e.g. per SKU)" };
const RESETS: Record<CounterReset, string> = {
  never: "Never",
  daily: "Every day",
  weekly: "Every week (ISO)",
  monthly: "Every month",
  yearly: "Every year",
  change: "When a field's value changes",
};
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const err = (e: unknown) => toast.error((e as Error).message);

function describe(c: CounterDef) {
  const scope = c.scope === "value" ? `per ${c.keyField || "?"}` : c.scope === "template" ? "per template" : "shared";
  const reset = c.reset === "change" ? `restarts when ${c.watchField || "?"} changes` : c.reset === "never" ? "never resets" : `resets ${RESETS[c.reset].toLowerCase()}`;
  return `${scope} · ${reset} · starts at ${c.start}${c.format ? ` · shown as ${formatCounter(c.start, c.format)}` : ""}`;
}

export function CountersSection() {
  const counters = useCounters();
  const [editing, setEditing] = useState<CounterDef | "new" | null>(null);
  return (
    <div id="counters" className="scroll-mt-20 space-y-4">
      <p className="text-sm text-muted-foreground">
        Numbers that keep counting between prints: box, batch or serial numbers. Use them in a template as <code>{"{{counter:name}}"}</code> or{" "}
        <code>{"{{counter:name:0000}}"}</code>, or let a template number <code>{"{{seq}}"}</code> from one (Template editor &gt; Fields). Each print reserves its numbers
        on the server, so two printers never get the same number. A counter used in a template is created automatically on its first print.
      </p>
      <Button variant="outline" onClick={() => setEditing("new")}>
        <IconPlus /> New counter
      </Button>
      <ul className="divide-y rounded-lg border">
        {counters.data?.map((c) => (
          <CounterRow key={c.id} c={c} onEdit={() => setEditing(c)} />
        ))}
        {counters.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No counters yet.</li>}
        {counters.error && <li className="px-3 py-2 text-sm text-destructive">{(counters.error as Error).message}</li>}
      </ul>
      {editing && <CounterDialog initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CounterRow({ c, onEdit }: { c: CounterInfo; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const { remove, setValue } = useCounterActions();
  const single = c.scope === "global";
  const main = single ? (c.values.find((v) => v.key === "") ?? null) : null;
  return (
    <li className="space-y-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex min-w-0 flex-1 items-start gap-1.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <IconChevronDown className="mt-0.5 size-4 shrink-0" /> : <IconChevronRight className="mt-0.5 size-4 shrink-0" />}
          <span className="min-w-0">
            <span className="font-medium">{c.name}</span> <code className="text-xs text-muted-foreground">{`{{counter:${c.id}}}`}</code>
            <span className="block text-xs text-muted-foreground">{describe(c)}</span>
          </span>
        </button>
        {single && <NextEditor c={c} v={main} />}
        {!single && <span className="text-xs text-muted-foreground">{c.values.length} sequence{c.values.length === 1 ? "" : "s"}</span>}
        <Button size="icon-sm" variant="ghost" title="Edit counter" onClick={onEdit}>
          <IconPencil />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Reset: the next print starts again"
          disabled={!c.values.length}
          onClick={async () =>
            (await confirmDialog({ title: `Reset "${c.name}"?`, description: `The next print starts at ${c.start}${single ? "" : " for every sequence"}.`, confirmLabel: "Reset" })) &&
            setValue.mutate({ id: c.id }, { onError: err })
          }
        >
          <IconRotate />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive"
          title="Delete counter"
          onClick={async () =>
            (await confirmDialog({ title: `Delete "${c.name}"?`, description: "Its numbers and log are removed. Templates using it start again at its start number (as a new counter).", confirmLabel: "Delete", destructive: true })) &&
            remove.mutate(c.id, { onError: err })
          }
        >
          <IconTrash />
        </Button>
      </div>
      {open && <CounterDetails c={c} />}
    </li>
  );
}

/** Inline "next number" editor for one scope key. */
function NextEditor({ c, v, keyName = "" }: { c: CounterInfo; v: CounterValueInfo | null; keyName?: string }) {
  const { setValue } = useCounterActions();
  const shown = v ? v.nextNow : c.start;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() === "" || !Number.isInteger(n) || n === shown) return;
    setValue.mutate({ id: c.id, key: keyName, next: n }, { onError: err });
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={v && v.next !== v.nextNow ? `Stored ${v.next}; resets before the next print` : undefined}>
      Next
      <Input
        type="number"
        className="h-7 w-24"
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {c.format && <span className="font-mono">{formatCounter(shown, c.format)}</span>}
    </label>
  );
}

function CounterDetails({ c }: { c: CounterInfo }) {
  const { setValue } = useCounterActions();
  const detail = useQuery({ queryKey: ["counters", c.id, c.updatedAt, c.values.map((v) => v.next).join()], queryFn: () => fetchCounter(c.id) });
  const keyLabel = (k: string) => (c.scope === "template" ? k : (k.split("/").slice(1).join("/") || "(empty)") + ` · ${k.split("/")[0]}`);
  return (
    <div className="space-y-3 pl-6">
      {c.scope !== "global" && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">{c.scope === "template" ? "Template" : `${c.keyField} · template`}</th>
              <th className="py-1 font-normal">Next</th>
              <th className="py-1 font-normal">{c.reset === "change" ? `Last ${c.watchField}` : "Period"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {c.values.map((v) => (
              <tr key={v.key} className="border-t">
                <td className="py-1 pr-2 break-all">{keyLabel(v.key)}</td>
                <td className="py-1 pr-2">
                  <NextEditor c={c} v={v} keyName={v.key} />
                </td>
                <td className="py-1 pr-2">{c.reset === "change" ? (v.watched ?? "") : v.period}</td>
                <td className="py-1 text-right">
                  <Button size="xs" variant="ghost" onClick={() => setValue.mutate({ id: c.id, key: v.key }, { onError: err })}>
                    Reset
                  </Button>
                </td>
              </tr>
            ))}
            {!c.values.length && (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={4}>
                  Nothing printed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recently handed out</h3>
        <ul className="space-y-0.5 text-xs">
          {detail.data?.log.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-mono">{l.from === l.to ? formatCounter(l.from, c.format) : `${formatCounter(l.from, c.format)} – ${formatCounter(l.to, c.format)}`}</span>
              <span className="text-muted-foreground">
                {when(l.at)}
                {l.source && ` · ${l.source}`}
                {l.key && c.scope !== "global" && ` · ${keyLabel(l.key)}`}
              </span>
            </li>
          ))}
          {detail.data?.log.length === 0 && <li className="text-muted-foreground">No numbers handed out yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function CounterDialog({ initial, onClose }: { initial?: CounterDef; onClose: () => void }) {
  const { save } = useCounterActions();
  const [d, setD] = useState<CounterDef>(initial ?? { id: "", name: "", scope: "global", reset: "never", start: 1, format: "" });
  const set = (p: Partial<CounterDef>) => setD((x) => ({ ...x, ...p }));
  const idOk = COUNTER_ID.test(d.id);
  const missing = (d.scope === "value" && !d.keyField?.trim()) || (d.reset === "change" && !d.watchField?.trim());
  const submit = () =>
    save.mutate(
      { ...d, name: d.name?.trim() || d.id, keyField: d.keyField?.trim() || undefined, watchField: d.watchField?.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Saved counter "${d.id}"`);
          onClose();
        },
        onError: err,
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (idOk && !missing) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{initial ? `Edit "${initial.name ?? initial.id}"` : "New counter"}</DialogTitle>
            <DialogDescription>Templates show it with {`{{counter:${d.id || "name"}}}`}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ctr-id">Id</Label>
              <Input id="ctr-id" className="font-mono" disabled={!!initial} value={d.id} placeholder="box" onChange={(e) => set({ id: e.target.value.toLowerCase() })} aria-invalid={!!d.id && !idOk} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctr-name">Name</Label>
              <Input id="ctr-name" value={d.name ?? ""} placeholder={d.id || "Box number"} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Counts</Label>
              <Select value={d.scope} onValueChange={(v) => set({ scope: v as CounterScope })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCOPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {d.scope === "value" ? (
              <div className="space-y-1.5">
                <Label htmlFor="ctr-key">Field</Label>
                <Input id="ctr-key" className="font-mono" placeholder="sku" value={d.keyField ?? ""} onChange={(e) => set({ keyField: e.target.value })} />
              </div>
            ) : (
              <div />
            )}
            <div className="space-y-1.5">
              <Label>Starts again</Label>
              <Select value={d.reset} onValueChange={(v) => set({ reset: v as CounterReset })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RESETS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {d.reset === "change" ? (
              <div className="space-y-1.5">
                <Label htmlFor="ctr-watch">Watched field</Label>
                <Input id="ctr-watch" className="font-mono" placeholder="lot" value={d.watchField ?? ""} onChange={(e) => set({ watchField: e.target.value })} />
              </div>
            ) : (
              <div />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ctr-start">Start at</Label>
              <Input id="ctr-start" type="number" value={d.start} onChange={(e) => set({ start: Number.isFinite(e.target.valueAsNumber) ? Math.trunc(e.target.valueAsNumber) : 1 })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctr-format">Format</Label>
              <Input id="ctr-format" className="font-mono" placeholder="0000 or LOT-####" value={d.format ?? ""} onChange={(e) => set({ format: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Format: <code>0000</code> pads to 4 digits, <code>#</code> runs mark the number inside text (<code>B-###</code> shows {formatCounter(d.start, "B-###")}). A token can
            override it: <code>{`{{counter:${d.id || "name"}:000}}`}</code>. Day / week / month resets use the server&apos;s clock.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!idOk || missing || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
