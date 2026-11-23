import { listPublished } from "../../../server/github-publish";
import { requireRole } from "../../../server/identity";
import { noStore } from "../../../server/validate-github";

/** Packs published from this app ("My packs"), with `changedSince` (items changed here since the last publish). Editors. */
export async function GET(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  return Response.json(await listPublished(), { headers: noStore });
}
