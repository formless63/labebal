import type { Ctx } from "../../../http";
import { duplicateKeys, getDatasetMeta } from "../../../../server/datasets";

/** Values shared by several rows in `?column=` (default: the linked key column), across the whole dataset. */
export async function GET(req: Request, ctx: Ctx<"/datasets/[id]/duplicates">) {
  const { id } = await ctx.params;
  const meta = await getDatasetMeta(id);
  if (!meta) return Response.json({ error: "not found" }, { status: 404 });
  const column = new URL(req.url).searchParams.get("column") ?? meta.link?.keyColumn;
  if (!column) return Response.json([]);
  if (!meta.columns.some((c) => c.id === column)) return Response.json({ error: "unknown column" }, { status: 400 });
  return Response.json(await duplicateKeys(id, column));
}
