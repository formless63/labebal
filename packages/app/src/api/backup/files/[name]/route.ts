import type { Ctx } from "../../../http";
import { readStoredBackup } from "../../../../server/backup";

/** Download a backup stored in the server's backup directory. */
export async function GET(_req: Request, ctx: Ctx<"/backup/files/[name]">) {
  const { name } = await ctx.params;
  const bytes = await readStoredBackup(name);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
