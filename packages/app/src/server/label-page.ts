/**
 * Label pages (`/l/<id>`): one label's record for its QR code. Reads the
 * label, its template, the dataset row it came from, notes and print history.
 */
import { eq } from "drizzle-orm";
import { labelContext, resolveLabel, resolveTemplate, type Template } from "@labebal/core";
import { getDb } from "../db";
import { datasetRows, datasets, labelNotes, labels, templates } from "../db/schema";
import { datasetOfLabel, fieldRows, linkFor, normalizedHttpUrl, rowForLabel, type LabelPageData } from "../features/label-page/model";
import { listHistory } from "./history";
import { getParts } from "./parts";
import { env, host } from "./host";

const FOLDER_TAG = "folder:";
const folderOf = (tags: string[]) =>
  (tags.find((t) => t.startsWith(FOLDER_TAG))?.slice(FOLDER_TAG.length) ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");

/** Public URL of the app (host option `publicUrl`, else `LABEBAL_PUBLIC_URL`), undefined when not set. */
export const publicUrlFromEnv = () => (host().publicUrl ?? env().LABEBAL_PUBLIC_URL)?.trim().replace(/\/+$/, "") || undefined;

export async function getLabelPage(id: string, baseUrl: string): Promise<LabelPageData | null> {
  const db = await getDb();
  const [l] = await db.select().from(labels).where(eq(labels.id, id));
  if (!l) return null;
  const [t] = await db.select({ doc: templates.doc }).from(templates).where(eq(templates.id, l.templateId));
  if (!t) return null;
  // Components expanded and text styles applied here, so the page renders without loading the library.
  const template: Template = resolveTemplate(t.doc, await getParts());
  const label = {
    id: l.id,
    templateId: l.templateId,
    name: l.name,
    values: l.values,
    ...(l.overrides ? { overrides: l.overrides } : {}),
    ...(l.invert !== null ? { invert: l.invert } : {}),
    ...(l.tags.length ? { tags: l.tags } : {}),
  };

  // Values as printed: field defaults, then the label, then template rules.
  const resolved = resolveLabel(template, label) ?? label;
  const values = { ...Object.fromEntries(template.fields.map((f) => [f.key, f.default ?? ""])), ...resolved.values };
  const ctx = labelContext(template, label, values, { baseUrl });
  const recordUrl = normalizedHttpUrl(ctx.recordUrl);

  const [source, notes, prints] = await Promise.all([
    (async (): Promise<LabelPageData["source"]> => {
      const dsId = datasetOfLabel(label);
      if (!dsId) return undefined;
      const [d] = await db.select().from(datasets).where(eq(datasets.id, dsId));
      if (!d?.link) return undefined;
      const rows = await db.select({ id: datasetRows.id, cells: datasetRows.cells }).from(datasetRows).where(eq(datasetRows.datasetId, dsId));
      const row = rowForLabel(d.link, id, rows.map((r) => ({ id: r.id, values: r.cells })));
      if (!row) return undefined;
      return {
        datasetId: d.id,
        datasetName: d.name,
        rowId: row.id,
        cells: d.columns.map((c) => {
          const value = row.values[c.id] ?? "";
          const href = linkFor(value);
          return href ? { name: c.name, value, href } : { name: c.name, value };
        }),
      };
    })(),
    db.select().from(labelNotes).where(eq(labelNotes.labelId, id)),
    listHistory({ labelId: id, voided: "exclude", limit: 5 }),
  ]);

  return {
    label,
    template,
    folder: folderOf(l.tags),
    fields: fieldRows(template, resolved.values),
    url: `${baseUrl}/l/${encodeURIComponent(id)}`,
    ...(recordUrl ? { recordUrl } : {}),
    ...(source ? { source } : {}),
    notes: notes[0] ? { text: notes[0].notes, updatedBy: notes[0].updatedBy, updatedAt: notes[0].updatedAt.toISOString() } : null,
    prints: prints.map((h) => ({
      historyId: h.id,
      printedAt: h.printedAt,
      who: h.who,
      printer: h.printer,
      sizeName: h.sizeName,
      qty: h.items.filter((i) => i.labelId === id).reduce((a, i) => a + i.qty, 0),
    })),
  };
}

/** Save a label's notes ("" clears them). Null when the label does not exist. */
export async function setLabelNotes(id: string, text: string, who: string): Promise<LabelPageData["notes"]> {
  const db = await getDb();
  const [l] = await db.select({ id: labels.id }).from(labels).where(eq(labels.id, id));
  if (!l) return null;
  if (!text.trim()) {
    await db.delete(labelNotes).where(eq(labelNotes.labelId, id));
    return { text: "", updatedBy: who, updatedAt: new Date().toISOString() };
  }
  const now = new Date();
  const [r] = await db
    .insert(labelNotes)
    .values({ labelId: id, notes: text, updatedBy: who, updatedAt: now })
    .onConflictDoUpdate({ target: labelNotes.labelId, set: { notes: text, updatedBy: who, updatedAt: now } })
    .returning();
  return { text: r.notes, updatedBy: r.updatedBy, updatedAt: r.updatedAt.toISOString() };
}
