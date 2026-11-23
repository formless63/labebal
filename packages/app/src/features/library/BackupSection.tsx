"use client";
/** Settings > Backup: download / restore a full backup, scheduled backups on the server. */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArchive, IconDatabaseExport, IconDownload, IconRestore } from "@tabler/icons-react";
import { toast } from "sonner";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { json } from "../data/api";
import { apiRoot } from "../../lib/base";

interface Status {
  schedule: { dir: string; intervalHours: number; keep: number };
  last: { at: string; ok: boolean; message: string } | null;
  files: { name: string; size: number; createdAt: string }[];
}

interface Plan {
  plan: { tables: string[]; unknown: string[]; missing: string[]; warnings: string[] };
  manifest: { createdAt: string; tables: { name: string; rows: number }[] };
  restored: Record<string, number>;
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
const pretty = (t: string) => t.replace(/^label_/, "").replace(/_/g, " ");

export function BackupSection() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ["backup-status"], queryFn: () => fetch(`${apiRoot()}/backup?status=1`).then((r) => json<Status>(r)) });

  async function restore(body: Blob | null, file?: string) {
    const url = (mode: string, extra = "") => `${apiRoot()}/backup/restore?mode=${mode}${file ? `&file=${encodeURIComponent(file)}` : ""}${extra}`;
    setBusy(true);
    try {
      const dry = await fetch(url("merge", "&dryRun=1"), { method: "POST", body }).then((r) => json<Plan>(r));
      const rows = dry.manifest.tables.filter((t) => t.rows).map((t) => `${t.rows} ${pretty(t.name)}`).join(", ");
      const replace = await confirmDialog({
        title: `Restore the backup from ${fmt.format(new Date(dry.manifest.createdAt))}?`,
        description: (
          <span className="block space-y-2">
            <span className="block">It holds {rows || "no data"}.</span>
            <span className="block">
              <b>Replace</b> deletes everything in labebal now and puts the backup back. <b>Merge</b> (Cancel, then choose below) only adds what is missing.
            </span>
            {dry.plan.warnings.map((w) => (
              <span key={w} className="block text-amber-600">
                {w}
              </span>
            ))}
          </span>
        ),
        confirmLabel: "Replace everything",
        destructive: true,
      });
      let mode: "replace" | "merge" | null = replace ? "replace" : null;
      if (!mode && (await confirmDialog({ title: "Merge the backup instead?", description: "Adds templates, labels, history... that are not in labebal now; nothing is changed or deleted.", confirmLabel: "Merge" }))) mode = "merge";
      if (!mode) return;
      const r = await fetch(url(mode, mode === "replace" ? "&confirm=replace" : ""), { method: "POST", body }).then((res) => json<Plan>(res));
      const n = Object.values(r.restored).reduce((a, b) => a + b, 0);
      toast.success(mode === "replace" ? `Restored ${n} records` : `Merged: added ${n} records`);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(`Restore failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveNow() {
    setBusy(true);
    try {
      const r = await fetch(`${apiRoot()}/backup`, { method: "POST" }).then((res) => json<{ name: string }>(res));
      toast.success(`Saved ${r.name} on the server`);
      void status.refetch();
    } catch (e) {
      toast.error(`Backup failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={`${apiRoot()}/backup`} download>
            <IconDownload /> Download backup
          </a>
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <IconRestore /> Restore from file…
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void saveNow()}>
          <IconDatabaseExport /> Back up on the server now
        </Button>
        <input ref={input} type="file" accept=".zip" hidden onChange={(e) => (e.target.files?.[0] && void restore(e.target.files[0]), (e.target.value = ""))} />
      </div>
      <p className="text-muted-foreground">
        One zip with every template (and its versions), label, dataset, stock run, print history entry, uploaded image / font / icon and setting.
      </p>
      {s && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            {s.schedule.intervalHours
              ? `Automatic backups every ${s.schedule.intervalHours} h to ${s.schedule.dir} (newest ${s.schedule.keep} kept).`
              : `Automatic backups are off (set LABEBAL_BACKUP_INTERVAL_HOURS). Server backups go to ${s.schedule.dir}.`}
            {s.last && !s.last.ok && <span className="block text-destructive">Last automatic backup failed: {s.last.message}</span>}
          </p>
          {s.files.length > 0 && (
            <ul className="divide-y rounded-md border">
              {s.files.slice(0, 10).map((f) => (
                <li key={f.name} className="flex items-center gap-2 px-3 py-1.5">
                  <IconArchive className="size-4 text-muted-foreground" />
                  <span className="flex-1">{fmt.format(new Date(f.createdAt))}</span>
                  <span className="text-muted-foreground">{kb(f.size)}</span>
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`${apiRoot()}/backup/files/${encodeURIComponent(f.name)}`} download>
                      Download
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore(null, f.name)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
