import { getIdentity } from "../../server/identity";

/** Who is calling (from the reverse proxy's identity headers) and their role. */
export async function GET(req: Request) {
  return Response.json(getIdentity(req), { headers: { "cache-control": "private, no-store" } });
}
