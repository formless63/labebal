import type { Ctx } from "../../../http";
import { cancelDevice, deviceStatus } from "../../../../server/github";
import { githubErrors, noStore, scopeOr401 } from "../../../../server/validate-github";

/** Device-flow status `{ status: pending | done | denied | expired | error, error?, account? }` (asks GitHub at most once per interval). */
export async function GET(req: Request, ctx: Ctx<"/github/device/[id]">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  return githubErrors(async () => {
    const r = await deviceStatus(s.scope, id);
    return r ? Response.json(r, { headers: noStore }) : Response.json({ error: "not found" }, { status: 404 });
  });
}

export async function DELETE(req: Request, ctx: Ctx<"/github/device/[id]">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  cancelDevice(s.scope, (await ctx.params).id);
  return new Response(null, { status: 204 });
}
