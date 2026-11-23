import { accountRow, ownScope } from "../../../server/github";
import { getIdentity, requireRole } from "../../../server/identity";
import { addSource } from "../../../server/packs";
import { parseBody } from "../../../server/validate";
import { githubErrors } from "../../../server/validate-github";
import { addSourceSchema, packErrors } from "../../../server/validate-packs";

/**
 * Add a source: { input: URL | owner/repo[/path][@ref], token?, accountId? }.
 * `accountId` (one of the caller's connected GitHub accounts) reads a GitHub
 * source through the API instead of a pasted token. Fetched first; 400 when
 * nothing usable is there.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, addSourceSchema);
  if (!body.ok) return body.res;
  let account = null;
  if (body.data.accountId) {
    const scope = ownScope(getIdentity(req));
    account = scope ? await accountRow(scope, body.data.accountId) : null;
    if (!account) return Response.json({ error: "GitHub account not found" }, { status: 404 });
  }
  return githubErrors(() => packErrors(async () => Response.json(await addSource(body.data.input, body.data.token, account), { status: 201 })));
}
