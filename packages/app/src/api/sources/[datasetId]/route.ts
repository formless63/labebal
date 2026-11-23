import type { Ctx as RouteCtx } from "../../http";
import { getDatasetMeta } from "../../../server/datasets";
import { ensureScheduler } from "../../../server/scheduler";
import { deleteSource, getSource, saveSource } from "../../../server/sources";
import { parseBody } from "../../../server/validate";
import { sourceSchema } from "../../../server/validate-integrations";
import { requireRole } from "../../../server/identity";

type Ctx = RouteCtx<"/sources/[datasetId]">;

/** The dataset's source, or `null`. */
export async function GET(_req: Request, ctx: Ctx) {
  const { datasetId } = await ctx.params;
  ensureScheduler();
  return Response.json((await getSource(datasetId)) ?? null);
}

/** Link / change. `headerValue` omitted keeps the stored one; `null` clears it. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { datasetId } = await ctx.params;
  const body = await parseBody(req, sourceSchema);
  if (!body.ok) return body.res;
  if (!(await getDatasetMeta(datasetId))) return Response.json({ error: "dataset not found" }, { status: 404 });
  ensureScheduler();
  return Response.json(await saveSource(datasetId, body.data));
}

/** Unlink (rows stay). */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { datasetId } = await ctx.params;
  await deleteSource(datasetId);
  return new Response(null, { status: 204 });
}
