import type { Ctx } from "../../../../../../http";
import { repoPacks } from "../../../../../../../server/github-publish";
import { githubErrors, noStore, scopeOr401 } from "../../../../../../../server/validate-github";

/** Packs already in a repo: `{ packs: [{ dir, id, name, version, description }], defaultBranch, canWrite }`. */
export async function GET(req: Request, ctx: Ctx<"/github/accounts/[id]/repos/[owner]/[repo]">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const { id, owner, repo } = await ctx.params;
  return githubErrors(async () => Response.json(await repoPacks(s.scope, id, owner, repo), { headers: noStore }));
}
