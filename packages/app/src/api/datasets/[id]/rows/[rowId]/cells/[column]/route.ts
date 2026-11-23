import type { Ctx } from "../../../../../../http";
import { patchRows } from "../../../../../../../server/datasets";
import { parseBody } from "../../../../../../../server/validate";
import { cellSchema } from "../../../../../../../server/validate-data";
import { requireRole } from "../../../../../../../server/identity";

/** Set one cell: `{ value: "text" }`. */
export async function PUT(req: Request, ctx: Ctx<"/datasets/[id]/rows/[rowId]/cells/[column]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, rowId, column } = await ctx.params;
  const body = await parseBody(req, cellSchema);
  if (!body.ok) return body.res;
  const n = await patchRows(id, [{ id: rowId, values: { [column]: body.data.value } }]);
  return n ? Response.json({ id: rowId, column, value: body.data.value }) : Response.json({ error: "row not found" }, { status: 404 });
}
