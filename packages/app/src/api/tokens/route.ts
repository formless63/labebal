import { createToken, listTokens } from "../../server/tokens";
import { parseBody } from "../../server/validate";
import { tokenCreateSchema } from "../../server/validate-data";
import { requireRole } from "../../server/identity";

/** Token list (never includes the tokens themselves). */
export async function GET() {
  return Response.json(await listTokens());
}

/** Create a token. The response is the only time the token is shown. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, tokenCreateSchema);
  if (!body.ok) return body.res;
  return Response.json(await createToken(body.data.name), { status: 201, headers: { "cache-control": "no-store" } });
}
