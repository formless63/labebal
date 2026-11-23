"use client";
/**
 * "New label": pick the design the label uses (any template, searchable, the
 * selected label's design first), or start a new design (editors), which
 * creates the template and its first label and opens the design editor.
 */
import { useMemo, useState } from "react";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label, Library, Template } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { useRouter } from "../../lib/router";
import { cn } from "../../lib/utils";
import { useCan } from "../auth/me-client";
import { stockAreas } from "../editor/controls";
import { withFolder } from "../library/folders";
import { STARTERS, makeStarter, type StarterId } from "../templates/starters";
import { TemplateThumb } from "../templates/TemplateThumb";
import { useLibraryActions } from "./api";
import { useLabelStore } from "./store";

const newId = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

/** A label of template `t` with the field defaults. */
export const labelFor = (t: Template, name = t.name): Label => ({ id: newId("l"), templateId: t.id, name, values: Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])) });

export function NewLabelDialog({ lib, open, onOpenChange, folder, currentTemplateId }: { lib: Library; open: boolean; onOpenChange: (v: boolean) => void; folder: string; currentTemplateId?: string }) {
  const actions = useLibraryActions();
  const select = useLabelStore((s) => s.select);
  const settings = useLabelStore((s) => s.settings);
  const router = useRouter();
  const canDesign = useCan("editor");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lib.labels) m.set(l.templateId, (m.get(l.templateId) ?? 0) + 1);
    return m;
  }, [lib.labels]);
  const sample = (id: string) => lib.labels.find((l) => l.templateId === id);
  const templates = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return lib.templates
      .filter((t) => words.every((w) => `${t.name} ${t.description ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(b.id === currentTemplateId) - Number(a.id === currentTemplateId) || (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  }, [lib.templates, q, currentTemplateId, usage]);

  // New designs start at the size in use (its printable area).
  const area = stockAreas(settings.marginMm).find((a) => a.size.id === settings.sizeId);
  const design = area ? { w: Math.round(area.width * 100) / 100, h: Math.round(area.height * 100) / 100 } : { w: 40, h: 12 };

  const place = (l: Label) => (folder ? withFolder(l, folder) : l);

  const fromTemplate = (t: Template) => {
    const l = place(labelFor(t));
    actions.saveLabel(l, { immediate: true });
    select(l.id);
    onOpenChange(false);
    setQ("");
  };

  const newDesign = async (starter: StarterId) => {
    setBusy(true);
    const s = STARTERS.find((x) => x.id === starter)!;
    const t = makeStarter(starter, { id: newId("t"), name: starter === "blank" ? "New design" : s.name, design });
    const ok = await actions.saveTemplate(t, { immediate: true });
    if (!ok) {
      setBusy(false);
      return toast.error("Couldn't create the design.");
    }
    const l = place(labelFor(t, "New label"));
    actions.saveLabel(l, { immediate: true });
    select(l.id);
    setBusy(false);
    onOpenChange(false);
    router.push(`/templates/${encodeURIComponent(t.id)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New label{folder ? ` in ${folder}` : ""}</DialogTitle>
          <DialogDescription>
            A label fills in a design&apos;s fields (text, codes, icons). Pick the design it uses{canDesign ? ", or start a new design and draw it in the editor" : ""}.
          </DialogDescription>
        </DialogHeader>

        {canDesign && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">New design</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STARTERS.map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  className="flex flex-col items-center gap-1.5 rounded-lg border p-2 text-left hover:bg-muted disabled:opacity-50"
                  onClick={() => void newDesign(s.id)}
                  title={`${s.description} Opens the design editor.`}
                >
                  <TemplateThumb template={makeStarter(s.id, { id: `preview-${s.id}`, name: s.name, design })} maxW={120} maxH={44} />
                  <span className="flex w-full items-center gap-1 text-sm font-medium">
                    {s.id === "blank" && <IconPlus className="size-3.5" />} {s.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Use a design</h3>
            <span className="flex-1" />
            <div className="relative">
              <IconSearch className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus className="h-8 w-56 pl-8" placeholder="Search designs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search designs" />
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-2 overflow-y-auto pr-1">
            {templates.map((t) => (
              <button key={t.id} className={cn("flex flex-col gap-1.5 rounded-lg border p-2 text-left hover:bg-muted", t.id === currentTemplateId && "border-primary/60")} onClick={() => fromTemplate(t)}>
                <span className="flex h-20 items-center justify-center rounded bg-muted/60">
                  <TemplateThumb template={t} label={sample(t.id)} maxW={160} maxH={68} />
                </span>
                <span className="truncate text-sm font-medium">{t.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {t.id === currentTemplateId ? "Same as the selected label · " : ""}
                  {usage.get(t.id) ? `${usage.get(t.id)} label${usage.get(t.id)! > 1 ? "s" : ""}` : `${t.design.w} × ${t.design.h} mm`}
                </span>
              </button>
            ))}
            {!templates.length && <p className="col-span-full p-6 text-center text-sm text-muted-foreground">{q ? "No designs match." : "No designs yet."}</p>}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
