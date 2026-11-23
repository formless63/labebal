/** Quick print boards repository: saved sets of one-tap labels (label + size + quantity). */
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { boards, type BoardTile } from "../db/schema";

export interface Board {
  id: string;
  name: string;
  notes: string;
  tiles: BoardTile[];
  updatedAt: string;
}

const toBoard = (r: typeof boards.$inferSelect): Board => ({ id: r.id, name: r.name, notes: r.notes, tiles: r.tiles, updatedAt: r.updatedAt.toISOString() });

export async function listBoards(): Promise<Board[]> {
  const db = await getDb();
  return (await db.select().from(boards).orderBy(asc(boards.name))).map(toBoard);
}

export async function saveBoard(b: Omit<Board, "updatedAt">): Promise<Board> {
  const db = await getDb();
  const row = { id: b.id, name: b.name, notes: b.notes, tiles: b.tiles };
  const [out] = await db.insert(boards).values(row).onConflictDoUpdate({ target: boards.id, set: { ...row, updatedAt: new Date() } }).returning();
  return toBoard(out);
}

export async function deleteBoard(id: string) {
  const db = await getDb();
  await db.delete(boards).where(eq(boards.id, id));
}
