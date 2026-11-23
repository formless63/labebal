"use client";
import { useCallback, useState } from "react";
import { Link } from "../../lib/router";
import { IconCopy, IconPencil, IconPhoto, IconPrinter, IconStack2, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { GOOD_FIT, SIZES, contentSize, labelPixels, printerForSize, sizeFit, sizePrinterName, usesSequence, type Label, type Library, type Template, type TextNode, walk } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { parseTags, userTags } from "../library/tags";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { PreflightList } from "../preflight";
import { useLibraryActions } from "./api";
import { isInverted, usePrintContext } from "./context";
import { LabelPreview } from "./LabelPreview";
import { usePrinter } from "./printer";
import { printLabels } from "./print";
import { askForPrintValues } from "../print-form/ask";
import { useCan } from "../auth/me-client";
import { useLabelStore } from "./store";

/** Text node that displays a field (for the per-label size control). */
function fieldNode(t: Template, key: string): TextNode | undefined {
  let hit: TextNode | undefined;
  walk(t.root, (n) => {
    if (!hit && n.type === "text" && n.text.includes(`{{${key}}}`)) hit = n;
  });
  return hit;
}

export function LabelEditor({ lib, label }: { lib: Library; label: Label }) {
  const { settings, printer, size } = usePrintContext();
  const p = usePrinter();
  const actions = useLibraryActions();
  const enqueue = useLabelStore((s) => s.enqueue);
  const select = useLabelStore((s) => s.select);
  const canDesign = useCan("editor");
  const [qty, setQty] = useState(1);
  // Empty = default (1, or the template's persistent counter).
  const [seqStart, setSeqStart] = useState<number | undefined>(undefined);
  const [coverage, setCoverage] = useState(0);
  const [stageW, setStageW] = useState(700);
  // Track the stage width so the big preview always fits (React 19 ref cleanup).
  // Stable callback: an inline one would re-create the observer on every render.
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const t = lib.templates.find((x) => x.id === label.templateId);
  if (!t) return <p className="m-auto text-muted-foreground">Template missing for this label.</p>;

  const inverted = isInverted(label, t, settings.invertAll);
  const update = (patch: Partial<Label>) => actions.saveLabel({ ...label, ...patch });
  const setValue = (key: string, v: string) => update({ values: { ...label.values, [key]: v } });
  const setSize = (nodeId: string, v: number, dflt: number) => {
    const overrides = { ...(label.overrides ?? {}) };
    const own = { ...(overrides[nodeId] ?? {}) } as Partial<TextNode>;
    if (!Number.isFinite(v) || v === dflt) delete own.sizePt;
    else own.sizePt = v;
    if (Object.keys(own).length) overrides[nodeId] = own;
    else delete overrides[nodeId];
    update({ overrides: Object.keys(overrides).length ? overrides : undefined });
  };
  // Sizes whose shape suits the design (best first), plus the one in use.
  const fitSizes = SIZES.map((z) => {
    const px = labelPixels(z, printerForSize(z));
    const c = contentSize({ ...px, marginMm: settings.marginMm });
    return { z, fit: sizeFit(t.design, { w: c.width, h: c.height }) };
  })
    .filter((x) => x.fit < GOOD_FIT || x.z.id === size.id)
    .sort((a, b) => a.fit - b.fit)
    .slice(0, 10)
    .map((x) => x.z);
  const invertMode = label.invert === undefined ? "auto" : label.invert ? "on" : "off";

  const common = { template: t, label, invert: inverted, material: settings.material, ribbon: settings.ribbon, marginMm: settings.marginMm };
  // Fit the big preview to the panel width and a sensible height.
  const bigScale = Math.max(2, Math.min(26, (stageW - 16) / size.widthMm, 300 / size.heightMm));

  async function printNow() {
    try {
      const asked = await askForPrintValues(lib, [{ label, qty }]); // print-time form
      if (!asked) return;
      await printLabels(lib, [{ label, qty }], { settings, printer, size }, { seqStart, ...asked });
      toast.success(`Printed ${qty} × ${label.name}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  /** Use another design: keeps values whose field names match, fills the rest with defaults. */
  const changeDesign = (id: string) => {
    const next = lib.templates.find((x) => x.id === id);
    if (!next || next.id === t.id) return;
    const values = Object.fromEntries(next.fields.map((f) => [f.key, label.values[f.key] ?? f.default ?? ""]));
    actions.saveLabel({ ...label, templateId: next.id, values, overrides: undefined });
    toast.success(`Now uses "${next.name}"`);
  };

  return (
    <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Design</span>
        <Select value={t.id} onValueChange={changeDesign}>
          <SelectTrigger className="h-8 w-64 max-w-full" aria-label="Design this label uses">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...lib.templates].sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canDesign && (
          <Button size="sm" asChild title="Open the visual editor: layout, text, codes, icons. Changes every label using this design.">
            <Link href={`/templates/${encodeURIComponent(t.id)}`}>
              <IconPencil /> Edit design
            </Link>
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {(() => {
            const n = lib.labels.filter((l) => l.templateId === t.id).length;
            return n > 1 ? `Shared by ${n} labels: editing it changes all of them.` : "Fill in the fields below; the design sets the layout.";
          })()}
        </span>
      </div>
      {/* shrink-0: in this scrolling flex column the stage would otherwise be squeezed
          below the preview's height when the panel is short, clipping the label. */}
      <div ref={stageRef} className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/60 px-4 py-9">
        <LabelPreview {...common} size={size} printer={printer} scale={bigScale} snap={0.7} guides onCoverage={setCoverage} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {size.name} on the {printer.name}. Dashed line = printable area. Ribbon coverage {Math.round(coverage * 100)}%.
      </p>
      <PreflightList template={t} label={label} className="-mt-2" />

      {/* Reflow check: the same label on every size we stock. */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <IconStack2 className="size-3.5" /> All sizes
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          {fitSizes.map((z) => (
            <button key={z.id} className="flex flex-col items-center gap-1" title={`Use ${z.name}`} onClick={() => useLabelStore.getState().setSettings({ printer: z.printer, sizeId: z.id })}>
              <LabelPreview {...common} size={z} printer={printerForSize(z)} scale={4} className={z.id === size.id ? "ring-2 ring-primary" : ""} />
              <span className="text-[11px] text-muted-foreground">
                {sizePrinterName(z)} {z.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Name</UiLabel>
          <Input value={label.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Tags</UiLabel>
          <Input
            key={label.id}
            defaultValue={userTags(label.tags).join(", ")}
            placeholder="e.g. freezer, outdoor"
            onBlur={(e) => {
              const own = userTags(label.tags);
              const next = parseTags(e.target.value);
              if (next.join(",") !== own.join(",")) update({ tags: [...(label.tags ?? []).filter((t) => !own.includes(t)), ...next] });
            }}
          />
        </div>
        {t.fields.map((f) => {
          const node = fieldNode(t, f.key);
          const sz = node ? ((label.overrides?.[node.id] as Partial<TextNode> | undefined)?.sizePt ?? node.sizePt) : undefined;
          return (
            <div key={f.key} className="flex gap-2">
              <div className="flex-1 space-y-1.5">
                <UiLabel className="text-xs text-muted-foreground">{f.label}</UiLabel>
                {f.type === "multiline" ? (
                  <Textarea rows={2} className="min-h-0" value={label.values[f.key] ?? ""} onChange={(e) => setValue(f.key, e.target.value)} />
                ) : (
                  <Input value={label.values[f.key] ?? ""} onChange={(e) => setValue(f.key, e.target.value)} />
                )}
              </div>
              {node && (
                <div className="w-20 space-y-1.5" title={`Text size in points; ${node.sizePt}pt is the template default`}>
                  <UiLabel className="text-xs text-muted-foreground">Size (pt)</UiLabel>
                  <Input type="number" min={2} max={72} step={0.1} value={sz} onChange={(e) => setSize(node.id, e.target.valueAsNumber, node.sizePt)} />
                </div>
              )}
            </div>
          );
        })}
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Colors</UiLabel>
          <Select value={invertMode} onValueChange={(v) => update({ invert: v === "auto" ? undefined : v === "on" })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Template default ({t.invertByDefault ? "inverted" : "normal"})</SelectItem>
              <SelectItem value="off">Normal: print the marks</SelectItem>
              <SelectItem value="on">Inverted: print the background</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" className="w-20" min={1} max={999} value={qty} onChange={(e) => setQty(Math.max(1, e.target.valueAsNumber || 1))} aria-label="Quantity" />
        {usesSequence(t, label) && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="First number for {{seq}} when printing now">
            Start #
            <Input type="number" className="w-24" min={0} value={seqStart ?? ""} placeholder={t.seqCounter ? "next" : "1"} title={t.seqCounter ? `Empty: next number of the "${t.seqCounter}" counter` : undefined} onChange={(e) => setSeqStart(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined)} />
          </label>
        )}
        <Button variant="outline" onClick={() => enqueue(label.id, qty)}>
          Add {qty} to queue
        </Button>
        <Button disabled={!p.connected || p.busy} onClick={printNow}>
          <IconPrinter /> Print {qty} now
        </Button>
        <span className="flex-1" />
        <Button variant="outline" asChild>
          <Link href={`/mockups?label=${encodeURIComponent(label.id)}&size=${size.id}`}>
            <IconPhoto /> View on product
          </Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const id = `l-${crypto.randomUUID().slice(0, 8)}`;
            actions.saveLabel({ ...structuredClone(label), id, name: `${label.name} copy` }, { immediate: true });
            select(id);
          }}
        >
          <IconCopy /> Duplicate
        </Button>
        <Button
          variant="outline"
          className="text-destructive"
          onClick={async () => {
            if (!(await confirmDialog({ title: `Delete "${label.name}"?`, confirmLabel: "Delete", destructive: true }))) return;
            void actions.deleteLabel(label.id);
            select(lib.labels.find((l) => l.id !== label.id)?.id ?? null);
          }}
        >
          <IconTrash /> Delete
        </Button>
      </div>
    </section>
  );
}
