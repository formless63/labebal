"use client";
/**
 * Templates page: the library's reusable components and shared text styles.
 * Components open in the editor (component mode); styles are edited here.
 * Deleting either first detaches it where it is used, so nothing changes look.
 */
import { useMemo, useState } from "react";
import { Link } from "../../lib/router";
import { useRouter } from "../../lib/router";
import { IconComponents, IconCopy, IconDots, IconPencil, IconPlus, IconTrash, IconTypography } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  detachInstancesOf,
  detachStyleIn,
  LABEL_FONT,
  newId,
  templatesUsingComponent,
  templatesUsingStyle,
  type LabelComponent,
  type Library,
  type TextStyle,
} from "@labebal/core";
import { confirmDialog, promptDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { useLibraryActions } from "../labels/api";
import { ChoiceField, Field, NumField, PaintField, Row, SwitchField } from "../editor/controls";
import { FontPicker } from "../editor/NodeProps";
import { componentHref, componentToTemplate } from "../editor/library";
import { useCan } from "../auth/me-client";
import { TemplateThumb } from "./TemplateThumb";

export function LibraryParts({ lib }: { lib: Library }) {
  const canEdit = useCan("editor");
  const [editing, setEditing] = useState<TextStyle | null>(null);
  const comps = lib.components ?? [];
  const styles = lib.styles ?? [];
  return (
    <section id="parts" className="space-y-6 pt-4">
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <IconComponents className="size-5 text-violet-600" /> Components
          </h2>
          <p className="text-sm text-muted-foreground">
            Pieces designed once and placed in any template (Layers &gt; Add). Editing a component updates every copy. Make one in the editor: select something,
            then the component button in Layers.
          </p>
        </div>
        {!comps.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No components yet.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {comps.map((c) => (
            <ComponentCard key={c.id} c={c} lib={lib} canEdit={canEdit} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <IconTypography className="size-5 text-sky-600" /> Text styles
            </h2>
            <p className="text-sm text-muted-foreground">
              Named looks for text (font, size, weight, spacing…). Pick one under Text style in the editor; changing a style here changes every text using it, in
              every template.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" onClick={() => setEditing({ id: newId("style"), name: "New style", font: LABEL_FONT, weight: 600, sizePt: 8 })}>
              <IconPlus /> New text style
            </Button>
          )}
        </div>
        {!styles.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No text styles yet.</p>}
        <div className="divide-y rounded-lg border bg-card">
          {styles.map((s) => (
            <StyleRow key={s.id} s={s} lib={lib} canEdit={canEdit} onEdit={() => setEditing(s)} />
          ))}
        </div>
      </div>
      {editing && <StyleDialog style={editing} isNew={!styles.some((s) => s.id === editing.id)} onClose={() => setEditing(null)} />}
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ComponentCard({ c, lib, canEdit }: { c: LabelComponent; lib: Library; canEdit: boolean }) {
  const router = useRouter();
  const actions = useLibraryActions();
  const preview = useMemo(() => componentToTemplate(c), [c]);
  const users = templatesUsingComponent(lib.templates, c.id, lib);
  const href = componentHref(c.id);

  const duplicate = async () => {
    const copy: LabelComponent = { ...structuredClone(c), id: newId("comp"), name: `${c.name} copy` };
    if (await actions.saveComponent(copy, { immediate: true })) toast.success(`Made a copy: ${copy.name}`);
  };
  const rename = async () => {
    const name = (await promptDialog({ title: "Rename component", label: "Name", defaultValue: c.name, confirmLabel: "Rename" }))?.trim();
    if (name) void actions.saveComponent({ ...c, name }, { immediate: true });
  };
  const remove = async () => {
    const inComps = (lib.components ?? []).filter((x) => x.id !== c.id && JSON.stringify(x.root).includes(`"ref":${JSON.stringify(c.id)}`));
    const ok = await confirmDialog({
      title: `Delete “${c.name}”?`,
      description:
        users.length || inComps.length
          ? `${plural(users.length + inComps.length, "design")} use it (${[...users, ...inComps].map((x) => x.name).join(", ")}). Their copies become plain groups that look the same but no longer follow the component.`
          : "It isn't used anywhere.",
      confirmLabel: "Delete component",
      destructive: true,
    });
    if (!ok) return;
    const fresh = (old: { type: string }) => newId(old.type);
    for (const t of users) await actions.saveTemplate({ ...t, root: detachInstancesOf(t.root, c.id, lib, fresh) }, { immediate: true });
    for (const x of inComps) await actions.saveComponent({ ...x, root: detachInstancesOf(x.root, c.id, lib, fresh) }, { immediate: true });
    await actions.deleteComponent(c.id);
    toast.success(`Deleted “${c.name}”`);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <Link href={href} className="flex h-24 items-center justify-center bg-muted/60 p-3" title="Edit the component">
        <TemplateThumb template={preview} maxW={170} maxH={70} />
      </Link>
      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-sm font-medium hover:underline">
            {c.name}
          </Link>
          <div className="text-xs text-muted-foreground">
            {c.design.w} × {c.design.h} mm · {users.length ? `in ${plural(users.length, "template")}` : "not used yet"}
          </div>
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => router.push(href)}>
                <IconPencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void rename()}>
                <IconPencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void duplicate()}>
                <IconCopy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <IconTrash /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function StyleRow({ s, lib, canEdit, onEdit }: { s: TextStyle; lib: Library; canEdit: boolean; onEdit: () => void }) {
  const actions = useLibraryActions();
  const users = templatesUsingStyle(lib.templates, s.id, lib);
  const remove = async () => {
    const comps = (lib.components ?? []).filter((c) => JSON.stringify(c.root).includes(`"style":${JSON.stringify(s.id)}`));
    const ok = await confirmDialog({
      title: `Delete the text style “${s.name}”?`,
      description: users.length || comps.length ? `Texts using it (${plural(users.length, "template")}, ${plural(comps.length, "component")}) keep how they look, without the style.` : "No text uses it.",
      confirmLabel: "Delete style",
      destructive: true,
    });
    if (!ok) return;
    for (const t of lib.templates) {
      const root = detachStyleIn(t.root, s.id, lib.styles);
      if (root !== t.root) await actions.saveTemplate({ ...t, root }, { immediate: true });
    }
    for (const c of comps) await actions.saveComponent({ ...c, root: detachStyleIn(c.root, s.id, lib.styles) }, { immediate: true });
    await actions.deleteStyle(s.id);
    toast.success(`Deleted “${s.name}”`);
  };
  const summary = [s.font, s.sizePt && `${s.sizePt} pt`, s.weight && s.weight !== 400 && `weight ${s.weight}`, s.uppercase && "capitals", s.letterSpacing && `spacing ${s.letterSpacing} mm`, s.align]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span
        className="w-28 shrink-0 truncate text-lg"
        style={{ fontFamily: s.font ? `"${s.font}"` : undefined, fontWeight: s.weight, textTransform: s.uppercase ? "uppercase" : undefined, letterSpacing: s.letterSpacing ? `${s.letterSpacing}mm` : undefined }}
      >
        Aa Bb 12
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {summary} · {users.length ? `in ${plural(users.length, "template")}` : "not used yet"}
        </div>
      </div>
      {canEdit && (
        <>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <IconPencil /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void actions.saveStyle({ ...structuredClone(s), id: newId("style"), name: `${s.name} copy` }, { immediate: true })}>
                <IconCopy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <IconTrash /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}

/** Edit a text style; saved as you type (every text using it follows). */
function StyleDialog({ style, isNew, onClose }: { style: TextStyle; isNew: boolean; onClose: () => void }) {
  const actions = useLibraryActions();
  const [s, setS] = useState(style);
  const [created, setCreated] = useState(!isNew);
  const set = (patch: Partial<TextStyle>) => {
    const next = { ...s, ...patch } as TextStyle & Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    setS(next);
    if (created) void actions.saveStyle(next);
  };
  const create = async () => {
    await actions.saveStyle(s, { immediate: true });
    setCreated(true);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "New text style" : `Text style “${style.name}”`}</DialogTitle>
          <DialogDescription>{isNew ? "Then pick it under Text style in the editor." : "Changes apply right away to every text using this style, in every template."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Field label="Name">
            <Input className="h-8" value={s.name} onChange={(e) => set({ name: e.target.value || "Style" })} />
          </Field>
          <FontPicker value={s.font ?? "Arial"} onChange={(font) => set({ font })} />
          <Row>
            <NumField label="Size" unit="pt" min={1} max={200} step={0.5} value={s.sizePt ?? 8} onChange={(v) => v && set({ sizePt: v })} />
            <NumField label="Smallest size" unit="pt" min={0} allowEmpty placeholder="none" value={s.minSizePt} onChange={(v) => set({ minSizePt: v })} />
          </Row>
          <Row>
            <NumField label="Weight" step={100} min={100} max={900} allowEmpty placeholder="400" value={s.weight} onChange={(v) => set({ weight: v })} />
            <NumField label="Letter spacing" unit="mm" step={0.05} allowEmpty placeholder="0" value={s.letterSpacing} onChange={(v) => set({ letterSpacing: v || undefined })} />
          </Row>
          <Row>
            <NumField label="Line height" step={0.05} min={0.5} allowEmpty placeholder="1.1" value={s.lineHeight} onChange={(v) => set({ lineHeight: v })} />
            <ChoiceField
              label="Align"
              value={s.align ?? "left"}
              onChange={(align) => set({ align: align === "left" ? undefined : align })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
                { value: "justify", label: "Justify" },
              ]}
            />
          </Row>
          <Row>
            <ChoiceField
              label="Fit to box"
              value={s.fit ?? "shrink"}
              onChange={(fit) => set({ fit: fit === "shrink" ? undefined : fit })}
              options={[
                { value: "shrink", label: "Shrink to fit" },
                { value: "fill", label: "Fill the box" },
                { value: "fixed", label: "Fixed size" },
              ]}
            />
            <div className="flex items-end pb-1.5">
              <SwitchField label="CAPITALS" checked={!!s.uppercase} onChange={(v) => set({ uppercase: v || undefined })} />
            </div>
          </Row>
          <Row>
            <PaintField label="Colour" value={s.color} onChange={(color) => set({ color })} allowNone={false} />
            <PaintField label="Outline" value={s.stroke} onChange={(stroke) => set({ stroke: stroke === "none" ? undefined : stroke, strokeMm: stroke === "none" ? undefined : (s.strokeMm ?? 0.15) })} />
          </Row>
        </div>
        <DialogFooter>
          {isNew && !created ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void create()}>Create style</Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
