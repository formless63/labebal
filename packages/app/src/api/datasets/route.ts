import { listDatasets, saveDataset } from "../../server/datasets";
import { parseBody } from "../../server/validate";
import { datasetSchema } from "../../server/validate-data";
import { requireRole } from "../../server/identity";

/** Dataset summaries (no rows). */
export async function GET() {
  return Response.json(await listDatasets());
}

/** Create (or replace) a dataset. */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, datasetSchema);
  if (!body.ok) return body.res;
  return Response.json(await saveDataset(body.data), { status: 201 });
}
