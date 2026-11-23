import type { Ctx } from "../../../../http";
import { deleteRows, patchRows } from "../../../../../server/datasets";
import { parseBody } from "../../../../../server/validate";
import { rowPatchSchema } from "../../../../../server/validate-data";
import { requireRole } from "../../../../../server/identity";

/** Merge cells into one row: `{ values: { column: text } }`. */
export async function PATCH(req: Request, ctx: Ctx<"/datasets/[id]/rows/[rowId]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, rowId } = await ctx.params;
  const body = await parseBody(req, rowPatchSchema);
  if (!body.ok) return body.res;
  const n = await patchRows(id, [{ id: rowId, values: body.data.values }]);
  return n ? Response.json({ id: rowId }) : Response.json({ error: "row not found" }, { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx<"/datasets/[id]/rows/[rowId]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, rowId } = await ctx.params;
  await deleteRows(id, { rowIds: [rowId] });
  return new Response(null, { status: 204 });
}
