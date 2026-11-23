"use client";
/**
 * "Publish to GitHub": the pack "Export as pack" would build, written to the
 * person's packs repository in one commit (new pack, or an update of one
 * already there: the version goes up by itself).
 */
import { useMemo, useState } from "react";
import { IconBrandGithub, IconCheck, IconExternalLink } from "@tabler/icons-react";
import { toast } from "sonner";
import { slugify } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { useGithub, useGithubActions, useRepoPacks } from "./api";
import { RepoDialog } from "./RepoDialog";
import { summaryText, type Bump, type PublishedPackView, type PublishResult } from "./model";

export interface PublishTarget {
  title: string;
  templateIds: string[];
  labelIds: string[];
  name?: string;
  /** "Publish update" of a pack published before. */
  published?: PublishedPackView;
}

const NEW = "__new";

export function PublishDialog({ target, onClose }: { target: PublishTarget; onClose: () => void }) {
  const gh = useGithub();
  const actions = useGithubActions();
  const accounts = (gh.data?.accounts ?? []).filter((a) => a.status === "ok");
  const p = target.published;
  const [accountId, setAccountId] = useState<string | null>(p?.accountId ?? null);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  const [repo, setRepo] = useState<string | null>(p ? `${p.owner}/${p.repo}` : null);
  const repoName = repo ?? account?.defaultRepo ?? null;
  const existing = useRepoPacks(account?.id ?? null, repoName);
  const [choice, setChoice] = useState<string>(p ? p.dir : NEW);
  const [name, setName] = useState(p?.name ?? target.name ?? "My pack");
  const [id, setId] = useState(p?.packId ?? (slugify(target.name ?? "my-pack") || "my-pack"));
  const [touchedId, setTouchedId] = useState(!!p);
  const [description, setDescription] = useState(p?.description ?? "");
  const [dir, setDir] = useState(p?.dir ?? "");
  const [touchedDir, setTouchedDir] = useState(!!p);
  const [bump, setBump] = useState<Bump>("patch");
  const [datasets, setDatasets] = useState(p?.datasets ?? false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  // A new pack goes into a folder named after its id until the folder is edited.
  const dirValue = !touchedDir && choice === NEW ? id : dir;

  const chosen = useMemo(() => existing.data?.packs.find((x) => x.dir === choice) ?? null, [existing.data, choice]);
  function choose(v: string) {
    setChoice(v);
    const x = existing.data?.packs.find((y) => y.dir === v);
    if (x) {
      setId(x.id);
      setName(x.name);
      setDescription(x.description);
      setDir(x.dir);
      setTouchedId(true);
      setTouchedDir(true);
    } else {
      setTouchedDir(false);
    }
  }

  async function go() {
    if (!account || !repoName) return;
    const [owner, r] = repoName.split("/");
    setBusy(true);
    try {
      const res = await actions.publish({
        accountId: account.id,
        owner,
        repo: r,
        dir: dirValue,
        manifest: { id, name, ...(description ? { description } : {}), ...(p?.author ? { author: p.author } : {}), ...(p?.folder ? { folder: p.folder } : {}) },
        bump,
        templateIds: target.templateIds,
        labelIds: target.labelIds,
        datasets,
      });
      setResult(res);
      if (res.unchanged) toast.info("Nothing changed since the last publish");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!gh.isLoading && !accounts.length)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish to GitHub</DialogTitle>
            <DialogDescription>Connect a GitHub account first: Settings &gt; Packs &gt; GitHub.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <a href="/settings#github">Open settings</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p ? `Publish an update of ${p.name}` : "Publish to GitHub"}</DialogTitle>
          <DialogDescription>
            {target.title}: {target.labelIds.length ? `${target.labelIds.length} label${target.labelIds.length === 1 ? "" : "s"} and their templates` : `${target.templateIds.length} template${target.templateIds.length === 1 ? "" : "s"}`}, with the pictures and fonts they use. Friends who follow your repository get it as an update.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <IconCheck className="size-4 text-green-600" />
              {result.unchanged ? `Already up to date (${result.version})` : `Published ${name} ${result.version}`}
            </p>
            {!result.unchanged && <p className="text-muted-foreground">{result.summary.first ? "First version" : summaryText(result.summary)}.</p>}
            <div className="flex flex-wrap gap-2">
              {result.commitUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={result.commitUrl} target="_blank" rel="noreferrer">
                    <IconExternalLink /> See the change
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={result.htmlUrl} target="_blank" rel="noreferrer">
                  <IconBrandGithub /> Open on GitHub
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Friends add <code className="select-all">{repoName}</code> in Settings &gt; Packs to follow it.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.length > 1 && (
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-xs">GitHub account</Label>
                <Select value={account?.id} onValueChange={(v) => (setAccountId(v), setRepo(null))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.login} ({a.kind === "app" ? "connected" : "token"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1 sm:col-span-2">
              <Label className="text-xs">Repository</Label>
              <div className="flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-md border px-3 font-mono text-sm">{repoName ?? <span className="font-sans text-muted-foreground">none chosen yet</span>}</div>
                <Button variant="outline" onClick={() => setPicking(true)}>
                  {repoName ? "Change…" : "Choose…"}
                </Button>
              </div>
              {existing.error && <p className="text-xs text-destructive">{(existing.error as Error).message}</p>}
            </div>
            {repoName && (
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-xs">Pack</Label>
                <Select value={choice} onValueChange={choose} disabled={!!p}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>A new pack</SelectItem>
                    {(existing.data?.packs ?? []).map((x) => (
                      <SelectItem key={x.dir || "(root)"} value={x.dir}>
                        Update {x.name} ({x.version})
                      </SelectItem>
                    ))}
                    {p && !existing.data?.packs.some((x) => x.dir === p.dir) && <SelectItem value={p.dir}>Update {p.name}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => (setName(e.target.value), !touchedId && setId(slugify(e.target.value) || "my-pack"))} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Id (never change it)</Label>
              <Input value={id} disabled={!!chosen || !!p} onChange={(e) => (setId(e.target.value), setTouchedId(true))} />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {(chosen || p) && (
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-xs">What kind of change?</Label>
                <ToggleGroup type="single" variant="outline" value={bump} onValueChange={(v) => v && setBump(v as Bump)} className="justify-start">
                  <ToggleGroupItem value="patch">Small fix</ToggleGroupItem>
                  <ToggleGroupItem value="minor">New labels</ToggleGroupItem>
                  <ToggleGroupItem value="major">Big change</ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
            <details className="text-sm sm:col-span-2">
              <summary className="cursor-pointer text-muted-foreground">More options</summary>
              <div className="mt-2 grid gap-3">
                <div className="grid gap-1">
                  <Label className="text-xs">Folder in the repository (empty = the whole repository is this one pack)</Label>
                  <Input value={dirValue} disabled={!!chosen || !!p} onChange={(e) => (setDir(e.target.value), setTouchedDir(true))} />
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox checked={datasets} onCheckedChange={(v) => setDatasets(v === true)} /> Include datasets linked to these templates
                </label>
              </div>
            </details>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={() => void go()} disabled={busy || !account || !repoName || !name.trim() || !id.trim()}>
              <IconBrandGithub /> {busy ? "Publishing…" : "Publish"}
            </Button>
          )}
        </DialogFooter>
        {picking && account && <RepoDialog account={account} onClose={() => setPicking(false)} onPicked={(r) => (setRepo(r), choose(NEW))} />}
      </DialogContent>
    </Dialog>
  );
}
