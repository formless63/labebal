import type { Ctx } from "../../../http";

import { bundleFileName, bundleToJson } from "@labebal/core";
import { exportTemplateBundle } from "../../../../server/library";

/** Download one template as `<name>.labebal.json` with the assets it uses. `?labels=1` includes its labels. */
export async function GET(req: Request, ctx: Ctx<"/templates/[id]/share">) {
  const { id } = await ctx.params;
  const b = await exportTemplateBundle(id, new URL(req.url).searchParams.get("labels") === "1");
  if (!b) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(bundleToJson(b), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${bundleFileName(b.template)}"`,
    },
  });
}
