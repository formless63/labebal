/**
 * Bearer-token auth for the public, versioned API (`/api/v1/*`).
 *
 * The browser-facing `/api/*` routes are NOT authenticated here: the app is
 * meant to run behind an authenticating reverse proxy (Pangolin, optionally
 * with Pocket ID) at the network edge. `/api/v1/*` is for other systems
 * (inventory, scripts) and always needs `Authorization: Bearer wmb_...`.
 * A host app can check its own API keys instead (`apiAuth` in host.ts); with
 * `features.apiTokens: false` labebal's tokens are not accepted at all.
 */
import { featureOn, host } from "./host";
import { verifyToken, type TokenInfo } from "./tokens";

const unauthorized = (message: string) =>
  Response.json({ error: message }, { status: 401, headers: { "www-authenticate": 'Bearer realm="labebal"' } });

export async function authenticate(req: Request): Promise<{ ok: true; token: TokenInfo } | { ok: false; res: Response }> {
  const hostAuth = host().apiAuth;
  if (hostAuth) {
    const u = await hostAuth(req);
    if (u) return { ok: true, token: { id: u.id, name: u.name || u.id, hint: "", createdAt: "", lastUsedAt: null, revokedAt: null } };
    if (!featureOn("apiTokens")) return { ok: false, res: unauthorized("Not authorized.") };
  }
  if (!featureOn("apiTokens")) return { ok: false, res: unauthorized("API access is not available here.") };
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  if (!m) return { ok: false, res: unauthorized("Missing bearer token. Create one in Settings > API access.") };
  const token = await verifyToken(m[1]);
  if (!token) return { ok: false, res: unauthorized("Invalid or revoked token.") };
  return { ok: true, token };
}

/** Wrap a route handler so it only runs with a valid token. */
export function withToken<C>(handler: (req: Request, ctx: C, token: TokenInfo) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const a = await authenticate(req);
    if (!a.ok) return a.res;
    return handler(req, ctx, a.token);
  };
}
