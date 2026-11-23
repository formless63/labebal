/**
 * Datasets: tables of records (spreadsheet rows, inventory exports) that drive
 * labels. One row becomes one label: a column -> field mapping fills the
 * template's fields, rules (rules.ts) adjust values / style per row, and a key
 * column gives each label a stable id so re-importing updates labels instead
 * of duplicating them.
 *
 * Framework-free: parsing, mapping and label building run in the browser
 * (preview) and on the server (create/update, public API) unchanged.
 */
import Papa from "papaparse";
import { applyRules, type RuleSet } from "./rules";
import type { FieldDef, Label, LabelNode, Template } from "./schema";

export interface DataColumn {
  /** Stable key used in rows, rules and mappings (slug of the original name). */
  id: string;
  /** Display name (can be renamed without breaking mappings). */
  name: string;
}

export interface DataRow {
  id: string;
  values: Record<string, string>;
}

/** How a dataset turns into labels. */
export interface DatasetLink {
  templateId: string;
  /** Template field key -> column id. */
  fields: Record<string, string>;
  /** Column whose value identifies the record (SKU, part number...). */
  keyColumn?: string;
  /** Column used as the label's name in lists (defaults to the key / first field). */
  nameColumn?: string;
  /** Label ids are `${idPrefix}${slug(key)}`. Fixed when the link is created so ids never move. */
  idPrefix: string;
  rules: RuleSet;
}

export interface Dataset {
  id: string;
  name: string;
  columns: DataColumn[];
  rows: DataRow[];
  link?: DatasetLink;
  updatedAt?: string;
}

/** Lowercase, keep letters/digits, collapse the rest to `-`. */
export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** For fuzzy name matching: "Part Name" == "part_name" == "partname". */
export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A column id for `name` not already in `taken` (taken is updated). */
export function columnIdFor(name: string, taken: Set<string>): string {
  const base = slugify(name).replace(/-/g, "_") || "column";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

export const newRowId = () => `r-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export interface ParsedTable {
  columns: DataColumn[];
  rows: DataRow[];
  /** Human-readable problems (e.g. a row with too many cells). */
  warnings: string[];
}

/**
 * Parse CSV or spreadsheet paste (tab separated). The first row is the header.
 * The delimiter is detected unless given. Blank lines are skipped.
 */
export function parseTable(text: string, opts: { delimiter?: string } = {}): ParsedTable {
  const clean = text.replace(/^﻿/, "");
  const delimiter = opts.delimiter ?? (clean.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : "");
  const res = Papa.parse<string[]>(clean, { delimiter, skipEmptyLines: "greedy" });
  const warnings = res.errors.filter((e) => e.code !== "UndetectableDelimiter").map((e) => (e.row !== undefined ? `Row ${e.row + 1}: ${e.message}` : e.message));
  const [header = [], ...body] = res.data;
  const width = Math.max(header.length, ...body.map((r) => r.length));
  const taken = new Set<string>();
  const columns: DataColumn[] = Array.from({ length: width }, (_, i) => {
    const name = (header[i] ?? "").trim() || `Column ${i + 1}`;
    return { id: columnIdFor(name, taken), name };
  });
  const rows = body.map((cells) => ({
    id: newRowId(),
    values: Object.fromEntries(columns.map((c, i) => [c.id, (cells[i] ?? "").trim()])),
  }));
  return { columns, rows, warnings };
}

/** CSV export (header = column names). */
export const toCsv = (d: Pick<Dataset, "columns" | "rows">) =>
  Papa.unparse({ fields: d.columns.map((c) => c.name), data: d.rows.map((r) => d.columns.map((c) => r.values[c.id] ?? "")) });

/** Match template fields to columns by key or label (case/punctuation-insensitive). */
export function autoMapFields(fields: FieldDef[], columns: DataColumn[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const names = [normalizeName(f.key), normalizeName(f.label)];
    const hit = columns.find((c) => names.includes(normalizeName(c.name)) || names.includes(normalizeName(c.id)));
    if (hit) out[f.key] = hit.id;
  }
  return out;
}

const KEY_HINTS = ["sku", "id", "key", "code", "partnumber", "partno", "part", "itemnumber", "item", "barcode", "upc"];

/** A column whose values are all filled and unique, preferring names like SKU / ID / Code. */
export function guessKeyColumn(columns: DataColumn[], rows: DataRow[]): string | undefined {
  const unique = columns.filter((c) => {
    const vs = rows.map((r) => (r.values[c.id] ?? "").trim());
    return vs.length > 0 && vs.every(Boolean) && new Set(vs.map(slugify)).size === vs.length;
  });
  for (const h of KEY_HINTS) {
    const hit = unique.find((c) => normalizeName(c.name) === h);
    if (hit) return hit.id;
  }
  return unique.find((c) => KEY_HINTS.some((h) => normalizeName(c.name).includes(h)))?.id;
}

/** Default label id prefix for a template: `t-drawer-bin` -> `l-drawer-bin-`. */
export const defaultIdPrefix = (templateId: string) => `${templateId.replace(/^t-/, "l-")}-`;

/** Stable label id for a record key under a template (also used by the public API). */
export const keyedLabelId = (templateId: string, key: string) => `${defaultIdPrefix(templateId)}${slugify(key)}`;

/** A new link with fields auto-matched and a guessed key column. */
export function createLink(d: Pick<Dataset, "columns" | "rows">, template: Template): DatasetLink {
  const keyColumn = guessKeyColumn(d.columns, d.rows);
  return {
    templateId: template.id,
    fields: autoMapFields(template.fields, d.columns),
    keyColumn,
    idPrefix: defaultIdPrefix(template.id),
    rules: { mode: "first", rules: [] },
  };
}

/** The record key of a row ("" when the link has no key column or the cell is empty). */
export const rowKey = (link: DatasetLink, row: DataRow) => (link.keyColumn ? (row.values[link.keyColumn] ?? "").trim() : "");

/** Label id for a row: from the key column when filled, else from the row id. */
export const labelIdForRow = (link: DatasetLink, row: DataRow) => {
  const key = slugify(rowKey(link, row));
  return `${link.idPrefix}${key || row.id}`;
};

export interface RowLabel {
  row: DataRow;
  label: Label;
  /** Rule ids that applied. */
  matched: string[];
  /** Things the user should fix (missing key, template...). */
  problems: string[];
}

/** Build the label for one row (mapping, then rules). */
export function rowToLabel(d: Pick<Dataset, "id">, link: DatasetLink, row: DataRow, templates?: Pick<Template, "id">[]): RowLabel {
  const problems: string[] = [];
  const values: Record<string, string> = {};
  for (const [field, col] of Object.entries(link.fields)) if (col) values[field] = row.values[col] ?? "";
  const r = applyRules(row.values, link.rules);
  Object.assign(values, r.values);
  const templateId = r.templateId ?? link.templateId;
  if (templates && !templates.some((t) => t.id === templateId)) problems.push(`Template "${templateId}" not found`);
  if (link.keyColumn && !rowKey(link, row)) problems.push("Key is empty: this row's label id will change if the row is re-imported");
  const name =
    (link.nameColumn && row.values[link.nameColumn]?.trim()) ||
    rowKey(link, row) ||
    Object.values(values).find((v) => v.trim())?.split("\n")[0] ||
    "Untitled";
  const overrides: Record<string, Partial<LabelNode>> = r.overrides;
  const label: Label = {
    id: labelIdForRow(link, row),
    templateId,
    name,
    values,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(r.invert !== undefined ? { invert: r.invert } : {}),
    tags: [`dataset:${d.id}`],
  };
  return { row, label, matched: r.matched, problems };
}

/** Labels for the given rows (default: all), with duplicate-id problems flagged. */
export function datasetToLabels(d: Dataset, rows: DataRow[] = d.rows, templates?: Pick<Template, "id">[]): RowLabel[] {
  if (!d.link) return [];
  const out = rows.map((row) => rowToLabel(d, d.link!, row, templates));
  const seen = new Map<string, number>();
  for (const r of out) seen.set(r.label.id, (seen.get(r.label.id) ?? 0) + 1);
  for (const r of out) if ((seen.get(r.label.id) ?? 0) > 1) r.problems.push("Same key as another row: only one label will be kept");
  return out;
}

export interface MergeResult {
  dataset: Dataset;
  added: number;
  updated: number;
}

/**
 * Merge incoming records (objects keyed by column name or id) into a dataset.
 * Unknown columns are added. With `upsert` and a key column, rows whose key
 * matches are updated (only the given cells change); others are appended.
 */
export function mergeRows(
  d: Dataset,
  records: Record<string, unknown>[],
  opts: { mode?: "append" | "upsert"; keyColumn?: string } = {},
): MergeResult {
  const keyCol = findColumn(d.columns, opts.keyColumn ?? d.link?.keyColumn)?.id;
  const existing = new Map<string, string>();
  if (keyCol) for (const r of d.rows) if (r.values[keyCol]) existing.set(slugify(r.values[keyCol]), r.id);
  const plan = planRowMerge(d.columns, records, { mode: opts.mode, keyColumn: opts.keyColumn ?? d.link?.keyColumn, existing });
  const patch = new Map(plan.updates.map((u) => [u.id, u.values]));
  const rows = [...d.rows.map((r) => ({ ...r, values: { ...r.values, ...patch.get(r.id) } })), ...plan.inserts];
  for (const r of rows) for (const c of plan.columns) r.values[c.id] ??= "";
  return { dataset: { ...d, columns: plan.columns, rows }, added: plan.inserts.length, updated: plan.updated };
}

/** A column by id, or by name (case/punctuation-insensitive). */
export const findColumn = (columns: DataColumn[], idOrName: string | undefined) =>
  idOrName === undefined ? undefined : (columns.find((c) => c.id === idOrName) ?? columns.find((c) => normalizeName(c.name) === normalizeName(idOrName)));

export interface RowMergePlan {
  /** All columns after the merge (new ones appended). */
  columns: DataColumn[];
  newColumns: DataColumn[];
  /** Resolved key column id used for matching (undefined = append only). */
  keyColumn?: string;
  /** New rows, in input order. */
  inserts: DataRow[];
  /** Cells to merge into existing rows (one entry per row id, input records combined). */
  updates: { id: string; values: Record<string, string> }[];
  /** Number of input records that matched an existing row. */
  updated: number;
}

/**
 * Plan a merge of incoming records without holding the dataset's rows: the
 * caller passes `existing` (slug(key) -> row id) for the key column, e.g. from
 * a database query, and applies the plan in batches. Same semantics as
 * `mergeRows` (which is built on this): records are keyed by column name or
 * id, unknown columns are added, records with the same key update one row.
 * With `upsert` (default when there is a key column) matching rows are
 * updated; `append` adds everything.
 */
export function planRowMerge(
  columns: DataColumn[],
  records: Record<string, unknown>[],
  opts: { mode?: "append" | "upsert"; keyColumn?: string; existing?: Map<string, string> } = {},
): RowMergePlan {
  const cols = [...columns];
  const newColumns: DataColumn[] = [];
  const taken = new Set(cols.map((c) => c.id));
  const colCache = new Map<string, string>();
  const colFor = (k: string) => {
    let id = colCache.get(k);
    if (id) return id;
    let c = findColumn(cols, k);
    if (!c) {
      c = { id: columnIdFor(k, taken), name: k };
      cols.push(c);
      newColumns.push(c);
    }
    colCache.set(k, c.id);
    return (id = c.id);
  };
  const keyCol = findColumn(cols, opts.keyColumn)?.id;
  const mode = opts.mode ?? (keyCol ? "upsert" : "append");
  const existing = opts.existing ?? new Map<string, string>();
  const fresh = new Map<string, DataRow>();
  const updates = new Map<string, Record<string, string>>();
  const inserts: DataRow[] = [];
  let updated = 0;
  for (const rec of records) {
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) values[colFor(k)] = v === null || v === undefined ? "" : String(v).trim();
    const key = keyCol && mode === "upsert" ? slugify(values[keyCol] ?? "") : "";
    const hitId = key ? existing.get(key) : undefined;
    const hitNew = key && !hitId ? fresh.get(key) : undefined;
    if (hitId) {
      updates.set(hitId, { ...updates.get(hitId), ...values });
      updated++;
    } else if (hitNew) {
      Object.assign(hitNew.values, values);
      updated++;
    } else {
      const row = { id: newRowId(), values };
      inserts.push(row);
      if (key) fresh.set(key, row);
    }
  }
  return { columns: cols, newColumns, keyColumn: keyCol, inserts, updates: [...updates].map(([id, values]) => ({ id, values })), updated };
}
