"use client";
/**
 * Settings > Packs > GitHub: connected accounts ("Connect GitHub" or a
 * token), where each keeps its packs, and "My packs" (packs published from
 * here, with "Publish update" when items changed since). Shown to editors
 * and admins; viewers see nothing new.
 */
import { useState } from "react";
import { IconBrandGithub, IconExternalLink, IconKey, IconPencil, IconRefresh, IconTrash, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { confirmDialog, promptDialog } from "../../components/dialogs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useCan } from "../auth/me-client";
import { useGithub, useGithubActions, usePublished } from "./api";
import { ConnectDialog, TokenDialog } from "./ConnectDialogs";
import { PublishDialog, type PublishTarget } from "./PublishDialog";
import { RepoDialog } from "./RepoDialog";
import type { GithubAccountView, PublishedPackView } from "./model";

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

export function GithubSection() {
  const editor = useCan("editor");
  const gh = useGithub();
  const published = usePublished();
  const actions = useGithubActions();
  const [dialog, setDialog] = useState<null | "connect" | "token">(null);
  const [repoFor, setRepoFor] = useState<GithubAccountView | null>(null);
  const [publish, setPublish] = useState<PublishTarget | null>(null);
  if (!editor) return null;
  if (gh.isLoading) return null;
  if (gh.error) return <p className="text-sm text-destructive">{(gh.error as Error).message}</p>;
  const { config, accounts } = gh.data!;

  const connected = (a: GithubAccountView) => {
    setDialog(null);
    toast.success(`Connected ${a.login}`);
    if (!a.defaultRepo) setRepoFor(a);
  };

  async function disconnect(a: GithubAccountView) {
    if (!(await confirmDialog({ title: `Disconnect ${a.login}?`, description: "labebal forgets this sign-in. Your packs stay on GitHub. Sources that read through this account stop updating until you pick another one.", confirmLabel: "Disconnect", destructive: true }))) return;
    try {
      await actions.removeAccount(a.id);
      toast.success(`Disconnected ${a.login}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function editEmail(a: GithubAccountView) {
    const v = await promptDialog({ title: "E-mail on your published changes", description: `GitHub shows this with each change you publish. The default keeps your real address private: ${a.commitEmail}. Leave empty for the default.`, label: "E-mail", defaultValue: a.commitEmailOverride ?? "", confirmLabel: "Save" });
    if (v === null) return;
    try {
      await actions.patchAccount(a.id, { commitEmail: v.trim() || null });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function unpublish(p: PublishedPackView) {
    if (!(await confirmDialog({ title: `Delete ${p.name} from GitHub?`, description: `Removes its folder${p.dir ? ` (${p.dir})` : ""} from ${p.owner}/${p.repo} in one change. Friends who installed it keep their copy but get no more updates. Your labels here are not touched. GitHub keeps the history, so it can be brought back from there.`, confirmLabel: "Delete from GitHub", destructive: true }))) return;
    try {
      const r = await actions.unpublish(p.id);
      toast.success(`Deleted ${p.name} from ${p.owner}/${p.repo}`, { description: `${r.removed} files removed` });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div id="github" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconBrandGithub className="size-4" />
        <span className="font-medium">GitHub</span>
        {config.mock && <Badge variant="outline">test server</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">Save your packs on GitHub so friends can follow them, and follow private packs. {config.scope === "user" ? "Accounts you connect are yours only." : ""}</p>
      {config.scope === null ? (
        <p className="text-sm text-muted-foreground">Sign in to connect GitHub.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {a.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatarUrl} alt="" className="size-9 shrink-0 rounded-full bg-muted" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  ) : (
                    <IconBrandGithub className="size-9 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{a.login}</span>
                      <Badge variant="secondary">{a.kind === "app" ? "connected" : "token"}</Badge>
                      {a.status === "reconnect" && <Badge variant="destructive">needs reconnecting</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.defaultRepo ? (
                        <>
                          Your packs are saved in <span className="font-mono">{a.defaultRepo}</span>
                        </>
                      ) : (
                        "No packs repository chosen yet"
                      )}
                    </div>
                    <button className="flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground" onClick={() => void editEmail(a)} title="E-mail shown on published changes">
                      <span className="truncate">{a.commitEmail}</span> <IconPencil className="size-3 shrink-0" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {a.status === "reconnect" ? (
                    <Button size="sm" onClick={() => setDialog(a.kind === "app" && config.app ? "connect" : "token")}>
                      <IconRefresh /> Reconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setRepoFor(a)}>
                      {a.defaultRepo ? "Change repository" : "Choose repository"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void disconnect(a)} aria-label={`Disconnect ${a.login}`}>
                    <IconTrash /> Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {config.app && (
              <Button onClick={() => setDialog("connect")}>
                <IconBrandGithub /> {accounts.length ? "Connect another account" : "Connect GitHub"}
              </Button>
            )}
            <Button variant={config.app ? "ghost" : "default"} onClick={() => setDialog("token")}>
              <IconKey /> Use a token instead
            </Button>
          </div>
        </>
      )}

      {editor && (published.data?.length ?? 0) > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-sm font-medium">My packs</div>
          <ul className="space-y-2">
            {published.data!.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.version}</span>
                    {p.changedSince > 0 && <Badge variant="outline">{p.changedSince} changed here since</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <a className="font-mono underline" href={p.htmlUrl} target="_blank" rel="noreferrer">
                      {p.owner}/{p.repo}
                      {p.dir ? `/${p.dir}` : ""}
                    </a>{" "}
                    · published {when(p.publishedAt)}
                    {p.publishedBy ? ` by ${p.publishedBy}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant={p.changedSince ? "default" : "outline"} onClick={() => setPublish({ title: p.name, templateIds: p.templateIds, labelIds: p.labelIds, published: p })}>
                    <IconUpload /> Publish update
                  </Button>
                  {p.commitUrl && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={p.commitUrl} target="_blank" rel="noreferrer" aria-label="Last change on GitHub">
                        <IconExternalLink />
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void unpublish(p)} aria-label={`Delete ${p.name} from GitHub`}>
                    <IconTrash />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editor && accounts.length > 0 && !published.data?.length && <p className="text-xs text-muted-foreground">To publish a pack: on the Templates page or in the label list, use a menu&apos;s &quot;Export as pack&quot; and choose Publish to GitHub.</p>}

      {dialog === "connect" && <ConnectDialog onClose={() => setDialog(null)} onConnected={connected} />}
      {dialog === "token" && <TokenDialog config={config} onClose={() => setDialog(null)} onConnected={connected} />}
      {repoFor && <RepoDialog account={repoFor} onClose={() => setRepoFor(null)} />}
      {publish && <PublishDialog target={publish} onClose={() => setPublish(null)} />}
    </div>
  );
}
