import type { Ctx } from "../../http";
import { revokeToken } from "../../../server/tokens";
import { requireRole } from "../../../server/identity";

/** Revoke (the token stops working immediately; the entry stays listed as revoked). */
export async function DELETE(req: Request, ctx: Ctx<"/tokens/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  await revokeToken(id);
  return new Response(null, { status: 204 });
}
