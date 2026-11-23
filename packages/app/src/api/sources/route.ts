import { ensureScheduler } from "../../server/scheduler";
import { listSources } from "../../server/sources";

/** Every dataset's live source (header values never included). */
export async function GET() {
  ensureScheduler();
  return Response.json(await listSources());
}
