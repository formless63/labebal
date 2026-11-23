/**
 * Settings shared by the team or kept per signed-in user (`label_settings`).
 * Keys, validation, roles and merge rules: features/settings/model.ts.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { settings } from "../db/schema";
import { roleAtLeast, type Identity } from "../features/auth/identity";
import { applyOp, familyOf, roleNeeded, userScope, type ScopedOp, type SettingEntry } from "../features/settings/model";

const toEntry = (r: typeof settings.$inferSelect): SettingEntry => ({ key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy });

export async function listSettings(scope: string): Promise<SettingEntry[]> {
  const db = await getDb();
  return (await db.select().from(settings).where(eq(settings.scope, scope)).orderBy(asc(settings.key))).map(toEntry);
}

/** The per-user scope for this request, or null (no identity configured, or anonymous). */
export const scopeOfUser = (me: Identity) => (me.enabled && me.signedIn && me.user ? userScope(me.user) : null);

export interface Denied {
  scope: "shared" | "user";
  key: string;
  status: 400 | 401 | 403;
  error: string;
}

/**
 * Apply operations in one transaction. Operations the caller may not do (role,
 * not signed in) or that are invalid are skipped and reported in `denied`;
 * the rest are applied. Returns the entries as stored afterwards.
 */
export async function applySettingOps(ops: ScopedOp[], me: Identity, who: string) {
  const db = await getDb();
  const own = scopeOfUser(me);
  const denied: Denied[] = [];
  const changed: { scope: "shared" | "user"; entry: SettingEntry | { key: string; deleted: true } }[] = [];
  await db.transaction(async (tx) => {
    for (const op of ops) {
      const scope = op.scope === "shared" ? "shared" : own;
      if (!scope) {
        denied.push({ scope: op.scope, key: op.key, status: 401, error: "Sign in to save your own settings." });
        continue;
      }
      const fam = familyOf(op.scope, op.key);
      if (!fam) {
        denied.push({ scope: op.scope, key: op.key, status: 400, error: `unknown setting ${op.key}` });
        continue;
      }
      const [row] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.scope, scope), eq(settings.key, op.key)))
        .for("update");
      if (op.scope === "shared") {
        const need = roleNeeded(fam, op, row?.value);
        if (!roleAtLeast(me.role, need)) {
          denied.push({ scope: op.scope, key: op.key, status: 403, error: `Needs the ${need} role (you are ${me.role}).` });
          continue;
        }
      }
      const r = applyOp(op.scope, op, row?.value);
      if (!r.ok) {
        denied.push({ scope: op.scope, key: op.key, status: r.status, error: r.error });
        continue;
      }
      if ("deleted" in r) {
        if (row) await tx.delete(settings).where(and(eq(settings.scope, scope), eq(settings.key, op.key)));
        changed.push({ scope: op.scope, entry: { key: op.key, deleted: true } });
        continue;
      }
      // An unchanged value (e.g. a merge that kept the server's) keeps its date and author.
      if (row && JSON.stringify(row.value) === JSON.stringify(r.value)) {
        changed.push({ scope: op.scope, entry: toEntry(row) });
        continue;
      }
      const values = { scope, key: op.key, value: r.value, updatedAt: new Date(), updatedBy: who };
      const [saved] = await tx
        .insert(settings)
        .values(values)
        .onConflictDoUpdate({ target: [settings.scope, settings.key], set: { value: values.value, updatedAt: values.updatedAt, updatedBy: who } })
        .returning();
      changed.push({ scope: op.scope, entry: toEntry(saved) });
    }
  });
  return { changed, denied };
}
