"use client";
/** Settings section: outgoing webhooks (signed JSON POSTs on print / void / print-request changes). */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCopy, IconPlus, IconRefresh, IconSend, IconTrash, IconWebhook } from "@tabler/icons-react";
import { toast } from "sonner";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { json, send } from "../data/api";
import { apiRoot } from "../../lib/base";

interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  secretHint: string;
  createdAt: string;
  last?: { event: string; status: string; responseStatus: number | null; error: string | null; at: string; attempts: number };
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

const KEY = ["webhooks"] as const;
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

const EVENT_LABELS: Record<string, string> = {
  print: "Printed",
  void: "Print voided",
  "request.created": "Request received",
  "request.approved": "Request approved",
  "request.rejected": "Request rejected",
  "source.synced": "Data source synced",
  "source.failed": "Data source sync failed",
};

function Deliveries({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, id, "deliveries"], queryFn: () => fetch(`${apiRoot()}/webhooks/${id}/deliveries`).then((r) => json<Delivery[]>(r)) });
  const retry = useMutation({
    mutationFn: (ids: string[]) => send(`${apiRoot()}/webhooks/${id}/deliveries`, "POST", { ids }).then((r) => json<Delivery[]>(r)),
    onSuccess: (d) => {
      qc.setQueryData([...KEY, id, "deliveries"], d);
      void qc.invalidateQueries({ queryKey: KEY, exact: true });
    },
  });
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">No deliveries yet.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {q.data.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2">
          <span className={d.status === "ok" ? "text-green-700 dark:text-green-400" : d.status === "failed" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>{d.status}</span>
          <code>{d.event}</code>
          <span className="text-muted-foreground">
            {when(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
            {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
            {d.status === "pending" && d.attempts > 0 ? ` · next ${when(d.nextAttemptAt)}` : ""}
          </span>
          {d.lastError && <span className="text-destructive">{d.lastError}</span>}
          {d.status !== "ok" && (
            <Button size="xs" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate([d.id])}>
              <IconRefresh /> Retry
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function SecretDialog({ secret, onClose }: { secret: { name: string; secret: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret{secret?.name ? ` for “${secret.name}”` : ""}</DialogTitle>
          <DialogDescription>
            Each request carries <code>X-Labebal-Timestamp</code> and <code>X-Labebal-Signature: sha256=&lt;hex&gt;</code>, the HMAC-SHA256 of{" "}
            <code>&lt;timestamp&gt;.&lt;body&gt;</code> with this secret. Check it on the receiving side.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={secret?.secret ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            onClick={() =>
              secret &&
              navigator.clipboard.writeText(secret.secret).then(
                () => toast.success("Copied"),
                () => toast.error("Could not copy"),
              )
            }
          >
            <IconCopy /> Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => fetch(`${apiRoot()}/webhooks`).then((r) => json<{ events: string[]; webhooks: WebhookInfo[] }>(r)) });
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const create = useMutation({
    mutationFn: () => send(`${apiRoot()}/webhooks`, "POST", { url: url.trim(), name: name.trim() }).then((r) => json<{ info: WebhookInfo; secret: string }>(r)),
    onSuccess: (r) => {
      setSecret({ name: r.info.name, secret: r.secret });
      setUrl("");
      setName("");
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...p }: { id: string; events?: string[]; enabled?: boolean; rotateSecret?: boolean }) => send(`${apiRoot()}/webhooks/${id}`, "PATCH", p).then((r) => json<{ secret?: string }>(r)),
    onSettled: () => void refresh(),
    onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({
    mutationFn: (id: string) => send(`${apiRoot()}/webhooks/${id}/test`, "POST").then((r) => json<Delivery>(r)),
    onSuccess: (d, id) => {
      if (d.status === "ok") toast.success(`Test delivered (HTTP ${d.responseStatus})`);
      else toast.error(`Test failed: ${d.lastError ?? d.status}`, { description: "It will be retried with backoff." });
      void qc.invalidateQueries({ queryKey: [...KEY, id, "deliveries"] });
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const events = q.data?.events ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        labebal POSTs a signed JSON event to these URLs when a label is printed or voided, when a print request arrives or is decided, and after data-source syncs.
        Failed deliveries are retried (30 s, 2 min, 10 min, 1 h, 6 h). Addresses on your local network are blocked unless listed in <code>LABEBAL_FETCH_ALLOW</code>.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) create.mutate();
        }}
      >
        <Input className="w-44" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Webhook name" />
        <Input className="min-w-64 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/labebal" aria-label="Webhook URL" />
        <Button type="submit" disabled={!/^https?:\/\/.+/i.test(url.trim()) || create.isPending}>
          <IconPlus /> Add webhook
        </Button>
      </form>

      <ul className="divide-y rounded-lg border">
        {q.data?.webhooks.map((w) => (
          <li key={w.id} className={`space-y-2 px-3 py-3 text-sm ${w.enabled ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <IconWebhook className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{w.name || w.url}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {w.name && <>{w.url} · </>}
                  {w.last ? `last: ${w.last.event} ${w.last.status}${w.last.responseStatus ? ` (HTTP ${w.last.responseStatus})` : ""} ${when(w.last.at)}` : "nothing sent yet"}
                </div>
              </div>
              <Switch checked={w.enabled} onCheckedChange={(v) => patch.mutate({ id: w.id, enabled: v })} aria-label="Enabled" />
              <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(w.id)}>
                <IconSend /> Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await fetch(`${apiRoot()}/webhooks/${w.id}/secret`).then((x) => json<{ secret: string }>(x));
                  setSecret({ name: w.name || w.url, secret: r.secret });
                }}
              >
                Secret
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === w.id ? null : w.id)}>
                {open === w.id ? "Hide" : "Details"}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                title="Delete"
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Delete this webhook?`, description: w.url, confirmLabel: "Delete", destructive: true }))) return;
                  await send(`${apiRoot()}/webhooks/${w.id}`, "DELETE").then((r) => json<void>(r));
                  void refresh();
                }}
              >
                <IconTrash />
              </Button>
            </div>
            {open === w.id && (
              <div className="space-y-3 rounded-md bg-muted/40 p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <span className="text-xs text-muted-foreground">Events (none ticked = all):</span>
                  {events.map((ev) => (
                    <label key={ev} className="flex items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={w.events.includes(ev)}
                        onCheckedChange={(on) => patch.mutate({ id: w.id, events: on ? [...w.events, ev] : w.events.filter((x) => x !== ev) })}
                      />
                      {EVENT_LABELS[ev] ?? ev}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: "Create a new secret?", description: "The old one stops working immediately.", confirmLabel: "Rotate" }))) return;
                      const r = await patch.mutateAsync({ id: w.id, rotateSecret: true });
                      if (r.secret) setSecret({ name: w.name || w.url, secret: r.secret });
                    }}
                  >
                    Rotate secret
                  </Button>
                  <code className="text-xs text-muted-foreground">{w.secretHint}</code>
                </div>
                <Deliveries id={w.id} />
              </div>
            )}
          </li>
        ))}
        {q.data?.webhooks.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No webhooks yet.</li>}
      </ul>
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}
