import type { Ctx } from "../../../http";
import { listDeliveries, redeliver } from "../../../../server/webhooks";
import { requireRole } from "../../../../server/identity";

/** Recent deliveries (newest first). */
export async function GET(_req: Request, ctx: Ctx<"/webhooks/[id]/deliveries">) {
  const { id } = await ctx.params;
  return Response.json(await listDeliveries(id));
}

/** Retry now: `{ ids: [...] }`. */
export async function POST(req: Request, ctx: Ctx<"/webhooks/[id]/deliveries">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  const mine = new Set((await listDeliveries(id, 500)).map((d) => d.id));
  await redeliver(ids.filter((x) => mine.has(x)));
  return Response.json(await listDeliveries(id));
}
