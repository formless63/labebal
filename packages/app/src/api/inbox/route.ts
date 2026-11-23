import { listRequests, type RequestStatus } from "../../server/inbox";
import { ensureScheduler } from "../../server/scheduler";

/** Print requests for the Inbox page, newest first. `?status=&before=&limit=` */
export async function GET(req: Request) {
  ensureScheduler();
  const p = new URL(req.url).searchParams;
  const status = (p.get("status") || undefined) as RequestStatus | undefined;
  const before = p.get("before") || undefined;
  if (before && Number.isNaN(Date.parse(before))) return Response.json({ error: "before must be a date" }, { status: 400 });
  return Response.json(await listRequests({ status, before, limit: Number(p.get("limit")) || undefined }));
}
