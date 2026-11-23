import { withToken } from "../../../server/auth";
import { getCounter, listCounters, reserveResponse, reserveSchema } from "../../../server/counters";
import { parseBody } from "../../../server/validate";

/** Public: counters and their current values; `?id=` for one. See docs/API.md. */
export const GET = withToken(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json(await listCounters(), { headers: { "cache-control": "no-store" } });
  const c = await getCounter(id.toLowerCase());
  return c ? Response.json(c, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "counter not found" }, { status: 404 });
});

/** Public: reserve numbers (one item or `{ items: [...] }`), atomically. Counters must exist. See docs/API.md. */
export const POST = withToken(async (req, _ctx, token) => {
  const body = await parseBody(req, reserveSchema);
  if (!body.ok) return body.res;
  return reserveResponse(body.data.items, { source: body.data.source ? `api:${token.name}: ${body.data.source}` : `api:${token.name}`, create: false });
});
