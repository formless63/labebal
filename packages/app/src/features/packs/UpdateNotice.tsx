"use client";
/**
 * Pack update prompts while navigating (admins only: applying updates is
 * admin). Checks on focus / route change at most every 5 minutes (the server
 * re-reads sources older than LABEBAL_PACK_CHECK_MINUTES, GitHub sources with
 * a cheap commit-SHA check). Shows a small notice per pack with a newer
 * version: "Cable labels 1.1.0: 3 added, 1 removed, 2 changed. Review".
 * The review dialog lists the items with previews; Apply / Skip this version / Later.
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "../../lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowRight, IconDownload, IconPackage, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label as LabelDoc, Template } from "@labebal/core";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useCan } from "../auth/me-client";
import { json, send } from "../data/api";
import { TemplateThumb } from "../templates/TemplateThumb";
import { PACKS_KEY, usePackActions } from "./api";
import type { PackUpdatePreview, PackUpdateSummary, UpdateItemView } from "./types";
import { apiRoot } from "../../lib/base";

export const UPDATES_KEY = ["pack-updates"] as const;
const EVERY = 5 * 60_000;
const LATER_KEY = "labebal.packUpdates.later";

const fetchUpdates = (force = false) => send(`${apiRoot()}/packs/check-updates`, "POST", force ? { force: true } : {}).then((r) => json<PackUpdateSummary[]>(r));

export function useUpdateCheck(enabled: boolean) {
  return useQuery({ queryKey: UPDATES_KEY, queryFn: () => fetchUpdates(), enabled, staleTime: EVERY, refetchOnWindowFocus: true, retry: false });
}

/** "Check now": every source, right away. */
export function useCheckNow() {
  const qc = useQueryClient();
  return async () => {
    const r = await fetchUpdates(true);
    qc.setQueryData(UPDATES_KEY, r);
    await qc.invalidateQueries({ queryKey: PACKS_KEY });
    return r;
  };
}

export function updateText(u: Pick<PackUpdateSummary, "added" | "removed" | "changed" | "kept">) {
  const bits = [u.added.length && `${u.added.length} added`, u.removed.length && `${u.removed.length} removed`, u.changed.length && `${u.changed.length} changed`].filter(Boolean);
  const kept = u.kept.length ? `${u.kept.length} kept because you changed ${u.kept.length === 1 ? "it" : "them"}` : "";
  return [bits.join(", ") || "small changes", kept].filter(Boolean).join("; ");
}

function readLater(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(LATER_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** The small notice (mounted once in the app shell). */
export function PackUpdateNotice() {
  const admin = useCan("admin");
  const path = usePathname();
  const q = useUpdateCheck(admin);
  const [later, setLater] = useState<string[]>(readLater);
  const [review, setReview] = useState<PackUpdateSummary | null>(null);
  // Route changes: check again when the last answer is older than 5 minutes.
  const { refetch, dataUpdatedAt } = q;
  useEffect(() => {
    if (admin && dataUpdatedAt && Date.now() - dataUpdatedAt > EVERY) void refetch();
  }, [path, admin, dataUpdatedAt, refetch]);
  const shown = useMemo(() => (q.data ?? []).filter((u) => !later.includes(`${u.packId}@${u.to}`)), [q.data, later]);
  if (!admin || !shown.length) return review ? <UpdateReviewDialog summary={review} onClose={() => setReview(null)} /> : null;
  const u = shown[0];
  const dismiss = () => {
    const next = [...later, `${u.packId}@${u.to}`];
    setLater(next);
    try {
      sessionStorage.setItem(LATER_KEY, JSON.stringify(next));
    } catch {}
  };
  return (
    <>
      <div role="status" className="fixed inset-x-3 bottom-3 z-40 flex items-start gap-3 rounded-lg border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm">
        <IconPackage className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p>
            <b>
              {u.name} {u.to}
            </b>
            : {updateText(u)}.
          </p>
          {shown.length > 1 && <p className="text-xs text-muted-foreground">and {shown.length - 1} more pack update{shown.length > 2 ? "s" : ""}</p>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => setReview(u)}>
              Review
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Later
            </Button>
          </div>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={dismiss} aria-label="Hide until next time">
          <IconX className="size-4" />
        </button>
      </div>
      {review && <UpdateReviewDialog summary={review} onClose={() => setReview(null)} onLater={dismiss} />}
    </>
  );
}

function Thumb({ item, side, preview }: { item: UpdateItemView; side: "before" | "after"; preview: PackUpdatePreview }) {
  const doc = item[side];
  if (!doc) return <div className="flex h-14 w-24 items-center justify-center rounded bg-muted text-xs text-muted-foreground">—</div>;
  if (item.kind === "template") return <TemplateThumb template={doc as Template} maxW={140} maxH={56} title={doc.name} />;
  const l = doc as LabelDoc;
  const t = (side === "before" ? (preview.templatesBefore?.[l.templateId] ?? preview.templates?.[l.templateId]) : (preview.templates?.[l.templateId] ?? preview.templatesBefore?.[l.templateId])) ?? null;
  return t ? <TemplateThumb template={t} label={l} maxW={140} maxH={56} title={l.name} /> : <div className="h-14 w-24 rounded bg-muted" />;
}

/** Review an update: items by category with previews (before / after for changes). */
export function UpdateReviewDialog({ summary, onClose, onLater }: { summary: PackUpdateSummary; onClose: () => void; onLater?: () => void }) {
  const qc = useQueryClient();
  const actions = usePackActions();
  const [busy, setBusy] = useState(false);
  const pv = useQuery({
    queryKey: ["pack-update-preview", summary.packId, summary.to],
    queryFn: () => fetch(`${apiRoot()}/packs/installed/${encodeURIComponent(summary.packId)}/preview`).then((r) => json<PackUpdatePreview>(r)),
  });
  const data = pv.data;
  const tabs = (
    [
      ["added", "Added", data?.added ?? summary.added],
      ["changed", "Changed", data?.changed ?? summary.changed],
      ["removed", "Removed", data?.removed ?? summary.removed],
      ["kept", "Kept (you changed)", data?.kept ?? summary.kept],
    ] as const
  ).filter(([, , items]) => items.length);

  async function apply() {
    setBusy(true);
    try {
      const r = await actions.update(summary.packId);
      toast.success(`Updated ${r.pack.name} to ${r.pack.version}`, { description: `${r.inserted} added, ${r.updated} updated, ${r.removed} removed${r.kept.length ? `, ${r.kept.length} kept (changed here)` : ""}` });
      await qc.invalidateQueries({ queryKey: UPDATES_KEY });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function skip() {
    setBusy(true);
    try {
      await send(`${apiRoot()}/packs/installed/${encodeURIComponent(summary.packId)}/skip`, "POST", { version: summary.to }).then((r) => json<void>(r));
      toast.success(`Skipped ${summary.name} ${summary.to}`, { description: "You'll be asked again when a newer version comes out." });
      await Promise.all([qc.invalidateQueries({ queryKey: UPDATES_KEY }), qc.invalidateQueries({ queryKey: PACKS_KEY })]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Update {summary.name} to {summary.to}
          </DialogTitle>
          <DialogDescription>
            You have {summary.from}{summary.sourceName ? ` from ${summary.sourceName}` : ""}. {updateText(data ?? summary)}. Your own changes are kept; datasets, pictures and fonts in the pack come along too.
          </DialogDescription>
        </DialogHeader>
        {pv.error && <p className="text-sm text-destructive">{(pv.error as Error).message}</p>}
        {tabs.length ? (
          <Tabs defaultValue={tabs[0][0]}>
            <TabsList className="flex-wrap">
              {tabs.map(([k, label, items]) => (
                <TabsTrigger key={k} value={k}>
                  {label} <Badge variant="secondary">{items.length}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map(([k, , items]) => (
              <TabsContent key={k} value={k}>
                <ScrollArea className="h-80 rounded-md border">
                  <ul className="divide-y">
                    {items.map((it) => (
                      <li key={`${it.kind}:${it.id}`} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{it.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.kind}
                            {it.reason === "removed" ? " · gone from the pack, kept as yours" : it.reason === "changed" ? " · the pack changed it too; reset it later to take theirs" : ""}
                          </div>
                        </div>
                        {data && (
                          <div className="flex items-center gap-2">
                            {(k === "changed" || k === "kept") && (
                              <>
                                <Thumb item={it} side="before" preview={data} />
                                <IconArrowRight className="size-4 shrink-0 text-muted-foreground" aria-label="becomes" />
                              </>
                            )}
                            <Thumb item={it} side={k === "removed" ? "before" : "after"} preview={data} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">No template or label changes (other files may have changed).</p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => void skip()} disabled={busy}>
            Skip this version
          </Button>
          <Button variant="outline" onClick={() => (onLater?.(), onClose())} disabled={busy}>
            Later
          </Button>
          <Button onClick={() => void apply()} disabled={busy}>
            <IconDownload /> {busy ? "Updating…" : "Apply update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
