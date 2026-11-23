/**
 * One fetch-standard handler for the whole API: `(Request) => Response`.
 * Mount it on any server that speaks web-standard requests (Next.js route
 * handlers, Hono, Bun.serve, Deno, React Router / TanStack Start resource
 * routes, Node via a small adapter).
 *
 * The handler strips everything up to and including `apiBase` from the URL,
 * then matches the rest against the route table (routes.gen.ts).
 */
import { METHODS, type Method, type RouteModule } from "./http";
import { ROUTES } from "./routes.gen";

export type MatchedRoute = { module: RouteModule; params: Record<string, string> };

export function matchRoute(segments: string[]): MatchedRoute | null {
  outer: for (const [pattern, module] of ROUTES) {
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      if (p.startsWith("[")) params[p.slice(1, -1)] = segments[i];
      else if (p !== segments[i]) continue outer;
    }
    return { module, params };
  }
  return null;
}

/** Path segments after `apiBase` (e.g. "/labels/api"), decoded. null when the URL is outside it. */
export function apiSegments(url: string, apiBase: string): string[] | null {
  const pathname = new URL(url).pathname;
  const base = apiBase.replace(/\/+$/, "");
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  return pathname
    .slice(base.length)
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

export async function handleApi(req: Request, apiBase: string): Promise<Response> {
  const segments = apiSegments(req.url, apiBase);
  const hit = segments && matchRoute(segments);
  if (!hit) return Response.json({ error: "Not found" }, { status: 404 });
  const method = (req.method === "HEAD" ? "GET" : req.method) as Method;
  const fn = METHODS.includes(method) ? hit.module[method] : undefined;
  if (!fn) {
    const allow = METHODS.filter((m) => hit.module[m]).join(", ");
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow } });
  }
  return fn(req, { params: Promise.resolve(hit.params) });
}
