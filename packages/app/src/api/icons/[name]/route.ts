import type { Ctx } from "../../http";
import { iconSvg } from "../../../server/icons";

/**
 * Icon SVG by id: /api/icons/<id>[.svg], with the id URL-encoded
 * (`mdi%3Ausb`; a plain name is Tabler, `custom%3A<assetId>`
 * an uploaded icon). ?filled=1 asks for the filled variant (Tabler; falls back
 * to the outline one; `x-icon-variant` says which was served).
 */
export async function GET(req: Request, ctx: Ctx<"/icons/[name]">) {
  const { name } = await ctx.params;
  let id = name.replace(/\.svg$/, "");
  try {
    // Params may arrive still percent-encoded; ids never contain "%".
    if (id.includes("%")) id = decodeURIComponent(id);
  } catch {
    return new Response("bad id", { status: 400 });
  }
  const filled = ["1", "true"].includes(new URL(req.url).searchParams.get("filled") ?? "");
  const icon = await iconSvg(id, filled);
  if (!icon) return new Response("not found", { status: 404 });
  return new Response(icon.svg, {
    headers: {
      "content-type": "image/svg+xml",
      // Custom icons can be deleted; built-in sets only change with a deploy.
      "cache-control": icon.custom ? "private, max-age=300" : "public, max-age=86400",
      "x-icon-variant": icon.filled ? "filled" : "outline",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
