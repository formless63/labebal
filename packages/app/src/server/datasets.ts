/**
 * Dataset repository. Dataset metadata (name, columns, link + rules) is one
 * row in `label_datasets`; rows live in `label_dataset_rows` (one row each,
 * cells as JSONB) so datasets scale to thousands of rows: the browser pages
 * and filters them, edits patch single rows / cells, imports upsert in
 * batches. Label building is the shared core code (`datasetToLabels`), so the
 * browser preview and what gets saved are identical.
 */
import { and, asc, count, desc, eq, inArray, max, notInArray, sql, type SQL } from "drizzle-orm";
import { datasetToLabels, planRowMerge, slugify, type DataColumn, type DataRow, type Dataset, type DatasetLink, type Label } from "@labebal/core";
import { getDb, type DB } from "../db";
import { datasetRows, datasets, labels, templates } from "../db/schema";
import { hiddenIds, packMembership } from "./pack-overlay";

/** Rows written per statement (keeps parameter counts well under Postgres' limit). */
const BATCH = 500;

export interface DatasetSummary {
  id: string;
  name: string;
  columns: number;
  rows: number;
  templateId?: string;
  updatedAt: string;
}

/** A dataset without its rows. */
export interface DatasetMeta {
  id: string;
  name: string;
  columns: DataColumn[];
  link?: DatasetLink;
  rowCount: number;
  updatedAt: string;
}

/** Which rows an operation applies to: explicit ids, or everything matching a filter (minus some). */
export interface RowFilter {
  /** Text contained in any cell (or in `column` when given), case-insensitive. */
  q?: string;
  column?: string;
  /** Rows to leave out ("all matching except these"). */
  excludeIds?: string[];
}

export type RowSelection = { rowIds: string[] } | { filter: RowFilter } | Record<string, never>;

export interface RowQuery extends RowFilter {
  /** Column id to sort by (default: row order). */
  sort?: string;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
  /** Only these rows (in row order). */
  ids?: string[];
}

export interface RowPage {
  total: number;
  offset: number;
  rows: DataRow[];
}

type MetaRow = typeof datasets.$inferSelect;

const toMeta = (r: MetaRow, rowCount: number): DatasetMeta => ({
  id: r.id,
  name: r.name,
  columns: r.columns,
  ...(r.link ? { link: r.link } : {}),
  rowCount,
  updatedAt: r.updatedAt.toISOString(),
});

const toRow = (r: { id: string; cells: Record<string, string> }): DataRow => ({ id: r.id, values: r.cells });

const chunks = <T>(xs: T[], n = BATCH) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** SQL conditions for a filter (dataset id included). */
function filterWhere(id: string, f: RowFilter = {}): SQL {
  const where: SQL[] = [eq(datasetRows.datasetId, id)];
  const q = f.q?.trim();
  if (q) {
    const like = escapeLike(q);
    where.push(
      f.column
        ? sql`coalesce(${datasetRows.cells}->>${f.column}, '') ilike ${like}`
        : sql`exists (select 1 from jsonb_each_text(${datasetRows.cells}) as c where c.value ilike ${like})`,
    );
  }
  if (f.excludeIds?.length) where.push(notInArray(datasetRows.id, f.excludeIds));
  return and(...where)!;
}

async function countRows(db: DB, id: string) {
  const [r] = await db.select({ n: count() }).from(datasetRows).where(eq(datasetRows.datasetId, id));
  return r?.n ?? 0;
}

const touch = (db: DB, id: string) => db.update(datasets).set({ updatedAt: new Date() }).where(eq(datasets.id, id));

/** Insert rows after the current last row, in batches. */
async function insertRows(db: DB, id: string, rows: DataRow[]) {
  if (!rows.length) return;
  const [m] = await db.select({ p: max(datasetRows.position) }).from(datasetRows).where(eq(datasetRows.datasetId, id));
  let pos = (m?.p ?? -1) + 1;
  for (const part of chunks(rows)) await db.insert(datasetRows).values(part.map((r) => ({ datasetId: id, id: r.id, position: pos++, cells: r.values })));
}

/** Merge cells into existing rows (one statement per batch). */
async function mergeCells(db: DB, id: string, updates: { id: string; values: Record<string, string> }[]) {
  for (const part of chunks(updates))
    await db.execute(sql`
      update ${datasetRows} as r set cells = r.cells || u.v, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(part.map((u) => ({ id: u.id, v: u.values })))}::jsonb) as u(id text, v jsonb)
      where r.dataset_id = ${id} and r.id = u.id`);
}

/** Dataset seeds, inserted when their template is first seeded (so deleting the sample sticks). */
export async function listDatasets(): Promise<DatasetSummary[]> {
  const db = await getDb();
  const counts = db.select({ datasetId: datasetRows.datasetId, n: count().as("n") }).from(datasetRows).groupBy(datasetRows.datasetId).as("counts");
  const rs = await db
    .select({ d: datasets, n: counts.n })
    .from(datasets)
    .leftJoin(counts, eq(counts.datasetId, datasets.id))
    .orderBy(asc(datasets.name));
  // Datasets of disabled packs are hidden like their templates.
  const hidden = hiddenIds(await packMembership(db)).dataset;
  return rs.filter(({ d }) => !hidden.has(d.id)).map(({ d, n }) => ({
    id: d.id,
    name: d.name,
    columns: d.columns.length,
    rows: n ?? 0,
    ...(d.link ? { templateId: d.link.templateId } : {}),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export async function getDatasetMeta(id: string): Promise<DatasetMeta | undefined> {
  const db = await getDb();
  const [r] = await db.select().from(datasets).where(eq(datasets.id, id));
  return r && toMeta(r, await countRows(db, id));
}

/** Rows in order (all, or the given ids / filter). */
async function loadRows(db: DB, id: string, sel: RowSelection = {}): Promise<DataRow[]> {
  const where = "rowIds" in sel ? and(eq(datasetRows.datasetId, id), inArray(datasetRows.id, sel.rowIds)) : filterWhere(id, "filter" in sel ? sel.filter : {});
  if ("rowIds" in sel && !sel.rowIds.length) return [];
  const rs = await db.select({ id: datasetRows.id, cells: datasetRows.cells }).from(datasetRows).where(where).orderBy(asc(datasetRows.position));
  return rs.map(toRow);
}

/** The whole dataset, rows included (exports, full replace). */
export async function getDataset(id: string): Promise<Dataset | undefined> {
  const db = await getDb();
  const [r] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!r) return undefined;
  const rows = await loadRows(db, id);
  return { id: r.id, name: r.name, columns: r.columns, ...(r.link ? { link: r.link } : {}), rows, updatedAt: r.updatedAt.toISOString() };
}

/** Create or replace a dataset, rows included. */
export async function saveDataset(d: Dataset): Promise<DatasetMeta> {
  const db = await getDb();
  await writeDataset(db, d);
  return (await getDatasetMeta(d.id))!;
}

/** saveDataset on a given connection (pack installs). */
export async function writeDataset(db: DB, d: Dataset) {
  const meta = { id: d.id, name: d.name, columns: d.columns, link: d.link ?? null };
  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await t
      .insert(datasets)
      .values(meta)
      .onConflictDoUpdate({ target: datasets.id, set: { ...meta, updatedAt: new Date() } });
    await t.delete(datasetRows).where(eq(datasetRows.datasetId, d.id));
    const seen = new Set<string>();
    await insertRows(t, d.id, d.rows.filter((r) => !seen.has(r.id) && seen.add(r.id)));
  });
}

export interface DatasetPatch {
  name?: string;
  columns?: DataColumn[];
  /** null unlinks. */
  link?: DatasetLink | null;
}

/** Change name / columns / link without touching rows. Cells of removed columns are dropped. */
export async function patchDataset(id: string, p: DatasetPatch): Promise<DatasetMeta | undefined> {
  const db = await getDb();
  const [cur] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!cur) return undefined;
  const set: Partial<typeof datasets.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name;
  if (p.columns) set.columns = p.columns;
  if (p.link !== undefined) set.link = p.link;
  await db.update(datasets).set(set).where(eq(datasets.id, id));
  if (p.columns) {
    const keep = new Set(p.columns.map((c) => c.id));
    const gone = cur.columns.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if (gone.length)
      await db.execute(
        sql`update ${datasetRows} set cells = cells - array[${sql.join(
          gone.map((g) => sql`${g}`),
          sql`, `,
        )}]::text[], updated_at = now() where dataset_id = ${id}`,
      );
  }
  return getDatasetMeta(id);
}

export async function deleteDataset(id: string) {
  const db = await getDb();
  await db.delete(datasets).where(eq(datasets.id, id));
}

/** A page of rows: filtered, sorted, offset/limit. */
export async function queryRows(id: string, q: RowQuery = {}): Promise<RowPage> {
  const db = await getDb();
  let where = filterWhere(id, q);
  if (q.ids) where = and(where, q.ids.length ? inArray(datasetRows.id, q.ids) : sql`false`)!;
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 50_000);
  const dir = q.dir === "desc" ? desc : asc;
  // Natural, case-insensitive order ("A2" before "A10", "M3 × 8" before "M3 × 12"):
  // text before the first number, that number, text up to the second number,
  // that number, then the whole value; row order breaks ties.
  const v = sql`lower(coalesce(${datasetRows.cells}->>${q.sort ?? ""}, ''))`;
  const num = (re: string) => sql`nullif(substring(${v} from ${re}), '')::numeric`;
  const order = q.sort
    ? [
        dir(sql`substring(${v} from '^[^0-9]*')`),
        dir(num("^[^0-9]*([0-9]{1,15})")),
        dir(sql`substring(${v} from '^[^0-9]*[0-9]+([^0-9]*)')`),
        dir(num("^[^0-9]*[0-9]+[^0-9]*([0-9]{1,15})")),
        dir(v),
        dir(datasetRows.position),
      ]
    : [dir(datasetRows.position)];
  const [rs, [tot]] = await Promise.all([
    db
      .select({ id: datasetRows.id, cells: datasetRows.cells })
      .from(datasetRows)
      .where(where)
      .orderBy(...order)
      .offset(offset)
      .limit(limit),
    db.select({ n: count() }).from(datasetRows).where(where),
  ]);
  return { total: tot?.n ?? 0, offset, rows: rs.map(toRow) };
}

export interface AddRowsResult {
  added: number;
  updated: number;
  /** Rows in the dataset afterwards. */
  rows: number;
  /** Ids of the added rows (input order). */
  ids: string[];
  /** Columns added because records had unknown keys. */
  newColumns: DataColumn[];
}

/**
 * Append / upsert records (objects keyed by column name or id). With a key
 * column, records whose key matches a row update only the cells they carry.
 * Works in batches; the existing rows are never loaded, only their keys.
 */
export async function addRows(id: string, records: Record<string, unknown>[], opts: { mode?: "append" | "upsert"; keyColumn?: string } = {}): Promise<AddRowsResult | undefined> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [d] = await t.select().from(datasets).where(eq(datasets.id, id));
    if (!d) return undefined;
    const keyName = opts.keyColumn ?? d.link?.keyColumn;
    const probe = planRowMerge(d.columns, [], { keyColumn: keyName });
    const existing = new Map<string, string>();
    if (probe.keyColumn && opts.mode !== "append") {
      const keys = await t
        .select({ id: datasetRows.id, k: sql<string | null>`${datasetRows.cells}->>${probe.keyColumn}` })
        .from(datasetRows)
        .where(eq(datasetRows.datasetId, id))
        .orderBy(asc(datasetRows.position));
      for (const r of keys) if (r.k) existing.set(slugify(r.k), r.id);
    }
    const plan = planRowMerge(d.columns, records, { mode: opts.mode, keyColumn: keyName, existing });
    if (plan.newColumns.length) await t.update(datasets).set({ columns: plan.columns }).where(eq(datasets.id, id));
    await insertRows(t, id, plan.inserts);
    await mergeCells(t, id, plan.updates);
    await touch(t, id);
    return { added: plan.inserts.length, updated: plan.updated, rows: await countRows(t, id), ids: plan.inserts.map((r) => r.id), newColumns: plan.newColumns };
  });
}

/** Merge cells into rows by id (per-row / per-cell edits). Returns how many rows exist of those given. */
export async function patchRows(id: string, updates: { id: string; values: Record<string, string> }[]): Promise<number> {
  const db = await getDb();
  if (!updates.length) return 0;
  const ids = [...new Set(updates.map((u) => u.id))];
  const found = await db
    .select({ id: datasetRows.id })
    .from(datasetRows)
    .where(and(eq(datasetRows.datasetId, id), inArray(datasetRows.id, ids)));
  await mergeCells(db, id, updates);
  await touch(db, id);
  return found.length;
}

/** Delete rows by id, or everything matching a filter. Returns the number deleted. */
export async function deleteRows(id: string, sel: { rowIds: string[] } | { filter: RowFilter }): Promise<number> {
  const db = await getDb();
  const where = "rowIds" in sel ? and(eq(datasetRows.datasetId, id), inArray(datasetRows.id, sel.rowIds.length ? sel.rowIds : [""]))! : filterWhere(id, sel.filter);
  const gone = await db.delete(datasetRows).where(where).returning({ id: datasetRows.id });
  await touch(db, id);
  return gone.length;
}

export interface ApplyResult {
  created: number;
  updated: number;
  labelIds: string[];
  skipped: { rowId: string; reason: string }[];
}

/**
 * Create / update one label per row (all rows, the given row ids, or the rows
 * matching a filter). Label ids come from the key column, so running this
 * again updates the same labels. Field values and overrides from the dataset
 * replace the label's; other label properties set by hand (e.g. invert) are
 * kept unless a rule sets them. Labels are written in batches.
 */
export async function applyDatasetLabels(id: string, sel: RowSelection = {}): Promise<ApplyResult | undefined> {
  const db = await getDb();
  const [d] = await db.select().from(datasets).where(eq(datasets.id, id));
  if (!d) return undefined;
  if (!d.link) throw new Error("Link this dataset to a template first");
  const tpls = await db.select({ id: templates.id }).from(templates);
  const rows = await loadRows(db, id, sel);
  const built = datasetToLabels({ id: d.id, name: d.name, columns: d.columns, rows, link: d.link }, rows, tpls);
  const skipped: ApplyResult["skipped"] = [];
  const wanted = new Map<string, Label>();
  for (const b of built) {
    const fatal = b.problems.find((p) => p.startsWith("Template"));
    if (fatal) skipped.push({ rowId: b.row.id, reason: fatal });
    else wanted.set(b.label.id, b.label);
  }
  const ids = [...wanted.keys()];
  const have = new Map<string, { invert: boolean | null; tags: string[] }>();
  for (const part of chunks(ids))
    for (const e of await db.select({ id: labels.id, invert: labels.invert, tags: labels.tags }).from(labels).where(inArray(labels.id, part))) have.set(e.id, e);
  const now = new Date();
  const values = [...wanted.values()].map((l) => {
    const prev = have.get(l.id);
    return {
      id: l.id,
      templateId: l.templateId,
      name: l.name,
      values: l.values,
      overrides: l.overrides ?? null,
      invert: l.invert ?? prev?.invert ?? null,
      tags: [...new Set([...(prev?.tags ?? []), ...(l.tags ?? [])])],
      updatedAt: now,
    };
  });
  await db.transaction(async (tx) => {
    for (const part of chunks(values))
      await tx
        .insert(labels)
        .values(part)
        .onConflictDoUpdate({
          target: labels.id,
          set: {
            templateId: sql`excluded.template_id`,
            name: sql`excluded.name`,
            values: sql`excluded.values`,
            overrides: sql`excluded.overrides`,
            invert: sql`excluded.invert`,
            tags: sql`excluded.tags`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
  });
  return { created: ids.length - have.size, updated: have.size, labelIds: ids, skipped };
}

export interface DuplicateKey {
  value: string;
  count: number;
  rowIds: string[];
}

/**
 * Values of a column shared by more than one row, across the whole dataset.
 * With a key column these rows would map to the same label (the last wins).
 * Empty values are reported too: rows with no key can't be told apart.
 */
export async function duplicateKeys(id: string, column: string, limit = 50): Promise<DuplicateKey[]> {
  const db = await getDb();
  // Key computed once in a subquery, so GROUP BY sees a single expression.
  const res = await db.execute(sql`
    select k as value, count(*)::int as n, (array_agg(id order by position))[1:20] as ids
    from (select trim(coalesce(${datasetRows.cells}->>${column}, '')) as k, ${datasetRows.id} as id, ${datasetRows.position} as position
          from ${datasetRows} where ${datasetRows.datasetId} = ${id}) t
    group by k having count(*) > 1 order by count(*) desc, k limit ${limit}`);
  // PGlite returns { rows }, postgres-js returns the rows array.
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as { value: string; n: number; ids: string[] | null }[];
  return rows.map((r) => ({ value: r.value, count: Number(r.n), rowIds: r.ids ?? [] }));
}

/** Replace all rows with `records` (keyed by column name / id) in one transaction; unknown columns are added. Used by "replace" syncs. */
export async function replaceRows(id: string, records: Record<string, unknown>[]): Promise<(AddRowsResult & { removed: number }) | undefined> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [d] = await t.select().from(datasets).where(eq(datasets.id, id));
    if (!d) return undefined;
    const before = await countRows(t, id);
    const plan = planRowMerge(d.columns, records, { mode: "append" });
    if (plan.newColumns.length) await t.update(datasets).set({ columns: plan.columns }).where(eq(datasets.id, id));
    await t.delete(datasetRows).where(eq(datasetRows.datasetId, id));
    await insertRows(t, id, plan.inserts);
    await touch(t, id);
    return { added: plan.inserts.length, updated: 0, removed: before, rows: plan.inserts.length, ids: plan.inserts.map((r) => r.id), newColumns: plan.newColumns };
  });
}
