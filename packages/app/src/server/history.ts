/**
 * Print history repository: one entry per print job sent from a browser.
 * Each item keeps a snapshot (resolved values, template version, 1-bit
 * thumbnail) so a job can be reprinted exactly; entries can be voided.
 */
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { printHistory, type HistoryItem } from "../db/schema";
import type { ReservedRange } from "@labebal/core";
import { currentVersions } from "./versions";

export interface HistoryEntry {
  id: string;
  printedAt: string;
  source: string;
  printer: string;
  sizeId: string;
  sizeName: string;
  material: string;
  ribbon: string;
  density: number | null;
  invertAll: boolean;
  totalQty: number;
  items: HistoryItem[];
  client: string;
  /** Name set in the printing browser (Settings > You), "" when unknown. */
  who: string;
  /** counter numbers reserved for this print, print-time form answers (template id -> key -> value). */
  counters?: ReservedRange[] | null;
  printValues?: Record<string, Record<string, string>> | null;
  /** how the run ended. */
  outcome?: Record<string, unknown> | null;
  /** Set when the entry was voided (mis-print...). */
  voidedAt: string | null;
  voidReason: string;
  voidedBy: string;
}

export type NewHistoryEntry = Omit<HistoryEntry, "id" | "printedAt" | "totalQty" | "voidedAt" | "voidReason" | "voidedBy">;

const toEntry = (r: typeof printHistory.$inferSelect): HistoryEntry => ({ ...r, printedAt: r.printedAt.toISOString(), voidedAt: r.voidedAt?.toISOString() ?? null });

/** Thumbnails kept per job (the rest of a big job keeps values only). */
const MAX_THUMBS = 60;
const MAX_THUMB_CHARS = 200_000;

export async function recordPrint(e: NewHistoryEntry): Promise<HistoryEntry> {
  const db = await getDb();
  // Stamp the template version each label printed with (and freeze that version).
  const versions = await currentVersions(e.items.map((i) => i.templateId));
  const items = e.items.map((i, n) => {
    const { thumb, ...rest } = i;
    return {
      ...rest,
      ...(versions.has(i.templateId) ? { templateVersion: versions.get(i.templateId) } : {}),
      ...(thumb && n < MAX_THUMBS && thumb.length <= MAX_THUMB_CHARS && thumb.startsWith("data:image/png;base64,") ? { thumb } : {}),
    };
  });
  const [r] = await db
    .insert(printHistory)
    .values({ ...e, items, id: `h-${crypto.randomUUID()}`, totalQty: e.items.reduce((a, i) => a + i.qty, 0) })
    .returning();
  return toEntry(r);
}

export interface HistoryQuery {
  /** Searches label names, template names and source. */
  q?: string;
  /** Exact source, or a prefix ending in ":" (e.g. "run:"). */
  source?: string;
  printer?: string;
  /** Person (exact, case-insensitive); "-" = entries without a name. */
  who?: string;
  /** ISO dates (inclusive from, exclusive to). */
  from?: string;
  to?: string;
  /** Entries printed before this ISO timestamp (paging). */
  before?: string;
  /** "exclude" hides voided entries, "only" shows only them (default: all). */
  voided?: "exclude" | "only";
  /** A label id that must be among the items. */
  labelId?: string;
  limit?: number;
}

export async function listHistory(q: HistoryQuery = {}): Promise<HistoryEntry[]> {
  const db = await getDb();
  const where: SQL[] = [];
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(printHistory.source, like), sql`${printHistory.items}::text ilike ${like}`)!);
  }
  if (q.source) where.push(q.source.endsWith(":") ? ilike(printHistory.source, `${q.source}%`) : eq(printHistory.source, q.source));
  if (q.printer) where.push(eq(printHistory.printer, q.printer));
  if (q.who) where.push(q.who === "-" ? eq(printHistory.who, "") : sql`lower(${printHistory.who}) = lower(${q.who})`);
  if (q.from) where.push(gte(printHistory.printedAt, new Date(q.from)));
  if (q.to) where.push(lt(printHistory.printedAt, new Date(q.to)));
  if (q.before) where.push(lt(printHistory.printedAt, new Date(q.before)));
  if (q.voided === "exclude") where.push(isNull(printHistory.voidedAt));
  if (q.voided === "only") where.push(isNotNull(printHistory.voidedAt));
  if (q.labelId) where.push(sql`${printHistory.items} @> ${JSON.stringify([{ labelId: q.labelId }])}::jsonb`);
  const rs = await db
    .select()
    .from(printHistory)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(printHistory.printedAt))
    .limit(Math.min(Math.max(q.limit ?? 100, 1), 500));
  return rs.map(toEntry);
}

export async function getHistory(id: string): Promise<HistoryEntry | null> {
  const db = await getDb();
  const [r] = await db.select().from(printHistory).where(eq(printHistory.id, id));
  return r ? toEntry(r) : null;
}

/** Everyone who has printed (names as last written), with how many jobs. */
export async function listPeople(): Promise<{ who: string; jobs: number }[]> {
  const db = await getDb();
  const rs = await db
    .select({ who: sql<string>`max(${printHistory.who})`, jobs: sql<number>`count(*)::int` })
    .from(printHistory)
    .where(sql`${printHistory.who} <> ''`)
    .groupBy(sql`lower(${printHistory.who})`)
    .orderBy(sql`lower(${printHistory.who})`);
  return rs;
}

/** Void (or un-void with `voided: false`) an entry; it stays in the history, marked. */
export async function voidHistory(id: string, v: { voided: boolean; reason?: string; who?: string }): Promise<HistoryEntry | null> {
  const db = await getDb();
  const [r] = await db
    .update(printHistory)
    .set(v.voided ? { voidedAt: new Date(), voidReason: v.reason ?? "", voidedBy: v.who ?? "" } : { voidedAt: null, voidReason: "", voidedBy: "" })
    .where(eq(printHistory.id, id))
    .returning();
  return r ? toEntry(r) : null;
}

export async function deleteHistory(id: string) {
  const db = await getDb();
  await db.delete(printHistory).where(eq(printHistory.id, id));
}
