import { withToken } from "../../../server/auth";
import { createRequest, listRequests, publicView, type RequestStatus } from "../../../server/inbox";
import { parseBody } from "../../../server/validate";
import { printRequestSchema } from "../../../server/validate-integrations";

/** Public: ask for a print. It waits in the Inbox until someone approves it in a browser. See docs/API.md. */
export const POST = withToken(async (req, _ctx, token) => {
  const body = await parseBody(req, printRequestSchema);
  if (!body.ok) return body.res;
  const r = await createRequest(body.data, token.name);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(publicView(r.request), { status: 201, headers: { location: `/api/v1/print-requests/${r.request.id}` } });
});

/** Public: recent requests (`?status=pending|approved|rejected&limit=`). */
export const GET = withToken(async (req) => {
  const p = new URL(req.url).searchParams;
  const status = p.get("status") as RequestStatus | null;
  if (status && !["pending", "approved", "rejected"].includes(status)) return Response.json({ error: "status must be pending, approved or rejected" }, { status: 400 });
  return Response.json((await listRequests({ status: status ?? undefined, limit: Number(p.get("limit")) || 50 })).map(publicView));
});
