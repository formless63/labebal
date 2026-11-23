/**
 * Settings stored on the server (`label_settings`): which keys exist, how each
 * is validated, who may write it, and how values combine. Pure (no server or
 * browser APIs): the API route, the browser sync and the tests share it.
 *
 * Storage: one row per (scope, key). Scope "shared" is the whole team,
 * "user:<id>" one signed-in person. Map-like settings are stored one entry per
 * row (`customSize:<id>`, `usage:<roll key>`...), so two browsers changing
 * different entries never overwrite each other, and each entry has its own
 * updated_at / updated_by. Per-user lists (favourites...) are one row each and
 * change through add / remove operations, applied on the server.
 *
 * Operations (`SettingOp`):
 * - set / delete: normal writes from the app.
 * - merge: first upload of what a browser had before settings moved to the
 *   server. Never overwrites: existing server values win, lists are unioned,
 *   objects only gain missing fields, roll usage counts are added up.
 * - add / remove: list members (favourites, pins, open folders).
 * - usage: labels printed on a roll / ribbon, added to the shared count.
 */
import { z } from "zod";
import { addUsage, type ConsumableUsage, type LabelSize, type Swatch } from "@labebal/core";
import type { Role } from "../auth/identity";

export type ScopeKind = "shared" | "user";

export interface SettingEntry {
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string;
}

/* ------------------------------------------------------------ value schemas */

const int = z.number().int();
const name = z.string().max(200);
const mediaKind = z.enum(["gap", "black-mark", "continuous", "transparent"]);
const printTask = z.string().min(1).max(40);
const offset = z.object({ x: int.min(-200).max(200), y: int.min(-200).max(200) });

export const labelSizeSchema = z.object({
  id: z.string().min(1).max(100),
  printer: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  widthMm: z.number().positive().max(1000),
  heightMm: z.number().positive().max(1000),
  radiusMm: z.number().min(0).max(500).optional(),
  gapMm: z.number().min(0).max(50).optional(),
  perRoll: int.min(0).max(100000).optional(),
  kind: z.enum(["die-cut", "cable", "round"]).optional(),
  common: z.boolean().optional(),
  group: z.string().max(60).optional(),
  media: mediaKind.optional(),
  feed: z.enum(["left", "top"]).optional(),
  custom: z.boolean().optional(),
  printableMm: z.number().positive().max(1000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const rgb = z.tuple([int.min(0).max(255), int.min(0).max(255), int.min(0).max(255)]);

/** Stock or ribbon the user added (core `Swatch`). */
export const swatchSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(100),
  css: z.string().max(2000),
  rgb,
  finish: z.enum(["paper", "matte", "gloss", "metallic", "holographic", "clear", "fluorescent"]).optional(),
  sheen: z.array(z.string().max(40)).max(12).optional(),
  densityOffset: int.min(-10).max(10).optional(),
  alpha: z.number().min(0).max(1).optional(),
  media: mediaKind.optional(),
  thermal: z.enum(["direct", "transfer"]).optional(),
  custom: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const learnedRollSchema = z.object({ sizeId: z.string().min(1).max(100), materialId: z.string().min(1).max(60).optional() });
export const modelDefaultsSchema = z.object({ mediaKind: mediaKind.optional(), printTask: printTask.optional() });

/** A saved printer, without `lastSeen` (that stays per browser). */
export const savedPrinterSchema = z.object({
  key: z.string().min(1).max(160),
  name: name,
  model: z.string().max(40),
  sizeId: z.string().max(100).optional(),
  material: z.string().max(60).optional(),
  mediaKind: mediaKind.optional(),
  printTask: printTask.optional(),
  offset: offset.optional(),
});

export const usageSchema = z.object({
  kind: z.enum(["roll", "ribbon"]),
  barcode: z.string().max(100),
  total: int.min(0).max(1_000_000),
  usedAtStart: int.min(0).max(1_000_000),
  printed: int.min(0).max(10_000_000),
  firstSeen: z.number().min(0),
  lastUsed: z.number().min(0).optional(),
});

const idList = (max: number) => z.array(z.string().min(1).max(300)).max(max);

/* ------------------------------------------------------------ key families */

type Merge = (server: unknown, local: unknown) => unknown;

interface Family {
  scope: ScopeKind;
  /** Exact key, or prefix ending in ":" followed by the entry id. */
  key: string;
  /** Entry id after the prefix (prefix families only). */
  id?: RegExp;
  schema: z.ZodType;
  /** Role needed to write (shared scope); user scope: any signed-in user. */
  role: Role;
  /** Combine an existing server value with a browser's value during the first upload. */
  merge: Merge;
  /** Lists: maximum length kept (newest first when `front`). */
  list?: { max: number };
}

/** Server value wins; the browser value only fills in what is missing. */
const keepServer: Merge = (server) => server;
const fillMissing: Merge = (server, local) => ({ ...(local as object), ...(server as object) });
const union = (max: number): Merge => (server, local) => [...new Set([...(server as string[]), ...(local as string[])])].slice(0, max);

/** Two browsers' counts for the same roll: the roll's start is the earliest seen, prints add up. */
export function mergeUsage(a: ConsumableUsage, b: ConsumableUsage): ConsumableUsage {
  const lastUsed = Math.max(a.lastUsed ?? 0, b.lastUsed ?? 0);
  return {
    kind: a.kind,
    barcode: a.barcode || b.barcode,
    total: Math.max(a.total, b.total),
    usedAtStart: Math.min(a.usedAtStart, b.usedAtStart),
    printed: a.printed + b.printed,
    firstSeen: Math.min(a.firstSeen, b.firstSeen),
    ...(lastUsed ? { lastUsed } : {}),
  };
}

const ENTRY_ID = /^[^\u0000-\u001f]{1,300}$/;

export const FAMILIES: Family[] = [
  { scope: "shared", key: "customSize:", id: /^[\w.:-]{1,100}$/, schema: labelSizeSchema, role: "editor", merge: fillMissing },
  { scope: "shared", key: "learnedRoll:", id: /^[\w.-]{1,64}$/, schema: learnedRollSchema, role: "printer", merge: keepServer },
  { scope: "shared", key: "customStock:", id: /^[\w.:-]{1,60}$/, schema: swatchSchema, role: "editor", merge: fillMissing },
  { scope: "shared", key: "customRibbon:", id: /^[\w.:-]{1,60}$/, schema: swatchSchema, role: "editor", merge: fillMissing },
  // Relative darkness (Zebra) can be negative; network printer models are "zpl:<id>".
  { scope: "shared", key: "densityPreset:", id: /^[\w.:-]{1,60}:[\w.-]{1,60}$/, schema: z.number().int().min(-30).max(30), role: "editor", merge: keepServer },
  { scope: "shared", key: "model:", id: /^[\w.:-]{1,60}$/, schema: modelDefaultsSchema, role: "editor", merge: fillMissing },
  { scope: "shared", key: "profile:", id: ENTRY_ID, schema: savedPrinterSchema, role: "editor", merge: fillMissing },
  { scope: "shared", key: "usage:", id: ENTRY_ID, schema: usageSchema, role: "printer", merge: (s, l) => mergeUsage(s as ConsumableUsage, l as ConsumableUsage) },
  { scope: "shared", key: "folder:", id: ENTRY_ID, schema: z.literal(true), role: "editor", merge: keepServer },
  // Team values for {{team:name}} (company, address...): names as core TEAM_VALUE_NAME.
  { scope: "shared", key: "team:", id: /^[a-z][a-z0-9_-]{0,39}$/, schema: z.string().max(2000), role: "editor", merge: keepServer },
  { scope: "user", key: "favourites", schema: idList(2000), role: "viewer", merge: union(2000), list: { max: 2000 } },
  { scope: "user", key: "pinned", schema: idList(500), role: "viewer", merge: union(500), list: { max: 500 } },
  { scope: "user", key: "openFolders", schema: idList(2000), role: "viewer", merge: union(2000), list: { max: 2000 } },
  { scope: "user", key: "iconFavourites", schema: idList(1000), role: "viewer", merge: union(1000), list: { max: 1000 } },
  { scope: "user", key: "iconRecent", schema: idList(24), role: "viewer", merge: union(24), list: { max: 24 } },
];

export function familyOf(scope: ScopeKind, key: string): Family | undefined {
  for (const f of FAMILIES) {
    if (f.scope !== scope) continue;
    if (f.id ? key.startsWith(f.key) && f.id.test(key.slice(f.key.length)) : key === f.key) return f;
  }
  return undefined;
}

/* ------------------------------------------------------------ operations */

const keyStr = z.string().min(1).max(400);
const usageInfo = z.object({ kind: z.enum(["roll", "ribbon"]), barcode: z.string().max(100), total: int.min(0).max(1_000_000), used: int.min(0).max(1_000_000) });

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), key: keyStr, value: z.unknown() }),
  z.object({ op: z.literal("delete"), key: keyStr }),
  z.object({ op: z.literal("merge"), key: keyStr, value: z.unknown() }),
  z.object({ op: z.literal("add"), key: keyStr, items: z.array(z.string().min(1).max(300)).min(1).max(2000), front: z.boolean().optional() }),
  z.object({ op: z.literal("remove"), key: keyStr, items: z.array(z.string().min(1).max(300)).min(1).max(2000) }),
  z.object({ op: z.literal("usage"), key: keyStr, info: usageInfo, n: int.min(0).max(100_000), at: z.number().min(0).optional() }),
]);
export type SettingOp = z.infer<typeof opSchema>;

export const scopedOpSchema = z.intersection(z.object({ scope: z.enum(["shared", "user"]) }), opSchema);
export type ScopedOp = SettingOp & { scope: ScopeKind };

export const patchBodySchema = z.object({ ops: z.array(scopedOpSchema).min(1).max(2000) });

export type OpResult = { ok: true; value: unknown } | { ok: true; deleted: true } | { ok: false; status: 400 | 403; error: string };

/** Profile fields a printer may change ("use this roll", a newly connected printer). */
const PRINTER_PROFILE_FIELDS = new Set(["key", "model", "sizeId", "material"]);

/** Role needed for this operation on this key (shared scope). */
export function roleNeeded(fam: Family, op: SettingOp, current: unknown): Role {
  if (fam.key === "profile:" && (op.op === "set" || op.op === "merge")) {
    const next = op.value as Record<string, unknown>;
    const prev = (current ?? { name: "" }) as Record<string, unknown>;
    const fields = new Set([...Object.keys(next ?? {}), ...Object.keys(prev)]);
    const onlyRollFields = [...fields].every((f) => PRINTER_PROFILE_FIELDS.has(f) || JSON.stringify(prev[f]) === JSON.stringify(next?.[f]));
    if (onlyRollFields) return "printer";
  }
  return fam.role;
}

const MAX_VALUE_CHARS = 64_000;

/**
 * Apply one operation to the current stored value (undefined = no row). Pure:
 * the server runs it inside a transaction; the browser runs it to show pending
 * changes on top of a fresh server copy.
 */
export function applyOp(scope: ScopeKind, op: SettingOp, current: unknown, now = Date.now()): OpResult {
  const fam = familyOf(scope, op.key);
  if (!fam) return { ok: false, status: 400, error: `unknown setting ${op.key}` };
  let next: unknown;
  switch (op.op) {
    case "delete":
      return { ok: true, deleted: true };
    case "set":
      next = op.value;
      break;
    case "merge": {
      const local = fam.schema.safeParse(op.value);
      if (!local.success) return { ok: false, status: 400, error: `invalid ${op.key}` };
      next = current === undefined ? local.data : fam.merge(current, local.data);
      break;
    }
    case "add":
    case "remove": {
      if (!fam.list) return { ok: false, status: 400, error: `${op.key} is not a list` };
      const list = Array.isArray(current) ? (current as string[]) : [];
      if (op.op === "remove") next = list.filter((x) => !op.items.includes(x));
      else {
        const rest = list.filter((x) => !op.items.includes(x));
        next = (op.front ? [...op.items, ...rest] : [...list, ...op.items.filter((x) => !list.includes(x))]).slice(0, fam.list.max);
      }
      break;
    }
    case "usage": {
      if (fam.key !== "usage:") return { ok: false, status: 400, error: `${op.key} is not a roll counter` };
      const id = op.key.slice(fam.key.length);
      const map = current === undefined ? {} : { [id]: current as ConsumableUsage };
      next = addUsage(map, id, op.info, op.n, op.at ?? now)[id];
      break;
    }
  }
  const parsed = fam.schema.safeParse(next);
  if (!parsed.success) return { ok: false, status: 400, error: `invalid ${op.key}: ${parsed.error.issues[0]?.message ?? ""}` };
  if (JSON.stringify(parsed.data).length > MAX_VALUE_CHARS) return { ok: false, status: 400, error: `${op.key} is too large` };
  return { ok: true, value: parsed.data };
}

/** Apply operations to a key -> value map (browser side: pending writes over the server copy). */
export function applyOps(scope: ScopeKind, map: Record<string, unknown>, ops: SettingOp[], now = Date.now()) {
  const out = { ...map };
  for (const op of ops) {
    const r = applyOp(scope, op, out[op.key], now);
    if (!r.ok) continue;
    if ("deleted" in r) delete out[op.key];
    else out[op.key] = r.value;
  }
  return out;
}

/** What the first upload produces: every key of both, combined with the family's merge rule. */
export function mergeMaps(scope: ScopeKind, server: Record<string, unknown>, local: Record<string, unknown>) {
  return applyOps(scope, server, migrationOps(local));
}

export const migrationOps = (local: Record<string, unknown>): SettingOp[] => Object.entries(local).map(([key, value]) => ({ op: "merge", key, value }));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Operations that turn `prev` into `next` (both key -> value maps of one scope).
 * Lists become add / remove (so two browsers' toggles both survive), roll
 * counters become "printed n more" (so counts from several browsers add up),
 * everything else set / delete.
 */
export function diffOps(scope: ScopeKind, prev: Record<string, unknown>, next: Record<string, unknown>): SettingOp[] {
  const ops: SettingOp[] = [];
  for (const [key, value] of Object.entries(next)) {
    const old = prev[key];
    if (same(old, value)) continue;
    const fam = familyOf(scope, key);
    if (!fam) continue;
    if (fam.list && key !== "iconRecent" && Array.isArray(value)) {
      const before = Array.isArray(old) ? (old as string[]) : [];
      const added = (value as string[]).filter((x) => !before.includes(x));
      const removed = before.filter((x) => !(value as string[]).includes(x));
      if (added.length) ops.push({ op: "add", key, items: added, front: key === "iconFavourites" });
      if (removed.length) ops.push({ op: "remove", key, items: removed });
      continue;
    }
    if (fam.key === "usage:" && old) {
      const a = old as ConsumableUsage;
      const b = value as ConsumableUsage;
      if (a.usedAtStart === b.usedAtStart && a.firstSeen === b.firstSeen && b.printed >= a.printed) {
        ops.push({ op: "usage", key, info: { kind: b.kind, barcode: b.barcode, total: b.total, used: b.usedAtStart }, n: b.printed - a.printed, ...(b.lastUsed ? { at: b.lastUsed } : {}) });
        continue;
      }
    }
    ops.push({ op: "set", key, value });
  }
  for (const key of Object.keys(prev)) if (!(key in next) && familyOf(scope, key)) ops.push({ op: "delete", key });
  return ops;
}

/**
 * Add an operation to a pending list, dropping earlier ones it replaces
 * (a set / delete of a key replaces everything queued for that key).
 */
export function queueOp<T extends ScopedOp>(queue: T[], op: T): T[] {
  if (op.op === "set" || op.op === "delete") return [...queue.filter((q) => !(q.scope === op.scope && q.key === op.key)), op];
  return [...queue, op];
}

/* ------------------------------------------------------------ store <-> map */

export interface SharedSlices {
  customSizes: LabelSize[];
  customMaterials: Swatch[];
  customRibbons: Swatch[];
  learnedRolls: Record<string, { sizeId: string; materialId?: string }>;
  densityPresets: Record<string, number>;
  models: Record<string, { mediaKind?: string; printTask?: string }>;
  profiles: Record<string, { key: string; name: string; model: string; lastSeen?: number } & Record<string, unknown>>;
  usage: Record<string, ConsumableUsage>;
  newFolders: string[];
  /** Team values ({{team:name}}), name -> text. */
  teamValues: Record<string, string>;
}

const stripUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Store slices -> shared key/value map. */
export function sharedToMap(s: SharedSlices): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const z of s.customSizes) {
    const { custom: _c, ...rest } = z;
    void _c;
    m[`customSize:${z.id}`] = stripUndefined(rest);
  }
  for (const [prefix, list] of [["customStock:", s.customMaterials], ["customRibbon:", s.customRibbons]] as const)
    for (const w of list) {
      const { custom: _c, ...rest } = w;
      void _c;
      m[`${prefix}${w.id}`] = stripUndefined(rest);
    }
  for (const [k, v] of Object.entries(s.learnedRolls)) m[`learnedRoll:${k}`] = stripUndefined(v);
  for (const [k, v] of Object.entries(s.densityPresets)) m[`densityPreset:${k}`] = v;
  for (const [k, v] of Object.entries(s.models)) if (Object.keys(stripUndefined(v)).length) m[`model:${k}`] = stripUndefined(v);
  for (const [k, v] of Object.entries(s.profiles)) {
    const { lastSeen: _seen, ...rest } = v;
    void _seen;
    m[`profile:${k}`] = stripUndefined(rest);
  }
  for (const [k, v] of Object.entries(s.usage)) m[`usage:${k}`] = stripUndefined(v);
  for (const f of s.newFolders) m[`folder:${f}`] = true;
  for (const [k, v] of Object.entries(s.teamValues ?? {})) m[`team:${k}`] = v;
  return m;
}

const entriesWith = (m: Record<string, unknown>, prefix: string) =>
  Object.entries(m)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [k.slice(prefix.length), v] as const);

/** Shared key/value map -> store slices (profiles keep this browser's `lastSeen`). */
export function mapToShared(m: Record<string, unknown>, lastSeen: Record<string, number | undefined> = {}): SharedSlices {
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return {
    customSizes: entriesWith(m, "customSize:")
      .sort(([a], [b]) => byName(a, b))
      .map(([, v]) => v as LabelSize),
    customMaterials: entriesWith(m, "customStock:")
      .map(([, v]) => v as Swatch)
      .sort((a, b) => byName(a.name, b.name)),
    customRibbons: entriesWith(m, "customRibbon:")
      .map(([, v]) => v as Swatch)
      .sort((a, b) => byName(a.name, b.name)),
    learnedRolls: Object.fromEntries(entriesWith(m, "learnedRoll:")) as SharedSlices["learnedRolls"],
    densityPresets: Object.fromEntries(entriesWith(m, "densityPreset:")) as SharedSlices["densityPresets"],
    models: Object.fromEntries(entriesWith(m, "model:")) as SharedSlices["models"],
    profiles: Object.fromEntries(
      entriesWith(m, "profile:").map(([k, v]) => [k, lastSeen[k] ? { ...(v as object), lastSeen: lastSeen[k] } : v]),
    ) as SharedSlices["profiles"],
    usage: Object.fromEntries(entriesWith(m, "usage:")) as SharedSlices["usage"],
    newFolders: entriesWith(m, "folder:")
      .map(([k]) => k)
      .sort(byName),
    teamValues: Object.fromEntries(entriesWith(m, "team:").sort(([a], [b]) => byName(a, b))) as Record<string, string>,
  };
}

export interface UserSlices {
  favourites: string[];
  pinned: string[];
  openFolders: string[];
  iconFavourites: string[];
  iconRecent: string[];
}

export const USER_KEYS = ["favourites", "pinned", "openFolders", "iconFavourites", "iconRecent"] as const satisfies readonly (keyof UserSlices)[];

/** Empty lists are kept, so emptying one is a "remove" (not a delete that would also drop another browser's additions). */
export const userToMap = (s: UserSlices): Record<string, unknown> => Object.fromEntries(USER_KEYS.map((k) => [k, s[k]]));

export const mapToUser = (m: Record<string, unknown>): UserSlices =>
  Object.fromEntries(USER_KEYS.map((k) => [k, Array.isArray(m[k]) ? (m[k] as string[]) : []])) as unknown as UserSlices;

/** Scope id stored in the table for a signed-in user. */
export const userScope = (user: string) => `user:${user.trim().toLowerCase()}`;
