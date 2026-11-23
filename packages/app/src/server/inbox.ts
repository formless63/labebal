/**
 * Print inbox: other systems ask for prints (POST /api/v1/print-requests);
 * someone at a browser approves (-> the label is created if needed and goes
 * into that browser's print queue) or rejects. Printing still happens in the
 * browser; the server only keeps the requests and their status.
 */
import { and, count, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import { keyedLabelId } from "@labebal/core";
import { getDb } from "../db";
import { labels, printRequests, templates } from "../db/schema";
import { upsertLabelsPublic } from "./public-api";
import { emitWebhook } from "./webhooks";

export type RequestStatus = "pending" | "approved" | "rejected";

export interface PrintRequest {
  id: string;
  status: RequestStatus;
  labelId: string | null;
  templateId: string | null;
  key: string | null;
  name: string | null;
  values: Record<string, string> | null;
  qty: number;
  note: string;
  requestedBy: string;
  tokenName: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string;
  reason: string;
  /** Resolved for display: label / template names (when they exist). */
  labelName?: string;
  templateName?: string;
}

export interface NewPrintRequest {
  labelId?: string;
  templateId?: string;
  key?: string;
  name?: string;
  values?: Record<string, string>;
  qty: number;
  note?: string;
  requestedBy?: string;
}

type Row = typeof printRequests.$inferSelect;

const toReq = (r: Row): PrintRequest => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

/** What other systems see (GET /api/v1/print-requests/:id). */
export const publicView = (r: PrintRequest) => ({
  id: r.id,
  status: r.status,
  labelId: r.labelId,
  templateId: r.templateId,
  key: r.key,
  qty: r.qty,
  note: r.note,
  requestedBy: r.requestedBy,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt,
  decidedBy: r.decidedBy,
  reason: r.reason,
});

async function withNames(rs: Row[]): Promise<PrintRequest[]> {
  if (!rs.length) return [];
  const db = await getDb();
  const lids = [...new Set(rs.map((r) => r.labelId).filter((x): x is string => !!x))];
  const ls = lids.length ? await db.select({ id: labels.id, name: labels.name, templateId: labels.templateId }).from(labels).where(inArray(labels.id, lids)) : [];
  const lmap = new Map(ls.map((l) => [l.id, l]));
  const tids = [...new Set([...rs.map((r) => r.templateId), ...ls.map((l) => l.templateId)].filter((x): x is string => !!x))];
  const ts = tids.length ? await db.select({ id: templates.id, name: templates.name }).from(templates).where(inArray(templates.id, tids)) : [];
  const tmap = new Map(ts.map((t) => [t.id, t.name]));
  return rs.map((r) => {
    const l = r.labelId ? lmap.get(r.labelId) : undefined;
    const tid = r.templateId ?? l?.templateId;
    return { ...toReq(r), ...(l ? { labelName: l.name } : {}), ...(tid && tmap.has(tid) ? { templateName: tmap.get(tid) } : {}) };
  });
}

/** Validate references and store a pending request. Returns an error message for unknown ids. */
export async function createRequest(p: NewPrintRequest, tokenName: string): Promise<{ ok: true; request: PrintRequest } | { ok: false; status: number; error: string }> {
  const db = await getDb();
  let labelId = p.labelId ?? null;
  if (!labelId && p.templateId && p.key && !p.values) labelId = keyedLabelId(p.templateId, p.key);
  if (labelId) {
    const [l] = await db.select({ id: labels.id }).from(labels).where(eq(labels.id, labelId));
    // A key without values must name an existing label; with values it can be created on approval.
    if (!l && !(p.templateId && p.values)) return { ok: false, status: 404, error: `unknown label "${labelId}"` };
    if (!l) labelId = null;
  }
  if (!labelId) {
    if (!p.templateId) return { ok: false, status: 400, error: "give labelId, or templateId (+ key and/or values)" };
    const [t] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, p.templateId));
    if (!t) return { ok: false, status: 404, error: `unknown templateId "${p.templateId}" (see GET /api/v1/templates)` };
  }
  const [r] = await db
    .insert(printRequests)
    .values({
      id: `pr-${crypto.randomUUID()}`,
      labelId,
      templateId: p.templateId ?? null,
      key: p.key ?? null,
      name: p.name ?? null,
      values: labelId ? null : (p.values ?? {}),
      qty: p.qty,
      note: p.note ?? "",
      requestedBy: p.requestedBy ?? "",
      tokenName,
    })
    .returning();
  const [request] = await withNames([r]);
  void emitWebhook("request.created", publicView(request));
  return { ok: true, request };
}

export async function getRequest(id: string): Promise<PrintRequest | undefined> {
  const db = await getDb();
  const [r] = await db.select().from(printRequests).where(eq(printRequests.id, id));
  return r ? (await withNames([r]))[0] : undefined;
}

export async function listRequests(q: { status?: RequestStatus; before?: string; limit?: number } = {}): Promise<PrintRequest[]> {
  const db = await getDb();
  const where: SQL[] = [];
  if (q.status) where.push(eq(printRequests.status, q.status));
  if (q.before) where.push(lt(printRequests.createdAt, new Date(q.before)));
  const rs = await db
    .select()
    .from(printRequests)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(printRequests.createdAt))
    .limit(Math.min(Math.max(q.limit ?? 100, 1), 500));
  return withNames(rs);
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(printRequests).where(eq(printRequests.status, "pending"));
  return r?.n ?? 0;
}

/**
 * Approve: make sure the label exists (create it from template + values when
 * needed) and mark the request approved. The browser then adds the label to
 * its print queue. `qty` may be changed by the approver.
 */
export async function approveRequest(id: string, p: { qty?: number; who?: string }): Promise<{ ok: true; request: PrintRequest; labelId: string; qty: number } | { ok: false; status: number; error: string }> {
  const db = await getDb();
  const [r] = await db.select().from(printRequests).where(eq(printRequests.id, id));
  if (!r) return { ok: false, status: 404, error: "not found" };
  if (r.status !== "pending") return { ok: false, status: 409, error: `already ${r.status}` };
  let labelId = r.labelId;
  if (labelId) {
    const [l] = await db.select({ id: labels.id }).from(labels).where(eq(labels.id, labelId));
    if (!l) return { ok: false, status: 409, error: `label "${labelId}" no longer exists` };
  } else {
    if (!r.templateId) return { ok: false, status: 409, error: "request has no label or template" };
    const lid = r.key ? undefined : `l-req-${r.id.slice(3, 11)}`;
    const up = await upsertLabelsPublic(
      [{ id: lid, templateId: r.templateId, key: r.key ?? undefined, name: r.name ?? undefined, values: r.values ?? {}, tags: ["inbox"] }],
      true,
    );
    if (up.errors.length) return { ok: false, status: 409, error: up.errors[0].error };
    labelId = up.created[0] ?? up.updated[0];
  }
  const qty = p.qty ?? r.qty;
  // Status guard in the WHERE: two browsers approving at once only enqueue once.
  const [u] = await db
    .update(printRequests)
    .set({ status: "approved", labelId, qty, decidedAt: new Date(), decidedBy: p.who ?? "" })
    .where(and(eq(printRequests.id, id), eq(printRequests.status, "pending")))
    .returning();
  if (!u) return { ok: false, status: 409, error: "already decided" };
  const [request] = await withNames([u]);
  void emitWebhook("request.approved", publicView(request));
  return { ok: true, request, labelId: labelId!, qty };
}

export async function rejectRequest(id: string, p: { reason?: string; who?: string }): Promise<{ ok: true; request: PrintRequest } | { ok: false; status: number; error: string }> {
  const db = await getDb();
  const [u] = await db
    .update(printRequests)
    .set({ status: "rejected", reason: p.reason ?? "", decidedAt: new Date(), decidedBy: p.who ?? "" })
    .where(and(eq(printRequests.id, id), eq(printRequests.status, "pending")))
    .returning();
  if (!u) {
    const cur = await getRequest(id);
    return cur ? { ok: false, status: 409, error: `already ${cur.status}` } : { ok: false, status: 404, error: "not found" };
  }
  const [request] = await withNames([u]);
  void emitWebhook("request.rejected", publicView(request));
  return { ok: true, request };
}

export async function deleteRequest(id: string) {
  const db = await getDb();
  await db.delete(printRequests).where(eq(printRequests.id, id));
}
