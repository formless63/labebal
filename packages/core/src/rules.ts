/**
 * Category -> style rules.
 *
 * An ordered list of "if <column> <matches> then <set things>" rules, evaluated
 * against one data row. Used to drive a label's look from the data: e.g. a
 * drawer whose category is "Screws" gets `icon = "screw"`, resistors get an
 * inverted header, connectors use a different template.
 *
 * Framework-free; the data feature evaluates these in the browser (preview) and
 * on the server (create/update labels) with the same code.
 */
import { applyFilters, type LabelNode } from "./schema";

export type RuleOp = "equals" | "contains" | "startsWith" | "endsWith" | "regex" | "isEmpty";

export const RULE_OPS: { op: RuleOp; label: string; needsValue: boolean }[] = [
  { op: "equals", label: "is", needsValue: true },
  { op: "contains", label: "contains", needsValue: true },
  { op: "startsWith", label: "starts with", needsValue: true },
  { op: "endsWith", label: "ends with", needsValue: true },
  { op: "regex", label: "matches pattern", needsValue: true },
  { op: "isEmpty", label: "is empty", needsValue: false },
];

export interface RuleCondition {
  /** Column id in the row. */
  column: string;
  op: RuleOp;
  value?: string;
  /** Flip the result ("is not", "does not contain", "is not empty"). */
  not?: boolean;
  /** Text comparisons ignore case unless set. */
  caseSensitive?: boolean;
}

export interface RuleEffect {
  /** Field values to set. Values may use `{{column}}` to copy from the row. */
  values?: Record<string, string>;
  /** Node id -> properties to override (e.g. `{ header: { fill: "black" } }`). */
  overrides?: Record<string, Partial<LabelNode>>;
  /** Use this template instead of the dataset's default. */
  templateId?: string;
  /** Force the label inverted (true) or normal (false). */
  invert?: boolean;
}

export interface Rule {
  id: string;
  name?: string;
  when: RuleCondition;
  then: RuleEffect;
  disabled?: boolean;
}

export interface RuleSet {
  /** "first": only the first matching rule applies. "all": every matching rule applies, later ones win. */
  mode: "first" | "all";
  rules: Rule[];
}

export interface RuleResult {
  values: Record<string, string>;
  overrides: Record<string, Partial<LabelNode>>;
  templateId?: string;
  invert?: boolean;
  /** Ids of the rules that applied, in order. */
  matched: string[];
}

const fold = (s: string, cs?: boolean) => (cs ? s : s.toLocaleLowerCase());

/** Problem with a rule's condition (e.g. a broken pattern), or undefined when fine. */
export function ruleProblem(c: RuleCondition): string | undefined {
  if (!c.column) return "Pick a column";
  if (c.op === "regex") {
    try {
      new RegExp(c.value ?? "");
    } catch (e) {
      return `Pattern is not valid: ${(e as Error).message}`;
    }
  }
  return undefined;
}

/** Does the row match the condition? Broken patterns never match. */
export function testCondition(c: RuleCondition, row: Record<string, string>): boolean {
  const cell = (row[c.column] ?? "").trim();
  const want = (c.value ?? "").trim();
  let hit: boolean;
  switch (c.op) {
    case "equals":
      hit = fold(cell, c.caseSensitive) === fold(want, c.caseSensitive);
      break;
    case "contains":
      hit = fold(cell, c.caseSensitive).includes(fold(want, c.caseSensitive));
      break;
    case "startsWith":
      hit = fold(cell, c.caseSensitive).startsWith(fold(want, c.caseSensitive));
      break;
    case "endsWith":
      hit = fold(cell, c.caseSensitive).endsWith(fold(want, c.caseSensitive));
      break;
    case "regex":
      try {
        hit = new RegExp(c.value ?? "", c.caseSensitive ? "" : "i").test(cell);
      } catch {
        return false;
      }
      break;
    case "isEmpty":
      hit = cell === "";
      break;
    default:
      hit = false;
  }
  return c.not ? !hit : hit;
}

/** Replace `{{column}}` with row values; unknown placeholders (e.g. `{{date}}`) are kept for render time. */
export const fillFromRow = (text: string, row: Record<string, string>) =>
  text.replace(/\{\{\s*([\w-]+)((?:\|[^}|]*)*)\s*\}\}/g, (m, k: string, chain: string) => (k in row ? applyFilters(row[k], chain) : m));

/** Evaluate a rule set against a row. */
export function applyRules(row: Record<string, string>, set: RuleSet | undefined): RuleResult {
  const out: RuleResult = { values: {}, overrides: {}, matched: [] };
  if (!set) return out;
  for (const r of set.rules) {
    if (r.disabled || !testCondition(r.when, row)) continue;
    out.matched.push(r.id);
    for (const [k, v] of Object.entries(r.then.values ?? {})) out.values[k] = fillFromRow(v, row);
    for (const [id, patch] of Object.entries(r.then.overrides ?? {})) out.overrides[id] = { ...out.overrides[id], ...patch } as Partial<LabelNode>;
    if (r.then.templateId) out.templateId = r.then.templateId;
    if (r.then.invert !== undefined) out.invert = r.then.invert;
    if (set.mode === "first") break;
  }
  return out;
}

/** Plain-language summary of a condition, e.g. `category is "Screws"`. */
export function describeCondition(c: RuleCondition, columnName = c.column): string {
  const op = RULE_OPS.find((o) => o.op === c.op);
  const verb = c.not ? { equals: "is not", contains: "does not contain", startsWith: "does not start with", endsWith: "does not end with", regex: "does not match", isEmpty: "is not empty" }[c.op] : op?.label;
  return op?.needsValue ? `${columnName} ${verb} "${c.value ?? ""}"` : `${columnName} ${verb}`;
}

/* ------------------------------------------------------- template rules */

type RuleTemplate = { fields: { key: string; default?: string }[]; rules?: RuleSet; invertByDefault?: boolean };
type RuleLabel = { values?: Record<string, string>; overrides?: Record<string, Partial<LabelNode>>; invert?: boolean };
type Resolved<L> = L & { values?: Record<string, string>; overrides?: Record<string, Partial<LabelNode>>; invert?: boolean };

/**
 * Template-level rules (`Template.rules`) run on every label of the template
 * at render time, with the label's field values (defaults filled in) as the
 * "row": conditions name field keys, e.g. `category is "Screws"` -> set `icon`.
 *
 * Precedence, so preview, print, thumbnails and mockups agree:
 *   - values: rule values win over the label's (that is what a rule is for);
 *   - overrides: rule overrides first, the label's own overrides on top
 *     (a hand-tweak on one label beats the rule);
 *   - invert: the label's explicit `invert` wins, else the rule's, else the
 *     template's `invertByDefault` (see `labelInvert`).
 * `templateId` effects are ignored (a label cannot switch template while rendering).
 *
 * `layout()` calls this, so every render path sees the same label.
 */
export function resolveLabel<L extends RuleLabel>(t: RuleTemplate, label: L | undefined): Resolved<L> | undefined {
  if (!t.rules?.rules.some((r) => !r.disabled)) return label as Resolved<L> | undefined;
  const row = { ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...label?.values };
  const r = applyRules(row, t.rules);
  if (!r.matched.length) return label as Resolved<L> | undefined;
  const overrides: Record<string, Partial<LabelNode>> = { ...r.overrides };
  for (const [id, patch] of Object.entries(label?.overrides ?? {})) overrides[id] = { ...overrides[id], ...patch } as Partial<LabelNode>;
  return {
    ...(label ?? ({} as L)),
    // Rules fill fields the label leaves empty; a value set on the label itself wins
    // (same precedence as overrides and invert).
    values: { ...label?.values, ...Object.fromEntries(Object.entries(r.values).filter(([k]) => !label?.values?.[k]?.trim())) },
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(label?.invert === undefined && r.invert !== undefined ? { invert: r.invert } : {}),
  };
}

/** Ids of the template rules that apply to a label (for UI badges). */
export const matchedTemplateRules = (t: RuleTemplate, label: RuleLabel | undefined) =>
  t.rules ? applyRules({ ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...label?.values }, t.rules).matched : [];

/** Effective invert before "invert all": the label's own setting, then template rules, then the template default. */
export const labelInvert = (t: RuleTemplate | undefined, label: RuleLabel) =>
  t ? (resolveLabel(t, label)?.invert ?? t.invertByDefault ?? false) : (label.invert ?? false);
