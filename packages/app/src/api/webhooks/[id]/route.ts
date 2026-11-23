import type { Ctx as RouteCtx } from "../../http";
import { assertFetchableUrl } from "../../../server/safe-fetch";
import { parseBody } from "../../../server/validate";
import { webhookPatchSchema } from "../../../server/validate-integrations";
import { deleteWebhook, updateWebhook } from "../../../server/webhooks";
import { requireRole } from "../../../server/identity";

type Ctx = RouteCtx<"/webhooks/[id]">;

/** Change name / url / events / enabled; `rotateSecret: true` returns a new `secret`. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, webhookPatchSchema);
  if (!body.ok) return body.res;
  if (body.data.url)
    try {
      assertFetchableUrl(body.data.url);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  const r = await updateWebhook(id, body.data);
  return r ? Response.json(r, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteWebhook(id);
  return new Response(null, { status: 204 });
}
