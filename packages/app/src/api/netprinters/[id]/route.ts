import type { Ctx } from "../../http";
import { requireRole } from "../../../server/identity";
import { deleteNetPrinter, detectZpl, getNetPrinter, saveNetPrinter } from "../../../server/netprinters";
import { parseBody } from "../../../server/validate";
import { whoFrom } from "../../../server/versions";
import { errText, patchSchema } from "../schema";

/** Rename, move (a new address is detected again) or change ribbon use. Admins. */
export async function PATCH(req: Request, ctx: Ctx<"/netprinters/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const cur = await getNetPrinter(id);
  if (!cur) return Response.json({ error: "not found" }, { status: 404 });
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.res;
  const next = { ...cur, ...body.data };
  const moved = (body.data.host && body.data.host !== cur.host) || (body.data.port && body.data.port !== cur.port);
  if (moved && (!body.data.dpi || !body.data.headDots)) {
    try {
      const d = await detectZpl(next.host, next.port);
      next.dpi = body.data.dpi ?? d.dpi;
      next.headDots = body.data.headDots ?? d.headDots;
      next.model = d.model;
    } catch (e) {
      return Response.json({ error: errText(e) }, { status: 502 });
    }
  }
  return Response.json(await saveNetPrinter(id, next, whoFrom(req)));
}

export async function DELETE(req: Request, ctx: Ctx<"/netprinters/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteNetPrinter(id);
  return new Response(null, { status: 204 });
}
