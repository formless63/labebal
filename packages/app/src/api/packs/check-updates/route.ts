import { requireRole } from "../../../server/identity";
import { checkUpdates } from "../../../server/packs";
import { parseBody } from "../../../server/validate";
import { checkUpdatesSchema, githubErrors, noStore } from "../../../server/validate-github";
import { env } from "../../../server/host";

const minutes = () => Math.max(1, Number(env().LABEBAL_PACK_CHECK_MINUTES) || 10);

/**
 * Update prompts (admin): refresh sources not checked for
 * LABEBAL_PACK_CHECK_MINUTES (default 10; `force` = all now), then per
 * installed pack with a newer, not skipped version a dry-run summary
 * `[{ packId, name, from, to, added, removed, changed, kept }]`.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const b = await parseBody(req, checkUpdatesSchema);
  if (!b.ok) return b.res;
  return githubErrors(async () => Response.json(await checkUpdates({ maxAgeMs: minutes() * 60_000, force: b.data.force }), { headers: noStore }));
}
