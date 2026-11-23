import { publishPack } from "../../../server/github-publish";
import { requireRole } from "../../../server/identity";
import { parseBody } from "../../../server/validate";
import { githubErrors, noStore, publishSchema, scopeOr401 } from "../../../server/validate-github";
import { whoFrom } from "../../../server/versions";

/**
 * "Publish to GitHub" (editor): build the pack like "Export as pack" and
 * write it to `owner/repo` (folder `dir`) in one commit, bumping the version.
 * -> `{ unchanged, version, commitSha, commitUrl, htmlUrl, summary, files, message }`.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const b = await parseBody(req, publishSchema);
  if (!b.ok) return b.res;
  return githubErrors(async () => Response.json(await publishPack(s.scope, whoFrom(req), b.data), { headers: noStore }));
}
