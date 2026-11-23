import type { Ctx } from "../../../http";
import { requireRole } from "../../../../server/identity";
import { removePack, removePlan, setPackEnabled } from "../../../../server/packs";
import { parseBody } from "../../../../server/validate";
import { patchPackSchema } from "../../../../server/validate-packs";

/** What removing would do: { remove, changed[], dependents }. */
export async function GET(_req: Request, ctx: Ctx<"/packs/installed/[id]">) {
  const { id } = await ctx.params;
  const r = await removePlan(id);
  return r ? Response.json(r) : Response.json({ error: "not installed" }, { status: 404 });
}

/** Enable / disable: { enabled }. Disabled packs' templates and labels are hidden, not deleted. */
export async function PATCH(req: Request, ctx: Ctx<"/packs/installed/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, patchPackSchema);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  return (await setPackEnabled(id, body.data.enabled)) ? new Response(null, { status: 204 }) : Response.json({ error: "not installed" }, { status: 404 });
}

/** Remove: unchanged items are deleted; `?keepChanged=1` keeps changed ones (and templates other labels use) as your own. */
export async function DELETE(req: Request, ctx: Ctx<"/packs/installed/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = await removePack(id, new URL(req.url).searchParams.get("keepChanged") === "1");
  return r ? Response.json(r) : Response.json({ error: "not installed" }, { status: 404 });
}
