import type { Ctx } from "../../http";
import { deleteRun, saveRun } from "../../../server/runs";
import { parseBody } from "../../../server/validate";
import { runSchema } from "../../../server/validate-data";
import { requireRole } from "../../../server/identity";

export async function PUT(req: Request, ctx: Ctx<"/runs/[id]">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, runSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await saveRun(body.data));
}

export async function DELETE(req: Request, ctx: Ctx<"/runs/[id]">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteRun(id);
  return new Response(null, { status: 204 });
}
