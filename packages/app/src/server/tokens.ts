/**
 * API tokens for the public /api/v1 API.
 *
 * Tokens look like `wmb_<43 chars base64url>` (256 random bits). Only the
 * SHA-256 hash is stored, so a token can be shown exactly once at creation.
 * Revoked tokens are kept (marked) so the list shows what was revoked when.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { apiTokens } from "../db/schema";

export const TOKEN_PREFIX = "wmb_";

export interface TokenInfo {
  id: string;
  name: string;
  /** e.g. "wmb_Ab3x…" */
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const toInfo = (r: typeof apiTokens.$inferSelect): TokenInfo => ({
  id: r.id,
  name: r.name,
  hint: `${r.prefix}…`,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
});

export async function listTokens(): Promise<TokenInfo[]> {
  const db = await getDb();
  return (await db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt))).map(toInfo);
}

/** Create a token. The plain token is returned only here. */
export async function createToken(name: string): Promise<{ token: string; info: TokenInfo }> {
  const db = await getDb();
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const [r] = await db
    .insert(apiTokens)
    .values({ id: `tok-${crypto.randomUUID()}`, name, prefix: token.slice(0, TOKEN_PREFIX.length + 4), hash: hashToken(token) })
    .returning();
  return { token, info: toInfo(r) };
}

export async function revokeToken(id: string) {
  const db = await getDb();
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
}

/** The active token matching `token`, or undefined. Updates "last used". */
export async function verifyToken(token: string): Promise<TokenInfo | undefined> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return undefined;
  const db = await getDb();
  const h = hashToken(token);
  const [r] = await db.select().from(apiTokens).where(eq(apiTokens.hash, h));
  // The lookup is by hash (no timing leak about the token itself); compare anyway as defence in depth.
  if (!r || r.revokedAt || !timingSafeEqual(Buffer.from(r.hash, "hex"), Buffer.from(h, "hex"))) return undefined;
  const now = new Date();
  // Avoid a write on every call: refresh "last used" at most once a minute.
  if (!r.lastUsedAt || now.getTime() - r.lastUsedAt.getTime() > 60_000) await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, r.id));
  return toInfo({ ...r, lastUsedAt: now });
}
