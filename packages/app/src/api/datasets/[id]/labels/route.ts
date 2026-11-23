import type { Ctx } from "../../../http";
import { applyDatasetLabels } from "../../../../server/datasets";
import { parseBody } from "../../../../server/validate";
import { applySchema } from "../../../../server/validate-data";
import { requireRole } from "../../../../server/identity";

/**
 * Create / update one label per row. Body: `{ rowIds?: string[] }` or
 * `{ filter?: { q, column, excludeIds } }` (default: all rows).
 */
export async function POST(req: Request, ctx: Ctx<"/datasets/[id]/labels">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, applySchema);
  if (!body.ok) return body.res;
  const { rowIds, filter } = body.data;
  try {
    const r = await applyDatasetLabels(id, rowIds ? { rowIds } : filter ? { filter } : {});
    return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
