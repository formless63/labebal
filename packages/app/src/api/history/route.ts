import { z } from "zod";
import { listHistory, recordPrint } from "../../server/history";
import { parseBody } from "../../server/validate";
import { historySchema } from "../../server/validate-data";
import { emitWebhook } from "../../server/webhooks";
import { getIdentity, requireRole } from "../../server/identity";

/** Print history, newest first. ?q= &source= &printer= &who= &from= &to= &before= &voided=exclude|only &labelId= &limit= */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const get = (k: string) => p.get(k) || undefined;
  const bad = ["from", "to", "before"].find((k) => get(k) && Number.isNaN(Date.parse(get(k)!)));
  if (bad) return Response.json({ error: `${bad} must be a date` }, { status: 400 });
  const voided = get("voided");
  return Response.json(
    await listHistory({
      q: get("q"),
      source: get("source"),
      printer: get("printer"),
      who: get("who"),
      from: get("from"),
      to: get("to"),
      before: get("before"),
      voided: voided === "exclude" || voided === "only" ? voided : undefined,
      labelId: get("labelId"),
      limit: Number(get("limit")) || undefined,
    }),
  );
}

/** History items with the snapshot fields (values, overrides, thumbnail). */
const snapshotItem = z.object({
  labelId: z.string().max(200),
  name: z.string().max(500),
  templateId: z.string().max(200),
  templateName: z.string().max(500).optional(),
  qty: z.number().int().min(0).max(100_000),
  invert: z.boolean(),
  values: z.record(z.string(), z.string().max(10_000)).optional(),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  thumb: z.string().max(200_000).optional(),
});
const recordSchema = historySchema.extend({ items: z.array(snapshotItem).min(1).max(5000) });

/** Record a print (called by the browser after each print job). */
export async function POST(req: Request) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const body = await parseBody(req, recordSchema);
  if (!body.ok) return body.res;
  // Signed in through the proxy: that is who printed (the per-browser name is the fallback).
  const me = getIdentity(req);
  const data = body.data as Parameters<typeof recordPrint>[0];
  const entry = await recordPrint(me.signedIn ? { ...data, who: me.display } : data);
  void emitWebhook("print", entry);
  return Response.json(entry, { status: 201 });
}
