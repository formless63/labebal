import type { Ctx } from "../../../../http";
import { addRows, applyDatasetLabels, getDatasetMeta, queryRows } from "../../../../../server/datasets";
import { withToken } from "../../../../../server/auth";
import { parseBody } from "../../../../../server/validate";
import { parseRowQuery, v1RowsSchema } from "../../../../../server/validate-data";

/** Public: a page of rows (`?q= &column= &sort= &dir= &offset= &limit=`). See docs/API.md. */
export const GET = withToken<Ctx<"/v1/datasets/[id]/rows">>(async (req, ctx) => {
  const { id } = await ctx.params;
  const meta = await getDatasetMeta(id);
  if (!meta) return Response.json({ error: "dataset not found" }, { status: 404 });
  const page = await queryRows(id, parseRowQuery(new URL(req.url).searchParams));
  return Response.json({ columns: meta.columns, ...page });
});

/** Public: append / upsert rows into a dataset, optionally refreshing its labels. See docs/API.md. */
export const POST = withToken<Ctx<"/v1/datasets/[id]/rows">>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, v1RowsSchema);
  if (!body.ok) return body.res;
  const res = await addRows(id, body.data.rows, { mode: body.data.mode, keyColumn: body.data.key });
  if (!res) return Response.json({ error: "dataset not found" }, { status: 404 });
  const r = { added: res.added, updated: res.updated, rows: res.rows };
  if (!body.data.applyLabels) return Response.json(r);
  try {
    return Response.json({ ...r, labels: await applyDatasetLabels(id) });
  } catch (e) {
    return Response.json({ ...r, labels: { error: (e as Error).message } });
  }
});
