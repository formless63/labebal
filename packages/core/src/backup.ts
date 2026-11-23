/**
 * Full-backup file format (framework-free; the app does the database part).
 *
 * A backup is one zip:
 *   manifest.json            format, version, schema (migration count), tables
 *   tables/<table>.json      rows as JSON (timestamps as ISO strings, arrays as arrays)
 *   blobs/<table>/<n>-<col>  binary columns (bytea) pulled out of the rows,
 *                            referenced from the row as { "$blob": "<path>" }
 *
 * The table list is generic: the app backs up every `label_*` table, so tables
 * added later (counters, settings...) are included without changes here.
 */
import JSZip from "jszip";

export const BACKUP_FORMAT = "labebal.backup";
export const BACKUP_VERSION = 1;

export type BackupRow = Record<string, unknown>;

export interface BackupColumn {
  name: string;
  /** Postgres type name (information_schema `udt_name`), e.g. "text", "jsonb", "bytea", "_text". */
  type: string;
}

export interface BackupTable {
  name: string;
  rows: number;
  columns: BackupColumn[];
  primaryKey: string[];
  /** Tables this one references (foreign keys): restored first. */
  dependsOn: string[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: "labebal";
  createdAt: string;
  /** Database schema the backup was taken from: applied migration count (+ last migration time, ms). */
  schema: { migrations: number; lastMigrationAt?: number };
  tables: BackupTable[];
  /** "manual", "scheduled", ... */
  reason?: string;
}

export interface BackupData {
  manifest: BackupManifest;
  /** Table name -> rows (binary columns as Uint8Array). */
  rows: Record<string, BackupRow[]>;
}

/* --------------------------------------------------------- hex (bytea) */

/** Postgres bytea text form `\x0a1b...` -> bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "\\x";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/* --------------------------------------------------------- ordering */

/** Tables in an order that satisfies foreign keys (referenced tables first). Cycles fall back to name order. */
export function restoreOrder(tables: Pick<BackupTable, "name" | "dependsOn">[]): string[] {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(tables.map((t) => [t.name, t.dependsOn.filter((d) => d !== t.name && names.has(d))]));
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    if (state.get(n) === 2 || state.get(n) === 1) return;
    state.set(n, 1);
    for (const d of deps.get(n) ?? []) visit(d);
    state.set(n, 2);
    out.push(n);
  };
  for (const n of [...names].sort()) visit(n);
  return out;
}

/* --------------------------------------------------------- planning */

export interface RestorePlan {
  /** Tables to restore, in foreign-key order. */
  tables: string[];
  /** In the backup but not in this database (ignored). */
  unknown: string[];
  /** In this database but not in the backup (left as they are; emptied in replace mode). */
  missing: string[];
  /** Per table: backup columns this database doesn't have (dropped). */
  droppedColumns: Record<string, string[]>;
  warnings: string[];
}

/** Compare a backup with the current database (tables -> column names, applied migrations). */
export function planRestore(manifest: BackupManifest, current: { tables: Record<string, string[]>; migrations: number }): RestorePlan {
  const inBackup = new Set(manifest.tables.map((t) => t.name));
  const restorable = manifest.tables.filter((t) => current.tables[t.name]);
  const droppedColumns: Record<string, string[]> = {};
  for (const t of restorable) {
    const have = new Set(current.tables[t.name]);
    const gone = t.columns.map((c) => c.name).filter((c) => !have.has(c));
    if (gone.length) droppedColumns[t.name] = gone;
  }
  const warnings: string[] = [];
  if (manifest.schema.migrations > current.migrations)
    warnings.push(`The backup is from a newer labebal (database schema ${manifest.schema.migrations}, this one ${current.migrations}); data it added may be lost.`);
  for (const [t, cols] of Object.entries(droppedColumns)) warnings.push(`${t}: columns ${cols.join(", ")} are not in this database and are skipped.`);
  return {
    tables: restoreOrder(restorable),
    unknown: manifest.tables.filter((t) => !current.tables[t.name]).map((t) => t.name),
    missing: Object.keys(current.tables).filter((t) => !inBackup.has(t)).sort(),
    droppedColumns,
    warnings,
  };
}

/* --------------------------------------------------------- manifest */

export function validateManifest(m: unknown): BackupManifest {
  const bad = (why: string): never => {
    throw new Error(`not a labebal backup: ${why}`);
  };
  if (!m || typeof m !== "object") bad("manifest missing");
  const o = m as Partial<BackupManifest>;
  if (o.format !== BACKUP_FORMAT) bad("wrong format");
  if (typeof o.version !== "number") bad("no version");
  if (o.version! > BACKUP_VERSION) bad(`backup format ${o.version} is newer than this app understands (${BACKUP_VERSION})`);
  if (!Array.isArray(o.tables)) bad("no tables");
  for (const t of o.tables!) {
    if (!t || typeof t.name !== "string" || !/^[a-z_][a-z0-9_]*$/.test(t.name)) bad(`bad table name ${JSON.stringify(t?.name)}`);
    if (!Array.isArray(t.columns) || !Array.isArray(t.primaryKey) || !Array.isArray(t.dependsOn)) bad(`table ${t.name} incomplete`);
    for (const c of t.columns) if (typeof c?.name !== "string" || !/^[a-z_][a-z0-9_]*$/.test(c.name)) bad(`bad column in ${t.name}`);
  }
  return { ...o, schema: o.schema ?? { migrations: 0 } } as BackupManifest;
}

const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;

/* --------------------------------------------------------- zip */

/** Write a backup zip. Binary values (Uint8Array) are stored as separate files. */
export async function writeBackupZip(data: BackupData): Promise<Uint8Array> {
  const zip = new JSZip();
  const tables: BackupTable[] = [];
  for (const t of data.manifest.tables) {
    const rows = data.rows[t.name] ?? [];
    const out = rows.map((r, i) => {
      const o: BackupRow = {};
      for (const [k, v] of Object.entries(r)) {
        if (isBytes(v)) {
          const path = `blobs/${t.name}/${i}-${k}`;
          zip.file(path, v, { binary: true });
          o[k] = { $blob: path };
        } else o[k] = v;
      }
      return o;
    });
    zip.file(`tables/${t.name}.json`, JSON.stringify(out));
    tables.push({ ...t, rows: rows.length });
  }
  zip.file("manifest.json", JSON.stringify({ ...data.manifest, tables }, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Read and check a backup zip; binary columns come back as Uint8Array. */
export async function readBackupZip(bytes: Uint8Array | ArrayBuffer): Promise<BackupData> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("not a labebal backup: not a zip file");
  }
  const mf = zip.file("manifest.json");
  if (!mf) throw new Error("not a labebal backup: manifest.json missing");
  let raw: unknown;
  try {
    raw = JSON.parse(await mf.async("string"));
  } catch {
    throw new Error("not a labebal backup: manifest.json is not JSON");
  }
  const manifest = validateManifest(raw);
  const rows: Record<string, BackupRow[]> = {};
  for (const t of manifest.tables) {
    const f = zip.file(`tables/${t.name}.json`);
    if (!f) throw new Error(`backup is incomplete: tables/${t.name}.json missing`);
    const list = JSON.parse(await f.async("string")) as BackupRow[];
    if (!Array.isArray(list) || list.length !== t.rows) throw new Error(`backup is damaged: ${t.name} should have ${t.rows} rows`);
    for (const r of list)
      for (const [k, v] of Object.entries(r)) {
        if (v && typeof v === "object" && typeof (v as { $blob?: unknown }).$blob === "string") {
          const path = (v as { $blob: string }).$blob;
          const b = zip.file(path);
          if (!b) throw new Error(`backup is damaged: ${path} missing`);
          r[k] = await b.async("uint8array");
        }
      }
    rows[t.name] = list;
  }
  return { manifest, rows };
}

/** "labebal-backup-2026-11-19T10-30-00Z.zip" */
export const backupFileName = (d = new Date()) => `labebal-backup-${d.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}.zip`;

/** Of a list of backup file names, those beyond the newest `keep` (to delete). */
export function backupsToPrune(names: string[], keep: number): string[] {
  const ours = names.filter((n) => /^labebal-backup-.*\.zip$/.test(n)).sort().reverse();
  return ours.slice(Math.max(0, keep));
}
