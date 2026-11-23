"use client";
/** Settings section: API tokens for /api/v1. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCopy, IconKey, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { json } from "../data/api";
import { apiRoot } from "../../lib/base";

interface TokenInfo {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const KEY = ["api-tokens"] as const;
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

export function ApiTokensSection() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const tokens = useQuery({ queryKey: KEY, queryFn: () => fetch(`${apiRoot()}/tokens`).then((r) => json<TokenInfo[]>(r)) });

  const create = useMutation({
    mutationFn: (n: string) =>
      fetch(`${apiRoot()}/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n }) }).then((r) =>
        json<{ token: string; info: TokenInfo }>(r),
      ),
    onSuccess: (r) => {
      setShown({ name: r.info.name, token: r.token });
      setName("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(`Could not create: ${(e as Error).message}`),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => fetch(`${apiRoot()}/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<void>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Other systems (inventory, spreadsheets with scripts) can send labels and data rows to <code>/api/v1/…</code> on this site using a token. See{" "}
        <code>docs/API.md</code> for examples. Give each system its own token so you can revoke one without breaking the others.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input className="w-72" value={name} onChange={(e) => setName(e.target.value)} placeholder="What will use it? e.g. Inventory sync" aria-label="Token name" />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <IconPlus /> Create token
        </Button>
      </form>

      <ul className="divide-y rounded-lg border">
        {tokens.data?.map((t) => (
          <li key={t.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${t.revokedAt ? "opacity-60" : ""}`}>
            <IconKey className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {t.name} <code className="text-xs font-normal text-muted-foreground">{t.hint}</code>
              </div>
              <div className="text-xs text-muted-foreground">
                Created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                {t.revokedAt && ` · revoked ${when(t.revokedAt)}`}
              </div>
            </div>
            {!t.revokedAt && (
              <Button
                size="sm"
                variant="destructive"
                disabled={revoke.isPending}
                onClick={async () =>
                  (await confirmDialog({ title: `Revoke "${t.name}"?`, description: "Anything using it stops working immediately. This can't be undone.", confirmLabel: "Revoke", destructive: true })) &&
                  revoke.mutate(t.id)
                }
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
        {tokens.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No tokens yet.</li>}
      </ul>

      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token for “{shown?.name}”</DialogTitle>
            <DialogDescription>Copy it now and keep it somewhere safe. It is shown only this once; if you lose it, revoke it and create a new one.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={shown?.token ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              onClick={() =>
                shown &&
                navigator.clipboard.writeText(shown.token).then(
                  () => toast.success("Copied"),
                  () => toast.error("Could not copy; select the text and copy it by hand"),
                )
              }
            >
              <IconCopy /> Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Send it as a header: <code>Authorization: Bearer {shown ? `${shown.token.slice(0, 8)}…` : ""}</code>
          </p>
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
