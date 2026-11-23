import type { Ctx } from "../../http";
import { deleteTemplate, upsertTemplate } from "../../../server/library";
import { parseBody, templateSchema } from "../../../server/validate";
import { whoFrom } from "../../../server/versions";
import { requireRole } from "../../../server/identity";

/** Save a template (also snapshots it into the version history). */
export async function PUT(req: Request, ctx: Ctx<"/templates/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, templateSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await upsertTemplate(body.data, whoFrom(req)));
}

export async function DELETE(req: Request, ctx: Ctx<"/templates/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteTemplate(id);
  return new Response(null, { status: 204 });
}
