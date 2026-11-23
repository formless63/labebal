import { startDeviceFlow } from "../../../server/github";
import { githubErrors, noStore, scopeOr401 } from "../../../server/validate-github";

/** "Connect GitHub": start the device flow -> `{ id, userCode, verificationUri, expiresAt, interval }`. Poll GET /api/github/device/:id. */
export async function POST(req: Request) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  return githubErrors(async () => Response.json(await startDeviceFlow(s.scope), { status: 201, headers: noStore }));
}
