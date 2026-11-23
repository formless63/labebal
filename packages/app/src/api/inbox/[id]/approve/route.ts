import type { Ctx } from "../../../http";
import { approveRequest } from "../../../../server/inbox";
import { parseBody } from "../../../../server/validate";
import { approveSchema } from "../../../../server/validate-integrations";
import { requireRole } from "../../../../server/identity";

/** Approve: creates the label if needed; returns `{ request, labelId, qty }` for the browser to enqueue. */
export async function POST(req: Request, ctx: Ctx<"/inbox/[id]/approve">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, approveSchema);
  if (!body.ok) return body.res;
  const r = await approveRequest(id, body.data);
  return r.ok ? Response.json({ request: r.request, labelId: r.labelId, qty: r.qty }) : Response.json({ error: r.error }, { status: r.status });
}
