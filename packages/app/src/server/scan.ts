/**
 * Scan lookup: find labels and dataset rows for a scanned code (camera or
 * keyboard-wedge USB scanner). Matches, best first: label id, a label value
 * equal to the code, dataset rows with a cell equal to the code (exact,
 * case-insensitive, trimmed). Falls back to "contains" when nothing is exact.
 */
import { eq, ilike, inArray, or, sql } from "drizzle-orm";
import { labelIdForRow } from "@labebal/core";
import { getDb } from "../db";
import { datasetRows, datasets, labels, templates } from "../db/schema";

export interface ScanLabelHit {
  id: string;
  name: string;
  templateId: string;
  templateName?: string;
  match: "id" | "value" | "name" | "contains";
}

export interface ScanRowHit {
  datasetId: string;
  datasetName: string;
  rowId: string;
  /** First few cells (column name -> value). */
  preview: Record<string, string>;
  /** Column (name) that matched. */
  column?: string;
  /** The label this row maps to, when the dataset is linked (it may not exist yet). */
  labelId?: string;
  labelExists: boolean;
  match: "exact" | "contains";
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function scanLookup(raw: string, limit = 20): Promise<{ q: string; labels: ScanLabelHit[]; rows: ScanRowHit[] }> {
  const q = raw.trim();
  if (!q) return { q, labels: [], rows: [] };
  const db = await getDb();
  const lower = q.toLowerCase();

  const exactLabels = await db
    .select({ id: labels.id, name: labels.name, templateId: labels.templateId, values: labels.values })
    .from(labels)
    .where(
      or(
        eq(labels.id, q),
        sql`lower(${labels.name}) = ${lower}`,
        sql`exists (select 1 from jsonb_each_text(${labels.values}) as v where lower(trim(v.value)) = ${lower})`,
      ),
    )
    .limit(limit);
  const like = `%${escapeLike(q)}%`;
  const fuzzyLabels = exactLabels.length
    ? []
    : await db
        .select({ id: labels.id, name: labels.name, templateId: labels.templateId, values: labels.values })
        .from(labels)
        .where(or(ilike(labels.id, like), ilike(labels.name, like), sql`exists (select 1 from jsonb_each_text(${labels.values}) as v where v.value ilike ${like})`))
        .limit(limit);

  const exactRows = await db
    .select({ datasetId: datasetRows.datasetId, id: datasetRows.id, cells: datasetRows.cells })
    .from(datasetRows)
    .where(or(eq(datasetRows.id, q), sql`exists (select 1 from jsonb_each_text(${datasetRows.cells}) as c where lower(trim(c.value)) = ${lower})`))
    .limit(limit);
  const fuzzyRows = exactRows.length
    ? []
    : await db
        .select({ datasetId: datasetRows.datasetId, id: datasetRows.id, cells: datasetRows.cells })
        .from(datasetRows)
        .where(sql`exists (select 1 from jsonb_each_text(${datasetRows.cells}) as c where c.value ilike ${like})`)
        .limit(limit);

  const rowHits = [...exactRows.map((r) => ({ ...r, match: "exact" as const })), ...fuzzyRows.map((r) => ({ ...r, match: "contains" as const }))];
  const dsIds = [...new Set(rowHits.map((r) => r.datasetId))];
  const dss = dsIds.length ? await db.select().from(datasets).where(inArray(datasets.id, dsIds)) : [];
  const dsMap = new Map(dss.map((d) => [d.id, d]));
  const rowLabelIds = new Map<string, string>();
  for (const r of rowHits) {
    const d = dsMap.get(r.datasetId);
    if (d?.link) rowLabelIds.set(`${r.datasetId}/${r.id}`, labelIdForRow(d.link, { id: r.id, values: r.cells }));
  }
  const wantedIds = [...new Set(rowLabelIds.values())];
  const existing = new Set(wantedIds.length ? (await db.select({ id: labels.id }).from(labels).where(inArray(labels.id, wantedIds))).map((l) => l.id) : []);

  const labelRows = [...exactLabels, ...fuzzyLabels];
  const tids = [...new Set(labelRows.map((l) => l.templateId))];
  const tmap = new Map(tids.length ? (await db.select({ id: templates.id, name: templates.name }).from(templates).where(inArray(templates.id, tids))).map((t) => [t.id, t.name]) : []);

  const labelHits: ScanLabelHit[] = labelRows.map((l) => ({
    id: l.id,
    name: l.name,
    templateId: l.templateId,
    templateName: tmap.get(l.templateId),
    match: fuzzyLabels.includes(l) ? "contains" : l.id === q ? "id" : l.name.toLowerCase() === lower ? "name" : "value",
  }));
  const order = { id: 0, value: 1, name: 2, contains: 3 };
  labelHits.sort((a, b) => order[a.match] - order[b.match]);

  return {
    q,
    labels: labelHits,
    rows: rowHits.map((r) => {
      const d = dsMap.get(r.datasetId);
      const cols = d?.columns ?? [];
      const hitCol = cols.find((c) => (r.cells[c.id] ?? "").trim().toLowerCase() === lower) ?? cols.find((c) => (r.cells[c.id] ?? "").toLowerCase().includes(lower));
      const labelId = rowLabelIds.get(`${r.datasetId}/${r.id}`);
      return {
        datasetId: r.datasetId,
        datasetName: d?.name ?? r.datasetId,
        rowId: r.id,
        preview: Object.fromEntries(cols.slice(0, 5).map((c) => [c.name, r.cells[c.id] ?? ""])),
        ...(hitCol ? { column: hitCol.name } : {}),
        ...(labelId ? { labelId } : {}),
        labelExists: !!labelId && existing.has(labelId),
        match: r.match,
      };
    }),
  };
}
