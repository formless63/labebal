/** Shared helpers for the design importers (NiimBlue JSON, ZPL). */
import { isBuiltinFont } from "./fonts";
import type { FieldDef, FrameNode, Label, LabelNode, Rotation, Template } from "./schema";

export const PT_TO_MM = 25.4 / 72;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported";

/** Snap an angle (degrees, clockwise) to 0 / 90 / 180 / 270. */
export const snapRotation = (deg: number): Rotation => ((((Math.round((deg || 0) / 90) * 90) % 360) + 360) % 360) as Rotation;

/** Fixed-size free-layout node base at (x, y) mm that scales with the label. */
export const placed = (id: string, x: number, y: number, w: number, h: number, rotate: Rotation = 0) => ({
  id,
  x: round2(x),
  y: round2(y),
  w: { kind: "fixed" as const, mm: round2(Math.max(0.1, w)) },
  h: { kind: "fixed" as const, mm: round2(Math.max(0.1, h)) },
  ax: "scale" as const,
  ay: "scale" as const,
  ...(rotate ? { rotate } : {}),
});

/** A font family we can render: built-in / system fonts as is, anything else falls back to Arial. */
export const usableFont = (family: string | undefined, warn: (w: string) => void) => {
  const f = (family ?? "").replace(/["']/g, "").split(",")[0].trim();
  if (!f) return "Arial";
  if (isBuiltinFont(f)) return f;
  warn(`font "${f}" replaced by Arial (upload it in Settings > Fonts and pick it in the editor)`);
  return "Arial";
};

/** Collects template fields; the imported label keeps the original values. */
export class FieldSet {
  readonly fields: FieldDef[] = [];
  readonly values: Record<string, string> = {};
  private counts = new Map<string, number>();

  /** A new field `<prefix><n>` holding `value`; returns the `{{key}}` placeholder. */
  add(prefix: string, value: string, label?: string): string {
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    const key = `${prefix}${n}`;
    this.fields.push({ key, label: label ?? `${prefix[0].toUpperCase()}${prefix.slice(1)} ${n}`, type: value.includes("\n") ? "multiline" : "text" });
    this.values[key] = value;
    return `{{${key}}}`;
  }

  /** A named field (from a `{name}` placeholder in the source). */
  named(key: string) {
    if (!this.fields.some((f) => f.key === key)) this.fields.push({ key, label: key, type: "text" });
    this.values[key] ??= "";
  }
}

export function freeTemplate(id: string, name: string, w: number, h: number, children: LabelNode[], fields: FieldDef[], description: string): Template {
  const root: FrameNode = { id: "root", name: "Label", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children };
  return { id, name, description, schema: 2, design: { w: round2(w), h: round2(h) }, scaleText: true, root, fields };
}

export interface DesignImport {
  templates: Template[];
  labels: Label[];
  warnings: string[];
}
