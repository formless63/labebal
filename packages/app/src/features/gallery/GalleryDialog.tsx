"use client";
/** Templates > New from gallery: curated starters by use case, previewed at several label sizes. */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SIZES } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { stockAreas } from "../editor/controls";
import { useLibraryActions } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { TemplateThumb } from "../templates/TemplateThumb";
import { CATEGORIES, GALLERY, makeFromGallery, type GalleryCategory, type GalleryItem } from "./gallery";

/** Sizes the cards can be previewed at, to show the reflow. "own" = each starter's suggested size. */
const PREVIEW_SIZES = [
  { id: "own", label: "Suggested" },
  { id: "n1-14x30", label: "N1 14×30" },
  { id: "n1-14x50", label: "N1 14×50" },
  { id: "m2-30x15", label: "M2 30×15" },
  { id: "m2-50x30", label: "M2 50×30" },
];

const newTemplateId = () => `t-${crypto.randomUUID().slice(0, 8)}`;

export function GalleryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const actions = useLibraryActions();
  const marginMm = useLabelStore((s) => s.settings.marginMm);
  const areas = useMemo(() => stockAreas(marginMm), [marginMm]);
  const [cat, setCat] = useState<GalleryCategory | "all">("all");
  const [preview, setPreview] = useState("own");
  const [picked, setPicked] = useState<GalleryItem | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const designFor = (sizeId: string) => {
    const a = areas.find((x) => x.size.id === sizeId) ?? areas[0];
    return { w: Math.round(a.width * 100) / 100, h: Math.round(a.height * 100) / 100 };
  };
  // Built once per size so thumbnails don't re-render on every keystroke.
  const previews = useMemo(
    () => new Map(GALLERY.map((g) => [g.id, makeFromGallery(g, { id: `gallery-${g.id}`, name: g.name, design: designFor(g.sizeId) })])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas],
  );
  const shown = GALLERY.filter((g) => cat === "all" || g.category === cat);

  const create = async (item: GalleryItem | null = picked) => {
    if (!item) return;
    setBusy(true);
    const id = newTemplateId();
    const t = makeFromGallery(item, { id, name: name.trim() || item.name, design: designFor(item.sizeId) });
    const ok = await actions.saveTemplate(t, { immediate: true });
    setBusy(false);
    if (!ok) return toast.error("Couldn't create the template.");
    onOpenChange(false);
    setPicked(null);
    setName("");
    onCreated(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New from gallery</DialogTitle>
          <DialogDescription>Ready-made designs by use case. They all reflow to any N1 or M2 label size; change anything in the editor.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Use case" className="flex flex-wrap gap-1">
            {[{ id: "all" as const, name: "All" }, ...CATEGORIES].map((c) => (
              <Button key={c.id} size="sm" variant={cat === c.id ? "default" : "outline"} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                {c.name}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Preview at</span>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={preview} onValueChange={(v) => v && setPreview(v)} aria-label="Preview size">
            {PREVIEW_SIZES.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} className="text-xs">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" aria-label="Starters">
          {shown.map((g) => {
            const t = previews.get(g.id)!;
            const sizeId = preview === "own" ? g.sizeId : preview;
            const size = SIZES.find((s) => s.id === sizeId);
            return (
              <li key={g.id}>
                <button
                  className={cn(
                    "flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    picked?.id === g.id && "border-primary ring-2 ring-primary",
                  )}
                  aria-pressed={picked?.id === g.id}
                  onClick={() => setPicked(g)}
                  onDoubleClick={() => {
                    setPicked(g);
                    void create(g);
                  }}
                >
                  <div className="flex h-24 items-center justify-center rounded-md bg-muted/60 p-2">
                    <TemplateThumb template={t} sizeId={sizeId} printer={size?.printer ?? "M2_H"} marginMm={marginMm} maxW={190} maxH={80} title={size?.name} />
                  </div>
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{g.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter className="items-end gap-3 sm:justify-between">
          <div className="w-full max-w-sm space-y-1.5">
            <UiLabel htmlFor="gallery-name">Name</UiLabel>
            <Input id="gallery-name" value={name} placeholder={picked?.name ?? "Pick a starter"} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!picked || busy} onClick={() => void create()}>
              Create and open
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
