import type { Ctx } from "../../http";
import { deleteAsset, getAsset, updateAssetMeta } from "../../../server/assets";
import { requireRole } from "../../../server/identity";

/** Raw asset bytes (immutable: ids are never reused). */
export async function GET(_req: Request, ctx: Ctx<"/assets/[id]">) {
  const { id } = await ctx.params;
  const a = await getAsset(id);
  if (!a) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": a.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // SVGs are served as images only; never let them run script in our origin.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** Replace metadata (e.g. pixel-font grid). Body: JSON object. */
export async function PATCH(req: Request, ctx: Ctx<"/assets/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const meta = await req.json().catch(() => null);
  if (!meta || typeof meta !== "object") return Response.json({ error: "JSON object required" }, { status: 400 });
  await updateAssetMeta(id, meta);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request, ctx: Ctx<"/assets/[id]">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteAsset(id);
  return new Response(null, { status: 204 });
}
