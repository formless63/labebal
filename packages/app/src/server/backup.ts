/**
 * Full backup / restore of every `label_*` table (generic: tables added later
 * are included automatically), plus scheduled backups to the data volume.
 * File format and checks: `@labebal/core` backup.ts.
 */
import path from "node:path";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  backupsToPrune,
  bytesToHex,
  hexToBytes,
  planRestore,
  readBackupZip,
  writeBackupZip,
  type BackupManifest,
  type BackupRow,
  type BackupTable,
  type RestorePlan,
} from "@labebal/core";
import { getDb, type DB } from "../db";
import { env, featureOn } from "./host";

type Exec = Pick<DB, "execute">;
const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
const q = (db: Exec, query: ReturnType<typeof sql>) => db.execute(query).then(rowsOf<Record<string, unknown>>);
const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad identifier ${name}`);
  return sql.raw(`"${name}"`);
};

type TableInfo = Omit<BackupTable, "rows">;

/** All `label_*` tables with columns, primary keys and foreign-key dependencies. */
async function introspect(db: Exec): Promise<TableInfo[]> {
  const cols = await q(
    db,
    sql`select c.table_name as t, c.column_name as c, c.udt_name as type
        from information_schema.columns c
        join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
        where c.table_schema = current_schema() and tb.table_type = 'BASE TABLE' and c.table_name like 'label\\_%'
        order by c.table_name, c.ordinal_position`,
  );
  const pks = await q(
    db,
    sql`select tc.table_name as t, kcu.column_name as c
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = current_schema()
        order by kcu.ordinal_position`,
  );
  const fks = await q(
    db,
    sql`select distinct tc.table_name as t, ccu.table_name as ref
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = current_schema()`,
  );
  const tables = new Map<string, TableInfo>();
  for (const r of cols) {
    const t = String(r.t);
    if (!tables.has(t)) tables.set(t, { name: t, columns: [], primaryKey: [], dependsOn: [] });
    tables.get(t)!.columns.push({ name: String(r.c), type: String(r.type) });
  }
  for (const r of pks) tables.get(String(r.t))?.primaryKey.push(String(r.c));
  for (const r of fks) tables.get(String(r.t))?.dependsOn.push(String(r.ref));
  return [...tables.values()];
}

/** Applied Drizzle migrations (schema version). */
async function migrations(db: Exec): Promise<BackupManifest["schema"]> {
  try {
    const [r] = await q(db, sql`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`);
    return { migrations: Number(r?.n ?? 0), ...(r?.last ? { lastMigrationAt: Number(r.last) } : {}) };
  } catch {
    return { migrations: 0 };
  }
}

/** Snapshot every label_* table. */
export async function createBackup(reason = "manual"): Promise<{ zip: Uint8Array; manifest: BackupManifest }> {
  const db = await getDb();
  const { rows, manifest } = await db.transaction(async (tx) => {
    const infos = await introspect(tx);
    const rows: Record<string, BackupRow[]> = {};
    for (const t of infos) {
      const blobs = t.columns.filter((c) => c.type === "bytea").map((c) => c.name);
      const order = t.primaryKey.length ? sql.join(t.primaryKey.map(ident), sql`, `) : sql`1`;
      const [r] = await q(tx, sql`select coalesce(json_agg(x), '[]'::json)::text as data from (select * from ${ident(t.name)} order by ${order}) x`);
      const list = JSON.parse(String(r.data)) as BackupRow[];
      for (const row of list) for (const b of blobs) if (typeof row[b] === "string") row[b] = hexToBytes(row[b] as string);
      rows[t.name] = list;
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "labebal",
      createdAt: new Date().toISOString(),
      schema: await migrations(tx),
      tables: infos.map((t) => ({ ...t, rows: rows[t.name].length })),
      reason,
    };
    return { rows, manifest };
  });
  return { zip: await writeBackupZip({ manifest, rows }), manifest };
}

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  plan: RestorePlan;
  manifest: BackupManifest;
  /** Rows written per table (merge: only new rows). */
  restored: Record<string, number>;
  dryRun: boolean;
}

const BATCH = 500;

/**
 * Restore a backup zip.
 * - replace: empties every label_* table, then loads the backup.
 * - merge: adds rows whose primary key (or other unique key) is not there yet; existing rows are kept.
 * `dryRun` only checks the file and returns the plan (row counts per table).
 */
export async function restoreBackup(bytes: Uint8Array, mode: RestoreMode, dryRun = false): Promise<RestoreResult> {
  const data = await readBackupZip(bytes);
  const db = await getDb();
  const infos = await introspect(db);
  const current = Object.fromEntries(infos.map((t) => [t.name, t.columns.map((c) => c.name)]));
  const plan = planRestore(data.manifest, { tables: current, migrations: (await migrations(db)).migrations });
  const restored: Record<string, number> = {};
  if (dryRun) {
    for (const t of plan.tables) restored[t] = data.rows[t]?.length ?? 0;
    return { plan, manifest: data.manifest, restored, dryRun };
  }
  await db.transaction(async (tx) => {
    if (mode === "replace" && infos.length) await tx.execute(sql`truncate ${sql.join(infos.map((t) => ident(t.name)), sql`, `)} cascade`);
    for (const name of plan.tables) {
      const info = infos.find((t) => t.name === name)!;
      const backupCols = new Set(data.manifest.tables.find((t) => t.name === name)!.columns.map((c) => c.name));
      const cols = info.columns.filter((c) => backupCols.has(c.name));
      if (!cols.length) continue;
      const colList = sql.join(cols.map((c) => ident(c.name)), sql`, `);
      const list = data.rows[name] ?? [];
      let n = 0;
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH).map((r) => {
          const o: BackupRow = {};
          for (const c of cols) o[c.name] = r[c.name] instanceof Uint8Array ? bytesToHex(r[c.name] as Uint8Array) : r[c.name];
          return o;
        });
        const res = await tx.execute(
          sql`insert into ${ident(name)} (${colList}) select ${colList} from json_populate_recordset(null::${ident(name)}, ${JSON.stringify(batch)}::json) on conflict do nothing returning 1`,
        );
        n += rowsOf(res).length;
      }
      restored[name] = n;
    }
  });
  return { plan, manifest: data.manifest, restored, dryRun };
}

/* ------------------------------------------------------------ scheduled backups */

export interface BackupSchedule {
  dir: string;
  /** Hours between backups; 0 = off. */
  intervalHours: number;
  keep: number;
}

export function backupSchedule(): BackupSchedule {
  const dataDir = env().LABEBAL_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const dir = env().LABEBAL_BACKUP_DIR || path.join(path.dirname(dataDir), "backups");
  const every = env().LABEBAL_BACKUP_INTERVAL_HOURS;
  const intervalHours = every !== undefined && every !== "" ? Math.max(0, Number(every) || 0) : process.env.NODE_ENV === "production" ? 24 : 0;
  const keep = Math.max(1, Number(env().LABEBAL_BACKUP_KEEP) || 14);
  return { dir, intervalHours, keep };
}

export interface StoredBackup {
  name: string;
  size: number;
  createdAt: string;
}

export async function listStoredBackups(): Promise<StoredBackup[]> {
  const { dir } = backupSchedule();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: StoredBackup[] = [];
  for (const name of names.filter((n) => /^labebal-backup-.*\.zip$/.test(n)).sort().reverse()) {
    const s = await stat(path.join(dir, name));
    out.push({ name, size: s.size, createdAt: s.mtime.toISOString() });
  }
  return out;
}

const safeName = (name: string) => (/^labebal-backup-[\w.-]+\.zip$/.test(name) ? name : null);

export async function readStoredBackup(name: string): Promise<Uint8Array | null> {
  const n = safeName(name);
  if (!n) return null;
  try {
    return new Uint8Array(await readFile(path.join(backupSchedule().dir, n)));
  } catch {
    return null;
  }
}

/** Write a backup into the backup directory and prune old ones. */
export async function saveBackupToDisk(reason = "scheduled"): Promise<StoredBackup> {
  const { dir, keep } = backupSchedule();
  await mkdir(dir, { recursive: true });
  const { zip } = await createBackup(reason);
  const name = backupFileName();
  await writeFile(path.join(dir, name), zip);
  for (const old of backupsToPrune(await readdir(dir), keep)) await unlink(path.join(dir, old)).catch(() => undefined);
  return { name, size: zip.length, createdAt: new Date().toISOString() };
}

const g = globalThis as unknown as { __labebalBackupTimer?: ReturnType<typeof setInterval>; __labebalBackupLast?: { at: string; ok: boolean; message: string } };

export const lastScheduledBackup = () => g.__labebalBackupLast ?? null;

/** Start the in-process schedule (idempotent). Called from instrumentation.ts when the server starts. */
export function startBackupSchedule() {
  if (!featureOn("backups")) return;
  const { intervalHours } = backupSchedule();
  if (!intervalHours || g.__labebalBackupTimer) return;
  const every = intervalHours * 3_600_000;
  const run = async () => {
    try {
      const b = await saveBackupToDisk("scheduled");
      g.__labebalBackupLast = { at: new Date().toISOString(), ok: true, message: b.name };
    } catch (e) {
      g.__labebalBackupLast = { at: new Date().toISOString(), ok: false, message: String((e as Error).message ?? e) };
      console.error("scheduled backup failed", e);
    }
  };
  // First check shortly after start: back up now if the newest backup is older than the interval.
  setTimeout(async () => {
    const [newest] = await listStoredBackups();
    if (!newest || Date.now() - Date.parse(newest.createdAt) >= every) await run();
  }, 30_000).unref?.();
  g.__labebalBackupTimer = setInterval(run, every);
  g.__labebalBackupTimer.unref?.();
}
