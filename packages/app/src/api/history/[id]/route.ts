import type { Ctx } from "../../http";
import { z } from "zod";
import { deleteHistory, getHistory, voidHistory } from "../../../server/history";
import { parseBody } from "../../../server/validate";
import { versionDocs, whoFrom } from "../../../server/versions";
import { emitWebhook } from "../../../server/webhooks";
import { requireRole } from "../../../server/identity";

/**
 * One entry. `?snapshot=1` adds `templates`: the template versions its items
 * were printed with (for "reprint as printed").
 */
export async function GET(req: Request, ctx: Ctx<"/history/[id]">) {
  const { id } = await ctx.params;
  const e = await getHistory(id);
  if (!e) return Response.json({ error: "not found" }, { status: 404 });
  if (new URL(req.url).searchParams.get("snapshot") !== "1") return Response.json(e);
  const keys = e.items.filter((i) => i.templateVersion).map((i) => ({ templateId: i.templateId, version: i.templateVersion! }));
  return Response.json({ ...e, templates: await versionDocs(keys) });
}

const voidSchema = z.object({ voided: z.boolean(), reason: z.string().trim().max(500).optional() });

/** Void / un-void: `{ voided: true, reason }`. */
export async function PATCH(req: Request, ctx: Ctx<"/history/[id]">) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, voidSchema);
  if (!body.ok) return body.res;
  const e = await voidHistory(id, { ...body.data, who: whoFrom(req) });
  if (!e) return Response.json({ error: "not found" }, { status: 404 });
  // Tell other systems a print was voided (un-voiding is not an event).
  if (body.data.voided) void emitWebhook("void", e);
  return Response.json(e);
}

export async function DELETE(req: Request, ctx: Ctx<"/history/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteHistory(id);
  return new Response(null, { status: 204 });
}
