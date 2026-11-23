import type { Ctx } from "../../../http";
import { parseRepo } from "../../../../features/github/model";
import { deleteAccount, patchAccount } from "../../../../server/github";
import { parseBody } from "../../../../server/validate";
import { githubErrors, noStore, patchAccountSchema, scopeOr401 } from "../../../../server/validate-github";

/** `{ commitEmail?, defaultRepo? }` ("" / null resets). */
export async function PATCH(req: Request, ctx: Ctx<"/github/accounts/[id]">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const b = await parseBody(req, patchAccountSchema);
  if (!b.ok) return b.res;
  if (b.data.defaultRepo && !parseRepo(b.data.defaultRepo)) return Response.json({ error: "Repository: owner/name" }, { status: 400 });
  const { id } = await ctx.params;
  return githubErrors(async () => {
    const r = await patchAccount(s.scope, id, b.data);
    return r ? Response.json(r, { headers: noStore }) : Response.json({ error: "not found" }, { status: 404 });
  });
}

/** Disconnect (forget the token here; revoke it on GitHub too if you like). */
export async function DELETE(req: Request, ctx: Ctx<"/github/accounts/[id]">) {
  const s = scopeOr401(req);
  if (s instanceof Response) return s;
  const ok = await deleteAccount(s.scope, (await ctx.params).id);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "not found" }, { status: 404 });
}
