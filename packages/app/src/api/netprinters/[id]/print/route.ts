import type { Ctx } from "../../../http";
import { requireRole } from "../../../../server/identity";
import { getNetPrinter, zplSend } from "../../../../server/netprinters";
import { errText } from "../../schema";

const MAX = 32 * 1024 * 1024;

/** Send a ZPL job (body: the ZPL text, as rendered by the browser). Printers. */
export async function POST(req: Request, ctx: Ctx<"/netprinters/[id]/print">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const p = await getNetPrinter(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  const zpl = await req.text();
  if (!zpl.trim()) return Response.json({ error: "empty job" }, { status: 400 });
  if (zpl.length > MAX) return Response.json({ error: "job too large" }, { status: 413 });
  if (!/^\s*[\^~]/.test(zpl)) return Response.json({ error: "not ZPL" }, { status: 400 });
  try {
    await zplSend(p, zpl);
    return Response.json({ sent: zpl.length });
  } catch (e) {
    return Response.json({ error: errText(e) }, { status: 502 });
  }
}
