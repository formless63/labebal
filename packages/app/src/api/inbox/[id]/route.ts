import type { Ctx } from "../../http";
import { deleteRequest, getRequest } from "../../../server/inbox";
import { requireRole } from "../../../server/identity";

export async function GET(_req: Request, ctx: Ctx<"/inbox/[id]">) {
  const { id } = await ctx.params;
  const r = await getRequest(id);
  return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx<"/inbox/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteRequest(id);
  return new Response(null, { status: 204 });
}
