"use client";
/**
 * Editor panels for library parts: the text style picker in text properties,
 * instance properties (component, overrides, detach), and the component
 * settings shown while editing a component.
 */
import { Link } from "../../lib/router";
import { useRouter } from "../../lib/router";
import { IconArrowBackUp, IconComponents, IconEye, IconEyeOff, IconLink, IconPencil, IconUnlink } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  TEXT_STYLE_KEYS,
  boundText,
  partsUsedBy,
  templatesUsingComponent,
  walk,
  wouldCycle,
  type ComponentNode,
  type LabelComponent,
  type LabelNode,
  type Template,
  type TextNode,
} from "@labebal/core";
import { promptDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useLibrary } from "../labels/api";
import { Field, IconBtn, NumField, Row, Section } from "./controls";
import { componentHref } from "./library";
import { NodeIcon, nodeLabel } from "./nodes";
import { addInstance, applyStyle, nodeById, createComponentFromSelection, createStyleFromText, detachSelection, resetStyleOverrides, setInstanceOverride, updateStyleFromText } from "./ops";
import { useEditor } from "./store";

const STYLE_LABELS: Record<(typeof TEXT_STYLE_KEYS)[number], string> = {
  font: "font",
  sizePt: "size",
  minSizePt: "smallest size",
  fit: "fit",
  weight: "weight",
  letterSpacing: "letter spacing",
  lineHeight: "line height",
  align: "align",
  valign: "vertical align",
  uppercase: "capitals",
  color: "colour",
  stroke: "outline",
  strokeMm: "outline width",
};

/* ------------------------------------------------------------- text style */

/** Text style picker: use / detach / create from this text / push changes to the style. */
export function TextStyleField({ node }: { node: TextNode }) {
  const { data: lib } = useLibrary();
  const variantId = useEditor((s) => s.variantId);
  const styles = lib?.styles ?? [];
  const style = node.style ? styles.find((s) => s.id === node.style) : undefined;
  const own = node.styleOverrides ?? [];

  const create = async () => {
    const name = await promptDialog({ title: "New text style", description: "Saved in the library. Every text using it changes when you edit the style, in every template.", label: "Name", defaultValue: node.name ?? "", placeholder: "Heading", confirmLabel: "Create style" });
    if (name === null) return;
    const s = createStyleFromText(node.id, name || "Text style");
    if (s) toast.success(`Text style “${s.name}” created`);
  };

  return (
    <Field
      label="Text style"
      hint="A named style from the library (font, size, weight, spacing...). Changing the style changes every text using it, in every template. Settings you change on this text win over the style."
    >
      <div className="flex gap-1">
        <Select
          value={node.style && style ? node.style : node.style ? "__missing" : "__none"}
          onValueChange={(v) => (v === "__new" ? void create() : v !== "__missing" && applyStyle(node.id, v === "__none" ? null : v))}
          disabled={!!variantId}
        >
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs" aria-label="Text style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none" className="text-xs">
              No style
            </SelectItem>
            {node.style && !style && (
              <SelectItem value="__missing" className="text-xs">
                Missing style (kept its look)
              </SelectItem>
            )}
            {styles.length > 0 && <SelectSeparator />}
            {styles.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                <span style={{ fontFamily: s.font ? `"${s.font}"` : undefined }}>{s.name}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {[s.font, s.sizePt && `${s.sizePt} pt`].filter(Boolean).join(" · ")}
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value="__new" className="text-xs">
              + New style from this text…
            </SelectItem>
          </SelectContent>
        </Select>
        {style && (
          <IconBtn tip="Detach: keep the look, stop following the style" onClick={() => applyStyle(node.id, null)}>
            <IconUnlink />
          </IconBtn>
        )}
      </div>
      {variantId && <p className="text-[11px] text-muted-foreground">Styles are set for every size: click Done in the yellow bar to change it.</p>}
      {style && own.length > 0 && (
        <div className="mt-1 space-y-1 rounded-md bg-sky-500/10 p-2 text-[11px]">
          <p>Changed on this text: {own.map((k) => STYLE_LABELS[k] ?? k).join(", ")}.</p>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => resetStyleOverrides(node.id)}>
              <IconArrowBackUp /> Use the style
            </Button>
            <Button size="xs" variant="outline" onClick={() => updateStyleFromText(node.id)} title="Every text using this style changes, in every template">
              <IconLink /> Update “{style.name}”
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}

/* --------------------------------------------------------------- instance */

/** Nodes of a component an instance can override: named nodes and anything holding text. */
function overridable(c: LabelComponent) {
  const out: { node: LabelNode; prop?: string }[] = [];
  walk(c.root, (n) => {
    if (n.id === c.root.id) return;
    const prop = n.type === "text" ? "text" : n.type === "icon" ? "icon" : n.type === "code" ? "value" : n.type === "image" ? "src" : undefined;
    if (prop || n.name) out.push({ node: n, prop });
  });
  return out;
}

export function InstanceSection({ node }: { node: ComponentNode }) {
  const { data: lib } = useLibrary();
  const t = useEditor((s) => s.template)!;
  const variantId = useEditor((s) => s.variantId);
  const router = useRouter();
  const c = lib?.components?.find((x) => x.id === node.ref);
  if (!c)
    return (
      <Section title="Component">
        <p className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
          The component this instance uses isn&apos;t in the library any more (deleted, or the template came without it). It prints nothing.
        </p>
      </Section>
    );
  const rows = overridable(c);
  const ov = node.overrides ?? {};
  const changed = Object.keys(ov).filter((k) => Object.keys(ov[k] ?? {}).length);
  return (
    <>
      <Section title="Component">
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <IconComponents className="size-4 text-violet-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.name}</div>
            <div className="text-[11px] text-muted-foreground">
              Library component · designed at {c.design.w} × {c.design.h} mm
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Edit the component to change every copy of it, in every template. Below you can change this copy&apos;s texts only.</p>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" onClick={() => router.push(componentHref(c.id, t.id))}>
            <IconPencil /> Edit component
          </Button>
          <Button size="xs" variant="outline" disabled={!!variantId} onClick={() => detachSelection()} title="Replace this instance by a plain group you can change freely (it stops following the component)">
            <IconUnlink /> Detach
          </Button>
        </div>
      </Section>
      {rows.length > 0 && (
        <Section title="This copy">
          {rows.map(({ node: n, prop }) => {
            const o = (ov[n.id] ?? {}) as Record<string, unknown>;
            const value = prop ? ((o[prop] as string | undefined) ?? boundText(n) ?? "") : "";
            const hidden = o.hidden !== undefined ? !!o.hidden : !!n.hidden;
            return (
              <div key={n.id} className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <NodeIcon node={n} className="size-3" />
                  <span className="flex-1 truncate">{nodeLabel(n)}</span>
                  <IconBtn tip={hidden ? "Hidden in this copy: click to show" : "Hide in this copy"} onClick={() => setInstanceOverride(node.id, n.id, { hidden: hidden === !!n.hidden ? !hidden : undefined })}>
                    {hidden ? <IconEyeOff /> : <IconEye />}
                  </IconBtn>
                </div>
                {prop &&
                  (n.type === "text" && value.includes("\n") ? (
                    <Textarea rows={2} className="min-h-0 text-sm" value={value} onChange={(e) => setInstanceOverride(node.id, n.id, { [prop]: e.target.value === boundText(n) ? undefined : e.target.value })} aria-label={nodeLabel(n)} />
                  ) : (
                    <Input
                      className={`h-7 text-sm ${o[prop] !== undefined ? "border-violet-500/60" : ""}`}
                      value={value}
                      onChange={(e) => setInstanceOverride(node.id, n.id, { [prop]: e.target.value === boundText(n) ? undefined : e.target.value })}
                      aria-label={nodeLabel(n)}
                    />
                  ))}
              </div>
            );
          })}
          {changed.length > 0 && (
            <Button size="xs" variant="outline" onClick={() => useEditor.getState().commit((x) => ({ ...x, root: patchOverrides(x, node.id) }))}>
              <IconArrowBackUp /> Same as the component
            </Button>
          )}
        </Section>
      )}
    </>
  );
}

function patchOverrides(t: Template, id: string) {
  const rec = (n: LabelNode): LabelNode => {
    if (n.id === id && n.type === "component") {
      const copy = { ...n };
      delete copy.overrides;
      return copy;
    }
    return n.type === "frame" ? { ...n, children: n.children.map(rec) } : n;
  };
  return rec(t.root) as Template["root"];
}

/* ------------------------------------------------------------- add menu */

/** "Component" entries for the Add menu. */
export function ComponentMenuItems() {
  const { data: lib } = useLibrary();
  const mode = useEditor((s) => s.mode);
  const comps = (lib?.components ?? []).filter((c) => mode.kind !== "component" || !wouldCycle(c.id, mode.id, lib ?? {}));
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs">Components from the library</DropdownMenuLabel>
      {comps.map((c) => (
        <DropdownMenuItem key={c.id} onSelect={() => addInstance(c.id)}>
          <IconComponents />
          <div>
            <div>{c.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {c.description || `${c.design.w} × ${c.design.h} mm`}
            </div>
          </div>
        </DropdownMenuItem>
      ))}
      {!comps.length && (
        <DropdownMenuItem disabled className="text-[11px]">
          None yet: select something and use “Make component”
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Ask for a name, then make the selection a component. */
export async function makeComponentFromSelection() {
  const st = useEditor.getState();
  const t = st.template;
  const first = st.selection.find((id) => id !== t?.root.id);
  if (!t || !first) {
    toast.error("Select what should become a component first.");
    return;
  }
  const n = nodeById(t, first);
  const name = await promptDialog({
    title: "Make a component",
    description: "Saved in the library and replaced here by an instance of it. Place it in any template from Add; editing it later updates every copy.",
    label: "Name",
    defaultValue: n?.name ?? "",
    placeholder: "Logo",
    confirmLabel: "Make component",
  });
  if (name === null) return;
  const c = createComponentFromSelection(name);
  if (c) toast.success(`Component “${c.name}” created`, { description: "Double-click it on the label (or Edit component) to change it everywhere." });
}

/* ------------------------------------------------- component mode settings */

/** Inspector tab while editing a component: name, description, design size, where it is used. */
export function ComponentSettings() {
  const t = useEditor((s) => s.template)!;
  const mode = useEditor((s) => s.mode);
  const { data: lib } = useLibrary();
  const commit = (fn: (x: Template) => Template, key?: string) => useEditor.getState().commit(fn, key);
  const id = mode.kind === "component" ? mode.id : "";
  const users = lib ? templatesUsingComponent(lib.templates, id, lib) : [];
  const inComponents = (lib?.components ?? []).filter((c) => c.id !== id && partsUsedBy({ root: c.root } as Template, lib ?? {}).components.some((x) => x.id === id));
  return (
    <div>
      <Section title="Component">
        <Field label="Name">
          <Input className="h-7 text-sm" value={t.name} onChange={(e) => commit((x) => ({ ...x, name: e.target.value }), "tname")} />
        </Field>
        <Field label="Description" hint="Shown in the Add menu.">
          <Textarea rows={2} className="min-h-0 text-sm" value={t.description ?? ""} onChange={(e) => commit((x) => ({ ...x, description: e.target.value || undefined }), "tdesc")} />
        </Field>
      </Section>
      <Section title="Design size">
        <p className="text-[11px] text-muted-foreground">The size you draw it at. New instances start this big; inside, things placed freely are positioned at this size.</p>
        <Row>
          <NumField label="Width" unit="mm" min={0.5} step={0.5} value={t.design.w} onChange={(v) => v && commit((x) => ({ ...x, design: { ...x.design, w: v } }), "dw")} />
          <NumField label="Height" unit="mm" min={0.5} step={0.5} value={t.design.h} onChange={(v) => v && commit((x) => ({ ...x, design: { ...x.design, h: v } }), "dh")} />
        </Row>
      </Section>
      <Section title="Used in">
        {!users.length && !inComponents.length && <p className="text-[11px] text-muted-foreground">Not placed anywhere yet. Add it to a template from Layers &gt; Add.</p>}
        <ul className="space-y-0.5 text-xs">
          {users.map((u) => (
            <li key={u.id}>
              <Link className="underline-offset-2 hover:underline" href={`/templates/${encodeURIComponent(u.id)}`}>
                {u.name}
              </Link>
            </li>
          ))}
          {inComponents.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <IconComponents className="size-3 text-violet-600" />
              <Link className="underline-offset-2 hover:underline" href={componentHref(c.id)}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">Every change here shows up in all of them (texts changed on a copy keep their own wording).</p>
      </Section>
    </div>
  );
}

/** Button for the Layers toolbar. */
export function MakeComponentButton({ disabled }: { disabled: boolean }) {
  return (
    <IconBtn tip="Make component: save the selection in the library to reuse in any template" disabled={disabled} onClick={() => void makeComponentFromSelection()}>
      <IconComponents />
    </IconBtn>
  );
}
