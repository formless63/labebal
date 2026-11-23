import { parseRepo } from "../../../features/github/model";
import { addTokenAccount } from "../../../server/github";
import { parseBody } from "../../../server/validate";
import { githubErrors, noStore, scopeOr401, tokenAccountSchema } from "../../../server/validate-github";

/** "Use a token instead": `{ token, repo? }`, checked with GitHub before saving -> `{ account, repo? }` (no token). */
export async function POST(req: Request) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const b = await parseBody(req, tokenAccountSchema);
  if (!b.ok) return b.res;
  const repo = b.data.repo ? parseRepo(b.data.repo) : null;
  if (b.data.repo && !repo) return Response.json({ error: "Repository: owner/name" }, { status: 400 });
  return githubErrors(async () => Response.json(await addTokenAccount(s.scope, b.data.token, repo), { status: 201, headers: noStore }));
}
