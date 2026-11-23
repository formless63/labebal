import type { Ctx } from "../../../http";
import { addRows, deleteRows, getDatasetMeta, patchRows, queryRows } from "../../../../server/datasets";
import { parseBody } from "../../../../server/validate";
import { parseRowQuery, rowsAddSchema, rowsDeleteSchema, rowsPatchSchema } from "../../../../server/validate-data";
import { requireRole } from "../../../../server/identity";

const notFound = () => Response.json({ error: "dataset not found" }, { status: 404 });

/** A page of rows. ?q= &column= &sort=<column id> &dir=asc|desc &offset= &limit=(max 50000 | all) &ids=a,b */
export async function GET(req: Request, ctx: Ctx<"/datasets/[id]/rows">) {
  const { id } = await ctx.params;
  if (!(await getDatasetMeta(id))) return notFound();
  return Response.json(await queryRows(id, parseRowQuery(new URL(req.url).searchParams)));
}

/** Append / upsert records (objects keyed by column name or id), in batches. */
export async function POST(req: Request, ctx: Ctx<"/datasets/[id]/rows">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, rowsAddSchema);
  if (!body.ok) return body.res;
  const r = await addRows(id, body.data.rows, { mode: body.data.mode, keyColumn: body.data.key });
  return r ? Response.json(r) : notFound();
}

/** Merge cells into several rows: `{ updates: [{ id, values: { column: text } }] }`. */
export async function PATCH(req: Request, ctx: Ctx<"/datasets/[id]/rows">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, rowsPatchSchema);
  if (!body.ok) return body.res;
  return Response.json({ updated: await patchRows(id, body.data.updates) });
}

/** Delete `{ rowIds: [...] }` or every row matching `{ filter: { q, column, excludeIds } }`. */
export async function DELETE(req: Request, ctx: Ctx<"/datasets/[id]/rows">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, rowsDeleteSchema);
  if (!body.ok) return body.res;
  return Response.json({ deleted: await deleteRows(id, body.data) });
}
