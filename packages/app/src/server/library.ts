/**
 * Library repository: the only place that touches the label tables.
 * API routes are thin wrappers around these functions (easy to re-wrap in another host).
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
  UPLOADED_SUFFIX,
  makeBundle,
  partsUsedBy,
  renameBundle,
  sanitizeSvg,
  templateAssetRefs,
  type Label,
  type Library,
  type LibraryParts,
  type SharedAsset,
  type Template,
  type TemplateBundle,
} from "@labebal/core";
import { getDb } from "../db";
import { assets, labels, templates } from "../db/schema";
import { withPackOverlay } from "./pack-overlay";
import { snapshotOnSave } from "./versions";
import { getParts, importParts } from "./parts";
import type { LibraryWithPacks } from "../features/packs/types";

export const toLabel = (r: typeof labels.$inferSelect): Label => ({
  id: r.id,
  templateId: r.templateId,
  name: r.name,
  values: r.values,
  ...(r.overrides ? { overrides: r.overrides } : {}),
  ...(r.invert !== null ? { invert: r.invert } : {}),
  ...(r.tags.length ? { tags: r.tags } : {}),
});

/** Whole library as the app shows it: disabled packs' items hidden, pack items tagged (`packs`). */
export async function getLibrary(): Promise<LibraryWithPacks> {
  const db = await getDb();
  const [t, l, parts] = await Promise.all([
    db.select().from(templates).orderBy(asc(templates.name)),
    db.select().from(labels).orderBy(asc(labels.name)),
    getParts(),
  ]);
  // Text styles and components travel with the library (export / backup / packs).
  return withPackOverlay(db, { version: 2, templates: t.map((r) => r.doc), labels: l.map(toLabel), styles: parts.styles, components: parts.components });
}

/** Save a template; also records it in the version history (see versions.ts). */
export async function upsertTemplate(doc: Template, who = "") {
  const db = await getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    const [prev] = await tx.select({ doc: templates.doc }).from(templates).where(eq(templates.id, doc.id));
    await tx
      .insert(templates)
      .values({ id: doc.id, name: doc.name, doc })
      .onConflictDoUpdate({ target: templates.id, set: { name: doc.name, doc, updatedAt: now } });
    await snapshotOnSave(doc, who, tx, prev?.doc);
  });
  return doc;
}

export async function deleteTemplate(id: string) {
  const db = await getDb();
  await db.delete(templates).where(eq(templates.id, id));
}

export const labelRow = (l: Label) => ({
  id: l.id,
  templateId: l.templateId,
  name: l.name,
  values: l.values,
  overrides: l.overrides ?? null,
  invert: l.invert ?? null,
  tags: l.tags ?? [],
});

export async function upsertLabel(l: Label) {
  const db = await getDb();
  const row = labelRow(l);
  await db
    .insert(labels)
    .values(row)
    .onConflictDoUpdate({ target: labels.id, set: { ...row, updatedAt: new Date() } });
  return l;
}

export async function deleteLabels(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.delete(labels).where(inArray(labels.id, ids));
}

/* ------------------------------------------------ share one template */

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
export const SHARE_MIME: Record<SharedAsset["kind"], RegExp> = {
  image: /^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/,
  font: /^(font\/(ttf|otf|woff2?)|application\/(x-font-ttf|x-font-otf|font-woff|octet-stream))$/,
  icon: /^image\/svg\+xml$/,
};

/** A template, optionally its labels, and every uploaded image / icon / font it uses. */
export async function exportTemplateBundle(id: string, withLabels: boolean): Promise<TemplateBundle | null> {
  const db = await getDb();
  const [t] = await db.select().from(templates).where(eq(templates.id, id));
  if (!t) return null;
  const ls = withLabels ? (await db.select().from(labels).where(eq(labels.templateId, id)).orderBy(asc(labels.name))).map(toLabel) : [];
  // The styles and components it uses go along (and whatever assets those use).
  const used = partsUsedBy(t.doc, await getParts());
  return makeBundle(t.doc, ls, await usedAssets([t.doc], ls, used), used);
}

/** Uploaded images / icons / fonts that templates (and their labels, styles, components) use (share files, pack export). */
export async function usedAssets(ts: Template[], ls: Label[], used?: Parameters<typeof templateAssetRefs>[2]): Promise<SharedAsset[]> {
  const db = await getDb();
  const refs = ts.map((t) => templateAssetRefs(t, ls.filter((l) => l.templateId === t.id), used));
  const families = new Set(refs.flatMap((r) => r.fonts));
  const fontRows = families.size ? await db.select().from(assets).where(eq(assets.kind, "font")) : [];
  const fontIds = fontRows
    .filter((a) => {
      const family = String((a.meta as { family?: string }).family ?? "").trim() || a.name.replace(FONT_EXT, "");
      return families.has(family) || families.has(family + UPLOADED_SUFFIX);
    })
    .map((a) => a.id);
  const ids = [...new Set([...refs.flatMap((r) => r.assetIds), ...fontIds])];
  const rows = ids.length ? await db.select().from(assets).where(inArray(assets.id, ids)) : [];
  return rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, mime: a.mime, meta: a.meta, data: new Uint8Array(a.data) }));
}

export interface BundleImportResult {
  template: Pick<Template, "id" | "name">;
  labels: number;
  assets: number;
}

/**
 * Import a shared template. Assets are added when their id is new (ids are
 * random, so an existing id is the same file). With `asCopy`, the template and
 * its labels get new ids (keeps an existing template with the same id).
 */
export async function importTemplateBundle(bundle: TemplateBundle, opts: { asCopy?: boolean; who?: string } = {}): Promise<BundleImportResult> {
  const b = opts.asCopy ? renameBundle(bundle, `t-${crypto.randomUUID().slice(0, 8)}`) : bundle;
  const db = await getDb();
  let added = 0;
  await db.transaction(async (tx) => {
    // Styles and components it uses: added when missing (an existing one with the same id is kept).
    await importParts(tx, { styles: b.styles, components: b.components }, { onlyNew: true });
    for (const a of b.assets) {
      if (!SHARE_MIME[a.kind]?.test(a.mime) || a.data.length > 8 * 1024 * 1024) continue;
      let data = Buffer.from(a.data);
      if (a.kind === "icon") {
        const clean = sanitizeSvg(data.toString("utf8"));
        if (!clean) continue;
        data = Buffer.from(clean, "utf8");
      }
      const r = await tx
        .insert(assets)
        .values({ id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: data.length, data, meta: a.meta ?? {} })
        .onConflictDoNothing()
        .returning({ id: assets.id });
      added += r.length;
    }
  });
  await importLibrary({ templates: [b.template], labels: b.labels }, opts.who);
  return { template: { id: b.template.id, name: b.template.name }, labels: b.labels.length, assets: added };
}

export async function templateExists(id: string) {
  const db = await getDb();
  const [r] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, id));
  return !!r;
}

/** Merge a library (templates/labels/styles/components with the same id are replaced). */
export async function importLibrary(lib: Pick<Library, "templates" | "labels"> & LibraryParts, who = "") {
  const db = await getDb();
  let parts = { styles: 0, components: 0 };
  await db.transaction(async (tx) => {
    parts = await importParts(tx, lib);
    for (const doc of lib.templates) {
      const [prev] = await tx.select({ doc: templates.doc }).from(templates).where(eq(templates.id, doc.id));
      await tx
        .insert(templates)
        .values({ id: doc.id, name: doc.name, doc })
        .onConflictDoUpdate({ target: templates.id, set: { name: doc.name, doc, updatedAt: new Date() } });
      await snapshotOnSave(doc, who, tx, prev?.doc);
    }
    for (const l of lib.labels) {
      const row = labelRow(l);
      await tx.insert(labels).values(row).onConflictDoUpdate({ target: labels.id, set: { ...row, updatedAt: new Date() } });
    }
  });
  return { templates: lib.templates.length, labels: lib.labels.length, ...parts };
}
