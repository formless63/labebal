import { patchBodySchema, type ScopedOp } from "../../features/settings/model";
import { getIdentity } from "../../server/identity";
import { applySettingOps, listSettings, scopeOfUser } from "../../server/settings";
import { parseBody } from "../../server/validate";
import { whoFrom } from "../../server/versions";

const noStore = { "cache-control": "private, no-store" };

/**
 * Team settings and the caller's own settings. `user` is null when nobody is
 * signed in (or identity headers are off): the browser keeps those itself.
 */
export async function GET(req: Request) {
  const own = scopeOfUser(getIdentity(req));
  const [shared, user] = await Promise.all([listSettings("shared"), own ? listSettings(own) : null]);
  return Response.json({ shared, user, userScope: own }, { headers: noStore });
}

/**
 * Change settings: `{ ops: [{ scope: "shared" | "user", op, key, ... }] }`
 * (see features/settings/model.ts). Allowed operations are applied, the
 * others come back in `denied` with a status (403 = role, 401 = not signed in).
 */
export async function PATCH(req: Request) {
  const b = await parseBody(req, patchBodySchema);
  if (!b.ok) return b.res;
  const me = getIdentity(req);
  const r = await applySettingOps(b.data.ops as ScopedOp[], me, whoFrom(req));
  return Response.json(r, { headers: noStore });
}
