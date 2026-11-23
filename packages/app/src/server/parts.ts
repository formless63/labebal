/**
 * Library parts repository: shared text styles and reusable components
 * (tables `label_text_styles`, `label_components`). Documents are core's plain
 * JSON shapes (`TextStyle`, `LabelComponent`).
 */
import { asc, eq } from "drizzle-orm";
import type { LabelComponent, LibraryParts, TextStyle } from "@labebal/core";
import { getDb, type DB } from "../db";
import { components, textStyles } from "../db/schema";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function getParts(): Promise<Required<LibraryParts>> {
  const db = await getDb();
  const [s, c] = await Promise.all([db.select().from(textStyles).orderBy(asc(textStyles.name)), db.select().from(components).orderBy(asc(components.name))]);
  return { styles: s.map((r) => r.doc), components: c.map((r) => r.doc) };
}

async function putStyle(tx: Tx | DB, doc: TextStyle, onlyNew = false) {
  const q = tx.insert(textStyles).values({ id: doc.id, name: doc.name, doc });
  await (onlyNew ? q.onConflictDoNothing() : q.onConflictDoUpdate({ target: textStyles.id, set: { name: doc.name, doc, updatedAt: new Date() } }));
}

async function putComponent(tx: Tx | DB, doc: LabelComponent, onlyNew = false) {
  const q = tx.insert(components).values({ id: doc.id, name: doc.name, doc });
  await (onlyNew ? q.onConflictDoNothing() : q.onConflictDoUpdate({ target: components.id, set: { name: doc.name, doc, updatedAt: new Date() } }));
}

export async function upsertStyle(doc: TextStyle) {
  await putStyle(await getDb(), doc);
  return doc;
}

export async function deleteStyle(id: string) {
  const db = await getDb();
  await db.delete(textStyles).where(eq(textStyles.id, id));
}

export async function upsertComponent(doc: LabelComponent) {
  await putComponent(await getDb(), doc);
  return doc;
}

export async function deleteComponent(id: string) {
  const db = await getDb();
  await db.delete(components).where(eq(components.id, id));
}

/**
 * Merge styles and components inside an import: same id = replace (library
 * files), or with `onlyNew` keep the existing ones (shared template files,
 * like their assets).
 */
export async function importParts(tx: Tx | DB, parts: LibraryParts, opts: { onlyNew?: boolean } = {}) {
  for (const s of parts.styles ?? []) await putStyle(tx, s, opts.onlyNew);
  for (const c of parts.components ?? []) await putComponent(tx, c, opts.onlyNew);
  return { styles: parts.styles?.length ?? 0, components: parts.components?.length ?? 0 };
}
