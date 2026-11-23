import type { Ctx } from "../../../../http";
import { refreshSource } from "../../../../../server/packs";

/** Re-read a source's listing (any role: it changes nothing in the library). Errors are stored on the source (`lastError`). */
export async function POST(_req: Request, ctx: Ctx<"/packs/sources/[id]/refresh">) {
  const { id } = await ctx.params;
  const r = await refreshSource(id);
  return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
}
