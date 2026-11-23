import { counterDefSchema, listCounters, saveCounter } from "../../server/counters";
import { parseBody } from "../../server/validate";
import { requireRole } from "../../server/identity";

/** Counters with their current values (one per scope key). */
export async function GET() {
  return Response.json(await listCounters());
}

/** Create or update a counter definition. */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, counterDefSchema);
  if (!body.ok) return body.res;
  return Response.json(await saveCounter(body.data), { status: 201 });
}
