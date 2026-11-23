import { pendingCount } from "../../../server/inbox";
import { ensureScheduler } from "../../../server/scheduler";

/** `{ pending }`: the nav badge polls this. */
export async function GET() {
  ensureScheduler();
  return Response.json({ pending: await pendingCount() }, { headers: { "cache-control": "no-store" } });
}
