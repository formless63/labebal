"use client";
/**
 * Template version history: snapshots (one per editing session, plus named
 * "Save version"s and the versions labels were printed with), compare two side
 * by side as rendered previews, restore one.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowBackUp, IconGitCompare, IconPrinter, IconUser } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label, Template } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { json } from "../data/api";
import { LIBRARY_KEY } from "../labels/api";
import { whoHeader } from "../labels/history-client";
import { useLabelStore } from "../labels/store";
import { TemplateThumb } from "./TemplateThumb";
import { apiRoot } from "../../lib/base";

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  name: string;
  note: string;
  auto: boolean;
  who: string;
  createdAt: string;
  updatedAt: string;
  doc: Template;
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const versionsKey = (id: string) => ["template-versions", id] as const;

/** Short list of what differs between two template documents. */
function changes(a: Template, b: Template): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`renamed "${a.name}" → "${b.name}"`);
  if (a.design.w !== b.design.w || a.design.h !== b.design.h) out.push(`design size ${a.design.w}×${a.design.h} → ${b.design.w}×${b.design.h} mm`);
  const fa = new Set(a.fields.map((f) => f.key)), fb = new Set(b.fields.map((f) => f.key));
  const added = [...fb].filter((k) => !fa.has(k)), removed = [...fa].filter((k) => !fb.has(k));
  if (added.length) out.push(`fields added: ${added.join(", ")}`);
  if (removed.length) out.push(`fields removed: ${removed.join(", ")}`);
  const count = (t: Template) => JSON.stringify(t.root).split('"id":').length - 1;
  if (count(a) !== count(b)) out.push(`${count(a)} → ${count(b)} elements`);
  if ((a.variants?.length ?? 0) !== (b.variants?.length ?? 0)) out.push(`variants ${a.variants?.length ?? 0} → ${b.variants?.length ?? 0}`);
  if ((a.rules?.rules.length ?? 0) !== (b.rules?.rules.length ?? 0)) out.push(`rules ${a.rules?.rules.length ?? 0} → ${b.rules?.rules.length ?? 0}`);
  if (!out.length && JSON.stringify(a.root) !== JSON.stringify(b.root)) out.push("layout or style changed");
  return out.length ? out : ["no differences"];
}

export function VersionHistoryDialog({ template, sample, onClose }: { template: Template; sample?: Label; onClose: () => void }) {
  const qc = useQueryClient();
  const sizeId = useLabelStore((s) => s.settings.sizeId);
  const printer = useLabelStore((s) => s.settings.printer);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const q = useQuery({
    queryKey: versionsKey(template.id),
    queryFn: () => fetch(`${apiRoot()}/templates/${encodeURIComponent(template.id)}/versions`).then((r) => json<TemplateVersion[]>(r)),
  });
  const versions = q.data ?? [];
  const current = versions[0];
  const refresh = () => qc.invalidateQueries({ queryKey: versionsKey(template.id) });

  async function save() {
    const r = await fetch(`${apiRoot()}/templates/${encodeURIComponent(template.id)}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...whoHeader() },
      body: JSON.stringify({ note: note.trim() }),
    });
    if (!r.ok) return toast.error(`Couldn't save the version: ${r.status}`);
    setNote("");
    toast.success("Version saved");
    void refresh();
  }

  async function restore(v: TemplateVersion) {
    const ok = await confirmDialog({
      title: `Restore version ${v.version}?`,
      description: "The template's design goes back to this version for all its labels. The current design stays in the history, so you can switch back.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    const r = await fetch(`${apiRoot()}/templates/${encodeURIComponent(template.id)}/versions/${v.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...whoHeader() },
      body: JSON.stringify({ action: "restore" }),
    });
    if (!r.ok) return toast.error(`Couldn't restore: ${r.status}`);
    toast.success(`Restored version ${v.version}`);
    await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
    void refresh();
  }

  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const compare = picked.map((id) => versions.find((v) => v.id === id)).filter(Boolean).sort((a, b) => a!.version - b!.version) as TemplateVersion[];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Versions of &ldquo;{template.name}&rdquo;</DialogTitle>
          <DialogDescription>
            A version is kept for each editing session and whenever labels are printed. Tick two to compare them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="Name this version, e.g. Approved by stores" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} aria-label="Version name" />
          <Button onClick={() => void save()}>Save version</Button>
        </div>

        {compare.length === 2 && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconGitCompare className="size-4" /> v{compare[0].version} vs v{compare[1].version}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {compare.map((v) => (
                <div key={v.id} className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    v{v.version} · {fmt.format(new Date(v.updatedAt))}
                  </div>
                  <TemplateThumb template={v.doc} label={sample} maxW={320} maxH={140} />
                  <TemplateThumb template={v.doc} label={sample} sizeId={sizeId} printer={printer} maxW={320} maxH={110} title="At the label size chosen for printing" />
                </div>
              ))}
            </div>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {changes(compare[0].doc, compare[1].doc).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <ScrollArea className="max-h-[50vh]">
          {q.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
          {!q.isLoading && !versions.length && <p className="p-3 text-sm text-muted-foreground">No versions yet. One is kept as soon as the template is saved or printed.</p>}
          <ul className="divide-y">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 pr-2">
                <Checkbox checked={picked.includes(v.id)} onCheckedChange={() => pick(v.id)} aria-label={`Compare version ${v.version}`} />
                <TemplateThumb template={v.doc} label={sample} maxW={120} maxH={48} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">v{v.version}</span>
                    {v.note && <span>{v.note}</span>}
                    {v === current && <Badge variant="secondary">current</Badge>}
                    {v.auto && v === current && <Badge variant="outline">being edited</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{fmt.format(new Date(v.updatedAt))}</span>
                    {v.who && (
                      <span className="flex items-center gap-0.5">
                        <IconUser className="size-3" /> {v.who}
                      </span>
                    )}
                    {!v.auto && !v.note && (
                      <span className="flex items-center gap-0.5">
                        <IconPrinter className="size-3" /> printed with
                      </span>
                    )}
                    {v.name !== template.name && <span>as &ldquo;{v.name}&rdquo;</span>}
                  </div>
                </div>
                {v !== current && (
                  <Button size="sm" variant="outline" onClick={() => void restore(v)}>
                    <IconArrowBackUp /> Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
