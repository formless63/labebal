import type { Ctx } from "../../http";
import { deleteComponent, upsertComponent } from "../../../server/parts";
import { componentSchema, parseBody } from "../../../server/validate";
import { requireRole } from "../../../server/identity";

/** Save a reusable component (every instance follows). */
export async function PUT(req: Request, ctx: Ctx<"/components/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, componentSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await upsertComponent(body.data));
}

/** The editor detaches instances in templates before deleting (instances of a missing component lay out empty). */
export async function DELETE(req: Request, ctx: Ctx<"/components/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteComponent(id);
  return new Response(null, { status: 204 });
}
