import type { Ctx } from "../../../http";
import { accountRow, ownScope, type AccountRow } from "../../../../server/github";
import { getIdentity, requireRole } from "../../../../server/identity";
import { deleteSource, updateSource } from "../../../../server/packs";
import { parseBody } from "../../../../server/validate";
import { githubErrors } from "../../../../server/validate-github";
import { packErrors, patchSourceSchema } from "../../../../server/validate-packs";

/** Change a source's access token (null / "" clears it), name, or GitHub account (`accountId`; null = none). */
export async function PATCH(req: Request, ctx: Ctx<"/packs/sources/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, patchSourceSchema);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  const { accountId, ...rest } = body.data;
  let account: AccountRow | null | undefined = undefined;
  if (accountId === null) account = null;
  else if (accountId) {
    const scope = ownScope(getIdentity(req));
    account = scope ? await accountRow(scope, accountId) : null;
    if (!account) return Response.json({ error: "GitHub account not found" }, { status: 404 });
  }
  return githubErrors(() =>
    packErrors(async () => {
      await updateSource(id, { ...rest, ...(account !== undefined ? { account } : {}) });
      return new Response(null, { status: 204 });
    }),
  );
}

/** Forget a source (installed packs stay installed; the built-in source can't be removed). */
export async function DELETE(req: Request, ctx: Ctx<"/packs/sources/[id]">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteSource(id);
  return new Response(null, { status: 204 });
}
