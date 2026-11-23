import { reserveResponse, reserveSchema } from "../../../server/counters";
import { parseBody } from "../../../server/validate";
import { requireRole } from "../../../server/identity";

/**
 * Reserve numbers for a browser print (called by features/counters/reserve.ts).
 * Unknown counters used in a template are created with defaults.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const body = await parseBody(req, reserveSchema);
  if (!body.ok) return body.res;
  return reserveResponse(body.data.items, { source: body.data.source ?? "print", create: true });
}
