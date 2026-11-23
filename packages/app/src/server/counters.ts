/**
 * Persistent counters repository (tables in db/schema.ts "counters").
 *
 * Reservations run in one transaction: each (counter, scope key) row is locked
 * (`SELECT ... FOR UPDATE`) before the block is computed with core
 * `reserveCounter`, so concurrent prints / API calls never get overlapping
 * numbers. Reset periods use the server's local time (set TZ in the container).
 * Numbers that were reserved for a print that then failed are not given back.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  COUNTER_ID,
  COUNTER_RESETS,
  COUNTER_SCOPES,
  counterKey,
  counterPeriod,
  peekCounter,
  reserveCounter,
  watchedValue,
  type CounterDef,
  type CounterState,
  type ReservedRange,
} from "@labebal/core";
import { getDb } from "../db";
import { counterLog, counters, counterValues } from "../db/schema";

export interface CounterValueInfo {
  key: string;
  /** Stored next number. */
  next: number;
  /** What the next print would get now (start when a reset is due; watched-value resets are not predicted). */
  nextNow: number;
  period: string;
  watched: string | null;
  updatedAt: string;
}

export interface CounterInfo extends CounterDef {
  name: string;
  values: CounterValueInfo[];
  updatedAt: string;
}

export interface CounterLogEntry {
  counter: string;
  key: string;
  from: number;
  to: number;
  source: string;
  at: string;
}

/* ------------------------------------------------------------ validation */

const id = z.string().trim().toLowerCase().regex(COUNTER_ID, "lower-case letters, digits, _ and - (max 64)");
const fieldKey = z.string().trim().max(200);

export const counterDefSchema = z.object({
  id,
  name: z.string().trim().max(200).optional(),
  scope: z.enum(COUNTER_SCOPES as [CounterDef["scope"], ...CounterDef["scope"][]]).default("global"),
  keyField: fieldKey.optional().nullable(),
  reset: z.enum(COUNTER_RESETS as [CounterDef["reset"], ...CounterDef["reset"][]]).default("never"),
  watchField: fieldKey.optional().nullable(),
  start: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(1),
  format: z.string().max(100).optional().nullable(),
});

export const counterValueSchema = z.object({
  /** Scope key; omitted = every key of the counter. */
  key: z.string().max(1000).optional(),
  /** New next number; omitted = reset (the next print starts at `start`). */
  next: z.number().int().min(-1_000_000_000).max(1_000_000_000).optional(),
});

const reserveItem = z.object({
  counter: id,
  n: z.number().int().min(1).max(100_000).default(1),
  /** Explicit scope key; otherwise derived from templateId + values. */
  key: z.string().max(1000).optional(),
  templateId: z.string().max(200).optional(),
  values: z.record(z.string().max(200), z.string().max(5000)).optional(),
  /** Watched value for reset "change" (otherwise read from values). */
  watched: z.string().max(1000).optional(),
  labelId: z.string().max(200).optional(),
});
export type ReserveRequest = z.infer<typeof reserveItem>;

export const reserveSchema = z.union([
  z.object({ items: z.array(reserveItem).min(1).max(5000), source: z.string().max(200).optional() }),
  reserveItem.extend({ source: z.string().max(200).optional() }).transform(({ source, ...item }) => ({ items: [item], source })),
]);

/* ------------------------------------------------------------ repository */

type Row = typeof counters.$inferSelect;
const toDef = (r: Row): CounterDef & { name: string } => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  keyField: r.keyField ?? undefined,
  reset: r.reset,
  watchField: r.watchField ?? undefined,
  start: r.start,
  format: r.format || undefined,
});

export async function listCounters(): Promise<CounterInfo[]> {
  const db = await getDb();
  const [defs, vals] = await Promise.all([db.select().from(counters).orderBy(asc(counters.id)), db.select().from(counterValues).orderBy(asc(counterValues.scopeKey))]);
  const now = new Date();
  return defs.map((r) => {
    const def = toDef(r);
    return {
      ...def,
      updatedAt: r.updatedAt.toISOString(),
      values: vals
        .filter((v) => v.counterId === r.id)
        .map((v) => ({
          key: v.scopeKey,
          next: v.next,
          nextNow: peekCounter(def, { next: v.next, period: v.period, watched: v.watched }, now, v.watched),
          period: v.period,
          watched: v.watched,
          updatedAt: v.updatedAt.toISOString(),
        })),
    };
  });
}

export async function getCounter(counterId: string): Promise<CounterInfo | undefined> {
  return (await listCounters()).find((c) => c.id === counterId);
}

export async function saveCounter(input: z.infer<typeof counterDefSchema>): Promise<CounterInfo> {
  const db = await getDb();
  const row = {
    id: input.id,
    name: input.name || input.id,
    scope: input.scope,
    keyField: input.scope === "value" ? input.keyField || null : null,
    reset: input.reset,
    watchField: input.reset === "change" ? input.watchField || null : null,
    start: input.start,
    format: input.format ?? "",
  };
  await db.insert(counters).values(row).onConflictDoUpdate({ target: counters.id, set: { ...row, updatedAt: new Date() } });
  return (await getCounter(input.id))!;
}

export async function deleteCounter(counterId: string) {
  const db = await getDb();
  await db.delete(counters).where(eq(counters.id, counterId));
}

/** Set the next number for a key (or every key), or reset (next = undefined: the next print starts at `start`). */
export async function setCounterValue(counterId: string, v: z.infer<typeof counterValueSchema>): Promise<CounterInfo | undefined> {
  const db = await getDb();
  const [def] = await db.select().from(counters).where(eq(counters.id, counterId));
  if (!def) return undefined;
  const where = v.key === undefined ? eq(counterValues.counterId, counterId) : and(eq(counterValues.counterId, counterId), eq(counterValues.scopeKey, v.key));
  if (v.next === undefined) await db.delete(counterValues).where(where);
  else if (v.key === undefined) await db.update(counterValues).set({ next: v.next, updatedAt: new Date() }).where(where);
  else {
    // Keep the current period so a manual value is not immediately reset.
    const period = counterPeriod(def.reset, new Date());
    await db
      .insert(counterValues)
      .values({ counterId, scopeKey: v.key, next: v.next, period })
      .onConflictDoUpdate({ target: [counterValues.counterId, counterValues.scopeKey], set: { next: v.next, period, updatedAt: new Date() } });
  }
  return getCounter(counterId);
}

export async function counterHistory(counterId: string, limit = 50): Promise<CounterLogEntry[]> {
  const db = await getDb();
  const rs = await db
    .select()
    .from(counterLog)
    .where(eq(counterLog.counterId, counterId))
    .orderBy(desc(counterLog.at))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rs.map((r) => ({ counter: r.counterId, key: r.scopeKey, from: r.first, to: r.last, source: r.source, at: r.at.toISOString() }));
}

export class CounterError extends Error {}

/**
 * Reserve numbers for each item, in order, in one transaction. Unknown counter
 * ids are created with defaults (global, never reset, start 1) unless
 * `create` is false. Throws CounterError for bad requests.
 */
export async function reserveNumbers(items: ReserveRequest[], opts: { source?: string; create?: boolean } = {}): Promise<ReservedRange[]> {
  const db = await getDb();
  const now = new Date();
  return db.transaction(async (tx) => {
    const ids = [...new Set(items.map((i) => i.counter))];
    const defs = new Map((await tx.select().from(counters).where(inArray(counters.id, ids))).map((r) => [r.id, toDef(r)]));
    for (const cid of ids) {
      if (defs.has(cid)) continue;
      if (opts.create === false) throw new CounterError(`unknown counter "${cid}"`);
      const [r] = await tx.insert(counters).values({ id: cid, name: cid }).onConflictDoNothing().returning();
      defs.set(cid, toDef(r ?? (await tx.select().from(counters).where(eq(counters.id, cid)))[0]));
    }
    const out: ReservedRange[] = [];
    for (const item of items) {
      const def = defs.get(item.counter)!;
      if (item.key === undefined && def.scope !== "global" && !item.templateId) throw new CounterError(`counter "${def.id}" is per ${def.scope}: send templateId (+ values) or key`);
      const values = item.values ?? {};
      const key = item.key ?? counterKey(def, item.templateId ?? "", values);
      const watched = item.watched ?? watchedValue(def, values);
      const fresh = await tx.insert(counterValues).values({ counterId: def.id, scopeKey: key, next: def.start }).onConflictDoNothing().returning();
      const [row] = await tx
        .select()
        .from(counterValues)
        .where(and(eq(counterValues.counterId, def.id), eq(counterValues.scopeKey, key)))
        .for("update");
      const state: CounterState | undefined = fresh.length ? undefined : { next: row.next, period: row.period, watched: row.watched };
      const r = reserveCounter(def, state, item.n, now, watched);
      await tx
        .update(counterValues)
        .set({ next: r.state.next, period: r.state.period, watched: r.state.watched, updatedAt: now })
        .where(and(eq(counterValues.counterId, def.id), eq(counterValues.scopeKey, key)));
      await tx.insert(counterLog).values({ id: `cl-${crypto.randomUUID()}`, counterId: def.id, scopeKey: key, first: r.from, last: r.to, source: opts.source ?? "", at: now });
      out.push({ counter: def.id, key, from: r.from, to: r.to, ...(def.format ? { format: def.format } : {}), ...(item.labelId ? { labelId: item.labelId } : {}) });
    }
    return out;
  });
}

/** Route helper: reserve + map CounterError to 400. */
export async function reserveResponse(items: ReserveRequest[], opts: { source?: string; create?: boolean }) {
  try {
    return Response.json({ reservations: await reserveNumbers(items, opts) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof CounterError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
