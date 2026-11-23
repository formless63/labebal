"use client";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "../../lib/router";
import { useParams, useSearchParams } from "../../lib/router";
import { IconAlertTriangle, IconKeyboard, IconPointer, IconX } from "@tabler/icons-react";
import { labelInvert, matchesRule, type Template, type Variant } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useLibrary, useLibraryActions } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { EditorPreflight } from "../preflight";
import { Canvas } from "./Canvas";
import { ruleSummary, stockAreas } from "./controls";
import { EditorToolbar } from "./EditorToolbar";
import { makeView } from "./geometry";
import { useAutosave, useEditorShortcuts } from "./hooks";
import { Layers } from "./Layers";
import { NodeProps } from "./NodeProps";
import { ShortcutsDialog, openShortcuts } from "./Shortcuts";
import { SizeStrip } from "./SizeStrip";
import { FieldsPanel, TemplateSettings, VariantsPanel } from "./TemplateProps";
import { useEditor, useEditorView, type InspectorTab } from "./store";
import { componentToTemplate, setEditorLibrary } from "./library";
import { ComponentSettings } from "./PartsProps";

/**
 * Route: /templates/[id], or /components/[id] (`kind="component"`: a library
 * component edited as a template; `?from=` = the template to go back to).
 */
export function EditorPage({ kind = "template" }: { kind?: "template" | "component" }) {
  const params = useParams<{ id: string }>();
  const from = useSearchParams().get("from") ?? undefined;
  const raw = decodeURIComponent(params.id);
  const { data: lib, isLoading, error } = useLibrary();
  const component = kind === "component" ? lib?.components?.find((c) => c.id === raw) : undefined;
  const id = kind === "component" ? `component:${raw}` : raw;
  const template = useMemo(() => (kind === "component" ? (component ? componentToTemplate(component) : undefined) : lib?.templates.find((t) => t.id === id)), [kind, component, lib, id]);
  const loadedId = useEditor((s) => s.template?.id);
  const loadedFor = useRef<string | null>(null);

  // Load into the editor once per visit (later library refreshes must not clobber edits).
  useEffect(() => {
    if (template && loadedFor.current !== template.id) {
      loadedFor.current = template.id;
      useEditor.getState().load(template, kind === "component" ? { kind: "component", id: raw, from } : undefined);
    }
  }, [template, kind, raw, from]);

  if (isLoading) return <p className="m-auto text-muted-foreground">Loading template…</p>;
  if (error) return <p className="m-auto text-destructive">Could not load the library: {String(error)}</p>;
  if (!template)
    return (
      <div className="m-auto space-y-3 text-center">
        <p className="text-muted-foreground">This {kind === "component" ? "component" : "template"} doesn&apos;t exist (it may have been deleted).</p>
        <Button asChild variant="outline">
          <Link href="/templates">All templates</Link>
        </Button>
      </div>
    );
  if (loadedId !== id) return <p className="m-auto text-muted-foreground">Opening…</p>;
  return <Editor key={id} />;
}

function Editor() {
  const t = useEditor((s) => s.template)!;
  const { data: lib } = useLibrary();
  const sampleId = useEditor((s) => s.sampleLabelId);
  const variantId = useEditor((s) => s.variantId);
  const selection = useEditor((s) => s.selection);
  const tab = useEditor((s) => s.tab);
  const sizeId = useEditorView((s) => s.sizeId);
  const settings = useLabelStore((s) => s.settings);
  const status = useAutosave();
  useEditorShortcuts();
  const mode = useEditor((s) => s.mode);
  const isComponent = mode.kind === "component";
  // Operations that save to the library (make component / style from the selection).
  const actions = useLibraryActions();
  useEffect(() => {
    setEditorLibrary(actions);
    return () => setEditorLibrary(null);
  });

  const labels = useMemo(() => (isComponent ? [] : (lib?.labels ?? []).filter((l) => l.templateId === t.id)), [lib, t.id, isComponent]);
  const sample = labels.find((l) => l.id === sampleId);
  const sampleLabel = useMemo(() => (sample ? { values: sample.values, overrides: sample.overrides, invert: sample.invert } : undefined), [sample]);
  const view = useMemo(
    () => makeView({ design: t.design } as Template, sizeId, settings.printer, settings.marginMm),
    [t.design, sizeId, settings.printer, settings.marginMm],
  );
  // Same rule as printing: label override, then template rules, then the template default.
  const invert = labelInvert(t, sample ?? { values: {} });
  const variant = t.variants?.find((v) => v.id === variantId);

  /** Entering a variant: show a size it applies to. */
  const showVariantSize = (v: Variant) => {
    if (matchesRule(v.when, view.width, view.height)) return;
    const hit = stockAreas(settings.marginMm).find((a) => matchesRule(v.when, a.width, a.height));
    if (hit) useEditorView.getState().set({ sizeId: hit.size.id });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShortcutsDialog />
      <EditorToolbar status={status} labels={labels} />
      {isComponent && <ComponentBanner />}
      {variant && (
        <VariantBanner
          variant={variant}
          applies={matchesRule(variant.when, view.width, view.height)}
          canShow={stockAreas(settings.marginMm).some((a) => matchesRule(variant.when, a.width, a.height))}
          onShow={() => showVariantSize(variant)}
        />
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)_310px]">
        <aside className="flex min-h-0 flex-col border-r bg-card">
          <Layers />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">
          <Canvas key={view.size.id} template={t} label={sampleLabel} invert={invert} view={view} />
          <EditorPreflight template={t} label={sampleLabel} invert={invert} size={view.size} printer={view.printer} marginMm={settings.marginMm} pixels={view.isDesign ? view : undefined} />
          <SizeStrip template={t} label={sampleLabel} />
        </div>
        <aside className="flex min-h-0 flex-col border-l bg-card">
          <Tabs value={tab} onValueChange={(v) => useEditor.getState().setTab(v as InspectorTab)} className="flex min-h-0 flex-1 flex-col gap-0">
            {isComponent ? (
              <TabsList className="mx-2 mt-2 grid w-auto grid-cols-2">
                <TabsTrigger value="element" className="text-xs">
                  Element
                </TabsTrigger>
                <TabsTrigger value="template" className="text-xs">
                  Component
                </TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="mx-2 mt-2 grid w-auto grid-cols-4">
                <TabsTrigger value="element" className="text-xs">
                  Element
                </TabsTrigger>
                <TabsTrigger value="template" className="text-xs">
                  Template
                </TabsTrigger>
                <TabsTrigger value="fields" className="text-xs">
                  Fields
                </TabsTrigger>
                <TabsTrigger value="sizes" className="text-xs">
                  Variants
                </TabsTrigger>
              </TabsList>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TabsContent value="element">
                {selection.length === 1 ? (
                  <NodeProps key={selection[0]} id={selection[0]} />
                ) : selection.length > 1 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    {selection.length} elements selected. Drag any of them to move them together, use the align buttons at the top, or group them from the
                    Layers panel. In a row or column, the arrow keys move them through the order as a block.
                  </p>
                ) : (
                  <div className="space-y-2 p-4 text-sm text-muted-foreground">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <IconPointer className="size-4" /> Click something on the label to change it.
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-xs">
                      <li>Drag to move, drag the corners to resize. Arrow keys nudge by one dot (Shift: 1 mm).</li>
                      <li>Drag on an empty spot to select several elements; Shift + click adds one.</li>
                      <li>Esc selects the group around it, Enter goes inside a group.</li>
                      <li>Hold Space and drag, or scroll, to pan. Ctrl + scroll to zoom, Ctrl + 0 to fit.</li>
                      <li>Ctrl+C / V / D copy, paste, duplicate. Ctrl+G groups.</li>
                    </ul>
                    <Button size="xs" variant="outline" onClick={openShortcuts}>
                      <IconKeyboard /> All shortcuts
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="template">{isComponent ? <ComponentSettings /> : <TemplateSettings />}</TabsContent>
              <TabsContent value="fields">
                <FieldsPanel />
                <UsedBy count={labels.length} />
              </TabsContent>
              <TabsContent value="sizes">
                <VariantsPanel onEditSize={showVariantSize} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

/** Shown while editing a component. */
function ComponentBanner() {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-sm">
      <span className="font-medium text-violet-900 dark:text-violet-200">Editing a component</span>
      <span className="text-xs text-violet-900/80 dark:text-violet-200/80">
        Changes save to the library and show up in every template that uses it. Fields like {"{{title}}"} are filled from each label of those templates.
      </span>
    </div>
  );
}

function UsedBy({ count }: { count: number }) {
  return (
    <p className="px-3 py-2 text-[11px] text-muted-foreground">
      {count ? `${count} label${count > 1 ? "s" : ""} use this template. Pick one under “Preview” at the top to see it here.` : "No labels use this template yet. Create them on the Print page."}
    </p>
  );
}

function VariantBanner({ variant, applies, canShow, onShow }: { variant: Variant; applies: boolean; canShow: boolean; onShow: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-sm">
      <span className="font-medium text-amber-900 dark:text-amber-200">Editing variant &ldquo;{variant.name}&rdquo;</span>
      <span className="text-xs text-amber-900/80 dark:text-amber-200/80">
        Everything you change here only applies when {ruleSummary(variant.when)}: new elements appear only on these sizes, and deleting hides an element on these
        sizes only. Reordering and grouping change every size, so they are off until you click Done.
      </span>
      {!applies && (
        <span className="flex items-center gap-1 text-xs text-amber-900 dark:text-amber-200">
          <IconAlertTriangle className="size-3.5" /> This variant isn&apos;t active at the size shown.
          {canShow && (
            <Button size="xs" variant="outline" onClick={onShow}>
              Show a matching size
            </Button>
          )}
        </span>
      )}
      <span className="flex-1" />
      <Button size="xs" variant="outline" onClick={() => useEditor.getState().setVariant(null)}>
        <IconX /> Done
      </Button>
    </div>
  );
}
