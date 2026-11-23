"use client";
import { useState } from "react";
import { Link } from "../../lib/router";
import { useRouter } from "../../lib/router";
import { IconCheck, IconInbox, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { promptDialog } from "../../components/dialogs";
import { Page } from "../../components/app-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Hint } from "../data/ui";
import { useInbox, useInboxActions, type PrintRequest } from "./api";

const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function What({ r }: { r: PrintRequest }) {
  if (r.labelId)
    return (
      <span>
        <strong>{r.labelName ?? r.labelId}</strong>
        {r.templateName && <span className="text-muted-foreground"> · {r.templateName}</span>}
      </span>
    );
  return (
    <span>
      <strong>{r.name ?? r.key ?? "New label"}</strong> <span className="text-muted-foreground">· new label on {r.templateName ?? r.templateId}</span>
      {r.values && Object.keys(r.values).length > 0 && (
        <span className="block text-xs text-muted-foreground">
          {Object.entries(r.values)
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </span>
      )}
    </span>
  );
}

function Row({ r }: { r: PrintRequest }) {
  const [qty, setQty] = useState(r.qty);
  const { approve, reject, remove } = useInboxActions();
  const router = useRouter();
  const pending = r.status === "pending";

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <What r={r} />
        <div className="text-xs text-muted-foreground">
          {r.requestedBy || "Someone"}
          {r.tokenName && ` via ${r.tokenName}`} · {when(r.createdAt)}
          {!pending && ` · ${r.status}${r.decidedBy ? ` by ${r.decidedBy}` : ""}${r.decidedAt ? ` ${when(r.decidedAt)}` : ""}`}
          {r.reason && ` (${r.reason})`}
        </div>
        {r.note && <div className="mt-1 text-sm">“{r.note}”</div>}
      </div>
      {pending ? (
        <>
          <Input type="number" min={1} max={999} className="h-8 w-16" value={qty} onChange={(e) => setQty(Math.max(1, e.target.valueAsNumber || 1))} aria-label="Quantity" />
          <Button
            size="sm"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate(
                { id: r.id, qty },
                {
                  onSuccess: (x) => toast.success(`Added ${x.qty} × ${x.request.labelName ?? x.labelId} to the print queue`, { action: { label: "Go to Print", onClick: () => router.push("/") } }),
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            <IconCheck /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={reject.isPending}
            onClick={async () => {
              const reason = await promptDialog({ title: "Reject this request?", description: "Optional reason, sent back to the requesting system.", placeholder: "e.g. out of labels", confirmLabel: "Reject" });
              if (reason === null) return;
              reject.mutate({ id: r.id, reason: reason || undefined }, { onError: (e) => toast.error((e as Error).message) });
            }}
          >
            <IconX /> Reject
          </Button>
        </>
      ) : (
        <Button size="icon-sm" variant="ghost" title="Remove from the list" onClick={() => remove.mutate(r.id)}>
          <IconTrash />
        </Button>
      )}
    </li>
  );
}

/** Inbox: print requests from other systems (POST /api/v1/print-requests). */
export function InboxPage() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const list = useInbox(tab === "pending" ? "pending" : undefined);

  return (
    <Page title="Inbox">
      <Hint>
        Other systems can ask for labels with <code>POST /api/v1/print-requests</code> (see <code>docs/API.md</code>; tokens in{" "}
        <Link href="/settings" className="underline underline-offset-4">
          Settings &gt; API access
        </Link>
        ). Approving adds the label to this browser&apos;s print queue; printing still happens here.
      </Hint>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "all")}>
        <TabsList>
          <TabsTrigger value="pending">Waiting</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <ul className="divide-y rounded-lg border bg-card">
        {list.data?.map((r) => <Row key={r.id} r={r} />)}
        {list.isLoading && <li className="px-3 py-3 text-sm text-muted-foreground">Loading…</li>}
        {list.error && <li className="px-3 py-3 text-sm text-destructive">Could not load: {String(list.error)}</li>}
        {list.data?.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            <IconInbox className="mx-auto mb-2" />
            {tab === "pending" ? "Nothing waiting." : "No requests yet."}
          </li>
        )}
      </ul>
    </Page>
  );
}
