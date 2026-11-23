import type { Ctx } from "../../../../http";
import { requireRole } from "../../../../../server/identity";
import { updatePreview } from "../../../../../server/packs";
import { githubErrors, noStore } from "../../../../../server/validate-github";

/** Review an update (admin): the dry run with documents (`before` / `after`) and the templates previews need. 404 when there is no newer version. */
export async function GET(req: Request, ctx: Ctx<"/packs/installed/[id]/preview">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  return githubErrors(async () => {
    const r = await updatePreview(id);
    return r ? Response.json(r, { headers: noStore }) : Response.json({ error: "no update" }, { status: 404 });
  });
}
