import type { Ctx } from "../../../http";
import { revealWebhookSecret } from "../../../../server/webhooks";

/** The signing secret (Settings > Webhooks "Show secret"). */
export async function GET(_req: Request, ctx: Ctx<"/webhooks/[id]/secret">) {
  const { id } = await ctx.params;
  const secret = await revealWebhookSecret(id);
  return secret ? Response.json({ secret }, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "not found" }, { status: 404 });
}
