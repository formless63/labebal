import type { Ctx } from "../../http";
import { deleteStyle, upsertStyle } from "../../../server/parts";
import { parseBody, textStyleSchema } from "../../../server/validate";
import { requireRole } from "../../../server/identity";

/** Save a shared text style (every text using it follows). */
export async function PUT(req: Request, ctx: Ctx<"/styles/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, textStyleSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await upsertStyle(body.data));
}

/** Texts using a deleted style keep their own (copied) values. */
export async function DELETE(req: Request, ctx: Ctx<"/styles/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteStyle(id);
  return new Response(null, { status: 204 });
}
