"use client";
/** Pick (or create) the repository an account keeps its packs in. */
import { useMemo, useState } from "react";
import { IconExternalLink, IconLock, IconPlus, IconRefresh, IconWorld } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/utils";
import { useGithubActions, useRepos } from "./api";
import type { GithubAccountView } from "./model";

export function RepoDialog({ account, onClose, onPicked }: { account: GithubAccountView; onClose: () => void; onPicked?: (fullName: string) => void }) {
  const repos = useRepos(account.id);
  const actions = useGithubActions();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("labebal-packs");
  const [priv, setPriv] = useState(true);
  const [description, setDescription] = useState("Label packs for labebal");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href?: string; link?: string } | null>(null);

  const list = useMemo(() => (repos.data?.repos ?? []).filter((r) => r.canWrite && r.fullName.toLowerCase().includes(q.toLowerCase())), [repos.data, q]);

  async function pick(fullName: string) {
    await actions.patchAccount(account.id, { defaultRepo: fullName });
    toast.success(`Your packs are saved in ${fullName}`);
    onPicked?.(fullName);
    onClose();
  }

  async function create() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await actions.createRepo(account.id, { name, private: priv, description });
      if (r.created && r.repo && !r.needsInstall) return void (await pick(r.repo.fullName));
      if (r.created && r.needsInstall)
        setNotice({ text: `Created ${r.repo?.fullName}. One more step: let labebal use it. Add it on GitHub, then press Refresh.`, href: r.installUrl ?? undefined, link: "Choose repositories" });
      else if (r.newRepoUrl) setNotice({ text: "GitHub didn't let labebal create the repository. Create it on GitHub (the form is filled in), then press Refresh and pick it.", href: r.newRepoUrl, link: "Create it on GitHub" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const noInstall = account.kind === "app" && repos.data && repos.data.installations === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Where should your packs live?</DialogTitle>
          <DialogDescription>Pick a repository on GitHub ({account.login}) to save your packs in, or let labebal create one.</DialogDescription>
        </DialogHeader>
        {noInstall && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>labebal can&apos;t see any of your repositories yet. On GitHub, choose which repositories it may use (you can pick just one), then come back and press Refresh.</p>
            {repos.data?.installUrl && (
              <Button asChild size="sm">
                <a href={repos.data.installUrl} target="_blank" rel="noreferrer">
                  <IconExternalLink /> Choose repositories
                </a>
              </Button>
            )}
          </div>
        )}
        {notice && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>{notice.text}</p>
            {notice.href && (
              <Button asChild size="sm">
                <a href={notice.href} target="_blank" rel="noreferrer">
                  <IconExternalLink /> {notice.link}
                </a>
              </Button>
            )}
          </div>
        )}
        {creating ? (
          <div className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!priv} onCheckedChange={(v) => setPriv(!v)} /> {priv ? "Private: only people you invite can see it" : "Public: anyone can follow your packs"}
            </label>
            <div className="flex gap-2">
              <Button onClick={() => void create()} disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create repository"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter repositories" />
              <Button variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => void repos.refetch()}>
                <IconRefresh className={cn(repos.isFetching && "animate-spin")} />
              </Button>
            </div>
            <ScrollArea className="h-60 rounded-md border">
              <ul className="divide-y">
                {repos.isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
                {repos.error && <li className="p-3 text-sm text-destructive">{(repos.error as Error).message}</li>}
                {!repos.isLoading && !list.length && !repos.error && <li className="p-3 text-sm text-muted-foreground">No repositories you can write to{q ? " match" : ""}.</li>}
                {list.map((r) => (
                  <li key={r.fullName}>
                    <button className={cn("flex w-full items-center gap-2 p-3 text-left text-sm hover:bg-accent", account.defaultRepo === r.fullName && "bg-accent")} onClick={() => void pick(r.fullName)}>
                      {r.private ? <IconLock className="size-4 shrink-0" aria-label="private" /> : <IconWorld className="size-4 shrink-0" aria-label="public" />}
                      <span className="min-w-0 flex-1 truncate font-mono">{r.fullName}</span>
                      {account.defaultRepo === r.fullName && <span className="text-xs text-muted-foreground">current</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <Button variant="outline" onClick={() => setCreating(true)}>
              <IconPlus /> Create a repo for my packs
            </Button>
          </>
        )}
        <DialogFooter>
          {account.kind === "app" && repos.data?.installUrl && !noInstall && (
            <Button asChild variant="ghost" className="mr-auto">
              <a href={repos.data.installUrl} target="_blank" rel="noreferrer">
                <IconExternalLink /> Choose repositories
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
