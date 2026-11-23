/**
 * Database connection.
 *
 * - Host app: the Drizzle database it passes (createLabebalServer({ db })).
 *   Migrations are tracked in their own table (drizzle.__labebal_migrations)
 *   so they never mix with the host's own.
 * - Standalone: embedded Postgres (PGlite) in LABEBAL_DATA_DIR (default ./.data/pglite).
 * - With DATABASE_URL set: a real Postgres server (same schema, same queries).
 *
 * Migrations run automatically on first use; start-up data (the built-in
 * pack source) comes from server/seed.ts.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env, host, migrationsFolder as folder } from "../server/host";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Migration table for a host-provided database (the standalone app keeps drizzle's default). */
export const HOST_MIGRATIONS_TABLE = "__labebal_migrations";

/** Apply labebal's migrations to any Drizzle Postgres database (driver independent). */
export async function migrateDb(db: DB, migrationsTable = HOST_MIGRATIONS_TABLE) {
  const migrationsFolder = folder();
  const d = db as unknown as { dialect: { migrate: (m: unknown, s: unknown, c: unknown) => Promise<void> }; session: unknown };
  await d.dialect.migrate(readMigrationFiles({ migrationsFolder }), d.session, { migrationsFolder, migrationsTable });
}

async function open(): Promise<DB> {
  const given = host().db;
  if (given) {
    const db = typeof given === "function" ? await given() : given;
    if (host().migrate !== false) await migrateDb(db);
    return db;
  }
  const migrationsFolder = folder();
  const url = env().DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const db = drizzle(postgres(url), { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = env().LABEBAL_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as DB;
}

const g = globalThis as unknown as { __labebalDb?: Promise<DB> };

/** Shared connection (survives dev hot reloads). */
export function getDb(): Promise<DB> {
  g.__labebalDb ??= open().then(async (db) => {
    const { seedIfEmpty } = await import("../server/seed");
    await seedIfEmpty(db);
    return db;
  });
  return g.__labebalDb;
}
