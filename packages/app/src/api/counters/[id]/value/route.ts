import type { Ctx } from "../../../http";
import { counterValueSchema, setCounterValue } from "../../../../server/counters";
import { parseBody } from "../../../../server/validate";
import { requireRole } from "../../../../server/identity";

/** Set the next number (`{ key?, next }`) or reset (`{ key? }` without `next`). Without `key`: every key. */
export async function PUT(req: Request, ctx: Ctx<"/counters/[id]/value">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, counterValueSchema);
  if (!body.ok) return body.res;
  const c = await setCounterValue(id, body.data);
  if (!c) return Response.json({ error: "counter not found" }, { status: 404 });
  return Response.json(c);
}
