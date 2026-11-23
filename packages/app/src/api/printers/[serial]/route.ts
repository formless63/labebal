import type { Ctx } from "../../http";
import { z } from "zod";
import { requireRole } from "../../../server/identity";
import { deleteCalibration, saveCalibration } from "../../../server/printers";
import { parseBody } from "../../../server/validate";
import { whoFrom } from "../../../server/versions";

const dots = z.number().int().min(-80).max(80);
const body = z.object({
  model: z.string().min(1).max(40),
  name: z.string().max(100).default(""),
  offset: z.object({ x: dots, y: dots }),
  source: z.enum(["calibrated", "suggested"]).default("calibrated"),
});

/** Save this printer's calibration (shared by every browser). */
export async function PUT(req: Request, ctx: Ctx<"/printers/[serial]">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { serial } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(serial)) return Response.json({ error: "bad serial" }, { status: 400 });
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  return Response.json(await saveCalibration({ serial, ...b.data, updatedBy: whoFrom(req) }));
}

/** Forget this printer's calibration (it falls back to the model offset). */
export async function DELETE(req: Request, ctx: Ctx<"/printers/[serial]">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { serial } = await ctx.params;
  await deleteCalibration(serial);
  return new Response(null, { status: 204 });
}
