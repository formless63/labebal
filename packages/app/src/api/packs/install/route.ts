import { requireRole } from "../../../server/identity";
import { installPack } from "../../../server/packs";
import { parseBody } from "../../../server/validate";
import { installSchema, packErrors } from "../../../server/validate-packs";

/** Install (or re-install) a pack from a source: { sourceId, packId, labelIds? }. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, installSchema);
  if (!body.ok) return body.res;
  return packErrors(async () => Response.json(await installPack(body.data.sourceId, body.data.packId, body.data.labelIds)));
}
