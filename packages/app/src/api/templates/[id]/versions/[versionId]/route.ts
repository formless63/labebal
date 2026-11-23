import type { Ctx } from "../../../../http";
import { deleteVersion, getVersion, restoreVersion, whoFrom } from "../../../../../server/versions";
import { requireRole } from "../../../../../server/identity";

export async function GET(_req: Request, ctx: Ctx<"/templates/[id]/versions/[versionId]">) {
  const { id, versionId } = await ctx.params;
  const v = await getVersion(id, versionId);
  return v ? Response.json(v) : Response.json({ error: "not found" }, { status: 404 });
}

/** `{ "action": "restore" }`: make this version the current design (recorded as a new version). */
export async function POST(req: Request, ctx: Ctx<"/templates/[id]/versions/[versionId]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, versionId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "restore") return Response.json({ error: 'body must be { "action": "restore" }' }, { status: 400 });
  const doc = await restoreVersion(id, versionId, whoFrom(req));
  return doc ? Response.json(doc) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx<"/templates/[id]/versions/[versionId]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, versionId } = await ctx.params;
  await deleteVersion(id, versionId);
  return new Response(null, { status: 204 });
}
