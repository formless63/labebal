/**
 * Outgoing webhooks: configured URLs receive a signed JSON POST when
 * something happens (a print is recorded or voided, a print request changes
 * status). Each event becomes one delivery row per webhook; failures retry
 * with backoff (30 s, 2 min, 10 min, 1 h, 6 h) from the in-process worker in
 * `scheduler.ts`, so retries survive restarts.
 *
 * Request: `POST <url>`, body `{ id, event, createdAt, data }`, headers
 * `X-Labebal-Event`, `X-Labebal-Delivery`, `X-Labebal-Timestamp` (Unix s) and
 * `X-Labebal-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { signWebhook, webhookRetryDelay } from "@labebal/core/integrations";
import { getDb } from "../db";
import { webhookDeliveries, webhooks } from "../db/schema";
import { safeFetch } from "./safe-fetch";

export const WEBHOOK_EVENTS = ["print", "void", "request.created", "request.approved", "request.rejected", "source.synced", "source.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  /** First characters of the secret (the full secret is shown on create / reveal only). */
  secretHint: string;
  createdAt: string;
  last?: { event: string; status: string; responseStatus: number | null; error: string | null; at: string; attempts: number };
}

export interface DeliveryInfo {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

export async function listWebhooks(): Promise<WebhookInfo[]> {
  const db = await getDb();
  const hooks = await db.select().from(webhooks).orderBy(webhooks.createdAt);
  const out: WebhookInfo[] = [];
  for (const h of hooks) {
    const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(1);
    out.push({
      id: h.id,
      name: h.name,
      url: h.url,
      events: h.events,
      enabled: h.enabled,
      secretHint: `${h.secret.slice(0, 10)}…`,
      createdAt: h.createdAt.toISOString(),
      ...(d
        ? { last: { event: d.event, status: d.status, responseStatus: d.responseStatus, error: d.lastError, at: (d.deliveredAt ?? d.createdAt).toISOString(), attempts: d.attempts } }
        : {}),
    });
  }
  return out;
}

export async function createWebhook(p: { name: string; url: string; events: string[] }): Promise<{ info: WebhookInfo; secret: string }> {
  const db = await getDb();
  const secret = newSecret();
  const id = `wh-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(webhooks).values({ id, name: p.name, url: p.url, events: p.events, secret });
  const info = (await listWebhooks()).find((w) => w.id === id)!;
  return { info, secret };
}

export async function updateWebhook(id: string, p: { name?: string; url?: string; events?: string[]; enabled?: boolean; rotateSecret?: boolean }): Promise<{ secret?: string } | undefined> {
  const db = await getDb();
  const set: Partial<typeof webhooks.$inferInsert> = {};
  if (p.name !== undefined) set.name = p.name;
  if (p.url !== undefined) set.url = p.url;
  if (p.events !== undefined) set.events = p.events;
  if (p.enabled !== undefined) set.enabled = p.enabled;
  const secret = p.rotateSecret ? newSecret() : undefined;
  if (secret) set.secret = secret;
  const r = Object.keys(set).length ? await db.update(webhooks).set(set).where(eq(webhooks.id, id)).returning({ id: webhooks.id }) : await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, id));
  return r.length ? { secret } : undefined;
}

export async function revealWebhookSecret(id: string): Promise<string | undefined> {
  const db = await getDb();
  const [h] = await db.select({ secret: webhooks.secret }).from(webhooks).where(eq(webhooks.id, id));
  return h?.secret;
}

export async function deleteWebhook(id: string) {
  const db = await getDb();
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

export async function listDeliveries(webhookId: string, limit = 20): Promise<DeliveryInfo[]> {
  const db = await getDb();
  const rs = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)).orderBy(desc(webhookDeliveries.createdAt)).limit(limit);
  return rs.map((d) => ({
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: d.nextAttemptAt.toISOString(),
  }));
}

/** Deliveries in flight in this process (so the worker and an immediate send don't both send). */
const g = globalThis as unknown as { __labebalSending?: Set<string> };
const sending = (g.__labebalSending ??= new Set());

async function attempt(id: string): Promise<void> {
  if (sending.has(id)) return;
  sending.add(id);
  try {
    const db = await getDb();
    const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
    if (!d || d.status !== "pending") return;
    const [h] = await db.select().from(webhooks).where(eq(webhooks.id, d.webhookId));
    if (!h) return;
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    const attempts = d.attempts + 1;
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await safeFetch(h.url, {
        method: "POST",
        body,
        timeoutMs: 10_000,
        maxBytes: 64 * 1024,
        maxRedirects: 0,
        headers: {
          "content-type": "application/json",
          "x-labebal-event": d.event,
          "x-labebal-delivery": d.id,
          "x-labebal-timestamp": String(ts),
          "x-labebal-signature": `sha256=${await signWebhook(h.secret, ts, body)}`,
        },
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}${res.text ? `: ${res.text.slice(0, 200)}` : ""}`;
    } catch (e) {
      error = (e as Error).message;
    }
    const delay = error ? webhookRetryDelay(attempts) : undefined;
    await db
      .update(webhookDeliveries)
      .set({
        attempts,
        responseStatus: status,
        lastError: error,
        status: !error ? "ok" : delay === undefined ? "failed" : "pending",
        ...(error ? {} : { deliveredAt: new Date() }),
        ...(delay !== undefined ? { nextAttemptAt: new Date(Date.now() + delay) } : {}),
      })
      .where(eq(webhookDeliveries.id, id));
  } finally {
    sending.delete(id);
  }
}

/**
 * Queue `event` for every enabled webhook that subscribes to it and try to
 * send right away (without waiting). Safe to call from any route: errors are
 * logged, never thrown.
 */
export async function emitWebhook(event: WebhookEvent, data: unknown, opts: { only?: string; wait?: boolean } = {}): Promise<string[]> {
  try {
    const db = await getDb();
    const hooks = (await db.select().from(webhooks).where(opts.only ? eq(webhooks.id, opts.only) : eq(webhooks.enabled, true))).filter(
      (h) => opts.only || !h.events.length || h.events.includes(event),
    );
    if (!hooks.length) return [];
    const createdAt = new Date().toISOString();
    const rows = hooks.map((h) => {
      const id = `whd-${crypto.randomUUID()}`;
      return { id, webhookId: h.id, event, payload: { id, event, createdAt, data } as Record<string, unknown> };
    });
    await db.insert(webhookDeliveries).values(rows);
    const sends = rows.map((r) => attempt(r.id).catch((e) => console.error("webhook", e)));
    if (opts.wait) await Promise.all(sends);
    return rows.map((r) => r.id);
  } catch (e) {
    console.error("emitWebhook failed", e);
    return [];
  }
}

/** Retry deliveries that are due (called by the scheduler). */
export async function processDueDeliveries(limit = 20) {
  const db = await getDb();
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date())))
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(limit);
  await Promise.all(due.map((d) => attempt(d.id).catch((e) => console.error("webhook", e))));
}

/** Send a delivery again now (resets a failed one). */
export async function redeliver(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.update(webhookDeliveries).set({ status: "pending", nextAttemptAt: new Date() }).where(inArray(webhookDeliveries.id, ids));
  await Promise.all(ids.map((id) => attempt(id)));
}

/** Wait for an immediate attempt (used by the "Send test" button). */
export async function sendTest(id: string): Promise<DeliveryInfo | undefined> {
  const [deliveryId] = await emitWebhook("ping", { message: "Test from labebal" }, { only: id, wait: true });
  if (!deliveryId) return undefined;
  return (await listDeliveries(id, 50)).find((d) => d.id === deliveryId);
}
