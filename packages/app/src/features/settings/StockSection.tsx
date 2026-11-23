"use client";
/**
 * Settings > Stock and ribbons: the team's own label stock (another supplier's
 * film, freezer labels, direct thermal shipping paper...) and ribbons. Shared
 * through team settings (customStock:<id> / customRibbon:<id>), so they show
 * up in every picker for everyone.
 */
import { useMemo, useState } from "react";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { MEDIA_KINDS, MATERIALS, RIBBONS, THERMAL_NAMES, type Finish, type MediaKind, type Swatch, type ThermalKind } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useCan } from "../auth/me-client";
import { useLabelStore } from "../labels/store";
import { Hint } from "../printers/ui";
import { parseTags, TagChips } from "../library/tags";

type Kind = "stock" | "ribbon";

const FINISHES: { id: Finish; name: string }[] = [
  { id: "paper", name: "Paper" },
  { id: "matte", name: "Matte film" },
  { id: "gloss", name: "Gloss" },
  { id: "metallic", name: "Metallic" },
  { id: "holographic", name: "Holographic" },
  { id: "clear", name: "Clear" },
  { id: "fluorescent", name: "Fluorescent" },
];

const EITHER = "either";
const DEFAULT = "default";

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** CSS for a custom swatch: flat colour, with a simple sheen for metallic / holographic, see-through for clear. */
function swatchCss(hex: string, finish: Finish | undefined) {
  if (finish === "metallic") return `linear-gradient(100deg, transparent 30%, rgba(255,255,255,.55) 44%, transparent 56%), ${hex}`;
  if (finish === "holographic") return `linear-gradient(115deg, transparent 22%, rgba(255,255,255,.5) 38%, transparent 52%), conic-gradient(from 210deg at 28% 65%, #f6c, #6cf, #6f9, #ff6, #f6c), ${hex}`;
  if (finish === "clear") return `linear-gradient(135deg, rgba(255,255,255,.7), rgba(255,255,255,.1) 60%), repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px`;
  return hex;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "item";

export function StockSection() {
  const settings = useLabelStore((s) => s.settings);
  const set = useLabelStore((s) => s.setSettings);
  const canEdit = useCan("editor");
  const [editing, setEditing] = useState<{ kind: Kind; item: Swatch | null } | null>(null);
  const stock = settings.customMaterials ?? [];
  const ribbons = settings.customRibbons ?? [];

  const save = (kind: Kind, item: Swatch, replaces?: string) => {
    const key = kind === "stock" ? "customMaterials" : "customRibbons";
    const list = (kind === "stock" ? stock : ribbons).filter((x) => x.id !== item.id && x.id !== replaces);
    set({ [key]: [...list, item] });
  };
  const remove = (kind: Kind, id: string) => {
    if (kind === "stock") set({ customMaterials: stock.filter((x) => x.id !== id), ...(settings.material === id ? { material: "white" } : {}) });
    else set({ customRibbons: ribbons.filter((x) => x.id !== id), ...(settings.ribbon === id ? { ribbon: "black" } : {}) });
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <SwatchList
        title="Your stock"
        help="Label stock that isn't in the built-in list. Mark whether it needs a ribbon (thermal transfer) or is heat-sensitive paper (direct thermal)."
        items={stock}
        canEdit={canEdit}
        onAdd={() => setEditing({ kind: "stock", item: null })}
        onEdit={(item) => setEditing({ kind: "stock", item })}
        onRemove={(id) => remove("stock", id)}
      />
      <SwatchList
        title="Your ribbons"
        help="Ribbon colours for thermal transfer printers (on Brother tape, the text colour of the cassette)."
        items={ribbons}
        canEdit={canEdit}
        onAdd={() => setEditing({ kind: "ribbon", item: null })}
        onEdit={(item) => setEditing({ kind: "ribbon", item })}
        onRemove={(id) => remove("ribbon", id)}
      />
      {editing && (
        <SwatchDialog
          kind={editing.kind}
          item={editing.item}
          taken={new Set([...(editing.kind === "stock" ? [...MATERIALS, ...stock] : [...RIBBONS, ...ribbons]).map((x) => x.id)])}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            save(editing.kind, item, editing.item?.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SwatchList({ title, help, items, canEdit, onAdd, onEdit, onRemove }: { title: string; help: string; items: Swatch[]; canEdit: boolean; onAdd: () => void; onEdit: (s: Swatch) => void; onRemove: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {title}
          <Hint>{help}</Hint>
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <IconPlus /> Add
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">None yet. The built-in ones are always there.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="size-5 shrink-0 rounded ring-1 ring-border" style={{ background: m.css }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.name}</span>
                <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {m.thermal ? THERMAL_NAMES[m.thermal].name : null}
                  {m.densityOffset ? <span>darkness {m.densityOffset > 0 ? `+${m.densityOffset}` : m.densityOffset}</span> : null}
                  <TagChips tags={m.tags} />
                </span>
              </span>
              {canEdit && (
                <>
                  <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => onEdit(m)}>
                    <IconPencil />
                  </Button>
                  <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => onRemove(m.id)}>
                    <IconTrash />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SwatchDialog({ kind, item, taken, onClose, onSave }: { kind: Kind; item: Swatch | null; taken: Set<string>; onClose: () => void; onSave: (s: Swatch) => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [hex, setHex] = useState(item ? rgbToHex(item.rgb) : kind === "stock" ? "#ffffff" : "#111111");
  const [finish, setFinish] = useState<Finish>(item?.finish ?? (kind === "stock" ? "paper" : "matte"));
  const [thermal, setThermal] = useState<string>(item?.thermal ?? EITHER);
  const [media, setMedia] = useState<string>(item?.media ?? DEFAULT);
  const [darkness, setDarkness] = useState(String(item?.densityOffset ?? 0));
  const [tags, setTags] = useState((item?.tags ?? []).join(", "));
  const css = useMemo(() => swatchCss(hex, finish), [hex, finish]);
  const valid = name.trim().length > 0;

  function save() {
    if (!valid) return;
    let id = item?.id;
    if (!id) {
      const base = `c-${slug(name)}`;
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    }
    const off = Math.max(-10, Math.min(10, Math.trunc(Number(darkness) || 0)));
    const list = parseTags(tags);
    onSave({
      id,
      name: name.trim(),
      css,
      rgb: hexToRgb(hex),
      finish,
      ...(finish === "clear" ? { alpha: 0.18 } : {}),
      ...(kind === "stock" && thermal !== EITHER ? { thermal: thermal as ThermalKind } : {}),
      ...(kind === "stock" && media !== DEFAULT ? { media: media as MediaKind } : {}),
      ...(kind === "stock" && off ? { densityOffset: off } : {}),
      ...(list.length ? { tags: list } : {}),
      custom: true,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit" : "Add"} {kind === "stock" ? "stock" : "ribbon"}</DialogTitle>
          <DialogDescription>Shared with everyone on the team.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <UiLabel htmlFor="sw-name">Name</UiLabel>
              <Input id="sw-name" value={name} placeholder={kind === "stock" ? "e.g. Freezer film" : "e.g. Wax-resin black"} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <UiLabel htmlFor="sw-colour">Colour</UiLabel>
              <div className="flex items-center gap-2">
                <input id="sw-colour" type="color" className="h-9 w-12 cursor-pointer rounded border bg-transparent" value={hex} onChange={(e) => setHex(e.target.value)} />
                <span className="size-9 rounded ring-1 ring-border" style={{ background: css }} aria-hidden />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <UiLabel>Finish</UiLabel>
              <Select value={finish} onValueChange={(v) => setFinish(v as Finish)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINISHES.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind === "stock" && (
              <div className="space-y-1.5">
                <UiLabel>
                  Printing
                  <Hint>
                    {THERMAL_NAMES.direct.name}: {THERMAL_NAMES.direct.help} {THERMAL_NAMES.transfer.name}: {THERMAL_NAMES.transfer.help}
                  </Hint>
                </UiLabel>
                <Select value={thermal} onValueChange={setThermal}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EITHER}>Either (plain paper)</SelectItem>
                    <SelectItem value="transfer">Needs a ribbon (thermal transfer)</SelectItem>
                    <SelectItem value="direct">Heat-sensitive, no ribbon (direct thermal)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {kind === "stock" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <UiLabel>How labels are found</UiLabel>
                <Select value={media} onValueChange={setMedia}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>From the label size</SelectItem>
                    {MEDIA_KINDS.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <UiLabel htmlFor="sw-dark">
                  Darkness change
                  <Hint>Added to the printer&apos;s default darkness when this stock is picked (film and foil usually need +1).</Hint>
                </UiLabel>
                <Input id="sw-dark" type="number" min={-10} max={10} step={1} value={darkness} onChange={(e) => setDarkness(e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <UiLabel htmlFor="sw-tags">Tags</UiLabel>
            <Input id="sw-tags" value={tags} placeholder="e.g. freezer, outdoor, supplier X" onChange={(e) => setTags(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
