import type { Ctx } from "../../../http";

import { z } from "zod";
import { parseBody } from "../../../../server/validate";
import { listVersions, saveVersion, whoFrom } from "../../../../server/versions";
import { requireRole } from "../../../../server/identity";

/** Versions of a template, newest first (with documents unless ?docs=0). */
export async function GET(req: Request, ctx: Ctx<"/templates/[id]/versions">) {
  const { id } = await ctx.params;
  const p = new URL(req.url).searchParams;
  return Response.json(await listVersions(id, { withDocs: p.get("docs") !== "0", limit: Number(p.get("limit")) || undefined }));
}

const saveSchema = z.object({ note: z.string().trim().max(200).default("") });

/** "Save version": pin the current saved design under a name. Body: `{ note? }`. */
export async function POST(req: Request, ctx: Ctx<"/templates/[id]/versions">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, saveSchema);
  if (!body.ok) return body.res;
  const v = await saveVersion(id, body.data.note, whoFrom(req));
  return v ? Response.json(v, { status: 201 }) : Response.json({ error: "template not found" }, { status: 404 });
}
