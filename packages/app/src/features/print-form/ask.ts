"use client";
/**
 * "Ask when printing" fields (FieldDef.askAtPrint).
 *
 * Print entry points call, before `printLabels`:
 *
 *   const asked = await askForPrintValues(lib, items);
 *   if (!asked) return; // cancelled
 *   await printLabels(lib, items, ctx, { ...opts, ...asked });
 *
 * When none of the items' templates ask for anything this resolves to `{}`
 * straight away. Otherwise a form (PrintFormHost, mounted in app/providers.tsx)
 * asks once per template; answers fill those fields for this print only (not
 * saved to the labels) and history records them (`PrintOptions.printValues`).
 */
import { askDefault, askedFields, type FieldDef, type Label, type Library, type Template } from "@labebal/core";
import type { PrintOptions } from "../labels/print";

export interface AskGroup {
  template: Template;
  fields: FieldDef[];
  /** Number of labels / copies of this template in the print. */
  labels: number;
  copies: number;
  /** Prefilled answers. */
  initial: Record<string, string>;
}

export interface AskRequest {
  id: number;
  groups: AskGroup[];
  resolve: (v: Record<string, Record<string, string>> | null) => void;
}

let current: AskRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const subscribeAsk = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const askQueue = () => current;
export const settleAsk = (id: number) => ((current = current.filter((r) => r.id !== id)), emit());

const memoryKey = (templateId: string) => `labebal:print-form:${templateId}`;
function lastUsed(templateId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(memoryKey(templateId)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export function rememberAnswers(templateId: string, values: Record<string, string>) {
  try {
    localStorage.setItem(memoryKey(templateId), JSON.stringify(values));
  } catch {}
}

/**
 * Initial answer: a relative date default ("today", "+30d") is recomputed
 * every time; otherwise the value all these labels share, then the last answer
 * on this browser, then the field default.
 */
function initialValue(f: FieldDef, labels: Label[], last: Record<string, string>): string {
  if (f.askType === "date" && f.default?.trim()) return askDefault(f);
  const own = [...new Set(labels.map((l) => l.values[f.key] ?? ""))];
  if (own.length === 1 && own[0].trim()) return own[0];
  if (last[f.key] !== undefined) return last[f.key];
  return askDefault(f);
}

/** The print-time questions for these items (empty when nothing is asked). */
export function askGroups(lib: Library, items: { label: Label; qty: number }[]): AskGroup[] {
  const groups: AskGroup[] = [];
  for (const t of lib.templates) {
    const fields = askedFields(t);
    if (!fields.length) continue;
    const mine = items.filter((i) => i.qty > 0 && i.label.templateId === t.id);
    if (!mine.length) continue;
    const last = lastUsed(t.id);
    const labels = mine.map((i) => i.label);
    groups.push({
      template: t,
      fields,
      labels: new Set(labels.map((l) => l.id)).size,
      copies: mine.reduce((a, i) => a + i.qty, 0),
      initial: Object.fromEntries(fields.map((f) => [f.key, initialValue(f, labels, last)])),
    });
  }
  return groups;
}

/** Show the print-time form when needed. Resolves to options to merge into PrintOptions, or null when cancelled. */
export function askForPrintValues(lib: Library, items: { label: Label; qty: number }[]): Promise<Pick<PrintOptions, "printValues"> | null> {
  const groups = askGroups(lib, items);
  if (!groups.length) return Promise.resolve({});
  return new Promise((resolve) => {
    current = [...current, { id: nextId++, groups, resolve: (v) => resolve(v ? { printValues: v } : null) }];
    emit();
  });
}
