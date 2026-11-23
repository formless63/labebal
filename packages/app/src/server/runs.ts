/** Stock runs repository: saved presets of label x quantity. */
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { runs, type RunItem } from "../db/schema";

export interface Run {
  id: string;
  name: string;
  notes: string;
  items: RunItem[];
  updatedAt: string;
}

const toRun = (r: typeof runs.$inferSelect): Run => ({ id: r.id, name: r.name, notes: r.notes, items: r.items, updatedAt: r.updatedAt.toISOString() });

export async function listRuns(): Promise<Run[]> {
  const db = await getDb();
  return (await db.select().from(runs).orderBy(asc(runs.name))).map(toRun);
}

export async function getRun(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(runs).where(eq(runs.id, id));
  return r && toRun(r);
}

export async function saveRun(r: Omit<Run, "updatedAt">): Promise<Run> {
  const db = await getDb();
  const row = { id: r.id, name: r.name, notes: r.notes, items: r.items.filter((i) => i.qty > 0) };
  const [out] = await db.insert(runs).values(row).onConflictDoUpdate({ target: runs.id, set: { ...row, updatedAt: new Date() } }).returning();
  return toRun(out);
}

export async function deleteRun(id: string) {
  const db = await getDb();
  await db.delete(runs).where(eq(runs.id, id));
}
