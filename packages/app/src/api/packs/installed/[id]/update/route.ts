import type { Ctx } from "../../../../http";
import { requireRole } from "../../../../../server/identity";
import { updatePack } from "../../../../../server/packs";
import { packErrors } from "../../../../../server/validate-packs";

/** Update from the source: unchanged items get the new version, items changed here are kept (and listed). */
export async function POST(req: Request, ctx: Ctx<"/packs/installed/[id]/update">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  return packErrors(async () => Response.json(await updatePack(id)));
}
