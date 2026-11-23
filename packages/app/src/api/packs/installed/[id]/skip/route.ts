import type { Ctx } from "../../../../http";
import { requireRole } from "../../../../../server/identity";
import { skipUpdate } from "../../../../../server/packs";
import { parseBody } from "../../../../../server/validate";
import { skipSchema } from "../../../../../server/validate-github";
import { whoFrom } from "../../../../../server/versions";

/** "Skip this version" in update prompts: `{ version }` (null = prompt again). Admin. */
export async function POST(req: Request, ctx: Ctx<"/packs/installed/[id]/skip">) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const b = await parseBody(req, skipSchema);
  if (!b.ok) return b.res;
  await skipUpdate((await ctx.params).id, b.data.version, whoFrom(req));
  return new Response(null, { status: 204 });
}
