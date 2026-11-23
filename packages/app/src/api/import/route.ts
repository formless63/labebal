import { importLibrary } from "../../server/library";
import { librarySchema, parseBody } from "../../server/validate";
import { whoFrom } from "../../server/versions";
import { requireRole } from "../../server/identity";

/** Merge templates and/or labels (same id = replace). Used by "Open library", the importers and external systems. */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, librarySchema);
  if (!body.ok) return body.res;
  return Response.json(await importLibrary(body.data, whoFrom(req)));
}
