import { requireRole } from "../../../server/identity";
import { detectZpl } from "../../../server/netprinters";
import { parseBody } from "../../../server/validate";
import { detectSchema, errText } from "../schema";

/** What a printer at host:port reports (model, resolution, head width, print method). Prints nothing. Admins. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, detectSchema);
  if (!body.ok) return body.res;
  try {
    return Response.json(await detectZpl(body.data.host, body.data.port));
  } catch (e) {
    return Response.json({ error: errText(e) }, { status: 502 });
  }
}
