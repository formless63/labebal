"use client";
import { useMemo, useState } from "react";
import { Link } from "../../lib/router";
import { useRouter } from "../../lib/router";
import { useQueryClient } from "@tanstack/react-query";
import { IconCopy, IconDots, IconDownload, IconHistory, IconLayoutGrid, IconPencil, IconPlus, IconSearch, IconTrash, IconUpload, IconWand, IconWriting } from "@tabler/icons-react";
import { LIBRARY_KEY } from "../labels/api";
import { IMPORT_ACCEPT, importDesignFiles } from "../library/import";
import { VersionHistoryDialog } from "./VersionHistory";
import { toast } from "sonner";
import { SIZES, sizePrinterName, type Label, type Template } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Page } from "../../components/app-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useLibrary, useLibraryActions } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { stockAreas } from "../editor/controls";
import { useDeleteTemplate } from "./api";
import { STARTERS, makeStarter, type StarterId } from "./starters";
import { TemplateThumb } from "./TemplateThumb";
import { LibraryParts } from "./LibraryParts";
import { RoleGate, useCan } from "../auth/me-client";
import { GalleryDialog } from "../gallery/GalleryDialog";
import { PackBadge } from "../packs/PackBadge";
import { ExportPackDialog, type ExportPackTarget } from "../packs/ExportPackDialog";
import { packOf, usePackActions } from "../packs/api";
import { EMPTY_TEMPLATE_FILTER, activeCount, matchTemplate, tagCounts, templateFacts, type TemplateFilter } from "../library/filter";
import { TemplateFilterButton } from "../library/FilterButton";
import { IconPackageExport, IconRestore } from "@tabler/icons-react";
import { apiRoot } from "../../lib/base";

const newTemplateId = () => `t-${crypto.randomUUID().slice(0, 8)}`;

/** Route: /templates. All templates with live previews. */
export function TemplatesPage() {
  const { data: lib, isLoading, error } = useLibrary();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TemplateFilter>(EMPTY_TEMPLATE_FILTER);
  const [creating, setCreating] = useState(false);
  const [gallery, setGallery] = useState(false);
  const canEdit = useCan("editor");
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [history, setHistory] = useState<Template | null>(null);
  const qc = useQueryClient();
  const [packExport, setPackExport] = useState<ExportPackTarget | null>(null);
  const packActions = usePackActions();

  const share = (t: Template, labels: boolean) => {
    const a = document.createElement("a");
    a.href = `${apiRoot()}/templates/${encodeURIComponent(t.id)}/share${labels ? "?labels=1" : ""}`;
    a.click();
  };

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const r = await importDesignFiles([...files], actions.importLibrary);
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      void qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success(`Imported ${r.templates} template${r.templates === 1 ? "" : "s"} and ${r.labels} label${r.labels === 1 ? "" : "s"}`, {
        description: r.warnings.slice(0, 3).join("; ") || undefined,
      });
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message ?? e}`);
    }
  };
  const actions = useLibraryActions();
  const router = useRouter();

  const usage = useMemo(() => {
    const m = new Map<string, Label[]>();
    for (const l of lib?.labels ?? []) m.set(l.templateId, [...(m.get(l.templateId) ?? []), l]);
    return m;
  }, [lib]);
  const facts = useMemo(() => new Map((lib?.templates ?? []).map((t) => [t.id, templateFacts(t, !!packOf(lib, "template", t.id), usage.has(t.id))])), [lib, usage]);
  const allTags = useMemo(() => tagCounts([...facts.values()].map((x) => x.tags)), [facts]);
  const filtering = activeCount(filter) > 0;
  const shown = (lib?.templates ?? [])
    .filter((t) => !filtering || matchTemplate(filter, facts.get(t.id)!))
    .filter((t) => !q || `${t.name} ${t.description ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  const duplicate = async (t: Template) => {
    const copy: Template = { ...structuredClone(t), id: newTemplateId(), name: `${t.name} copy` };
    const ok = await actions.saveTemplate(copy, { immediate: true });
    if (ok) toast.success(`Made a copy: ${copy.name}`);
  };

  return (
    <Page
      title="Templates"
      actions={
        <>
          <div className="relative">
            <IconSearch className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="w-56 pl-8" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
          </div>
          <TemplateFilterButton value={filter} onChange={setFilter} tags={allTags} />
          <RoleGate need="editor">
            <Button variant="outline" asChild title="A shared .labebal.json / zip, NiimBlue .json, ZPL or P-touch .lbx">
              <label className="cursor-pointer">
                <IconUpload /> Import
                <input type="file" hidden multiple accept={IMPORT_ACCEPT} onChange={(e) => (void onImport(e.target.files), (e.target.value = ""))} />
              </label>
            </Button>
            <Button variant="outline" onClick={() => setGallery(true)}>
              <IconLayoutGrid /> New from gallery
            </Button>
            <Button onClick={() => setCreating(true)}>
              <IconPlus /> New template
            </Button>
          </RoleGate>
        </>
      }
    >
      <p className="-mt-3 text-sm text-muted-foreground">A template is the design; labels fill in its fields. Templates reflow to every label size.</p>
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">Could not load the library: {String(error)}</p>}
      {lib && !shown.length && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {q ? "No templates match." : "No templates yet."}{" "}
          {!q && (
            <Button variant="link" onClick={() => setCreating(true)}>
              Create one
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {shown.map((t) => {
          const used = usage.get(t.id) ?? [];
          return (
            <div key={t.id} className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
              <Link href={`/templates/${encodeURIComponent(t.id)}`} className="flex h-36 items-center justify-center bg-muted/60 p-4" title="Open in the editor">
                <TemplateThumb template={t} label={used[0]} maxW={220} maxH={100} />
              </Link>
              <div className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/templates/${encodeURIComponent(t.id)}`} className="block truncate font-medium hover:underline">
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {t.design.w} × {t.design.h} mm
                    </span>
                    <span>·</span>
                    <UsedBy labels={used} />
                    <PackBadge lib={lib} kind="template" id={t.id} />
                    {(t.variants?.length ?? 0) > 0 && <Badge variant="secondary">{t.variants!.length} variant{t.variants!.length > 1 ? "s" : ""}</Badge>}
                    {t.tags?.map((tag) => (
                      <button key={tag} type="button" title={`Show only "${tag}"`} onClick={() => setFilter((f) => (f.tags.includes(tag.toLowerCase()) ? f : { ...f, tags: [...f.tags, tag.toLowerCase()] }))}>
                        <Badge variant="outline">{tag}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
                {canEdit && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}>
                      <IconDots />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => router.push(`/templates/${encodeURIComponent(t.id)}`)}>
                      <IconWriting /> Open in editor
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRenaming(t)}>
                      <IconPencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push(`/data?rules=${encodeURIComponent(t.id)}`)}>
                      <IconWand /> Rules{t.rules?.rules.length ? ` (${t.rules.rules.length})` : "…"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void duplicate(t)}>
                      <IconCopy /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setHistory(t)}>
                      <IconHistory /> Version history…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => share(t, false)}>
                      <IconDownload /> Share as file
                    </DropdownMenuItem>
                    {used.length > 0 && (
                      <DropdownMenuItem onSelect={() => share(t, true)}>
                        <IconDownload /> Share with its {used.length} label{used.length > 1 ? "s" : ""}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setPackExport({ title: t.name, templateIds: [t.id], labelIds: used.map((l) => l.id), name: t.name })}>
                      <IconPackageExport /> Export as pack{used.length ? ` (with ${used.length} label${used.length > 1 ? "s" : ""})` : ""}…
                    </DropdownMenuItem>
                    {packOf(lib, "template", t.id)?.changed && (
                      <DropdownMenuItem onSelect={() => void packActions.reset({ items: [{ kind: "template", id: t.id }] }).then(() => toast.success(`"${t.name}" reset to the pack version`), (e) => toast.error(String(e.message ?? e)))}>
                        <IconRestore /> Reset to pack version
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
                      <IconTrash /> Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>}
              </div>
            </div>
          );
        })}
      </div>
      {lib && !q && <LibraryParts lib={lib} />}

      <GalleryDialog open={gallery} onOpenChange={setGallery} onCreated={(id) => router.push(`/templates/${encodeURIComponent(id)}`)} />
      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreated={(id) => router.push(`/templates/${encodeURIComponent(id)}`)} />
      {renaming && <RenameDialog template={renaming} onClose={() => setRenaming(null)} />}
      {history && <VersionHistoryDialog template={history} sample={usage.get(history.id)?.[0]} onClose={() => setHistory(null)} />}
      {deleting && <DeleteDialog template={deleting} labels={usage.get(deleting.id) ?? []} onClose={() => setDeleting(null)} />}
    {packExport && <ExportPackDialog target={packExport} onClose={() => setPackExport(null)} />}
    </Page>
  );
}

function UsedBy({ labels }: { labels: Label[] }) {
  if (!labels.length) return <span>not used yet</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">
          used by {labels.length} label{labels.length > 1 ? "s" : ""}
        </span>
      </TooltipTrigger>
      <TooltipContent className="block max-w-64">
        {labels.slice(0, 12).map((l) => l.name).join(", ")}
        {labels.length > 12 && ` and ${labels.length - 12} more`}
      </TooltipContent>
    </Tooltip>
  );
}

function NewTemplateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const actions = useLibraryActions();
  const marginMm = useLabelStore((s) => s.settings.marginMm);
  const areas = stockAreas(marginMm);
  const [name, setName] = useState("");
  // Blank = free placement: drag things anywhere. The others reflow automatically.
  const [starter, setStarter] = useState<StarterId>("blank");
  const current = useLabelStore((s) => s.settings.sizeId);
  const [sizeId, setSizeId] = useState(() => (SIZES.some((s) => s.id === current) ? current : "n1-14x30"));
  const [busy, setBusy] = useState(false);
  const area = areas.find((a) => a.size.id === sizeId) ?? areas[0];
  const design = { w: Math.round(area.width * 100) / 100, h: Math.round(area.height * 100) / 100 };

  const create = async () => {
    setBusy(true);
    const id = newTemplateId();
    const t = makeStarter(starter, { id, name: name.trim() || STARTERS.find((s) => s.id === starter)!.name, design });
    const ok = await actions.saveTemplate(t, { immediate: true });
    setBusy(false);
    if (!ok) return toast.error("Couldn't create the template.");
    onOpenChange(false);
    setName("");
    onCreated(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>Pick a starting point. You can change everything in the editor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <div className="space-y-1.5">
            <UiLabel>Name</UiLabel>
            <Input autoFocus value={name} placeholder="e.g. Drawer label" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
          </div>
          <div className="space-y-1.5">
            <UiLabel>Designed for</UiLabel>
            <Select value={sizeId} onValueChange={setSizeId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {sizePrinterName(s)} {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STARTERS.map((s) => (
            <button
              key={s.id}
              className={cn("flex flex-col items-center gap-2 rounded-lg border p-3 text-left hover:bg-muted", starter === s.id && "border-primary ring-2 ring-primary")}
              onClick={() => setStarter(s.id)}
              aria-pressed={starter === s.id}
            >
              <TemplateThumb template={makeStarter(s.id, { id: `preview-${s.id}`, name: s.name, design })} maxW={130} maxH={60} />
              <span className="w-full text-sm font-medium">{s.name}</span>
              <span className="w-full text-xs text-muted-foreground">{s.description}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            Create and open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const actions = useLibraryActions();
  const [name, setName] = useState(template.name);
  const save = () => {
    if (!name.trim()) return;
    void actions.saveTemplate({ ...template, name: name.trim() }, { immediate: true });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename template</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Template name" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={save}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ template, labels, onClose }: { template: Template; labels: Label[]; onClose: () => void }) {
  const del = useDeleteTemplate();
  const actions = useLibraryActions();
  const [withLabels, setWithLabels] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (withLabels) for (const l of labels) await actions.deleteLabel(l.id);
      await del(template.id);
      toast.success(`Deleted ${template.name}`);
      onClose();
    } catch (e) {
      toast.error(`Couldn't delete: ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{template.name}&rdquo;?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        {labels.length > 0 && (
          <div className="space-y-2 rounded-md bg-destructive/10 p-3 text-sm">
            <p>
              {labels.length} label{labels.length > 1 ? "s use" : " uses"} this template. Without it {labels.length > 1 ? "they" : "it"} can&apos;t be printed.
            </p>
            <label className="flex items-center gap-2">
              <Checkbox checked={withLabels} onCheckedChange={(v) => setWithLabels(v === true)} /> Also delete {labels.length > 1 ? `these ${labels.length} labels` : "this label"}
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void go()}>
            <IconTrash /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
