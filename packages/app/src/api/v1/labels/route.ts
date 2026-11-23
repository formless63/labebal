import { withToken } from "../../../server/auth";
import { upsertLabelsPublic } from "../../../server/public-api";
import { parseBody } from "../../../server/validate";
import { v1LabelsSchema } from "../../../server/validate-data";

/** Public: upsert labels by id or by templateId + key. See docs/API.md. */
export const POST = withToken(async (req) => {
  const body = await parseBody(req, v1LabelsSchema);
  if (!body.ok) return body.res;
  const r = await upsertLabelsPublic(body.data.labels, body.data.merge);
  return Response.json(r, { status: r.errors.length && !r.created.length && !r.updated.length ? 400 : 200 });
});
