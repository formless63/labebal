import { githubConfigView, listAccounts, ownScope } from "../../server/github";
import { getIdentity } from "../../server/identity";
import { noStore } from "../../server/validate-github";

/** GitHub setup for this person: `{ config, accounts }` (their own accounts; never tokens). */
export async function GET(req: Request) {
  const me = getIdentity(req);
  const scope = ownScope(me);
  return Response.json({ config: githubConfigView(me), accounts: scope ? await listAccounts(scope) : [] }, { headers: noStore });
}
