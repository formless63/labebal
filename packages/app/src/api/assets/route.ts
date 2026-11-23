import { ASSET_KINDS, createAsset, listAssets, type AssetKind } from "../../server/assets";
import { requireRole } from "../../server/identity";

const kindOf = (v: string | null): AssetKind | undefined => ASSET_KINDS.find((k) => k === v);

/** List assets (metadata only). ?kind=image|font|icon */
export async function GET(req: Request) {
  return Response.json(await listAssets(kindOf(new URL(req.url).searchParams.get("kind"))));
}

/** Upload: multipart form with `file`, `kind` (image|font|icon; icons are sanitised SVGs), optional `meta` (JSON). */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const form = await req.formData();
  const file = form.get("file");
  const kind = kindOf(String(form.get("kind")));
  if (!(file instanceof File) || !kind) return Response.json({ error: "file and kind (image|font|icon) required" }, { status: 400 });
  let meta: Record<string, unknown> = {};
  try {
    meta = form.get("meta") ? JSON.parse(String(form.get("meta"))) : {};
  } catch {
    return Response.json({ error: "meta must be JSON" }, { status: 400 });
  }
  try {
    return Response.json(await createAsset(file, kind, meta), { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 400 });
  }
}
