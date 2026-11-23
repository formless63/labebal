import { parseBundle } from "@labebal/core";
import { importTemplateBundle, templateExists } from "../../../server/library";
import { whoFrom } from "../../../server/versions";
import { requireRole } from "../../../server/identity";

const MAX = 64 * 1024 * 1024;

/**
 * Import a shared template file (`.labebal.json` or zip) as the request body.
 * `?mode=replace` overwrites a template with the same id, `?mode=copy` imports
 * it under new ids; without a mode an existing id answers 409 `{ conflict }`.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return Response.json({ error: "empty body" }, { status: 400 });
  if (bytes.length > MAX) return Response.json({ error: "file too large" }, { status: 413 });
  let bundle;
  try {
    bundle = await parseBundle(bytes);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const mode = new URL(req.url).searchParams.get("mode");
  if (!mode && (await templateExists(bundle.template.id)))
    return Response.json({ conflict: true, id: bundle.template.id, name: bundle.template.name }, { status: 409 });
  return Response.json(await importTemplateBundle(bundle, { asCopy: mode === "copy", who: whoFrom(req) }), { status: 201 });
}
