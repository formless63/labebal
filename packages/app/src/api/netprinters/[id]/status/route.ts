import type { Ctx } from "../../../http";
import { requireRole } from "../../../../server/identity";
import { getNetPrinter, zplStatus } from "../../../../server/netprinters";
import { errText } from "../../schema";

/** Live status (~HS): paper, ribbon, head, pause, labels left in the batch. */
export async function GET(req: Request, ctx: Ctx<"/netprinters/[id]/status">) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const p = await getNetPrinter(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  try {
    return Response.json(await zplStatus(p), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ reachable: false, error: errText(e) }, { status: 502 });
  }
}
