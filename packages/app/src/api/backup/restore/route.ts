import { readStoredBackup, restoreBackup } from "../../../server/backup";
import { requireRole } from "../../../server/identity";

/**
 * Restore a backup. Body: the zip (or `?file=<name>` of a stored backup).
 * `?mode=merge` (default: add what is missing, keep existing rows) or
 * `?mode=replace` (wipe every label_* table first; requires `&confirm=replace`).
 * `?dryRun=1` only checks the file and returns the plan.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const mode = p.get("mode") === "replace" ? "replace" : "merge";
  const dryRun = p.get("dryRun") === "1";
  if (mode === "replace" && !dryRun && p.get("confirm") !== "replace")
    return Response.json({ error: "replace wipes all data: add confirm=replace" }, { status: 400 });
  const file = p.get("file");
  const bytes = file ? await readStoredBackup(file) : new Uint8Array(await req.arrayBuffer());
  if (!bytes?.length) return Response.json({ error: file ? "backup file not found" : "empty body" }, { status: file ? 404 : 400 });
  try {
    return Response.json(await restoreBackup(bytes, mode, dryRun));
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 400 });
  }
}
