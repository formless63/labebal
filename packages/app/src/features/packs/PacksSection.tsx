"use client";
/**
 * Settings > Packs: sources (links to pack repos / files, plus the built-in
 * Examples) and the packs they offer, with install / enable / update /
 * remove per pack. Viewers see everything; changes need the admin role.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconBox, IconBrandGithub, IconDownload, IconExternalLink, IconKey, IconLock, IconPackage, IconPlus, IconRefresh, IconRestore, IconTrash, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { compareVersions, labelFolder } from "@labebal/core";
import { confirmDialog, promptDialog } from "../../components/dialogs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Switch } from "../../components/ui/switch";
import { useCan } from "../auth/me-client";
import { TemplateThumb } from "../templates/TemplateThumb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useGithub } from "../github/api";
import { GithubSection } from "../github/GithubSection";
import { usePackActions, usePacks } from "./api";
import { itemLabel, type InstalledPackView, type PackListing, type PackSourceView, type PackUpdateSummary, type SyncResult } from "./types";
import { UpdateReviewDialog, useCheckNow, useUpdateCheck } from "./UpdateNotice";

const PUBLIC = "__public";

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function summary(r: SyncResult, verb: string) {
  const bits = [
    r.inserted && `${r.inserted} added`,
    r.updated && `${r.updated} updated`,
    r.adopted && `${r.adopted} already here (linked)`,
    r.kept.length && `${r.kept.length} changed here, kept`,
    r.removed && `${r.removed} removed`,
    r.detached && `${r.detached} kept as your own`,
    r.conflicts.length && `${r.conflicts.length} skipped (belong to another pack)`,
  ].filter(Boolean);
  toast.success(`${verb} ${r.pack.name} ${r.pack.version}`, { description: [bits.join(", ") || "Nothing changed", ...r.warnings.slice(0, 3)].join(". ") });
}

const counts = (c: PackListing["counts"]) =>
  [c.templates && plural(c.templates, "template"), c.labels && plural(c.labels, "label"), c.datasets && plural(c.datasets, "dataset"), c.fonts && plural(c.fonts, "font"), c.assets && plural(c.assets, "image")]
    .filter(Boolean)
    .join(" · ");

export function PacksSection() {
  const { data, isLoading, error } = usePacks();
  const actions = usePackActions();
  const canAdmin = useCan("admin");
  const [input, setInput] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ source: PackSourceView; pack: PackListing } | null>(null);
  const gh = useGithub();
  const ghAccounts = (gh.data?.accounts ?? []).filter((a) => a.status === "ok");
  const [via, setVia] = useState(PUBLIC);
  const updates = useUpdateCheck(canAdmin);
  const checkNow = useCheckNow();
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<PackUpdateSummary | null>(null);

  // Check every source for updates when the page opens (no background polling).
  const remoteIds = (data?.sources ?? []).filter((s) => s.kind === "url").map((s) => s.id).join(",");
  const check = useQuery({
    queryKey: ["packs-check", remoteIds],
    queryFn: async () => (await Promise.allSettled(remoteIds.split(",").filter(Boolean).map((id) => actions.refresh(id)))).length,
    enabled: !!remoteIds,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const refreshing = check.isFetching;

  const installed = useMemo(() => new Map((data?.installed ?? []).map((p) => [p.id, p])), [data]);
  const offered = new Set((data?.sources ?? []).flatMap((s) => s.index?.packs.map((p) => p.id) ?? []));
  const orphans = (data?.installed ?? []).filter((p) => !offered.has(p.id));

  async function run<T>(key: string, fn: () => Promise<T>, ok?: (r: T) => void) {
    setBusy(key);
    try {
      const r = await fn();
      ok?.(r);
      return r;
    } catch (e) {
      toast.error((e as Error).message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    if (!input.trim()) return;
    setAdding(true);
    try {
      const s = await actions.addSource(input.trim(), via === PUBLIC ? token.trim() || undefined : undefined, via === PUBLIC ? undefined : via);
      toast.success(`Added ${s.name}`, { description: `${plural(s.index?.packs.length ?? 0, "pack")} found` });
      setInput("");
      setToken("");
    } catch (e) {
      toast.error(`Could not add: ${(e as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function remove(p: InstalledPackView) {
    const plan = await run(`rm:${p.id}`, () => actions.removePlan(p.id));
    if (!plan) return;
    let keep = true;
    if (plan.changed.length) {
      const names = plan.changed.slice(0, 6).map((c) => `${c.name} (${itemLabel(c.kind)}${c.reason === "used" ? ", used by labels that stay" : ", changed here"})`);
      const del = await confirmDialog({
        title: `Remove ${p.name}?`,
        description: (
          <span className="block space-y-2">
            <span className="block">{plural(plan.remove, "unchanged item")} will be deleted.</span>
            <span className="block">
              {plural(plan.changed.length, "item")} {plan.changed.length === 1 ? "was" : "were"} changed here or {plan.changed.length === 1 ? "is" : "are"} used by your own labels: {names.join(", ")}
              {plan.changed.length > names.length ? "…" : ""}.
            </span>
            <span className="block">
              <b>Delete everything</b> also deletes those{plan.dependents ? ` (and ${plural(plan.dependents, "label")} of yours on its templates)` : ""}. Cancel to choose keeping them.
            </span>
          </span>
        ),
        confirmLabel: "Delete everything",
        destructive: true,
      });
      if (del) keep = false;
      else if (!(await confirmDialog({ title: `Keep the changed items?`, description: "They stay in your library as your own (no longer part of the pack); the rest of the pack is removed.", confirmLabel: "Remove, keep changed" }))) return;
    } else if (!(await confirmDialog({ title: `Remove ${p.name}?`, description: `Deletes its ${plural(plan.remove, "item")} from the library. You can install it again from its source.`, confirmLabel: "Remove", destructive: true }))) return;
    await run(`rm:${p.id}`, () => actions.remove(p.id, keep), (r) => toast.success(`Removed ${p.name}`, { description: `${r.removed} deleted${r.kept ? `, ${r.kept} kept as your own` : ""}` }));
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const installedRow = (p: InstalledPackView, listing?: PackListing) => (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={p.enabled} disabled={!canAdmin || busy === `en:${p.id}`} onCheckedChange={(v) => void run(`en:${p.id}`, () => actions.setEnabled(p.id, v), () => toast.success(v ? `${p.name} shown` : `${p.name} hidden`))} aria-label={`Enable ${p.name}`} />
        {p.enabled ? "Enabled" : "Disabled (hidden)"}
      </label>
      <Badge variant="secondary">installed {p.version}</Badge>
      {p.selection && <Badge variant="outline">{plural(p.selection.length, "label")} picked</Badge>}
      {(p.available || (listing && compareVersions(listing.version, p.version) > 0)) && (
        <>
          <Button size="sm" disabled={!canAdmin || !!busy} onClick={() => void run(`up:${p.id}`, () => actions.update(p.id), (r) => summary(r, "Updated to"))}>
            <IconDownload /> Update to {p.available ?? listing?.version}
          </Button>
          {canAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const to = p.available ?? listing?.version ?? "";
                setReview(updates.data?.find((u) => u.packId === p.id) ?? { packId: p.id, name: p.name, from: p.version, to, sourceId: p.sourceId, sourceName: "", added: [], removed: [], changed: [], kept: [] });
              }}
            >
              Review…
            </Button>
          )}
          {p.skipped && p.skipped === (p.available ?? listing?.version) && <Badge variant="outline">skipped in reminders</Badge>}
        </>
      )}
      {p.changed.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={!canAdmin || !!busy}
          title={p.changed.map((c) => `${c.name} (${itemLabel(c.kind)})`).join("\n")}
          onClick={async () => {
            if (await confirmDialog({ title: `Reset ${plural(p.changed.length, "changed item")}?`, description: `Puts ${p.changed.slice(0, 5).map((c) => c.name).join(", ")}${p.changed.length > 5 ? "…" : ""} back to the pack version (${p.version}). Templates keep their old version in the version history.`, confirmLabel: "Reset" }))
              await run(`rs:${p.id}`, () => actions.reset({ items: p.changed.map((c) => ({ kind: c.kind as "label", id: c.id })) }), (r) => toast.success(`Reset ${plural(r.reset, "item")}`));
          }}
        >
          <IconRestore /> {p.changed.length} changed here
        </Button>
      )}
      {p.deleted.length > 0 && (
        <Button size="sm" variant="ghost" disabled={!canAdmin || !!busy} title={p.deleted.map((c) => c.name).join("\n")} onClick={() => void run(`rd:${p.id}`, () => actions.reset({ items: p.deleted.map((c) => ({ kind: c.kind as "label", id: c.id })) }), (r) => toast.success(`Restored ${plural(r.reset, "item")}`))}>
          <IconRestore /> Restore {p.deleted.length} deleted
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={!canAdmin || !!busy} onClick={() => void remove(p)}>
        <IconTrash /> Remove
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Packs are sets of templates and labels kept in a git repo or a file. Add a source by link (a GitHub <code>owner/repo</code>, or a URL to a <code>labebal-pack.json</code>, a <code>labebal-packs.json</code> collection or a bundle), then install the packs you want. Updates keep anything you changed here. See <code>docs/PACKS.md</code> to make your own.
      </p>
      <GithubSection />
      {canAdmin ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input className="min-w-64 flex-[2]" placeholder="owner/repo[/path][@ref] or https://…/labebal-pack.json" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Source link" />
          {ghAccounts.length > 0 && (
            <Select value={via} onValueChange={setVia}>
              <SelectTrigger className="min-w-40" aria-label="Read with">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PUBLIC}>Public link / token</SelectItem>
                {ghAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    With GitHub: {a.login}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {via === PUBLIC && <Input className="min-w-48 flex-1" type="password" autoComplete="off" placeholder="Access token (private repos, optional)" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token" />}
          <Button type="submit" disabled={adding || !input.trim()}>
            <IconPlus /> {adding ? "Reading…" : "Add source"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Adding sources and installing packs needs the admin role.</p>
      )}
      {canAdmin && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button
            size="sm"
            variant="outline"
            disabled={checking || refreshing}
            onClick={async () => {
              setChecking(true);
              try {
                const r = await checkNow();
                toast.success(r.length ? `${plural(r.length, "pack update")} available` : "Everything is up to date");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          >
            <IconRefresh /> {checking ? "Checking…" : "Check for updates now"}
          </Button>
          <span>labebal also checks every few minutes while you use it and lets you know.</span>
        </div>
      )}
      {refreshing && <p className="text-xs text-muted-foreground">Checking sources for updates…</p>}

      {data!.sources.map((s) => (
        <div key={s.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {s.kind === "builtin" ? <IconBox className="size-4" /> : <IconPackage className="size-4" />}
                {s.name}
                {s.kind === "builtin" && <Badge variant="secondary">built in</Badge>}
                {s.hasToken && !s.account && (
                  <Badge variant="outline" title={`Token sent only to ${s.tokenHost}`}>
                    <IconLock className="size-3" /> private
                  </Badge>
                )}
                {s.account && (
                  <Badge variant="outline" title="Read through GitHub with this connected account">
                    <IconBrandGithub className="size-3" /> {s.account.login}
                  </Badge>
                )}
              </div>
              {s.kind === "url" && <div className="truncate font-mono text-xs text-muted-foreground" title={s.url}>{s.input}</div>}
              <div className="text-xs text-muted-foreground">Checked {when(s.lastFetchedAt)}</div>
              {s.lastError && <div className="text-xs text-destructive">Last check failed: {s.lastError}</div>}
              {s.index?.errors.map((e) => (
                <div key={e.url} className="text-xs text-destructive">
                  {e.url.split("/").slice(-2).join("/")}: {e.error}
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" disabled={busy === `ref:${s.id}`} onClick={() => void run(`ref:${s.id}`, () => actions.refresh(s.id), (r) => (r.lastError ? toast.error(r.lastError) : toast.success(`${r.name}: ${plural(r.index?.packs.length ?? 0, "pack")}`)))}>
              <IconRefresh /> Refresh
            </Button>
            {s.kind === "url" && canAdmin && (
              <>
                {!s.account && <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const t = await promptDialog({
                      title: s.hasToken ? "Change access token" : "Add access token",
                      description: `For private repos: a read-only token (GitHub: fine-grained, Contents: read). It is kept on the server and sent only to ${s.tokenHost}. Leave empty to remove it.`,
                      label: "Token",
                      placeholder: "github_pat_…",
                      confirmLabel: "Save",
                    });
                    if (t === null) return;
                    await run(`tok:${s.id}`, async () => {
                      await actions.setToken(s.id, t.trim() || null);
                      return actions.refresh(s.id);
                    }, (r) => (r.lastError ? toast.error(r.lastError) : toast.success("Token saved")));
                  }}
                >
                  <IconKey /> Token
                </Button>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Remove the source ${s.name}?`, description: "Installed packs stay installed (they just can't update until you add the link again).", confirmLabel: "Remove source", destructive: true }))
                      await run(`rms:${s.id}`, () => actions.removeSource(s.id));
                  }}
                >
                  <IconTrash />
                </Button>
              </>
            )}
          </div>
          {s.index?.description && <p className="text-sm text-muted-foreground">{s.index.description}</p>}
          {!s.index?.packs.length && !s.lastError && <p className="text-sm text-muted-foreground">No packs found.</p>}
          <ul className="space-y-3">
            {s.index?.packs.map((p) => {
              const inst = installed.get(p.id);
              const fromHere = !inst || !inst.sourceId || inst.sourceId === s.id;
              return (
                <li key={p.id} className="flex flex-col gap-3 rounded-md bg-muted/40 p-3 sm:flex-row">
                  <div className="flex shrink-0 flex-wrap gap-1.5 sm:w-56">
                    {p.templates.slice(0, 3).map((t) => (
                      <TemplateThumb key={t.id} template={t} label={p.labels.find((l) => l.templateId === t.id)} maxW={p.templates.length === 1 ? 200 : 100} maxH={56} title={t.name} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.version}
                        {p.author ? ` · ${p.author}` : ""}
                      </span>
                      {p.homepage && (
                        <a className="text-xs text-muted-foreground underline" href={p.homepage} target="_blank" rel="noreferrer">
                          <IconExternalLink className="inline size-3" /> site
                        </a>
                      )}
                    </div>
                    {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {counts(p.counts)}
                      {p.folder ? ` · into folder ${p.folder}` : ""}
                    </p>
                    {p.warnings.length > 0 && (
                      <details className="text-xs text-amber-600">
                        <summary>{plural(p.warnings.length, "note")}</summary>
                        <ul className="list-disc pl-4">
                          {p.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {inst && fromHere ? (
                      installedRow(inst, p)
                    ) : inst ? (
                      <p className="text-xs text-muted-foreground">Installed {inst.version} from another source.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!canAdmin || !!busy} onClick={() => void run(`in:${p.id}`, () => actions.install(s.id, p.id), (r) => summary(r, "Installed"))}>
                          <IconUpload /> {busy === `in:${p.id}` ? "Installing…" : "Install"}
                        </Button>
                        {p.labels.length > 1 && (
                          <Button size="sm" variant="outline" disabled={!canAdmin || !!busy} onClick={() => setPicking({ source: s, pack: p })}>
                            Choose labels…
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {orphans.length > 0 && (
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <div className="font-medium">Installed, source not added</div>
          <p className="text-xs text-muted-foreground">Add the pack&apos;s link again to get updates (e.g. a private repo: add it with its token).</p>
          {orphans.map((p) => (
            <div key={p.id} className="space-y-1.5 rounded-md bg-muted/40 p-3">
              <div className="font-medium">
                {p.name} <span className="text-xs font-normal text-muted-foreground">{p.version}</span>
              </div>
              <p className="text-xs text-muted-foreground">{[p.counts.templates && plural(p.counts.templates, "template"), p.counts.labels && plural(p.counts.labels, "label")].filter(Boolean).join(" · ")}</p>
              {installedRow(p)}
            </div>
          ))}
        </div>
      )}

      {review && <UpdateReviewDialog summary={review} onClose={() => setReview(null)} />}
      {picking && (
        <PickLabelsDialog
          pack={picking.pack}
          onClose={() => setPicking(null)}
          onInstall={(ids) => {
            const { source, pack } = picking;
            setPicking(null);
            void run(`in:${pack.id}`, () => actions.install(source.id, pack.id, ids), (r) => summary(r, "Installed"));
          }}
        />
      )}
    </div>
  );
}

/** Pick which of a pack's labels to install (templates always come along). */
function PickLabelsDialog({ pack, onClose, onInstall }: { pack: PackListing; onClose: () => void; onInstall: (ids: string[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(pack.labels.map((l) => l.id)));
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, PackListing["labels"]>();
    for (const l of pack.labels) {
      if (q && !`${l.name} ${Object.values(l.values).join(" ")}`.toLowerCase().includes(q.toLowerCase())) continue;
      const f = labelFolder(l) || "(no folder)";
      m.set(f, [...(m.get(f) ?? []), l]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pack, q]);
  const toggle = (ids: string[], on: boolean) => setSel((s) => new Set(on ? [...s, ...ids] : [...s].filter((x) => !ids.includes(x))));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose labels from {pack.name}</DialogTitle>
          <DialogDescription>All {plural(pack.templates.length, "template")} are installed; pick the labels you want. Updates then bring only these.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter labels" />
        <ScrollArea className="h-80 rounded-md border">
          <div className="space-y-3 p-3">
            {groups.map(([folder, ls]) => (
              <div key={folder}>
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Checkbox checked={ls.every((l) => sel.has(l.id)) ? true : ls.some((l) => sel.has(l.id)) ? "indeterminate" : false} onCheckedChange={(v) => toggle(ls.map((l) => l.id), v === true)} />
                  {folder} ({ls.length})
                </label>
                <ul className="mt-1 space-y-0.5 pl-6">
                  {ls.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => toggle([l.id], v === true)} />
                        {l.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSel(new Set(sel.size ? [] : pack.labels.map((l) => l.id)))}>
            {sel.size ? "Select none" : "Select all"}
          </Button>
          <Button onClick={() => onInstall([...sel])} disabled={!sel.size}>
            <IconUpload /> Install {plural(sel.size, "label")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
