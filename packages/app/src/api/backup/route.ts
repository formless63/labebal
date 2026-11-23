import { backupFileName } from "@labebal/core";
import { backupSchedule, createBackup, lastScheduledBackup, listStoredBackups, saveBackupToDisk } from "../../server/backup";
import { requireRole } from "../../server/identity";

/** Download a full backup zip now. `?status=1` instead returns the schedule and stored backups. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("status") === "1")
    return Response.json({ schedule: backupSchedule(), last: lastScheduledBackup(), files: await listStoredBackups() });
  const { zip } = await createBackup("download");
  return new Response(new Uint8Array(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${backupFileName()}"`, "cache-control": "no-store" },
  });
}

/** Write a backup into the server's backup directory now (same as a scheduled one). */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  try {
    return Response.json(await saveBackupToDisk("manual"), { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
