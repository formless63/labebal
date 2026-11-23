import type { Ctx } from "../../../../http";
import { accountRow, createRepo, installUrl, listRepos } from "../../../../../server/github";
import { parseBody } from "../../../../../server/validate";
import { createRepoSchema, githubErrors, noStore, scopeOr401 } from "../../../../../server/validate-github";

/** Repositories this account can reach: `{ repos, installations, installUrl }`. */
export async function GET(req: Request, ctx: Ctx<"/github/accounts/[id]/repos">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const acc = await accountRow(s.scope, (await ctx.params).id);
  if (!acc) return Response.json({ error: "not found" }, { status: 404 });
  return githubErrors(async () => Response.json({ ...(await listRepos(acc)), installUrl: acc.kind === "app" ? installUrl() : null }, { headers: noStore }));
}

/**
 * "Create a repo for my packs": `{ name, private, description }` ->
 * `{ created, repo?, needsInstall?, installUrl?, newRepoUrl? }` (newRepoUrl:
 * GitHub refused; create it there, prefilled, then pick it).
 */
export async function POST(req: Request, ctx: Ctx<"/github/accounts/[id]/repos">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const b = await parseBody(req, createRepoSchema);
  if (!b.ok) return b.res;
  const acc = await accountRow(s.scope, (await ctx.params).id);
  if (!acc) return Response.json({ error: "not found" }, { status: 404 });
  return githubErrors(async () => Response.json(await createRepo(acc, b.data), { headers: noStore }));
}
