import type { Ctx } from "../../http";
import { deleteLabels, upsertLabel } from "../../../server/library";
import { getLabelPage, publicUrlFromEnv } from "../../../server/label-page";
import { labelSchema, parseBody } from "../../../server/validate";
import { requireRole } from "../../../server/identity";
import { publicBaseUrl, requestOrigin } from "../../../features/label-page/model";
import { host } from "../../../server/host";

/**
 * One label's page data (what `/l/<id>` shows): label, template, field rows,
 * source dataset row, notes, last prints, page URL and record link. Viewers.
 */
export async function GET(req: Request, ctx: Ctx<"/labels/[id]">) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const { id } = await ctx.params;
  // Without a configured public URL: this request's origin plus where the module is mounted.
  const base = publicBaseUrl(publicUrlFromEnv(), requestOrigin((n) => req.headers.get(n), new URL(req.url).origin) + host().basePath);
  const page = await getLabelPage(id, base);
  if (!page) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(page, { headers: { "cache-control": "private, no-store" } });
}

export async function PUT(req: Request, ctx: Ctx<"/labels/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, labelSchema);
  if (!body.ok) return body.res;
  if (body.data.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  return Response.json(await upsertLabel(body.data));
}

export async function DELETE(req: Request, ctx: Ctx<"/labels/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteLabels([id]);
  return new Response(null, { status: 204 });
}
