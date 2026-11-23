/** Zod schemas for datasets, runs, history and the public v1 API. */
import { z } from "zod";
import type { Dataset, RuleSet } from "@labebal/core";
import type { DatasetPatch, RowQuery } from "./datasets";

const id = z.string().min(1).max(200);
const str = z.string().max(10_000);

const condition = z.object({
  column: z.string().max(200),
  op: z.enum(["equals", "contains", "startsWith", "endsWith", "regex", "isEmpty"]),
  value: z.string().max(1000).optional(),
  not: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
});

const rule = z.object({
  id,
  name: z.string().max(200).optional(),
  disabled: z.boolean().optional(),
  when: condition,
  then: z.object({
    values: z.record(z.string(), str).optional(),
    overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    templateId: id.optional(),
    invert: z.boolean().optional(),
  }),
});

/** A rule set (dataset links and template-level rules). */
export const ruleSetSchema = z.object({ mode: z.enum(["first", "all"]), rules: z.array(rule).max(500) }) as unknown as z.ZodType<RuleSet>;

const columns = z.array(z.object({ id, name: z.string().max(200) })).max(200);
const link = z.object({
  templateId: id,
  fields: z.record(z.string(), z.string()),
  keyColumn: z.string().optional(),
  nameColumn: z.string().optional(),
  idPrefix: z.string().min(1).max(100),
  rules: ruleSetSchema,
});
const dataRow = z.object({ id, values: z.record(z.string(), str) });

export const datasetSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  columns,
  rows: z.array(dataRow).max(50_000),
  link: link.optional(),
  updatedAt: z.string().optional(),
}) as unknown as z.ZodType<Dataset>;

/** PATCH /api/datasets/:id: metadata only (rows have their own endpoints). */
export const datasetPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  columns: columns.optional(),
  link: link.nullable().optional(),
}) as unknown as z.ZodType<DatasetPatch>;

const rowFilter = z.object({
  q: z.string().max(500).optional(),
  column: z.string().max(200).optional(),
  excludeIds: z.array(z.string().max(200)).max(50_000).optional(),
});

/** Rows to act on: `rowIds`, or a `filter` (all matching rows), or nothing (all rows). */
export const applySchema = z.object({ rowIds: z.array(z.string()).max(50_000).optional(), filter: rowFilter.optional() });

/** POST /api/datasets/:id/rows (browser import / add row). */
export const rowsAddSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(50_000),
  mode: z.enum(["append", "upsert"]).optional(),
  key: z.string().max(200).optional(),
});

/** PATCH /api/datasets/:id/rows: `{ updates: [{ id, values }] }` merges cells. */
export const rowsPatchSchema = z.object({ updates: z.array(z.object({ id, values: z.record(z.string(), str) })).min(1).max(50_000) });

/** PATCH /api/datasets/:id/rows/:rowId */
export const rowPatchSchema = z.object({ values: z.record(z.string(), str) });

/** PUT /api/datasets/:id/rows/:rowId/cells/:column */
export const cellSchema = z.object({ value: z.union([str, z.number(), z.boolean()]).transform(String) });

/** DELETE /api/datasets/:id/rows */
export const rowsDeleteSchema = z.union([z.object({ rowIds: z.array(z.string()).min(1).max(50_000) }), z.object({ filter: rowFilter })]);

/** Query string of GET .../rows: ?q=&column=&sort=&dir=&offset=&limit=&ids=a,b */
export function parseRowQuery(p: URLSearchParams): RowQuery {
  const get = (k: string) => p.get(k) || undefined;
  const num = (k: string) => (get(k) !== undefined && Number.isFinite(Number(get(k))) ? Number(get(k)) : undefined);
  return {
    q: get("q"),
    column: get("column"),
    sort: get("sort"),
    dir: get("dir") === "desc" ? "desc" : "asc",
    offset: num("offset"),
    limit: get("limit") === "all" ? 50_000 : num("limit"),
    ids: get("ids")?.split(",").filter(Boolean),
  };
}

export const runSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  notes: z.string().max(5000).default(""),
  items: z.array(z.object({ labelId: id, qty: z.number().int().min(0).max(9999) })).max(5000),
});

export const boardSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  notes: z.string().max(5000).default(""),
  tiles: z.array(z.object({ labelId: id, sizeId: z.string().min(1).max(100), qty: z.number().int().min(1).max(999) })).max(500),
});

export const historySchema = z.object({
  source: z.string().max(200).default(""),
  printer: z.string().max(100),
  sizeId: z.string().max(100),
  sizeName: z.string().max(100),
  material: z.string().max(100),
  ribbon: z.string().max(100),
  density: z.number().int().nullable().default(null),
  invertAll: z.boolean().default(false),
  client: z.string().max(200).default(""),
  who: z.string().trim().max(100).default(""),
  // counter ranges + print-time form answers.
  counters: z
    .array(z.object({ counter: z.string().max(64), key: z.string().max(1000), from: z.number().int(), to: z.number().int(), labelId: z.string().max(200).optional(), format: z.string().max(100).optional() }))
    .max(10_000)
    .optional(),
  printValues: z.record(z.string().max(200), z.record(z.string().max(200), z.string().max(2000))).optional(),
  // run outcome (status, printed, total, nextLabel, printer...).
  outcome: z.record(z.string(), z.unknown()).optional(),
  items: z
    .array(
      z.object({
        labelId: z.string().max(200),
        name: z.string().max(500),
        templateId: z.string().max(200),
        templateName: z.string().max(500).optional(),
        qty: z.number().int().min(0).max(100_000),
        invert: z.boolean(),
      }),
    )
    .min(1)
    .max(5000),
});

export const tokenCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });

/* ------------------------------------------------------------- public v1 */

const v1Label = z
  .object({
    id: id.optional(),
    templateId: id,
    /** Record key (SKU...): id becomes `l-<template>-<key>` when no id is given. */
    key: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(500).optional(),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String)).default({}),
    overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    invert: z.boolean().optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
  })
  .refine((l) => l.id || l.key, { message: "give either id or key" });

export type V1Label = z.infer<typeof v1Label>;

/** Either `{ labels: [...] }` or a single label object. `merge` keeps existing values not given. */
export const v1LabelsSchema = z.union([
  z.object({ labels: z.array(v1Label).min(1).max(5000), merge: z.boolean().default(false) }),
  v1Label.transform((l) => ({ labels: [l], merge: false })),
]);

export const v1RowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(50_000),
  /** upsert (default when the dataset has a key column): update rows with the same key. */
  mode: z.enum(["append", "upsert"]).optional(),
  /** Key column (name or id); defaults to the dataset's linked key column. */
  key: z.string().max(200).optional(),
  /** Also create/update the labels for the dataset afterwards. */
  applyLabels: z.boolean().default(false),
});
