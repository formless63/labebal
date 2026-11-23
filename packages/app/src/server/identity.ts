/**
 * Request identity and role checks for API routes. Mutating routes call `requireRole`:
 *
 *   const denied = requireRole(req, "editor"); if (denied) return denied;
 *
 * Where the identity comes from:
 * - A host app's `user(req)` callback (see host.ts), resolved once per request
 *   by the handler before the route runs.
 * - Otherwise proxy headers (features/auth/identity.ts, LABEBAL_AUTH_HEADERS).
 *   With no identity headers configured everyone is admin, so the checks pass.
 */
import { configFromEnv, identityFromHeaders, roleAtLeast, type Identity, type IdentityConfig, type Role } from "../features/auth/identity";
import { env, resolvedIdentity } from "./host";

let cached: IdentityConfig | null = null;
export const identityConfig = () => (cached ??= configFromEnv(env()));

export function getIdentity(req: Pick<Request, "headers">): Identity {
  return resolvedIdentity(req) ?? identityFromHeaders((n) => req.headers.get(n), identityConfig());
}

/** null when allowed, else a 403 response to return. */
export function requireRole(req: Pick<Request, "headers">, need: Role): Response | null {
  const me = getIdentity(req);
  if (roleAtLeast(me.role, need)) return null;
  return Response.json({ error: `Needs the ${need} role (you are ${me.role}).`, role: me.role, need }, { status: 403 });
}
