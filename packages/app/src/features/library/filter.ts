/**
 * Library filters: narrow big label and template libraries by tags and by
 * what they are (template, where they came from, inverted, size...). Pure,
 * so the lists and the tests share it.
 *
 * A label's tags are its own user tags plus its template's tags, so tagging a
 * template ("freezer") finds every label made from it.
 */
import type { Label, Template } from "@labebal/core";
import { userTags } from "./tags";

export type Source = "own" | "pack" | "data";

export interface LabelFilter {
  /** Every one of these tags (lower case). */
  tags: string[];
  /** Any of these templates (empty = all). */
  templates: string[];
  /** Any of these sources (empty = all). */
  sources: Source[];
  invert: "any" | "yes" | "no";
}

export const EMPTY_LABEL_FILTER: LabelFilter = { tags: [], templates: [], sources: [], invert: "any" };

export type SizeBucket = "tape" | "small" | "medium" | "large";

export interface TemplateFilter {
  tags: string[];
  sizes: SizeBucket[];
  sources: Exclude<Source, "data">[];
  usage: "any" | "used" | "unused";
}

export const EMPTY_TEMPLATE_FILTER: TemplateFilter = { tags: [], sizes: [], sources: [], usage: "any" };

export const SIZE_BUCKETS: { id: SizeBucket; name: string; hint: string }[] = [
  { id: "tape", name: "Tape / narrow", hint: "15 mm tall or less (N1 rolls, P-touch tape)" },
  { id: "small", name: "Small", hint: "Up to 40 mm on the long side" },
  { id: "medium", name: "Medium", hint: "Up to 75 mm" },
  { id: "large", name: "Large", hint: "Shipping labels and bigger" },
];

export function sizeBucket(t: Pick<Template, "design">): SizeBucket {
  const short = Math.min(t.design.w, t.design.h);
  const long = Math.max(t.design.w, t.design.h);
  if (short <= 15) return "tape";
  if (long <= 40) return "small";
  if (long <= 75) return "medium";
  return "large";
}

const lower = (xs: readonly string[] | undefined) => (xs ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);

export interface LabelFacts {
  tags: string[];
  templateId: string;
  source: Source;
  inverted: boolean;
}

/** What a filter looks at for one label. `inPack` says whether the label came from a pack. */
export function labelFacts(l: Label, t: Template | undefined, inPack: boolean, inverted: boolean): LabelFacts {
  const tags = [...new Set([...lower(userTags(l.tags)), ...lower(t?.tags)])];
  const fromData = (l.tags ?? []).some((x) => x.startsWith("dataset:"));
  return { tags, templateId: l.templateId, source: inPack ? "pack" : fromData ? "data" : "own", inverted };
}

export function matchLabel(f: LabelFilter, x: LabelFacts): boolean {
  if (f.tags.some((t) => !x.tags.includes(t))) return false;
  if (f.templates.length && !f.templates.includes(x.templateId)) return false;
  if (f.sources.length && !f.sources.includes(x.source)) return false;
  if (f.invert === "yes" && !x.inverted) return false;
  if (f.invert === "no" && x.inverted) return false;
  return true;
}

export interface TemplateFacts {
  tags: string[];
  size: SizeBucket;
  source: "own" | "pack";
  used: boolean;
}

export const templateFacts = (t: Template, inPack: boolean, used: boolean): TemplateFacts => ({ tags: lower(t.tags), size: sizeBucket(t), source: inPack ? "pack" : "own", used });

export function matchTemplate(f: TemplateFilter, x: TemplateFacts): boolean {
  if (f.tags.some((t) => !x.tags.includes(t))) return false;
  if (f.sizes.length && !f.sizes.includes(x.size)) return false;
  if (f.sources.length && !f.sources.includes(x.source)) return false;
  if (f.usage === "used" && !x.used) return false;
  if (f.usage === "unused" && x.used) return false;
  return true;
}

/** How many filters are set (for the button badge). */
export function activeCount(f: LabelFilter | TemplateFilter): number {
  let n = f.tags.length + f.sources.length;
  if ("templates" in f) n += f.templates.length + (f.invert !== "any" ? 1 : 0);
  if ("sizes" in f) n += f.sizes.length + (f.usage !== "any" ? 1 : 0);
  return n;
}

/** Tags with how often they occur, most used first (ties by name). */
export function tagCounts(lists: readonly string[][]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const t of l) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
