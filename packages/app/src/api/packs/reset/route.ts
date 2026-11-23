import { requireRole } from "../../../server/identity";
import { resetItems } from "../../../server/packs";
import { parseBody } from "../../../server/validate";
import { resetSchema } from "../../../server/validate-packs";

/** Reset to the pack version: { items: [{ kind, id }] } or { packId } (every changed / deleted item of it). */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, resetSchema);
  if (!body.ok) return body.res;
  if (!body.data.items?.length && !body.data.packId) return Response.json({ error: "give items or packId" }, { status: 400 });
  return Response.json(await resetItems(body.data));
}
