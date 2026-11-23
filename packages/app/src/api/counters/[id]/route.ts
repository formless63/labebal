import type { Ctx } from "../../http";
import { counterDefSchema, counterHistory, deleteCounter, getCounter, saveCounter } from "../../../server/counters";
import { parseBody } from "../../../server/validate";
import { requireRole } from "../../../server/identity";

/** One counter + its recent reservations (`?limit=`). */
export async function GET(req: Request, ctx: Ctx<"/counters/[id]">) {
  const { id } = await ctx.params;
  const c = await getCounter(id);
  if (!c) return Response.json({ error: "counter not found" }, { status: 404 });
  return Response.json({ ...c, log: await counterHistory(id, Number(new URL(req.url).searchParams.get("limit")) || 50) });
}

export async function PUT(req: Request, ctx: Ctx<"/counters/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, counterDefSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await saveCounter(body.data));
}

export async function DELETE(req: Request, ctx: Ctx<"/counters/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteCounter(id);
  return new Response(null, { status: 204 });
}
