import { z } from "zod";
import { previewSource } from "../../../server/sources";
import { parseBody } from "../../../server/validate";
import { sourceSchema } from "../../../server/validate-integrations";
import { requireRole } from "../../../server/identity";

const previewSchema = sourceSchema.extend({ datasetId: z.string().max(200).optional() });

/** Fetch a source configuration without saving: `{ total, columns, sample, warnings }`. `datasetId` reuses its stored header value. */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, previewSchema);
  if (!body.ok) return body.res;
  const { datasetId, ...cfg } = body.data;
  try {
    return Response.json(await previewSource(cfg, datasetId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
