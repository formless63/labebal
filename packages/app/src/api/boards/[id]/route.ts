import type { Ctx } from "../../http";
import { deleteBoard, saveBoard } from "../../../server/boards";
import { parseBody } from "../../../server/validate";
import { boardSchema } from "../../../server/validate-data";
import { requireRole } from "../../../server/identity";

export async function PUT(req: Request, ctx: Ctx<"/boards/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, boardSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await saveBoard(body.data));
}

export async function DELETE(req: Request, ctx: Ctx<"/boards/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteBoard(id);
  return new Response(null, { status: 204 });
}
