"use client";
/**
 * The library actions the editor's operations need outside React (saving a
 * component or style made from the selection). Registered by the editor page.
 */
import { boundText, componentAsTemplate, placeholdersIn, walk, type LabelComponent, type Template, type TextStyle } from "@labebal/core";

export interface EditorLibrary {
  saveComponent: (c: LabelComponent, opts?: { immediate?: boolean }) => Promise<boolean> | undefined;
  saveStyle: (s: TextStyle, opts?: { immediate?: boolean }) => Promise<boolean> | undefined;
}

let current: EditorLibrary | null = null;
export const setEditorLibrary = (l: EditorLibrary | null) => {
  current = l;
};
export const editorLibrary = () => current;

/** Link to a component's editor; `from` = the editor's template id to come back to (a template, or `component:<id>`). */
export const componentHref = (id: string, from?: string) => `/components/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;

/** Where "back" goes from a component's editor. */
export const backHref = (from: string | undefined) =>
  !from ? "/templates#parts" : from.startsWith("component:") ? `/components/${encodeURIComponent(from.slice("component:".length))}` : `/templates/${encodeURIComponent(from)}`;

/** Placeholder names that are tokens, not fields. */
const TOKENS = new Set(["date", "time", "seq", "copy", "copies", "counter", "icon"]);

/**
 * A component as the editor's template: its root fills the design area, and
 * the fields it uses get their names as example values.
 */
export function componentToTemplate(c: LabelComponent): Template {
  const keys = new Set<string>();
  walk(c.root, (n) => {
    const s = boundText(n);
    if (s) for (const k of placeholdersIn(s)) if (!TOKENS.has(k) && !/^(date|time)[+-]/.test(k)) keys.add(k);
    if (n.type === "table") for (const row of n.cells) for (const cell of row) for (const k of placeholdersIn(cell)) if (!TOKENS.has(k)) keys.add(k);
  });
  const t = componentAsTemplate(c, [...keys]);
  return { ...t, ...(c.description ? { description: c.description } : {}), root: { ...c.root, w: { kind: "fill" }, h: { kind: "fill" } } };
}

/** Back from the editor's template to the component (the root keeps the component's default instance size). */
export function templateToComponent(t: Template, c: LabelComponent): LabelComponent {
  const out: LabelComponent = { ...c, name: t.name.trim() || c.name, design: { ...t.design }, root: { ...t.root, w: c.root.w, h: c.root.h } };
  if (t.description) out.description = t.description;
  else delete out.description;
  return out;
}