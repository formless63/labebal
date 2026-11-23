/**
 * Pack membership for the library view: hides templates / labels of
 * disabled packs (and labels on hidden templates) and tags pack items with
 * their pack and whether they were changed here. Kept apart from packs.ts so
 * library.ts can use it without an import cycle.
 */
import { itemHash, type Library } from "@labebal/core";
import type { DB } from "../db";
import { packItems, packs } from "../db/schema";
import type { LibraryWithPacks, PackOverlay } from "../features/packs/types";

export interface PackMembership {
  packs: (typeof packs.$inferSelect)[];
  items: { packId: string; kind: string; itemId: string; hash: string }[];
}

export async function packMembership(db: DB): Promise<PackMembership> {
  const [p, i] = await Promise.all([
    db.select().from(packs),
    db.select({ packId: packItems.packId, kind: packItems.kind, itemId: packItems.itemId, hash: packItems.hash }).from(packItems),
  ]);
  return { packs: p, items: i };
}

/** Ids hidden because their pack is disabled. */
export function hiddenIds(m: PackMembership) {
  const off = new Set(m.packs.filter((p) => !p.enabled).map((p) => p.id));
  const hidden = { template: new Set<string>(), label: new Set<string>(), dataset: new Set<string>() };
  for (const i of m.items) if (off.has(i.packId) && i.kind in hidden) hidden[i.kind as keyof typeof hidden].add(i.itemId);
  return hidden;
}

export async function withPackOverlay(db: DB, lib: Library): Promise<LibraryWithPacks> {
  const m = await packMembership(db);
  if (!m.packs.length) return lib;
  const hidden = hiddenIds(m);
  const templates = lib.templates.filter((t) => !hidden.template.has(t.id));
  const labels = lib.labels.filter((l) => !hidden.label.has(l.id) && !hidden.template.has(l.templateId));
  const byKey = new Map(m.items.map((i) => [`${i.kind}:${i.itemId}`, i]));
  const items: PackOverlay["items"] = {};
  await Promise.all([
    ...templates.map(async (t) => {
      const it = byKey.get(`template:${t.id}`);
      if (it) items[`template:${t.id}`] = { pack: it.packId, changed: (await itemHash("template", t)) !== it.hash };
    }),
    ...labels.map(async (l) => {
      const it = byKey.get(`label:${l.id}`);
      if (it) items[`label:${l.id}`] = { pack: it.packId, changed: (await itemHash("label", l)) !== it.hash };
    }),
  ]);
  return {
    ...lib,
    templates,
    labels,
    packs: { packs: m.packs.map((p) => ({ id: p.id, name: p.name, version: p.version, enabled: p.enabled })), items },
  };
}
