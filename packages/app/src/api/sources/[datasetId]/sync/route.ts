import type { Ctx } from "../../../http";
import { syncSource } from "../../../../server/sources";
import { requireRole } from "../../../../server/identity";

/** Sync now. 200 with the result (also when the fetch failed: see `ok` / `error`); 404 without a source. */
export async function POST(req: Request, ctx: Ctx<"/sources/[datasetId]/sync">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { datasetId } = await ctx.params;
  const r = await syncSource(datasetId);
  return r ? Response.json(r) : Response.json({ error: "no source linked" }, { status: 404 });
}
