import type { Ctx } from "../../../http";
import { withToken } from "../../../../server/auth";
import { getRequest, publicView } from "../../../../server/inbox";

/** Public: status of one print request. */
export const GET = withToken<Ctx<"/v1/print-requests/[id]">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const r = await getRequest(id);
  return r ? Response.json(publicView(r)) : Response.json({ error: "not found" }, { status: 404 });
});
