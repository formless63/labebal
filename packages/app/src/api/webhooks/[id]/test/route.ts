import type { Ctx } from "../../../http";
import { sendTest } from "../../../../server/webhooks";
import { requireRole } from "../../../../server/identity";

/** Send a `ping` event now and return the delivery result. */
export async function POST(req: Request, ctx: Ctx<"/webhooks/[id]/test">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const d = await sendTest(id);
  return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
}
