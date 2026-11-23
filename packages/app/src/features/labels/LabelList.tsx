"use client";
/**
 * The label library: a folder tree (folders come from `folder:` tags, see
 * library/folders.ts), favourites, and search. Labels can be dragged onto a
 * folder; several checked labels move together.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconChevronRight,
  IconDots,
  IconDownload,
  IconFileTypePdf,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolders,
  IconPhoto,
  IconPin,
  IconPinnedOff,
  IconPackageExport,
  IconRestore,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconUpload,
  IconX,
  IconTag,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { Label, Library } from "@labebal/core";
import { promptDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import { useRuns } from "../runs/api";
import { exportPngs, exportProofPdf, type ExportItem } from "../library/export";
import { ancestors, buildTree, folderOf, normalizeFolder, renamedFolder, useLibraryPrefs, withFolder, type TreeFolder } from "../library/folders";
import { IMPORT_ACCEPT, importDesignFiles } from "../library/import";
import { LIBRARY_KEY, useLibraryActions } from "./api";
import { isInverted, usePrintContext } from "./context";
import { LabelPreview } from "./LabelPreview";
import { NewLabelDialog } from "./NewLabelDialog";
import { useLabelStore } from "./store";
import { PackBadge } from "../packs/PackBadge";
import { ExportPackDialog, type ExportPackTarget } from "../packs/ExportPackDialog";
import { packOf, usePackActions } from "../packs/api";
import type { LibraryWithPacks } from "../packs/types";
import { EMPTY_LABEL_FILTER, activeCount, labelFacts, matchLabel, tagCounts, type LabelFilter } from "../library/filter";
import { ActiveTagChips, LabelFilterButton } from "../library/FilterButton";
import { parseTags, userTags } from "../library/tags";

type View = "folders" | "favourites";
const DRAG = "application/x-labebal-labels";
const INDENT = 14;

/** Only mounts its children once scrolled near the viewport (200+ label previews stay cheap). */
function Lazy({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className={className} style={style}>
      {seen ? children : null}
    </div>
  );
}

export function LabelList({ lib }: { lib: Library }) {
  const ctx = usePrintContext();
  const { settings, printer, size } = ctx;
  const selected = useLabelStore((s) => s.selectedLabelId);
  const select = useLabelStore((s) => s.select);
  const enqueue = useLabelStore((s) => s.enqueue);
  const queue = useLabelStore((s) => s.queue);
  const actions = useLibraryActions();
  const qc = useQueryClient();
  const { favourites, pinned, openFolders, newFolders, toggleFavourite, togglePin, setFolderOpen, addFolder, dropNewFolder } = useLibraryPrefs();
  const { data: runs } = useRuns();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LabelFilter>(EMPTY_LABEL_FILTER);
  const [view, setView] = useState<View>("folders");
  /** Folder new labels go into (the last folder clicked). */
  const [here, setHere] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packExport, setPackExport] = useState<ExportPackTarget | null>(null);
  // Folder the "New label" picker adds to (null: closed).
  const [newIn, setNewIn] = useState<string | null>(null);
  const packActions = usePackActions();
  const fileInput = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(lib.labels, newFolders), [lib.labels, newFolders]);
  const open = useMemo(() => new Set(openFolders), [openFolders]);
  const pinnedLabels = useMemo(() => pinned.map((id) => lib.labels.find((l) => l.id === id)).filter((l): l is Label => !!l), [pinned, lib.labels]);

  // What filters look at per label: tags (own + template's), template, source, inverted.
  const facts = useMemo(() => {
    const byTemplate = new Map(lib.templates.map((t) => [t.id, t]));
    return new Map(lib.labels.map((l) => [l.id, labelFacts(l, byTemplate.get(l.templateId), !!packOf(lib as LibraryWithPacks, "label", l.id), isInverted(l, byTemplate.get(l.templateId), false))]));
  }, [lib]);
  const allTags = useMemo(() => tagCounts([...facts.values()].map((x) => x.tags)), [facts]);
  const templateChoices = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of lib.labels) n.set(l.templateId, (n.get(l.templateId) ?? 0) + 1);
    return lib.templates.filter((t) => n.has(t.id)).map((t) => ({ id: t.id, name: t.name, count: n.get(t.id)! }));
  }, [lib]);
  const filtering = activeCount(filter) > 0;

  // Search, filters and favourites are flat lists; the tree is the default view.
  const flat = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && view === "folders" && !filtering) return null;
    const fav = new Set(favourites);
    return lib.labels
      .filter((l) => view !== "favourites" || fav.has(l.id))
      .filter((l) => !filtering || matchLabel(filter, facts.get(l.id)!))
      .filter((l) => !q || `${l.name} ${folderOf(l)} ${Object.values(l.values).join(" ")} ${facts.get(l.id)?.tags.join(" ") ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [lib.labels, search, view, favourites, filter, filtering, facts]);

  /** Add tags to labels (keeps their folder and other tags). */
  async function tagLabels(ls: Label[]) {
    if (!ls.length) return;
    const input = await promptDialog({
      title: ls.length === 1 ? `Tags for "${ls[0].name}"` : `Add tags to ${ls.length} labels`,
      description: "Words to find them by, separated by commas (e.g. freezer, outdoor). Start a tag with - to remove it.",
      label: "Tags",
      defaultValue: ls.length === 1 ? userTags(ls[0].tags).join(", ") : "",
      confirmLabel: "Save",
    });
    if (input === null) return;
    const remove = parseTags(input.split(",").filter((x) => x.trim().startsWith("-")).map((x) => x.trim().slice(1)).join(","));
    const add = parseTags(input.split(",").filter((x) => !x.trim().startsWith("-")).join(","));
    for (const l of ls) {
      const own = userTags(l.tags);
      const keep = (l.tags ?? []).filter((t) => !own.includes(t));
      // One label: the box is its whole tag list. Several: tags are added (or removed with -).
      const next = ls.length === 1 ? add : [...new Set([...own.filter((t) => !remove.includes(t)), ...add])];
      actions.saveLabel({ ...l, tags: [...keep, ...next] }, { immediate: true });
    }
    toast.success(ls.length === 1 ? "Tags saved" : `Tags updated on ${ls.length} labels`);
  }

  // Open the folders leading to the selected label so it is visible.
  const current = lib.labels.find((l) => l.id === selected);
  const currentFolder = current ? folderOf(current) : "";
  useEffect(() => {
    if (!currentFolder) return;
    for (const p of [...ancestors(currentFolder), currentFolder]) if (!useLibraryPrefs.getState().openFolders.includes(p)) setFolderOpen(p, true);
  }, [currentFolder, setFolderOpen]);

  const checkedLabels = lib.labels.filter((l) => checked.has(l.id));
  const toggleCheck = (id: string) => setChecked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const allIn = (f: TreeFolder): Label[] => [...f.labels, ...f.folders.flatMap(allIn)];

  /** Opens the picker (which design the label uses, or a new design). */
  function newLabel(folder = here) {
    if (folder) setFolderOpen(folder, true);
    setNewIn(folder);
  }

  async function newFolder(parent = "") {
    const name = await promptDialog({
      title: parent ? `New folder in ${parent}` : "New folder",
      description: "Use / for subfolders. Drag labels onto it to fill it.",
      label: "Name",
      placeholder: "Drawers/Screws",
      confirmLabel: "Create",
    });
    const path = name && normalizeFolder(parent ? `${parent}/${name}` : name);
    if (!path) return;
    addFolder(path);
    for (const p of [...ancestors(path), path]) setFolderOpen(p, true);
    setHere(path);
  }

  async function renameFolder(f: TreeFolder) {
    const to = await promptDialog({ title: `Rename "${f.name}"`, description: "Use / to move it into another folder.", label: "Folder", defaultValue: f.path, confirmLabel: "Rename" });
    if (to === null || normalizeFolder(to) === f.path) return;
    const moved = lib.labels.flatMap((l) => {
      const next = renamedFolder(l, f.path, to);
      return next === null ? [] : [withFolder(l, next)];
    });
    for (const l of moved) actions.saveLabel(l, { immediate: true });
    // Empty folders made here move along too.
    for (const p of newFolders.filter((p) => p === f.path || p.startsWith(f.path + "/"))) {
      dropNewFolder(p);
      if (normalizeFolder(to)) addFolder(normalizeFolder(to) + p.slice(f.path.length));
    }
    setFolderOpen(normalizeFolder(to), true);
    toast.success(normalizeFolder(to) ? `Renamed to ${normalizeFolder(to)}` : `Moved ${moved.length} labels out of the folder`);
  }

  function moveInto(ids: string[], path: string) {
    const ls = lib.labels.filter((l) => ids.includes(l.id) && folderOf(l) !== path);
    if (!ls.length) return;
    for (const l of ls) actions.saveLabel(withFolder(l, path), { immediate: true });
    if (path) setFolderOpen(path, true);
    setChecked(new Set());
    toast.success(`${ls.length === 1 ? `"${ls[0].name}"` : `${ls.length} labels`} ${path ? `moved to ${path}` : "taken out of their folder"}`);
  }

  async function moveTo(ls: Label[]) {
    if (!ls.length) return;
    const now = ls.length === 1 ? folderOf(ls[0]) : "";
    const path = await promptDialog({
      title: ls.length === 1 ? `Folder for "${ls[0].name}"` : `Move ${ls.length} labels to a folder`,
      description: "Use / for subfolders, e.g. Drawers/Screws. Leave empty to take them out of their folder.",
      label: "Folder",
      defaultValue: now,
      placeholder: tree.folders[0]?.path ?? "Drawers/Screws",
      confirmLabel: "Move",
    });
    if (path === null) return;
    moveInto(
      ls.map((l) => l.id),
      normalizeFolder(path),
    );
  }

  /** Put every label that isn't in a folder into one named after its template. */
  function fileByTemplate() {
    const loose = lib.labels.filter((l) => !folderOf(l));
    let n = 0;
    for (const l of loose) {
      const t = lib.templates.find((x) => x.id === l.templateId);
      if (!t?.name) continue;
      actions.saveLabel(withFolder(l, t.name.replaceAll("/", "-")), { immediate: true });
      n++;
    }
    toast.success(n ? `Filed ${n} label${n === 1 ? "" : "s"} into folders by template` : "Every label is already in a folder");
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const r = await importDesignFiles([...files], actions.importLibrary, { zplDpmm: 8 });
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      void qc.invalidateQueries({ queryKey: ["assets"] });
      if (r.firstLabelId) select(r.firstLabelId);
      toast.success(`Imported ${r.labels} label${r.labels === 1 ? "" : "s"} into ${r.templates} template${r.templates === 1 ? "" : "s"}`, {
        description: r.warnings.length ? `${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"}: ${r.warnings.slice(0, 3).join("; ")}${r.warnings.length > 3 ? "…" : ""}` : undefined,
      });
      if (r.warnings.length) console.warn(r.warnings);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message ?? e}`);
    }
  }

  function exportJson() {
    const { packs: _p, ...plain } = lib as LibraryWithPacks;
    void _p;
    const blob = new Blob([JSON.stringify(plain, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `labebal-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function runExport(kind: "pdf" | "png", items: ExportItem[], title: string) {
    if (!items.length) return toast.error("Nothing to export");
    setBusy(true);
    try {
      const n = kind === "pdf" ? await exportProofPdf(lib, items, ctx, title) : await exportPngs(lib, items, ctx, title);
      toast.success(kind === "pdf" ? `Proof sheet with ${n} label${n === 1 ? "" : "s"}: print it at 100 % (actual size)` : `Exported ${n} PNG${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  const byId = (id: string) => lib.labels.find((l) => l.id === id);
  const queueItems = queue.map((q) => ({ label: byId(q.labelId)!, qty: q.qty })).filter((i) => i.label && i.qty > 0);
  const shown = flat ?? lib.labels;
  const exportSources = (kind: "pdf" | "png") => (
    <>
      <DropdownMenuItem disabled={!checkedLabels.length} onSelect={() => void runExport(kind, checkedLabels.map((label) => ({ label })), "Selected labels")}>
        Selected labels ({checkedLabels.length})
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!shown.length} onSelect={() => void runExport(kind, shown.map((label) => ({ label })), flat ? "Labels" : "All labels")}>
        {flat ? "Labels shown" : "All labels"} ({shown.length})
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!queueItems.length} onSelect={() => void runExport(kind, queueItems, "Print queue")}>
        Print queue ({queueItems.length})
      </DropdownMenuItem>
      {!!runs?.length && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Stock run</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {runs.map((r) => (
              <DropdownMenuItem key={r.id} onSelect={() => void runExport(kind, r.items.map((i) => ({ label: byId(i.labelId)!, qty: i.qty })).filter((i) => i.label && i.qty > 0), r.name)}>
                {r.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  );

  // Drop target props for a folder row ("" = out of any folder).
  const dropProps = (path: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== path) setDropTarget(path);
    },
    onDragLeave: () => setDropTarget((t) => (t === path ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const ids = e.dataTransfer.getData(DRAG).split(",").filter(Boolean);
      if (ids.length) moveInto(ids, path);
    },
  });

  const row = (l: Label, depth: number, showFolder = false) => {
    const t = lib.templates.find((x) => x.id === l.templateId);
    const fav = favourites.includes(l.id);
    const pin = pinned.includes(l.id);
    const f = folderOf(l);
    return (
      <li key={l.id}>
        <div
          className={cn("group flex items-center gap-1 rounded-md pr-1", l.id === selected && "bg-accent")}
          style={{ paddingLeft: depth * INDENT }}
          draggable
          onDragStart={(e) => {
            const ids = checked.has(l.id) ? [...checked] : [l.id];
            e.dataTransfer.setData(DRAG, ids.join(","));
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <Checkbox
            className={cn("ml-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100", checked.size > 0 && "opacity-100")}
            checked={checked.has(l.id)}
            onCheckedChange={() => toggleCheck(l.id)}
            aria-label={`Select ${l.name}`}
          />
          <button className="flex min-w-0 flex-1 items-center gap-2.5 p-1.5 text-left" onClick={() => (select(l.id), setHere(f))}>
            <Lazy className="shrink-0" style={{ width: size.widthMm * 2.6, height: size.heightMm * 2.6 }}>
              {t && (
                <LabelPreview
                  template={t}
                  label={l}
                  invert={isInverted(l, t, settings.invertAll)}
                  size={size}
                  printer={printer}
                  material={settings.material}
                  ribbon={settings.ribbon}
                  marginMm={settings.marginMm}
                  scale={2.6}
                />
              )}
            </Lazy>
            <span className="min-w-0">
              <span className="flex items-center gap-1 truncate text-sm">
                {pin && <IconPin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                <span className="truncate">{l.name}</span>
                <PackBadge lib={lib as LibraryWithPacks} kind="label" id={l.id} compact />
              </span>
              {f && showFolder && <span className="block truncate text-xs text-muted-foreground">{f}</span>}
            </span>
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn(!fav && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
            title={fav ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={fav}
            onClick={() => toggleFavourite(l.id)}
          >
            {fav ? <IconStarFilled className="text-amber-500" /> : <IconStar />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More for ${l.name}`}>
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => enqueue(l.id)}>
                <IconPlus /> Add one to the print queue
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => togglePin(l.id)}>
                {pin ? <IconPinnedOff /> : <IconPin />} {pin ? "Unpin" : "Pin to top"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void moveTo([l])}>
                <IconFolderOpen /> Move to folder…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void runExport("png", [{ label: l }], l.name)}>
                <IconPhoto /> Export PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runExport("pdf", [{ label: l }], l.name)}>
                <IconFileTypePdf /> Proof sheet (PDF)
              </DropdownMenuItem>
              {packOf(lib as LibraryWithPacks, "label", l.id)?.changed && (
                <DropdownMenuItem onSelect={() => void packActions.reset({ items: [{ kind: "label", id: l.id }] }).then(() => toast.success(`"${l.name}" reset to the pack version`), (e) => toast.error(String(e.message ?? e)))}>
                  <IconRestore /> Reset to pack version
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon-sm" variant="ghost" title="Add one to print queue" onClick={() => enqueue(l.id)}>
            <IconPlus />
          </Button>
        </div>
      </li>
    );
  };

  const folderRow = (f: TreeFolder): React.ReactNode => {
    const isOpen = open.has(f.path);
    return (
      <li key={`folder:${f.path}`}>
        <div
          className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/50", dropTarget === f.path && "bg-primary/10 ring-1 ring-primary", here === f.path && "font-medium")}
          style={{ paddingLeft: f.depth * INDENT }}
          {...dropProps(f.path)}
        >
          <button className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 text-left text-sm" onClick={() => (setFolderOpen(f.path, !isOpen), setHere(f.path))} aria-expanded={isOpen}>
            <IconChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
            {isOpen ? <IconFolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <IconFolder className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{f.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{f.count}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`More for folder ${f.name}`}>
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void newLabel(f.path)}>
                <IconPlus /> New label here
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void newFolder(f.path)}>
                <IconFolderPlus /> New subfolder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void renameFolder(f)}>
                <IconFolderOpen /> Rename / move…
              </DropdownMenuItem>
              {!f.count && (
                <DropdownMenuItem onSelect={() => newFolders.filter((p) => p === f.path || p.startsWith(f.path + "/")).forEach(dropNewFolder)}>
                  <IconX /> Remove empty folder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!f.count} onSelect={() => (allIn(f).forEach((l) => enqueue(l.id)), toast.success(`Added ${f.count} to the queue`))}>
                <IconPlus /> Add all {f.count} to the queue
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!f.count} onSelect={() => void runExport("pdf", allIn(f).map((label) => ({ label })), f.path)}>
                <IconFileTypePdf /> Proof sheet (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!f.count} onSelect={() => setPackExport({ title: `Folder ${f.path}`, templateIds: [], labelIds: allIn(f).map((l) => l.id), name: f.name })}>
                <IconPackageExport /> Export folder as pack…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen && (
          <ul>
            {f.folders.map(folderRow)}
            {f.labels.map((l) => row(l, f.depth + 1))}
            {!f.count && !f.folders.length && (
              <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: (f.depth + 1) * INDENT + 8 }}>
                Empty: drag labels here.
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const loose = tree.labels;
  return (
    <aside className="flex min-h-0 flex-col border-r bg-card">
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Labels</h2>
          <Input className="h-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search labels" />
        </div>
        <ActiveTagChips tags={filter.tags} onRemove={(t) => setFilter({ ...filter, tags: filter.tags.filter((x) => x !== t) })} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant={view === "folders" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("folders")} aria-pressed={view === "folders"}>
            <IconFolders /> Folders
          </Button>
          <Button size="sm" variant={view === "favourites" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("favourites")} aria-pressed={view === "favourites"}>
            <IconStar /> Favorites
          </Button>
          <LabelFilterButton value={filter} onChange={setFilter} tags={allTags} templates={templateChoices} />
          <span className="ml-auto" />
          <Button size="icon-sm" variant="ghost" title="New folder" onClick={() => void newFolder()}>
            <IconFolderPlus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Folder options">
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={fileByTemplate} disabled={!loose.length}>
                <IconFolders /> File loose labels by template ({loose.length})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => tree.folders.forEach(function openAll(f: TreeFolder) { setFolderOpen(f.path, true); f.folders.forEach(openAll); })}>Expand all</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openFolders.forEach((p) => setFolderOpen(p, false))}>Collapse all</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        {flat ? (
          <ul className="space-y-0.5 pb-2">
            {flat.map((l) => row(l, 0, true))}
            {!flat.length && <li className="p-3 text-sm text-muted-foreground">{search || filtering ? "No labels match." : "No favorites yet: use ☆ on a label."}</li>}
          </ul>
        ) : (
          <ul className="space-y-0.5 pb-2">
            {pinnedLabels.length > 0 && (
              <>
                <li className="px-2 pt-1 text-xs font-medium text-muted-foreground">Pinned</li>
                {pinnedLabels.map((l) => row(l, 0, true))}
                <li className="my-1 border-t" aria-hidden />
              </>
            )}
            {tree.folders.map(folderRow)}
            {tree.folders.length > 0 && (
              <li className={cn("mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground", dropTarget === "" && "bg-primary/10 ring-1 ring-primary")} {...dropProps("")}>
                Not in a folder
              </li>
            )}
            {loose.map((l) => row(l, 0))}
            {!lib.labels.length && <li className="p-3 text-sm text-muted-foreground">No labels yet.</li>}
          </ul>
        )}
      </ScrollArea>
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/50 px-3 py-2 text-sm">
          <span className="mr-auto">{checked.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => (checkedLabels.forEach((l) => enqueue(l.id)), toast.success(`Added ${checkedLabels.length} to the queue`))}>
            <IconPlus /> Queue
          </Button>
          <Button size="sm" variant="outline" onClick={() => void moveTo(checkedLabels)}>
            <IconFolderOpen /> Folder
          </Button>
          <Button size="sm" variant="outline" onClick={() => void tagLabels(checkedLabels)}>
            <IconTag /> Tag
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void runExport("pdf", checkedLabels.map((label) => ({ label })), "Selected labels")}>
            <IconFileTypePdf /> Proof
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void runExport("png", checkedLabels.map((label) => ({ label })), "Selected labels")}>
            <IconPhoto /> PNG
          </Button>
          <Button size="sm" variant="outline" title="Export as pack" onClick={() => setPackExport({ title: "Selected labels", templateIds: [], labelIds: checkedLabels.map((l) => l.id) })}>
            <IconPackageExport /> Pack
          </Button>
          <Button size="icon-sm" variant="ghost" title="Clear selection" onClick={() => setChecked(new Set())}>
            <IconX />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 border-t p-3">
        <Button size="sm" variant="outline" onClick={() => void newLabel()} title={here ? `New label in ${here}` : "New label"}>
          <IconPlus /> New label
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} title="P-touch .lbx, NiimBlue .json, ZPL, labebal template or library files">
          <IconUpload /> Import
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy}>
              <IconDownload /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Proof sheet (PDF, true size)</DropdownMenuLabel>
            {exportSources("pdf")}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>PNG images</DropdownMenuLabel>
            {exportSources("png")}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={exportJson}>Library as JSON (templates + labels)</DropdownMenuItem>
            <DropdownMenuItem disabled={!checkedLabels.length} onSelect={() => setPackExport({ title: "Selected labels", templateIds: [], labelIds: checkedLabels.map((l) => l.id) })}>
              <IconPackageExport /> Selected labels as pack… ({checkedLabels.length})
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shown.length} onSelect={() => setPackExport({ title: flat ? "Labels shown" : "All labels", templateIds: [], labelIds: shown.map((l) => l.id) })}>
              <IconPackageExport /> {flat ? "Labels shown" : "All labels"} as pack… ({shown.length})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInput} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))} />
      </div>
      {packExport && <ExportPackDialog target={packExport} onClose={() => setPackExport(null)} />}
      <NewLabelDialog lib={lib} open={newIn !== null} onOpenChange={(o) => !o && setNewIn(null)} folder={newIn ?? ""} currentTemplateId={current?.templateId} />
    </aside>
  );
}
