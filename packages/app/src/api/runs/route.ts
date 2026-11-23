import { listRuns, saveRun } from "../../server/runs";
import { parseBody } from "../../server/validate";
import { runSchema } from "../../server/validate-data";
import { requireRole } from "../../server/identity";

export async function GET() {
  return Response.json(await listRuns());
}

export async function POST(req: Request) {
  const denied = requireRole(req, "printer");
  if (denied) return denied;
  const body = await parseBody(req, runSchema);
  if (!body.ok) return body.res;
  return Response.json(await saveRun(body.data), { status: 201 });
}
