import type { Ctx } from "../../../http";
import { requireRole } from "../../../../server/identity";
import { getNetPrinter, zplCancelAll } from "../../../../server/netprinters";
import { errText } from "../../schema";

/** Drop everything waiting in the printer (~JA). Printers. */
export async function POST(req: Request, ctx: Ctx<"/netprinters/[id]/cancel">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const p = await getNetPrinter(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  try {
    await zplCancelAll(p);
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: errText(e) }, { status: 502 });
  }
}
