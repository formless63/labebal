/** Operations behind the public /api/v1 API (token-protected routes). */
import { asc, inArray } from "drizzle-orm";
import { keyedLabelId, type Label } from "@labebal/core";
import { getDb } from "../db";
import { labels, templates } from "../db/schema";
import { upsertLabel } from "./library";
import type { V1Label } from "./validate-data";

export async function listTemplatesPublic() {
  const db = await getDb();
  const rs = await db.select().from(templates).orderBy(asc(templates.name));
  return rs.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.doc.description ?? "",
    design: r.doc.design,
    fields: r.doc.fields,
    tags: r.doc.tags ?? [],
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface UpsertResult {
  created: string[];
  updated: string[];
  errors: { index: number; error: string }[];
}

/** Upsert labels by id, or by template + key (id derived from both). */
export async function upsertLabelsPublic(input: V1Label[], merge: boolean): Promise<UpsertResult> {
  const db = await getDb();
  const tplIds = [...new Set(input.map((l) => l.templateId))];
  const known = new Set((await db.select({ id: templates.id }).from(templates).where(inArray(templates.id, tplIds))).map((r) => r.id));
  const ids = input.map((l) => l.id ?? keyedLabelId(l.templateId, l.key!));
  const existing = new Map((await db.select().from(labels).where(inArray(labels.id, ids))).map((r) => [r.id, r]));
  const out: UpsertResult = { created: [], updated: [], errors: [] };
  for (const [i, l] of input.entries()) {
    if (!known.has(l.templateId)) {
      out.errors.push({ index: i, error: `unknown templateId "${l.templateId}" (see GET /api/v1/templates)` });
      continue;
    }
    const id = ids[i];
    const prev = existing.get(id);
    const keep = merge && prev;
    const overrides = l.overrides ?? (keep ? (prev.overrides ?? undefined) : undefined);
    const invert = l.invert ?? (keep ? (prev.invert ?? undefined) : undefined);
    const label: Label = {
      id,
      templateId: l.templateId,
      name: l.name ?? prev?.name ?? l.key ?? (Object.values(l.values)[0] || id),
      values: keep ? { ...prev.values, ...l.values } : l.values,
      ...(overrides ? { overrides: overrides as Label["overrides"] } : {}),
      ...(invert !== undefined ? { invert } : {}),
      tags: l.tags ?? prev?.tags ?? [],
    };
    await upsertLabel(label);
    (prev ? out.updated : out.created).push(id);
  }
  return out;
}
