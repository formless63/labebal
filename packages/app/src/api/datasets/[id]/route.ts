import type { Ctx } from "../../http";
import { deleteDataset, getDataset, getDatasetMeta, patchDataset, saveDataset } from "../../../server/datasets";
import { parseBody } from "../../../server/validate";
import { datasetPatchSchema, datasetSchema } from "../../../server/validate-data";
import { requireRole } from "../../../server/identity";

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

/** Dataset metadata + `rowCount` (rows: GET ./rows). `?rows=all` returns the whole dataset with rows. */
export async function GET(req: Request, ctx: Ctx<"/datasets/[id]">) {
  const { id } = await ctx.params;
  const d = new URL(req.url).searchParams.get("rows") === "all" ? await getDataset(id) : await getDatasetMeta(id);
  return d ? Response.json(d) : notFound();
}

/** Replace the whole dataset, rows included. */
export async function PUT(req: Request, ctx: Ctx<"/datasets/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, datasetSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await saveDataset(body.data));
}

/** Change name / columns / link (`null` unlinks). Rows are untouched, except cells of removed columns. */
export async function PATCH(req: Request, ctx: Ctx<"/datasets/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, datasetPatchSchema);
  if (!body.ok) return body.res;
  const d = await patchDataset(id, body.data);
  return d ? Response.json(d) : notFound();
}

export async function DELETE(req: Request, ctx: Ctx<"/datasets/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteDataset(id);
  return new Response(null, { status: 204 });
}
