import { assertFetchableUrl } from "../../server/safe-fetch";
import { parseBody } from "../../server/validate";
import { webhookCreateSchema } from "../../server/validate-integrations";
import { createWebhook, listWebhooks, WEBHOOK_EVENTS } from "../../server/webhooks";
import { requireRole } from "../../server/identity";

/** `{ events, webhooks }` (secrets are not included). */
export async function GET() {
  return Response.json({ events: WEBHOOK_EVENTS, webhooks: await listWebhooks() });
}

/** Create. The response includes the signing secret. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, webhookCreateSchema);
  if (!body.ok) return body.res;
  try {
    assertFetchableUrl(body.data.url);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(await createWebhook(body.data), { status: 201, headers: { "cache-control": "no-store" } });
}
