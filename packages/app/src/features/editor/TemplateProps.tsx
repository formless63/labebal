"use client";
/** Template-wide panels: settings, fields manager, size variants. */
import { useState } from "react";
import { IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { matchesRule, newId, nodesUsingField, renameField, renameLabelField, sizePrinterName, type FieldDef, type Library, type Template, type Variant } from "@labebal/core";
import { cn } from "../../lib/utils";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { LIBRARY_KEY, useLibraryActions } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { SeqCounterPicker } from "../counters/SeqCounterPicker";
import { AskAtPrintSettings } from "../print-form/AskAtPrintSettings";
import { Choice, ChoiceField, Field, IconBtn, NumField, Row, Section, SizeRuleEditor, SwitchField, Tip, ruleSummary, stockAreas } from "./controls";
import { nodeLabel } from "./nodes";
import { nodeById } from "./ops";
import { useEditor } from "./store";

const commitT = (fn: (t: Template) => Template, key?: string) => useEditor.getState().commit(fn, key);

export function TemplateSettings() {
  const t = useEditor((s) => s.template)!;
  const marginMm = useLabelStore((s) => s.settings.marginMm);
  const areas = stockAreas(marginMm);
  return (
    <div>
      <Section title="Template">
        <Field label="Name">
          <Input className="h-7 text-sm" value={t.name} onChange={(e) => commitT((x) => ({ ...x, name: e.target.value }), "tname")} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} className="min-h-0 text-sm" value={t.description ?? ""} onChange={(e) => commitT((x) => ({ ...x, description: e.target.value || undefined }), "tdesc")} />
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. drawers, cables.">
          <Input
            className="h-7 text-sm"
            defaultValue={(t.tags ?? []).join(", ")}
            onBlur={(e) => {
              const tags = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              commitT((x) => ({ ...x, tags: tags.length ? tags : undefined }));
            }}
          />
        </Field>
        <Field label="Record link" hint="Optional. Address of this item in your inventory, filled per label, e.g. https://inventory.example/parts/{{sku}}. Shown as 'Open in inventory' on the label's page and printable as {{recordUrl}}.">
          <Input
            className="h-7 font-mono text-xs"
            placeholder="https://…/{{key}}"
            value={t.recordUrl ?? ""}
            onChange={(e) => commitT((x) => ({ ...x, recordUrl: e.target.value.trim() ? e.target.value : undefined }), "trecord")}
            aria-label="Record link"
          />
        </Field>
      </Section>
      <Section title="Design size">
        <p className="text-[11px] text-muted-foreground">
          The size you design at (printable area). Free-placed elements are positioned at this size and move with their pins on other sizes.
        </p>
        <Row>
          <NumField label="Width" unit="mm" min={1} step={0.5} value={t.design.w} onChange={(v) => v && commitT((x) => ({ ...x, design: { ...x.design, w: v } }), "dw")} />
          <NumField label="Height" unit="mm" min={1} step={0.5} value={t.design.h} onChange={(v) => v && commitT((x) => ({ ...x, design: { ...x.design, h: v } }), "dh")} />
        </Row>
        <Field label="Match a label size">
          <Choice
            value={undefined}
            onChange={(id) => {
              const a = areas.find((x) => x.size.id === id);
              if (a) commitT((x) => ({ ...x, design: { w: Math.round(a.width * 100) / 100, h: Math.round(a.height * 100) / 100 } }));
            }}
            options={areas.map((a) => ({ value: a.size.id, label: `${sizePrinterName(a.size)} ${a.size.name} (${a.width.toFixed(1)} × ${a.height.toFixed(1)})` }))}
            ariaLabel="Match a label size"
          />
        </Field>
        <SwitchField
          label="Scale text with label size"
          hint="Text sizes grow/shrink with the label compared to the design size, before fitting into their boxes."
          checked={!!t.scaleText}
          onChange={(v) => commitT((x) => ({ ...x, scaleText: v || undefined }))}
        />
      </Section>
      <Section title="Printing">
        <SwitchField
          label="Inverted by default"
          hint="Print the background and leave the design as bare label (e.g. white-looking text on black). Labels can override this."
          checked={!!t.invertByDefault}
          onChange={(v) => commitT((x) => ({ ...x, invertByDefault: v || undefined }))}
        />
        {t.invertByDefault && (
          <ChoiceField
            label="Inverted area"
            value={t.invertArea ?? "bleed"}
            onChange={(v) => commitT((x) => ({ ...x, invertArea: v === "bleed" ? undefined : v }))}
            options={[
              { value: "bleed", label: "Whole printable area" },
              { value: "content", label: "Inside the margin (clean border)" },
            ]}
          />
        )}
        <Row>
          <NumField label="Border" hint="Line around the content area; 0 for none." unit="mm" min={0} step={0.1} value={t.borderMm ?? 0} onChange={(v) => commitT((x) => ({ ...x, borderMm: v || undefined }), "border")} />
          <NumField label="Border corners" unit="mm" min={0} step={0.1} value={t.borderRadiusMm ?? 0} onChange={(v) => commitT((x) => ({ ...x, borderRadiusMm: v || undefined }), "borderR")} />
        </Row>
      </Section>
    </div>
  );
}

/* ----------------------------------------------------------------- fields */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "field";

export function FieldsPanel() {
  const t = useEditor((s) => s.template)!;
  const add = () => {
    let i = t.fields.length + 1;
    while (t.fields.some((f) => f.key === `field${i}`)) i++;
    commitT((x) => ({ ...x, fields: [...x.fields, { key: `field${i}`, label: `Field ${i}`, type: "text" }] }));
  };
  return (
    <Section
      title="Fields"
      actions={
        <Button size="xs" variant="outline" onClick={add}>
          <IconPlus /> Add field
        </Button>
      }
    >
      <p className="text-[11px] text-muted-foreground">
        Fields are the blanks each label fills in. Use them in text, codes, icons or pictures as <code className="font-mono">{"{{key}}"}</code>.
      </p>
      {t.fields.map((f) => (
        <FieldRow key={f.key} field={f} />
      ))}
      {!t.fields.length && <p className="text-xs text-muted-foreground">No fields: every label printed from this template is the same.</p>}
      <SeqCounterPicker />
    </Section>
  );
}

function FieldRow({ field }: { field: FieldDef }) {
  const t = useEditor((s) => s.template)!;
  const qc = useQueryClient();
  const actions = useLibraryActions();
  const [key, setKey] = useState(field.key);
  const used = nodesUsingField(t, field.key);
  const update = (p: Partial<FieldDef>, k?: string) => commitT((x) => ({ ...x, fields: x.fields.map((f) => (f.key === field.key ? { ...f, ...p } : f)) }), k);

  const applyKey = () => {
    const next = slug(key);
    if (next === field.key) return setKey(field.key);
    if (t.fields.some((f) => f.key === next)) {
      toast.error(`There is already a field called "${next}".`);
      return setKey(field.key);
    }
    // Keep existing labels' data under the new name; undo / redo move it back and forth too.
    const relabel = (from: string, to: string) => {
      const current = qc.getQueryData<Library>(LIBRARY_KEY);
      for (const l of current?.labels ?? []) if (l.templateId === t.id && from in l.values) actions.saveLabel(renameLabelField(l, from, to), { immediate: true });
    };
    const old = field.key;
    relabel(old, next);
    useEditor.getState().commit((x) => renameField(x, old, next), undefined, { undo: () => relabel(next, old), redo: () => relabel(old, next) });
    setKey(next);
  };

  const remove = async () => {
    if (used.length && !(await confirmDialog({ title: `Remove the field "${field.label}"?`, description: `It is used by ${used.length} element(s); they will show nothing for it.`, confirmLabel: "Remove", destructive: true }))) return;
    commitT((x) => ({ ...x, fields: x.fields.filter((f) => f.key !== field.key) }));
  };

  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1">
        <Input className="h-7 flex-1 text-sm" value={field.label} onChange={(e) => update({ label: e.target.value }, `flabel:${field.key}`)} aria-label="Field name" />
        <IconBtn tip="Remove field" onClick={remove}>
          <IconTrash />
        </IconBtn>
      </div>
      <Row>
        <Field label="Key" hint="Used in {{key}} placeholders. Renaming updates the template and existing labels.">
          <Input
            className="h-7 font-mono text-xs"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={applyKey}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </Field>
        <ChoiceField
          label="Type"
          value={field.type}
          onChange={(type) => update({ type })}
          options={[
            { value: "text", label: "One line" },
            { value: "multiline", label: "Several lines" },
          ]}
        />
      </Row>
      <Field label="Example / default value" hint="Shown in the editor and used when a label leaves this blank.">
        {field.type === "multiline" ? (
          <Textarea rows={2} className="min-h-0 text-sm" value={field.default ?? ""} onChange={(e) => update({ default: e.target.value || undefined }, `fdef:${field.key}`)} />
        ) : (
          <Input className="h-7 text-sm" value={field.default ?? ""} onChange={(e) => update({ default: e.target.value || undefined }, `fdef:${field.key}`)} />
        )}
      </Field>
      <AskAtPrintSettings field={field} update={update} />
      <p className="text-[11px] text-muted-foreground">{used.length ? `Used by ${used.map((id) => nodeLabel(nodeById(t, id)!)).join(", ")}` : "Not used yet"}</p>
    </div>
  );
}

/* --------------------------------------------------------------- variants */

export function VariantsPanel({ onEditSize }: { onEditSize: (v: Variant) => void }) {
  const t = useEditor((s) => s.template)!;
  const variantId = useEditor((s) => s.variantId);
  const setVariant = useEditor((s) => s.setVariant);
  const marginMm = useLabelStore((s) => s.settings.marginMm);
  const [open, setOpen] = useState<string | null>(null);
  const variants = t.variants ?? [];
  const areas = stockAreas(marginMm);

  const add = () => {
    const v: Variant = { id: newId("variant"), name: "Small labels", when: { maxW: 20 }, patches: {} };
    commitT((x) => ({ ...x, variants: [...(x.variants ?? []), v] }));
    setOpen(v.id);
  };
  const update = (id: string, p: Partial<Variant>, key?: string) => commitT((x) => ({ ...x, variants: (x.variants ?? []).map((v) => (v.id === id ? { ...v, ...p } : v)) }), key);
  const remove = async (v: Variant) => {
    if (!(await confirmDialog({ title: `Delete the size variant "${v.name}"?`, description: `Its ${Object.keys(v.patches).length} change(s) will be lost.`, confirmLabel: "Delete", destructive: true }))) return;
    if (variantId === v.id) setVariant(null);
    commitT((x) => ({ ...x, variants: (x.variants ?? []).filter((y) => y.id !== v.id) }));
  };

  return (
    <Section
      title="Size variants"
      actions={
        <Button size="xs" variant="outline" onClick={add}>
          <IconPlus /> Add variant
        </Button>
      }
    >
      <p className="text-[11px] text-muted-foreground">
        A variant changes elements only on certain label sizes, e.g. &ldquo;on labels narrower than 18 mm, hide the logo&rdquo;. Click <b>Edit</b>, then change things as usual: changes go into the variant.
      </p>
      {variants.map((v) => {
        const sizes = areas.filter((a) => matchesRule(v.when, a.width, a.height));
        const editing = variantId === v.id;
        return (
          <div key={v.id} className={cn("space-y-1.5 rounded-md border p-2", editing && "border-amber-500 bg-amber-500/5")}>
            <div className="flex items-center gap-1">
              <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => setOpen(open === v.id ? null : v.id)}>
                {v.name}
              </button>
              <Tip tip={editing ? "Stop editing this variant" : "Edit: changes you make go into this variant only"}>
                <Button
                  size="xs"
                  variant={editing ? "default" : "outline"}
                  className={cn(editing && "bg-amber-500 text-white hover:bg-amber-600")}
                  onClick={() => {
                    setVariant(editing ? null : v.id);
                    if (!editing) onEditSize(v);
                  }}
                >
                  {editing ? <IconX /> : <IconPencil />} {editing ? "Done" : "Edit"}
                </Button>
              </Tip>
              <IconBtn tip="Delete variant" onClick={() => remove(v)}>
                <IconTrash />
              </IconBtn>
            </div>
            <p className="text-[11px] text-muted-foreground">
              When {ruleSummary(v.when)} · {sizes.length ? `${sizes.length} stock size${sizes.length > 1 ? "s" : ""}` : "no stock sizes"} · {Object.keys(v.patches).length} change(s)
            </p>
            {(open === v.id || editing) && (
              <div className="space-y-2 pt-1">
                <Field label="Name">
                  <Input className="h-7 text-sm" value={v.name} onChange={(e) => update(v.id, { name: e.target.value }, `vname:${v.id}`)} />
                </Field>
                <SizeRuleEditor rule={v.when} marginMm={marginMm} onChange={(when) => update(v.id, { when }, `vwhen:${v.id}`)} />
                <PatchList variant={v} />
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function PatchList({ variant }: { variant: Variant }) {
  const t = useEditor((s) => s.template)!;
  const select = useEditor((s) => s.select);
  const entries = Object.entries(variant.patches);
  if (!entries.length) return <p className="text-[11px] text-muted-foreground">No changes yet.</p>;
  const clear = (id: string) =>
    commitT((x) => ({ ...x, variants: (x.variants ?? []).map((v) => (v.id === variant.id ? { ...v, patches: Object.fromEntries(Object.entries(v.patches).filter(([k]) => k !== id)) } : v)) }));
  return (
    <ul className="space-y-1">
      {entries.map(([id, p]) => {
        const n = nodeById(t, id);
        return (
          <li key={id} className="flex items-center gap-1 text-xs">
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => select([id])}>
              <b>{n ? nodeLabel(n) : id}</b>{" "}
              <span className="text-muted-foreground">
                {Object.keys(p)
                  .map((k) => (k === "hidden" ? (p.hidden ? "hidden here" : n?.hidden ? "only on these sizes" : "shown") : k))
                  .join(", ")}
              </span>
            </button>
            <IconBtn tip="Undo this change (use the normal settings)" onClick={() => clear(id)}>
              <IconX />
            </IconBtn>
          </li>
        );
      })}
    </ul>
  );
}
