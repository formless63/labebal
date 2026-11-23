"use client";
/**
 * Editor state (Zustand): the template being edited, undo history, selection,
 * variant mode and view settings. One editor is open at a time.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { findPath, patchNode, setVariantPatch, type LabelNode, type Template } from "@labebal/core";

const HISTORY_LIMIT = 200;
/** Edits with the same key within this window merge into one undo step (typing, dragging). */
const COALESCE_MS = 1200;

export interface Guide {
  axis: "x" | "y";
  /** Position in content mm. */
  at: number;
}

/**
 * Changes an edit makes outside the template (e.g. label values rewritten by
 * a field rename). Undo / redo run them so history stays honest.
 */
export interface SideEffect {
  undo: () => void;
  redo: () => void;
}

/** One history entry: the template before a step, and that step's side effect. */
interface Step {
  t: Template;
  effect?: SideEffect;
}

/**
 * What the editor is editing: a template, or a library component (its tree
 * shown as a template; saved back to the component). `from` = the template
 * to go back to.
 */
export type EditorMode = { kind: "template" } | { kind: "component"; id: string; from?: string };

interface EditorState {
  template: Template | null;
  mode: EditorMode;
  past: Step[];
  future: Step[];
  lastKey: string | null;
  lastAt: number;
  /** Bumps on every change to the template (autosave watches it). */
  revision: number;

  selection: string[];
  hoverId: string | null;
  /** When set, property edits are written to this variant's patches. */
  variantId: string | null;
  sampleLabelId: string | null;
  guides: Guide[];
  /** Inspector tab. */
  tab: InspectorTab;

  load: (t: Template, mode?: EditorMode) => void;
  /** Apply an edit. Same `key` within a short window = one undo step. `effect` is undone / redone with it. */
  commit: (fn: (t: Template) => Template, key?: string, effect?: SideEffect) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setHover: (id: string | null) => void;
  setVariant: (id: string | null) => void;
  setSample: (id: string | null) => void;
  setGuides: (g: Guide[]) => void;
  setTab: (t: InspectorTab) => void;
}

export type InspectorTab = "element" | "template" | "fields" | "sizes";

export const useEditor = create<EditorState>()((set, get) => ({
  template: null,
  mode: { kind: "template" },
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  revision: 0,
  selection: [],
  hoverId: null,
  variantId: null,
  sampleLabelId: null,
  guides: [],
  tab: "element",

  load: (t, mode = { kind: "template" }) =>
    set({ template: t, mode, past: [], future: [], lastKey: null, lastAt: 0, revision: 0, selection: [], hoverId: null, variantId: null, sampleLabelId: null, guides: [], tab: "element" }),

  commit: (fn, key, effect) => {
    const { template, past, lastKey, lastAt } = get();
    if (!template) return;
    const next = fn(template);
    if (next === template) return;
    const now = Date.now();
    // A canvas drag (`drag:N`) is one step however long it takes (moves, then maybe a move into another group).
    const merge = !effect && key !== undefined && key === lastKey && (now - lastAt < COALESCE_MS || key.startsWith("drag:")) && !past.at(-1)?.effect;
    set({
      template: next,
      past: merge ? past : [...past, { t: template, effect }].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: effect ? null : (key ?? null),
      lastAt: now,
      revision: get().revision + 1,
    });
  },

  undo: () => {
    const { template, past, future } = get();
    if (!template || !past.length) return;
    const prev = past[past.length - 1];
    prev.effect?.undo();
    set({ template: prev.t, past: past.slice(0, -1), future: [{ t: template, effect: prev.effect }, ...future], lastKey: null, revision: get().revision + 1, ...keepSelection(prev.t, get()) });
  },

  redo: () => {
    const { template, past, future } = get();
    if (!template || !future.length) return;
    const next = future[0];
    next.effect?.redo();
    set({ template: next.t, past: [...past, { t: template, effect: next.effect }], future: future.slice(1), lastKey: null, revision: get().revision + 1, ...keepSelection(next.t, get()) });
  },

  select: (ids) => set({ selection: [...new Set(ids)], ...(ids.length ? { tab: "element" as const } : {}) }),
  toggleSelect: (id) => {
    const s = get().selection;
    set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id], tab: "element" });
  },
  setHover: (id) => {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  setVariant: (id) => set({ variantId: id }),
  setSample: (id) => set({ sampleLabelId: id }),
  setGuides: (g) => {
    if (g.length || get().guides.length) set({ guides: g });
  },
  setTab: (tab) => set({ tab }),
}));

/** Drop selected ids that no longer exist after undo/redo. */
function keepSelection(t: Template, s: EditorState) {
  const ids = new Set<string>();
  const rec = (n: LabelNode) => {
    ids.add(n.id);
    if (n.type === "frame") n.children.forEach(rec);
  };
  rec(t.root);
  const variantId = s.variantId && t.variants?.some((v) => v.id === s.variantId) ? s.variantId : null;
  return { selection: s.selection.filter((id) => ids.has(id)), variantId };
}

/**
 * Write node properties: into the active variant's patch when editing a
 * variant, otherwise into the base node. `undefined` removes a property.
 */
export function writeProps(t: Template, id: string, patch: Partial<LabelNode> | Record<string, unknown>, variantId: string | null): Template {
  if (variantId && t.variants?.some((v) => v.id === variantId)) return setVariantPatch(t, variantId, id, patch);
  return { ...t, root: patchNode(t.root, id, patch as Partial<LabelNode>) };
}

/**
 * Patch that hides / shows a node. Showing in a variant a node hidden in the
 * base needs an explicit `hidden: false` (removing the override would keep it hidden).
 */
export function visibilityPatch(t: Template, id: string, hide: boolean, variantId: string | null): Record<string, unknown> {
  if (hide) return { hidden: true };
  const base = findPath(t.root, id)?.at(-1);
  return { hidden: variantId && base?.hidden ? false : undefined };
}

/** Convenience: update props of one node through the store (respects variant mode). */
export function updateProps(id: string, patch: Partial<LabelNode> | Record<string, unknown>, key?: string) {
  const { commit, variantId } = useEditor.getState();
  commit((t) => writeProps(t, id, patch, variantId), key ?? `props:${id}:${Object.keys(patch).join(",")}`);
}

/** View preferences, remembered per browser. */
interface ViewState {
  /** "design" = the template's design size, otherwise a `SIZES` id. */
  sizeId: string;
  /** Screen pixels per mm; null = fit to the window. */
  zoom: number | null;
  showGrid: boolean;
  snap: boolean;
  set: (p: Partial<Omit<ViewState, "set">>) => void;
}

export const useEditorView = create<ViewState>()(
  persist(
    (set) => ({
      sizeId: "design",
      zoom: null,
      showGrid: true,
      snap: true,
      set: (p) => set(p),
    }),
    { name: "labebal:editor-view", partialize: (s) => ({ sizeId: s.sizeId, showGrid: s.showGrid, snap: s.snap }) },
  ),
);
