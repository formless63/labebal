import type { Ctx } from "../../../http";
import { unpublishPack } from "../../../../server/github-publish";
import { requireRole } from "../../../../server/identity";
import { githubErrors, noStore, scopeOr401 } from "../../../../server/validate-github";

/** Delete a published pack from its repo (its folder + collection entry, one commit). `?accountId=` picks the account (default: the one that published). Editors. */
export async function DELETE(req: Request, ctx: Ctx<"/github/published/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  return githubErrors(async () => Response.json(await unpublishPack(s.scope, id, new URL(req.url).searchParams.get("accountId")), { headers: noStore }));
}
