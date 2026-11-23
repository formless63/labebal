/**
 * Template version history. Every save goes through `snapshotOnSave`: saves in
 * one editing session (same person, less than SESSION_MS since the last save)
 * roll into the newest automatic snapshot, anything else starts a new version.
 * "Save version" (`saveVersion`) pins the current state under a name.
 */
import { getIdentity } from "./identity";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Template } from "@labebal/core";
import { getDb, type DB } from "../db";
import { templates, templateVersions } from "../db/schema";

/**
 * Who made a change: the proxy's signed-in user (`Remote-User`), else the
 * browser's name from Settings > You (`x-labebal-who`, URI-encoded).
 */
export function whoFrom(req: Request): string {
  // Signed in through the reverse proxy (identity): that wins over the per-browser name.
  const me = getIdentity(req);
  if (me.signedIn) return me.display.slice(0, 100);
  try {
    return decodeURIComponent(req.headers.get("x-labebal-who") ?? "").trim().slice(0, 100);
  } catch {
    return "";
  }
}

/** Gap between saves that starts a new editing session. */
export const SESSION_MS = 30 * 60_000;

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  name: string;
  note: string;
  auto: boolean;
  who: string;
  createdAt: string;
  updatedAt: string;
  doc?: Template;
}

type Row = typeof templateVersions.$inferSelect;
const toVersion = (r: Row, withDoc = true): TemplateVersion => ({
  id: r.id,
  templateId: r.templateId,
  version: r.version,
  name: r.name,
  note: r.note,
  auto: r.auto,
  who: r.who,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  ...(withDoc ? { doc: r.doc } : {}),
});

/** Structural equality of two documents (key order ignored). */
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

async function latest(db: Tx, templateId: string) {
  const [r] = await db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(desc(templateVersions.version)).limit(1);
  return r as Row | undefined;
}

async function insertVersion(db: Tx, doc: Template, v: { version: number; note?: string; auto?: boolean; who?: string }) {
  const [r] = await db
    .insert(templateVersions)
    .values({ id: `v-${crypto.randomUUID()}`, templateId: doc.id, version: v.version, name: doc.name, doc, note: v.note ?? "", auto: v.auto ?? true, who: v.who ?? "" })
    .returning();
  return r;
}

/** Record a saved document: roll into the current session's snapshot or start a new version. */
export async function snapshotOnSave(doc: Template, who = "", db?: Tx, previous?: Template) {
  db ??= await getDb();
  let last = await latest(db, doc.id);
  // First save of a template that has no history yet (seeded / imported earlier): keep what it was.
  if (!last && previous && !same(previous, doc)) last = await insertVersion(db, previous, { version: 1, note: "Before first edit", auto: false });
  if (last && same(last.doc, doc)) return toVersion(last, false);
  const now = Date.now();
  if (last && last.auto && last.who === who && now - last.updatedAt.getTime() < SESSION_MS) {
    const [r] = await db.update(templateVersions).set({ doc, name: doc.name, updatedAt: new Date(now) }).where(eq(templateVersions.id, last.id)).returning();
    return toVersion(r, false);
  }
  return toVersion(await insertVersion(db, doc, { version: (last?.version ?? 0) + 1, who }), false);
}

/** "Save version": pin the template's current saved state under a name. */
export async function saveVersion(templateId: string, note: string, who = ""): Promise<TemplateVersion | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, templateId));
    if (!t) return null;
    const last = await latest(tx, templateId);
    // The rolling snapshot already holds this state: turn it into the named version.
    if (last && last.auto && same(last.doc, t.doc)) {
      const [r] = await tx.update(templateVersions).set({ note, auto: false, who: who || last.who, updatedAt: new Date() }).where(eq(templateVersions.id, last.id)).returning();
      return toVersion(r);
    }
    return toVersion(await insertVersion(tx, t.doc, { version: (last?.version ?? 0) + 1, note, auto: false, who }));
  });
}

export async function listVersions(templateId: string, opts: { withDocs?: boolean; limit?: number } = {}): Promise<TemplateVersion[]> {
  const db = await getDb();
  const rs = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 1000));
  return rs.map((r) => toVersion(r, opts.withDocs ?? true));
}

export async function getVersion(templateId: string, versionId: string): Promise<TemplateVersion | null> {
  const db = await getDb();
  const [r] = await db.select().from(templateVersions).where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.id, versionId)));
  return r ? toVersion(r) : null;
}

/** Make a version the current design again (recorded as a new version, so it can be undone). */
export async function restoreVersion(templateId: string, versionId: string, who = ""): Promise<Template | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(templateVersions).where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.id, versionId)));
    if (!v) return null;
    const doc = { ...v.doc, id: templateId };
    await tx.update(templates).set({ name: doc.name, doc, updatedAt: new Date() }).where(eq(templates.id, templateId));
    const last = await latest(tx, templateId);
    await insertVersion(tx, doc, { version: (last?.version ?? 0) + 1, note: `Restored v${v.version}`, auto: false, who });
    return doc;
  });
}

export async function deleteVersion(templateId: string, versionId: string) {
  const db = await getDb();
  await db.delete(templateVersions).where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.id, versionId)));
}

/**
 * Current version number of each template, creating a first snapshot for
 * templates that never had one (seeded / imported). Used to stamp prints.
 */
export async function currentVersions(templateIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(templateIds)];
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const db = await getDb();
  const rs = await db
    .select({ templateId: templateVersions.templateId, version: sql<number>`max(${templateVersions.version})::int` })
    .from(templateVersions)
    .where(inArray(templateVersions.templateId, ids))
    .groupBy(templateVersions.templateId);
  for (const r of rs) {
    out.set(r.templateId, r.version);
    // Printed with this state: freeze it so later edits start a new version.
    await db
      .update(templateVersions)
      .set({ auto: false })
      .where(and(eq(templateVersions.templateId, r.templateId), eq(templateVersions.version, r.version), eq(templateVersions.auto, true)));
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const ts = await db.select().from(templates).where(inArray(templates.id, missing));
    for (const t of ts) {
      await insertVersion(db, t.doc, { version: 1, auto: false }).catch(() => undefined);
      out.set(t.id, 1);
    }
  }
  return out;
}

/** Version documents by (templateId, version), for reprinting a history snapshot. */
export async function versionDocs(keys: { templateId: string; version: number }[]): Promise<TemplateVersion[]> {
  if (!keys.length) return [];
  const db = await getDb();
  const rs = await db
    .select()
    .from(templateVersions)
    .where(inArray(templateVersions.templateId, [...new Set(keys.map((k) => k.templateId))]));
  const want = new Set(keys.map((k) => `${k.templateId}@${k.version}`));
  return rs.filter((r) => want.has(`${r.templateId}@${r.version}`)).map((r) => toVersion(r));
}
