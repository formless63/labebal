import type { Ctx } from "../../../http";
import { rejectRequest } from "../../../../server/inbox";
import { parseBody } from "../../../../server/validate";
import { rejectSchema } from "../../../../server/validate-integrations";
import { requireRole } from "../../../../server/identity";

export async function POST(req: Request, ctx: Ctx<"/inbox/[id]/reject">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, rejectSchema);
  if (!body.ok) return body.res;
  const r = await rejectRequest(id, body.data);
  return r.ok ? Response.json(r.request) : Response.json({ error: r.error }, { status: r.status });
}
