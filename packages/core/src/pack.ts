/**
 * Packs: shareable sets of templates, labels, datasets, images and fonts,
 * authored as plain files in a git repo (or exported from the app).
 *
 *   my-pack/
 *     labebal-pack.json      manifest (id, name, version, file lists)
 *     templates/*.json       core `Template` JSON (one, an array, or a library export)
 *     labels/*.csv|json      labels; CSV = one row per label, one column per field
 *     datasets/*.json        core `Dataset` JSON
 *     assets/*, fonts/*      images / SVG icons / font files
 *
 * A collection (`labebal-packs.json`) lists several packs so one repo can
 * hold many that people pick from. A bundle is one self-contained JSON file
 * (files inlined, binaries base64) for hosting anywhere.
 *
 * Framework-free: file access goes through a `PackReader` (fs in the CLI,
 * the SSRF-guarded fetch on the server). Merge rules for installs / updates
 * are pure (`planPackSync`, `planPackRemove`) so they are unit-tested here.
 */
import Papa from "papaparse";
import { z } from "zod";
import { slugify, type Dataset } from "./data";
import { BUILTIN_FONTS, SYSTEM_FONTS } from "./fonts";
import { fromBase64, toBase64 } from "./png";
import type { Label, Template } from "./schema";
import { templateAssetRefs, type SharedAsset } from "./share";

export const PACK_MANIFEST = "labebal-pack.json";
export const PACK_COLLECTION = "labebal-packs.json";
export const PACK_BUNDLE_FORMAT = "labebal.pack";
export const PACK_COLLECTION_BUNDLE_FORMAT = "labebal.packs";
export const PACK_FORMAT_VERSION = 1;
/** Where the published JSON Schemas live (use in `$schema`). */
export const PACK_SCHEMA_BASE = "https://raw.githubusercontent.com/formless63/labebal/main/packs/schema/";

/* ------------------------------------------------------------- manifest */

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const relPath = z
  .string()
  .min(1)
  .refine((p) => !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith("/") && !p.includes("\\"), "must be a relative path with / separators");

const pixelSchema = z.object({ pxPerEm: z.number().positive(), linePx: z.number().positive() });

export const packManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "lowercase letters, digits, . _ - (max 64)")
      .describe("Stable pack id. Never change it: installs and updates are matched on it."),
    name: z.string().min(1).describe("Display name."),
    version: z.string().regex(SEMVER, "semver, e.g. 1.2.0").describe("Semver. Bump it to offer an update."),
    description: z.string().optional(),
    author: z.string().optional(),
    homepage: z.string().optional(),
    license: z.string().optional(),
    minApp: z.string().optional().describe("Oldest labebal pack format / app version this pack needs."),
    folder: z.string().optional().describe("Library folder for labels that don't name their own (`/` nests)."),
    templates: z.array(relPath).default([]).describe("Template JSON files: a Template, an array of them, or a library export ({ templates, labels })."),
    labels: z
      .array(
        z.union([
          relPath,
          z.object({
            path: relPath,
            template: z.string().optional().describe("Template id for rows / labels that don't name one."),
            folder: z.string().optional().describe("Folder for labels in this file that don't name one."),
          }),
        ]),
      )
      .default([])
      .describe("Label files: .csv (id?, name, template, folder, invert, tags, overrides, then one column per field key) or .json (Label / Label[] / { labels })."),
    datasets: z.array(relPath).default([]).describe("Dataset JSON files (core Dataset: id, name, columns, rows, link)."),
    assets: z
      .array(
        z.union([
          relPath,
          z.object({
            path: relPath,
            id: z.string().regex(/^[\w-]+$/).optional().describe("Asset id templates use (`/api/assets/<id>`, `custom:<id>`). Default: pa-<pack>-<file name>."),
            kind: z.enum(["image", "icon"]).optional().describe("icon = SVG used as `custom:<id>`; default image."),
            name: z.string().optional(),
            keywords: z.array(z.string()).optional().describe("Icons: extra words the icon picker finds this by."),
          }),
        ]),
      )
      .default([]),
    fonts: z
      .array(
        z.object({
          path: relPath,
          family: z.string().min(1).describe("Family name templates use in `font`."),
          pixel: pixelSchema.optional().describe("Pixel fonts: font pixels per em and line height (see `pnpm --filter @labebal/core exec tsx scripts/font-grid.ts`)."),
          id: z.string().regex(/^[\w-]+$/).optional(),
        }),
      )
      .default([]),
  })
  .describe("labebal pack manifest (labebal-pack.json).");

export type PackManifest = z.output<typeof packManifestSchema>;
export type PackManifestInput = z.input<typeof packManifestSchema>;

export const packCollectionSchema = z
  .object({
    $schema: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    homepage: z.string().optional(),
    packs: z.array(relPath).min(1).describe("Paths to pack manifests (folder/labebal-pack.json) or bundle files."),
  })
  .describe("labebal pack collection (labebal-packs.json).");
export type PackCollection = z.output<typeof packCollectionSchema>;

/** Light structural checks (same as the app's API); the document model is versioned by `schema`. */
const idStr = z.string().min(1).max(200);
export const packTemplateSchema = z.looseObject({
  id: idStr,
  name: z.string().min(1),
  schema: z.literal(2),
  design: z.object({ w: z.number().positive(), h: z.number().positive() }),
  root: z.looseObject({ id: idStr, type: z.literal("frame") }),
  fields: z.array(z.looseObject({ key: z.string(), label: z.string() })),
});
export const packLabelSchema = z.looseObject({
  id: idStr.optional().describe("Stable id; default l-<pack>-<name>."),
  templateId: idStr.optional(),
  name: z.string().min(1),
  values: z.record(z.string(), z.string()).default({}),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  invert: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

/* ----------------------------------------------------------- resolved */

/** A pack with every file read: what installs, bundles and checks work on. */
export interface ResolvedPack {
  manifest: PackManifest;
  templates: Template[];
  labels: Label[];
  datasets: Dataset[];
  /** Images, icons and fonts (kind "font", meta `{ family, pixel? }`). Empty when loaded without assets. */
  assets: SharedAsset[];
  /** Item key (`template:<id>`...) -> file it came from, for error messages. */
  files: Record<string, string>;
  warnings: string[];
}

export interface PackIssue {
  level: "error" | "warning";
  file?: string;
  message: string;
}

export class PackError extends Error {
  constructor(
    message: string,
    readonly issues: PackIssue[] = [],
  ) {
    super(message);
  }
}

/** File access for loading packs: URLs (file://, https://, builtin:...) resolved against the manifest. */
export interface PackReader {
  text(url: string): Promise<string>;
  bytes(url: string): Promise<Uint8Array>;
}

export type PackDocKind = "manifest" | "collection" | "bundle" | "collection-bundle";

/** What a fetched JSON document is. */
export function packDocKind(doc: unknown): PackDocKind | null {
  if (!doc || typeof doc !== "object") return null;
  const o = doc as Record<string, unknown>;
  if (o.format === PACK_BUNDLE_FORMAT) return "bundle";
  if (o.format === PACK_COLLECTION_BUNDLE_FORMAT) return "collection-bundle";
  if (Array.isArray(o.packs)) return "collection";
  if (typeof o.id === "string" && typeof o.version === "string") return "manifest";
  return null;
}

const fmtZod = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

export function parseManifest(doc: unknown, file = PACK_MANIFEST): PackManifest {
  const r = packManifestSchema.safeParse(doc);
  if (!r.success) throw new PackError(`${file}: ${fmtZod(r.error)}`, [{ level: "error", file, message: fmtZod(r.error) }]);
  return r.data;
}

export function parseCollection(doc: unknown, file = PACK_COLLECTION): PackCollection {
  const r = packCollectionSchema.safeParse(doc);
  if (!r.success) throw new PackError(`${file}: ${fmtZod(r.error)}`, [{ level: "error", file, message: fmtZod(r.error) }]);
  return r.data;
}

/** Resolve a manifest-relative path to a URL (absolute URLs and leading / are refused). */
export function resolvePackPath(baseUrl: string, rel: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith("/") || rel.includes("\\")) throw new PackError(`${rel}: paths must be relative to the manifest`);
  return new URL(rel, baseUrl).toString();
}

const baseName = (p: string) => p.split("/").pop() ?? p;
const ext = (p: string) => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
export const mimeFor = (path: string) => MIME[ext(path)] ?? "application/octet-stream";

export const defaultAssetId = (packId: string, path: string) => `pa-${slugify(packId)}-${slugify(baseName(path).replace(/\.[^.]*$/, ""))}`;
export const defaultFontId = (packId: string, family: string) => `pf-${slugify(packId)}-${slugify(family)}`;

/* ------------------------------------------------------------- labels */

const truthy = (s: string) => /^(1|true|yes|y|x|on)$/i.test(s.trim());
const falsy = (s: string) => /^(0|false|no|n|off)$/i.test(s.trim());
const FOLDER_TAG = "folder:";
const RESERVED = new Set(["id", "name", "template", "templateid", "folder", "invert", "tags", "overrides"]);

const normFolder = (p: string) =>
  p
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");

/** Folder of a label (from its `folder:` tag), "" when none. */
export const labelFolder = (l: Pick<Label, "tags">) => {
  const t = l.tags?.find((x) => x.startsWith(FOLDER_TAG));
  return t ? normFolder(t.slice(FOLDER_TAG.length)) : "";
};

/** The label with its folder replaced (other tags kept). */
export function setLabelFolder<T extends Pick<Label, "tags">>(l: T, folder: string): T {
  const tags = (l.tags ?? []).filter((t) => !t.startsWith(FOLDER_TAG));
  const f = normFolder(folder);
  if (f) tags.push(FOLDER_TAG + f);
  const { tags: _t, ...rest } = l;
  void _t;
  return (tags.length ? { ...rest, tags } : rest) as T;
}

export interface LabelFileOptions {
  packId: string;
  /** Template for rows that don't name one. */
  template?: string;
  /** Folder for labels that don't name one. */
  folder?: string;
  file?: string;
}

/**
 * Labels from CSV. Columns (header names, case-insensitive for the reserved
 * ones): `id` (optional, default from the name), `name`, `template`,
 * `folder`, `invert` (yes/no), `tags` (separated by `;` or `,`), `overrides`
 * (JSON, per-node property tweaks), then one column per template field key.
 * An empty field cell is an empty value; leave a column out to use the
 * template field default.
 */
export type PackLabelDraft = Omit<Label, "id"> & { id?: string };

export function parseLabelsCsv(text: string, o: LabelFileOptions): { labels: PackLabelDraft[]; warnings: string[] } {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  const warnings = res.errors.filter((e) => e.code !== "UndetectableDelimiter").map((e) => `${o.file ?? "csv"} row ${(e.row ?? 0) + 1}: ${e.message}`);
  const [header = [], ...rows] = res.data;
  const cols = header.map((h) => h.trim());
  const key = cols.map((c) => (RESERVED.has(c.toLowerCase()) ? c.toLowerCase().replace("templateid", "template") : null));
  if (!key.includes("name")) warnings.push(`${o.file ?? "csv"}: no "name" column; labels are named after their first field`);
  const out: PackLabelDraft[] = [];
  rows.forEach((cells, r) => {
    const values: Record<string, string> = {};
    const l: Partial<Label> & { name: string } = { name: "" };
    let folder = o.folder ?? "";
    cols.forEach((c, i) => {
      const v = (cells[i] ?? "").replace(/\r\n/g, "\n");
      const k = key[i];
      if (!k) {
        if (c) values[c] = v;
        return;
      }
      const t = v.trim();
      if (k === "id" && t) l.id = t;
      else if (k === "name") l.name = t;
      else if (k === "template" && t) l.templateId = t;
      else if (k === "folder" && t) folder = t;
      else if (k === "invert" && t) {
        if (truthy(t)) l.invert = true;
        else if (falsy(t)) l.invert = false;
        else warnings.push(`${o.file ?? "csv"} row ${r + 2}: invert "${t}" is not yes/no`);
      } else if (k === "tags" && t) l.tags = t.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      else if (k === "overrides" && t) {
        try {
          l.overrides = JSON.parse(t);
        } catch {
          warnings.push(`${o.file ?? "csv"} row ${r + 2}: overrides is not valid JSON`);
        }
      }
    });
    l.values = values;
    if (!l.name) l.name = Object.values(values)[0]?.split("\n")[0] ?? `Label ${r + 1}`;
    const draft: PackLabelDraft = { ...l, templateId: l.templateId ?? o.template ?? "", values };
    out.push(folder ? setLabelFolder(draft, folder) : draft);
  });
  return { labels: out, warnings };
}

/** Value columns for labels: keys they use, in template field order first. */
const csvKeys = (labels: Label[], fieldKeys: string[]) => {
  const used = new Set(labels.flatMap((l) => Object.keys(l.values)));
  return [...fieldKeys.filter((k) => used.has(k)), ...[...used].filter((k) => !fieldKeys.includes(k))];
};

/** CSV holds these labels exactly (every label has a value for every column; an empty cell reads as ""). */
export const csvRoundTrips = (labels: Label[], fieldKeys: string[] = []) => {
  const keys = csvKeys(labels, fieldKeys);
  return labels.every((l) => keys.every((k) => k in l.values));
};

/** CSV for labels of one template (reverse of `parseLabelsCsv`). */
export function labelsToCsv(labels: Label[], fieldKeys: string[]): string {
  const keys = csvKeys(labels, fieldKeys);
  const anyInvert = labels.some((l) => l.invert !== undefined);
  const anyTags = labels.some((l) => (l.tags ?? []).some((t) => !t.startsWith(FOLDER_TAG)));
  const anyOverrides = labels.some((l) => l.overrides && Object.keys(l.overrides).length);
  const anyFolder = labels.some((l) => labelFolder(l));
  const fields = ["id", "name", "template", ...(anyFolder ? ["folder"] : []), ...(anyInvert ? ["invert"] : []), ...(anyTags ? ["tags"] : []), ...(anyOverrides ? ["overrides"] : []), ...keys];
  const data = labels.map((l) => [
    l.id,
    l.name,
    l.templateId,
    ...(anyFolder ? [labelFolder(l)] : []),
    ...(anyInvert ? [l.invert === undefined ? "" : l.invert ? "yes" : "no"] : []),
    ...(anyTags ? [(l.tags ?? []).filter((t) => !t.startsWith(FOLDER_TAG)).join("; ")] : []),
    ...(anyOverrides ? [l.overrides && Object.keys(l.overrides).length ? JSON.stringify(l.overrides) : ""] : []),
    ...keys.map((k) => l.values[k] ?? ""),
  ]);
  return Papa.unparse({ fields, data }, { newline: "\n" }) + "\n";
}

/** Stable ids for labels that don't have one: l-<pack>-<name slug>, -2, -3 for repeats. */
export function assignLabelIds(packId: string, labels: (Omit<Label, "id"> & { id?: string })[]): Label[] {
  const used = new Set(labels.map((l) => l.id).filter(Boolean) as string[]);
  return labels.map((l) => {
    if (l.id) return l as Label;
    const base = `l-${slugify(packId)}-${slugify(l.name) || "label"}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return { ...l, id };
  });
}

/* -------------------------------------------------------------- load */

const asArray = <T>(v: unknown, key: string): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>)[key])) return (v as Record<string, T[]>)[key];
  return [v as T];
};

export interface LoadPackOptions {
  /** Read image / font bytes (installs, bundles). Without it, `assets` stays empty. */
  withAssets?: boolean;
}

/**
 * Read a pack from its manifest URL (or take an already parsed manifest /
 * bundle). Throws PackError on unreadable files or invalid JSON; content
 * problems that don't stop a load are in `warnings` (see also `checkPack`).
 */
export async function loadPack(manifestUrl: string, reader: PackReader, opts: LoadPackOptions = {}, manifestDoc?: unknown): Promise<ResolvedPack> {
  const doc = manifestDoc ?? (await readJson(reader, manifestUrl, PACK_MANIFEST));
  if (packDocKind(doc) === "bundle") return parsePackBundle(doc, opts);
  const m = parseManifest(doc);
  const warnings: string[] = [];
  const files: Record<string, string> = {};
  const templates: Template[] = [];
  const labelsIn: (Omit<Label, "id"> & { id?: string })[] = [];
  const labelFile: string[] = [];

  for (const p of m.templates) {
    const json = await readJson(reader, resolvePackPath(manifestUrl, p), p);
    for (const t of asArray<unknown>(json, "templates")) {
      const r = packTemplateSchema.safeParse(t);
      if (!r.success) throw new PackError(`${p}: not a template (${fmtZod(r.error)})`, [{ level: "error", file: p, message: fmtZod(r.error) }]);
      const { $schema: _s, ...doc } = r.data as Record<string, unknown>;
      void _s;
      templates.push(doc as unknown as Template);
      files[`template:${r.data.id}`] = p;
    }
    // A library export may carry labels too.
    if (json && typeof json === "object" && !Array.isArray(json) && Array.isArray((json as { labels?: unknown }).labels)) {
      for (const l of (json as { labels: unknown[] }).labels) {
        labelsIn.push(parseJsonLabel(l, p, m, {}));
        labelFile.push(p);
      }
    }
  }

  for (const e of m.labels) {
    const entry = typeof e === "string" ? { path: e } : e;
    const url = resolvePackPath(manifestUrl, entry.path);
    const folder = entry.folder ?? m.folder;
    if (ext(entry.path) === "csv") {
      const r = parseLabelsCsv(await readText(reader, url, entry.path), { packId: m.id, template: entry.template, folder, file: entry.path });
      warnings.push(...r.warnings);
      for (const l of r.labels) {
        labelsIn.push(l);
        labelFile.push(entry.path);
      }
    } else {
      const json = await readJson(reader, url, entry.path);
      for (const l of asArray<unknown>(json, "labels")) {
        labelsIn.push(parseJsonLabel(l, entry.path, m, { template: entry.template, folder }));
        labelFile.push(entry.path);
      }
    }
  }
  const labels = assignLabelIds(m.id, labelsIn);
  labels.forEach((l, i) => (files[`label:${l.id}`] = labelFile[i]));

  const datasets: Dataset[] = [];
  for (const p of m.datasets) {
    const json = await readJson(reader, resolvePackPath(manifestUrl, p), p);
    for (const d of asArray<Dataset>(json, "datasets")) {
      if (!d || typeof d.id !== "string" || !Array.isArray(d.columns) || !Array.isArray(d.rows)) throw new PackError(`${p}: not a dataset (needs id, columns, rows)`);
      datasets.push(d);
      files[`dataset:${d.id}`] = p;
    }
  }

  const assets: SharedAsset[] = [];
  for (const e of m.assets) {
    const entry = typeof e === "string" ? { path: e } : e;
    const id = entry.id ?? defaultAssetId(m.id, entry.path);
    files[`asset:${id}`] = entry.path;
    const kind = entry.kind ?? "image";
    const meta = { pack: m.id, path: entry.path, ...(entry.keywords?.length ? { keywords: entry.keywords } : {}) };
    if (opts.withAssets) assets.push({ id, name: entry.name ?? baseName(entry.path), kind, mime: mimeFor(entry.path), meta, data: await readBytes(reader, resolvePackPath(manifestUrl, entry.path), entry.path) });
    else assets.push({ id, name: entry.name ?? baseName(entry.path), kind, mime: mimeFor(entry.path), meta, data: new Uint8Array() });
  }
  for (const f of m.fonts) {
    const id = f.id ?? defaultFontId(m.id, f.family);
    files[`asset:${id}`] = f.path;
    const meta = { family: f.family, ...(f.pixel ? { pixel: f.pixel } : {}), pack: m.id, path: f.path };
    const data = opts.withAssets ? await readBytes(reader, resolvePackPath(manifestUrl, f.path), f.path) : new Uint8Array();
    assets.push({ id, name: baseName(f.path), kind: "font", mime: mimeFor(f.path), meta, data });
  }

  return { manifest: m, templates, labels, datasets, assets, files, warnings };
}

function parseJsonLabel(l: unknown, file: string, m: PackManifest, o: { template?: string; folder?: string }): Omit<Label, "id"> & { id?: string } {
  const src = l && typeof l === "object" ? { ...(l as Record<string, unknown>) } : l;
  if (src && typeof src === "object" && "template" in src && !("templateId" in src)) {
    (src as Record<string, unknown>).templateId = (src as Record<string, unknown>).template;
    delete (src as Record<string, unknown>).template;
  }
  const r = packLabelSchema.safeParse(src);
  if (!r.success) throw new PackError(`${file}: not a label (${fmtZod(r.error)})`, [{ level: "error", file, message: fmtZod(r.error) }]);
  const out = { ...r.data, templateId: r.data.templateId ?? o.template ?? "" } as Omit<Label, "id"> & { id?: string };
  const folder = o.folder ?? m.folder;
  return folder && !labelFolder(out) ? setLabelFolder(out, folder) : out;
}

async function readText(reader: PackReader, url: string, file: string) {
  try {
    return await reader.text(url);
  } catch (e) {
    throw new PackError(`${file}: ${(e as Error).message ?? e}`, [{ level: "error", file, message: String((e as Error).message ?? e) }]);
  }
}
async function readBytes(reader: PackReader, url: string, file: string) {
  try {
    return await reader.bytes(url);
  } catch (e) {
    throw new PackError(`${file}: ${(e as Error).message ?? e}`, [{ level: "error", file, message: String((e as Error).message ?? e) }]);
  }
}
async function readJson(reader: PackReader, url: string, file: string): Promise<unknown> {
  const text = await readText(reader, url, file);
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new PackError(`${file}: invalid JSON (${(e as Error).message})`, [{ level: "error", file, message: `invalid JSON (${(e as Error).message})` }]);
  }
}

/** Entry in a source: one pack (manifest URL, or a bundle inlined in a collection bundle). */
export interface PackEntry {
  url: string;
  /** Already-read document (bundle or manifest), when the source was a bundle. */
  doc?: unknown;
}

/** Packs listed by a source document (manifest, collection or bundle). */
export async function listPackEntries(url: string, reader: PackReader): Promise<{ kind: PackDocKind; name?: string; description?: string; entries: PackEntry[] }> {
  const doc = await readJson(reader, url, baseName(new URL(url).pathname) || url);
  const kind = packDocKind(doc);
  if (!kind) throw new PackError(`${url}: not a labebal pack, collection or bundle`);
  if (kind === "manifest" || kind === "bundle") return { kind, entries: [{ url, doc }] };
  if (kind === "collection-bundle") {
    const c = doc as { name?: string; description?: string; packs: unknown[] };
    return { kind, name: c.name, description: c.description, entries: (c.packs ?? []).map((p, i) => ({ url: `${url}#${i}`, doc: p })) };
  }
  const c = parseCollection(doc);
  return { kind, name: c.name, description: c.description, entries: c.packs.map((p) => ({ url: resolvePackPath(url, p) })) };
}

/* ------------------------------------------------------------- bundle */

export interface PackBundle {
  format: typeof PACK_BUNDLE_FORMAT;
  version: number;
  bundledAt: string;
  manifest: PackManifest;
  templates: Template[];
  labels: Label[];
  datasets: Dataset[];
  /** Binary data base64-encoded. */
  assets: (Omit<SharedAsset, "data"> & { data: string })[];
}

/** One self-contained JSON object for a pack (files inlined, assets base64). */
export function makePackBundle(p: ResolvedPack): PackBundle {
  return {
    format: PACK_BUNDLE_FORMAT,
    version: PACK_FORMAT_VERSION,
    bundledAt: new Date().toISOString(),
    manifest: p.manifest,
    templates: p.templates,
    labels: p.labels,
    datasets: p.datasets,
    assets: p.assets.map((a) => ({ ...a, data: toBase64(a.data) })),
  };
}

/** Several bundles in one file (a bundled collection). */
export const makeCollectionBundle = (name: string, packs: ResolvedPack[], description?: string) => ({
  format: PACK_COLLECTION_BUNDLE_FORMAT,
  version: PACK_FORMAT_VERSION,
  name,
  ...(description ? { description } : {}),
  packs: packs.map(makePackBundle),
});

export function parsePackBundle(doc: unknown, opts: LoadPackOptions = {}): ResolvedPack {
  const b = doc as Partial<PackBundle> | null;
  if (!b || b.format !== PACK_BUNDLE_FORMAT) throw new PackError("not a labebal pack bundle");
  if ((b.version ?? 0) > PACK_FORMAT_VERSION) throw new PackError("this pack bundle is from a newer labebal");
  const manifest = parseManifest(b.manifest, "bundle manifest");
  const templates = (b.templates ?? []).map((t) => {
    const r = packTemplateSchema.safeParse(t);
    if (!r.success) throw new PackError(`bundle: not a template (${fmtZod(r.error)})`);
    return t;
  });
  const labels = assignLabelIds(manifest.id, (b.labels ?? []) as Label[]);
  const files: Record<string, string> = {};
  const assets = (b.assets ?? []).map((a) => ({ ...a, meta: a.meta ?? {}, data: opts.withAssets === false ? new Uint8Array() : fromBase64(a.data) }));
  return { manifest, templates, labels, datasets: b.datasets ?? [], assets, files, warnings: [] };
}

/* ------------------------------------------------------------- checks */

/** Font families usable without a pack font. */
const knownFamilies = () => new Set([...BUILTIN_FONTS.map((f) => f.family), ...SYSTEM_FONTS]);

/**
 * Content checks for authors (`pack check`) and installs: duplicate ids,
 * labels pointing at templates the pack lacks, values for unknown fields,
 * fonts and assets that are used but not shipped.
 */
export function checkPack(p: ResolvedPack, o: { extraFonts?: string[] } = {}): PackIssue[] {
  const issues: PackIssue[] = [];
  const file = (k: string) => p.files[k];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push({ level: "error", file: file(`${kind}:${id}`), message: `duplicate ${kind} id "${id}"` });
      seen.add(id);
    }
  };
  dup("template", p.templates.map((t) => t.id));
  dup("label", p.labels.map((l) => l.id));
  dup("dataset", p.datasets.map((d) => d.id));
  dup("asset", p.assets.map((a) => a.id));

  const byId = new Map(p.templates.map((t) => [t.id, t]));
  for (const l of p.labels) {
    if (!l.templateId) {
      issues.push({ level: "error", file: file(`label:${l.id}`), message: `label "${l.name}" has no template (add a template column / "template" in the manifest entry)` });
      continue;
    }
    const t = byId.get(l.templateId);
    if (!t) {
      issues.push({ level: "warning", file: file(`label:${l.id}`), message: `label "${l.name}": template "${l.templateId}" is not in this pack (it must already be in the library)` });
      continue;
    }
    const keys = new Set(t.fields.map((f) => f.key));
    const unknown = Object.keys(l.values).filter((k) => !keys.has(k));
    if (unknown.length) issues.push({ level: "warning", file: file(`label:${l.id}`), message: `label "${l.name}": ${unknown.map((k) => `"${k}"`).join(", ")} not a field of ${t.id}` });
  }
  for (const d of p.datasets)
    if (d.link?.templateId && !byId.has(d.link.templateId))
      issues.push({ level: "warning", file: file(`dataset:${d.id}`), message: `dataset "${d.name}" links template "${d.link.templateId}" which is not in this pack` });

  const fonts = new Set([...knownFamilies(), ...(o.extraFonts ?? []), ...p.assets.filter((a) => a.kind === "font").map((a) => String(a.meta.family ?? ""))]);
  const assetIds = new Set(p.assets.map((a) => a.id));
  for (const t of p.templates) {
    const refs = templateAssetRefs(t, p.labels.filter((l) => l.templateId === t.id));
    for (const f of refs.fonts) if (!fonts.has(f)) issues.push({ level: "warning", file: file(`template:${t.id}`), message: `template "${t.name}" uses font "${f}", which is neither built in nor in this pack's fonts` });
    for (const a of refs.assetIds) if (!assetIds.has(a)) issues.push({ level: "warning", file: file(`template:${t.id}`), message: `template "${t.name}" uses asset "${a}", which is not in this pack's assets` });
  }
  for (const w of p.warnings) issues.push({ level: "warning", message: w });
  return issues;
}

/* ------------------------------------------------- hashes + versions */

/** JSON with sorted keys and no undefined values: equal content = equal text. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PackItemKind = "template" | "label" | "dataset" | "asset";

/**
 * What counts as "changed here" for a label: everything but its folder
 * (moving a pack label to another folder is not an edit, and updates keep
 * the folder you chose). Empty overrides / tags are the same as none.
 */
export function labelContent(l: Label) {
  const tags = (l.tags ?? []).filter((t) => !t.startsWith(FOLDER_TAG));
  return {
    templateId: l.templateId,
    name: l.name,
    values: l.values ?? {},
    ...(l.overrides && Object.keys(l.overrides).length ? { overrides: l.overrides } : {}),
    ...(l.invert !== undefined && l.invert !== null ? { invert: l.invert } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

export const datasetContent = (d: Dataset) => ({ name: d.name, columns: d.columns, link: d.link ?? null, rows: d.rows.map((r) => ({ id: r.id, values: r.values })) });

/** Content hash of a library item (labels ignore folders, see `labelContent`). */
export async function itemHash(kind: PackItemKind, item: unknown): Promise<string> {
  if (kind === "asset") {
    const a = item as Pick<SharedAsset, "data" | "kind" | "mime"> & { meta?: Record<string, unknown> };
    const meta = { ...(a.meta ?? {}) };
    delete meta.pack;
    delete meta.path;
    return sha256Hex(stableJson({ kind: a.kind, mime: a.mime, meta, data: await sha256Hex(a.data) }));
  }
  const body = kind === "label" ? labelContent(item as Label) : kind === "dataset" ? datasetContent(item as Dataset) : item;
  return sha256Hex(stableJson(body));
}

/** Compare semver strings (pre-releases sort before the release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const s = v.replace(/^v/, "").split("+")[0];
    const dash = s.indexOf("-");
    const core = dash < 0 ? s : s.slice(0, dash);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: dash < 0 ? "" : s.slice(dash + 1) };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/* -------------------------------------------------------- merge rules */

export const itemKey = (kind: PackItemKind, id: string) => `${kind}:${id}`;

export interface IncomingItem {
  kind: PackItemKind;
  id: string;
  /** Hash of the pack's version. */
  hash: string;
}

/** What the library holds for an item id. */
export interface ExistingItem {
  /** Row exists in the library. */
  exists: boolean;
  /** Hash of the library's current content (when it exists). */
  hash?: string;
  /** Pack that owns the row (null = the user's own / an old seed). */
  owner: string | null;
  /** Hash of the pack version recorded for it (owned items). */
  packHash?: string;
}

export type PackOp =
  /** New: write it. */
  | "insert"
  /** Unchanged here, pack changed: write the pack version. */
  | "overwrite"
  /** Same as the pack version already: just (re)link it. */
  | "unchanged"
  /** Changed here: keep the library's version, record the pack version (reset restores it). */
  | "keep"
  /** Same id belongs to another pack: left alone. */
  | "conflict"
  /** Deleted here earlier: not brought back (reset restores it). */
  | "deleted"
  /** Gone from the pack and unchanged here: delete it. */
  | "delete"
  /** Gone from the pack but changed here: keep it as the user's own. */
  | "detach";

export interface PackAction {
  kind: PackItemKind;
  id: string;
  op: PackOp;
  /** Existing row not owned by any pack, taken over by this one (old seeds, earlier copies). */
  adopted?: boolean;
  /** Owner of the conflicting item. */
  owner?: string;
}

/**
 * Install / update plan. `incoming` = the pack version being installed;
 * `existing` = what the library has for every incoming id and for every
 * item the pack owned before (`owned`).
 */
export function planPackSync(packId: string, incoming: IncomingItem[], existing: Map<string, ExistingItem>, owned: { kind: PackItemKind; id: string }[] = []): PackAction[] {
  const actions: PackAction[] = [];
  const seen = new Set<string>();
  for (const it of incoming) {
    const key = itemKey(it.kind, it.id);
    seen.add(key);
    const ex = existing.get(key) ?? { exists: false, owner: null };
    if (ex.owner && ex.owner !== packId) {
      actions.push({ kind: it.kind, id: it.id, op: "conflict", owner: ex.owner });
      continue;
    }
    const mine = ex.owner === packId;
    if (!ex.exists) {
      actions.push({ kind: it.kind, id: it.id, op: mine ? "deleted" : "insert" });
      continue;
    }
    if (ex.hash === it.hash) actions.push({ kind: it.kind, id: it.id, op: "unchanged", ...(mine ? {} : { adopted: true }) });
    else if (mine && ex.hash === ex.packHash) actions.push({ kind: it.kind, id: it.id, op: "overwrite" });
    else actions.push({ kind: it.kind, id: it.id, op: "keep", ...(mine ? {} : { adopted: true }) });
  }
  for (const o of owned) {
    const key = itemKey(o.kind, o.id);
    if (seen.has(key)) continue;
    const ex = existing.get(key);
    if (!ex?.exists) actions.push({ kind: o.kind, id: o.id, op: "delete" });
    else actions.push({ kind: o.kind, id: o.id, op: ex.hash === ex.packHash ? "delete" : "detach" });
  }
  return actions;
}

export interface RemovePlan {
  /** Unchanged items: deleted. */
  remove: { kind: PackItemKind; id: string }[];
  /** Changed here, or templates that the user's own labels use: asked about. */
  changed: { kind: PackItemKind; id: string; reason: "changed" | "used" }[];
}

/**
 * Removing a pack deletes what is unchanged; changed items (and templates
 * that labels outside the pack use, which a delete would take with them)
 * are listed so the user can keep them.
 */
export function planPackRemove(owned: { kind: PackItemKind; id: string; hash?: string; packHash?: string; exists: boolean }[], templatesInUse: Set<string> = new Set()): RemovePlan {
  const plan: RemovePlan = { remove: [], changed: [] };
  for (const o of owned) {
    if (!o.exists) continue;
    if (o.hash !== o.packHash) plan.changed.push({ kind: o.kind, id: o.id, reason: "changed" });
    else if (o.kind === "template" && templatesInUse.has(o.id)) plan.changed.push({ kind: o.kind, id: o.id, reason: "used" });
    else plan.remove.push({ kind: o.kind, id: o.id });
  }
  return plan;
}

/* ------------------------------------------------------ source links */

export interface ResolvedSource {
  /** URL of the manifest / collection / bundle to read first. */
  url: string;
  /** Other URLs to try when `url` is missing (a GitHub folder: collection first, then manifest). */
  fallbacks: string[];
  /** Host an access token may be sent to. */
  tokenHost: string;
  github?: { owner: string; repo: string; ref: string; path: string };
}

const GH_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/**
 * What people paste into "Add source":
 *
 * - a URL to a `labebal-pack.json`, `labebal-packs.json` or bundle `.json`;
 *   a URL ending in `/` tries the collection, then the manifest, in that folder;
 * - GitHub shorthand `owner/repo[/path][@ref]` (also `github:owner/repo...`
 *   and github.com/owner/repo/tree|blob/ref/path links), read from
 *   raw.githubusercontent.com; without a file name the collection is tried,
 *   then the manifest.
 */
export function resolveSourceInput(input: string): ResolvedSource {
  const s = input.trim();
  if (!s) throw new PackError("enter a URL or owner/repo");
  const gh = githubFromUrl(s) ?? githubShorthand(s);
  if (gh) {
    const raw = (p: string) => `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${encodeURIComponent(gh.ref).replace(/%2F/g, "/")}/${p}`;
    const dir = gh.path.replace(/\/+$/, "");
    const isFile = /\.json$/i.test(dir);
    const join = (f: string) => (dir ? `${dir}/${f}` : f);
    const urls = isFile ? [raw(dir)] : [raw(join(PACK_COLLECTION)), raw(join(PACK_MANIFEST))];
    return { url: urls[0], fallbacks: urls.slice(1), tokenHost: "raw.githubusercontent.com", github: { ...gh, path: dir } };
  }
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new PackError(`"${s}" is not a URL or owner/repo[/path][@ref]`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PackError("only http(s) URLs can be added as sources");
  if (url.username || url.password) throw new PackError("put credentials in the token field, not in the URL");
  if (url.pathname.endsWith("/")) {
    const a = new URL(PACK_COLLECTION, url).toString();
    const b = new URL(PACK_MANIFEST, url).toString();
    return { url: a, fallbacks: [b], tokenHost: url.host };
  }
  return { url: url.toString(), fallbacks: [], tokenHost: url.host };
}

function githubShorthand(s: string): { owner: string; repo: string; ref: string; path: string } | null {
  const t = s.replace(/^github:/i, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("/") || t.includes(" ")) return null;
  const at = t.lastIndexOf("@");
  const ref = at > 0 ? t.slice(at + 1) : "";
  const body = at > 0 ? t.slice(0, at) : t;
  const [owner, repo, ...rest] = body.split("/");
  if (!owner || !repo || !GH_NAME.test(owner) || !GH_NAME.test(repo.replace(/\.git$/, ""))) return null;
  if (owner.includes(".") && !rest.length && !s.startsWith("github:")) {
    // "example.com/packs" looks like a host, not an owner.
    return null;
  }
  if (at > 0 && !/^[\w./-]+$/.test(ref)) return null;
  return { owner, repo: repo.replace(/\.git$/, ""), ref: ref || "HEAD", path: rest.filter(Boolean).join("/") };
}

function githubFromUrl(s: string): { owner: string; repo: string; ref: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  const [owner, repo, mode, ref, ...rest] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  if (mode && mode !== "tree" && mode !== "blob") return null;
  return { owner, repo: repo.replace(/\.git$/, ""), ref: ref ?? "HEAD", path: rest.join("/") };
}

/* -------------------------------------------------------- export */

export interface PackFile {
  path: string;
  data: string | Uint8Array;
}

/**
 * Files of a pack folder (manifest + templates/*.json + labels/*.csv +
 * datasets/*.json + assets/fonts) from library items: "Export as pack" in the
 * app, ready to commit to a git repo.
 */
export function packFiles(meta: Pick<PackManifest, "id" | "name" | "version"> & Partial<PackManifest>, items: { templates: Template[]; labels: Label[]; datasets?: Dataset[]; assets?: SharedAsset[] }): PackFile[] {
  const files: PackFile[] = [];
  const used = new Set<string>();
  const unique = (dir: string, name: string, extn: string) => {
    const base = slugify(name) || "item";
    let p = `${dir}/${base}.${extn}`;
    for (let k = 2; used.has(p); k++) p = `${dir}/${base}-${k}.${extn}`;
    used.add(p);
    return p;
  };
  const m: PackManifestInput = {
    $schema: `${PACK_SCHEMA_BASE}labebal-pack.schema.json`,
    id: meta.id,
    name: meta.name,
    version: meta.version,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.homepage ? { homepage: meta.homepage } : {}),
    ...(meta.folder ? { folder: meta.folder } : {}),
    templates: [],
    labels: [],
  };
  for (const t of items.templates) {
    const p = unique("templates", t.name, "json");
    m.templates!.push(p);
    files.push({ path: p, data: JSON.stringify(t, null, 2) + "\n" });
  }
  const byTemplate = new Map<string, Label[]>();
  for (const l of items.labels) byTemplate.set(l.templateId, [...(byTemplate.get(l.templateId) ?? []), l]);
  for (const [tid, ls] of byTemplate) {
    const t = items.templates.find((x) => x.id === tid);
    const keys = t?.fields.map((f) => f.key) ?? [];
    // CSV when it holds the labels exactly; JSON keeps "missing" (template default) apart from "".
    const csv = csvRoundTrips(ls, keys);
    const p = unique("labels", t?.name ?? tid, csv ? "csv" : "json");
    m.labels!.push(p);
    files.push({ path: p, data: csv ? labelsToCsv(ls, keys) : JSON.stringify(ls, null, 2) + "\n" });
  }
  if (items.datasets?.length) {
    m.datasets = [];
    for (const d of items.datasets) {
      const p = unique("datasets", d.name, "json");
      m.datasets.push(p);
      const { updatedAt: _u, ...rest } = d;
      void _u;
      files.push({ path: p, data: JSON.stringify(rest, null, 2) + "\n" });
    }
  }
  for (const a of items.assets ?? []) {
    const extn = ext(a.name) || Object.entries(MIME).find(([, v]) => v === a.mime)?.[0] || "bin";
    if (a.kind === "font") {
      const family = String(a.meta.family ?? a.name.replace(/\.[^.]*$/, ""));
      const p = unique("fonts", family, extn);
      const pixel = a.meta.pixel as { pxPerEm: number; linePx: number } | undefined;
      (m.fonts ??= []).push({ path: p, family, ...(pixel ? { pixel } : {}), id: a.id });
      files.push({ path: p, data: a.data });
    } else {
      const p = unique("assets", a.name.replace(/\.[^.]*$/, ""), extn);
      (m.assets ??= []).push({ path: p, id: a.id, ...(a.kind === "icon" ? { kind: "icon" as const } : {}), name: a.name, ...(Array.isArray(a.meta.keywords) ? { keywords: a.meta.keywords as string[] } : {}) });
      files.push({ path: p, data: a.data });
    }
  }
  files.unshift({ path: PACK_MANIFEST, data: JSON.stringify(m, null, 2) + "\n" });
  return files;
}

/** JSON Schemas for editor autocomplete (`packs/schema/*.schema.json`). */
export function packJsonSchemas(): Record<string, unknown> {
  const opts = { io: "input" as const, unrepresentable: "any" as const };
  return {
    "labebal-pack.schema.json": { ...z.toJSONSchema(packManifestSchema, opts), $id: `${PACK_SCHEMA_BASE}labebal-pack.schema.json`, title: "labebal pack manifest" },
    "labebal-packs.schema.json": { ...z.toJSONSchema(packCollectionSchema, opts), $id: `${PACK_SCHEMA_BASE}labebal-packs.schema.json`, title: "labebal pack collection" },
    "template.schema.json": {
      ...z.toJSONSchema(z.union([packTemplateSchema, z.array(packTemplateSchema), z.looseObject({ templates: z.array(packTemplateSchema) })]), opts),
      $id: `${PACK_SCHEMA_BASE}template.schema.json`,
      title: "labebal template file (structural check only; see docs/TEMPLATES.md)",
    },
    "labels.schema.json": {
      ...z.toJSONSchema(z.union([packLabelSchema, z.array(packLabelSchema), z.looseObject({ labels: z.array(packLabelSchema) })]), opts),
      $id: `${PACK_SCHEMA_BASE}labels.schema.json`,
      title: "labebal labels file",
    },
  };
}
