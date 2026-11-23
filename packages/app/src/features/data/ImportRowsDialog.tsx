"use client";
import { useState } from "react";
import { IconTableImport } from "@tabler/icons-react";
import { toast } from "sonner";
import { parseTable, type DataColumn, type ParsedTable } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useDatasetActions } from "./api";
import { TableFileInput } from "./spreadsheet";
import { Hint, Pick } from "./ui";

/** Records sent per request (the server writes them in smaller batches). */
const CHUNK = 2000;

/** Re-import: add new rows and update rows whose key matches. Runs on the server in batches. */
export function ImportRowsDialog({
  dataset,
  onColumnsAdded,
}: {
  dataset: { id: string; name: string; columns: DataColumn[]; link?: { keyColumn?: string } };
  onColumnsAdded: (columns: DataColumn[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<ParsedTable | null>(null);
  const [key, setKey] = useState<string | undefined>(dataset.link?.keyColumn);
  const [progress, setProgress] = useState<string | null>(null);
  const { addRows } = useDatasetActions();
  const table = file ?? (paste.trim() ? parseTable(paste) : null);

  async function run() {
    if (!table) return;
    const records = table.rows.map((r) => Object.fromEntries(table.columns.map((c) => [c.name, r.values[c.id]])));
    let added = 0;
    let updated = 0;
    const newCols: DataColumn[] = [];
    try {
      for (let i = 0; i < records.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, records.length)} of ${records.length}…`);
        const r = await addRows.mutateAsync({ id: dataset.id, rows: records.slice(i, i + CHUNK), mode: key ? "upsert" : "append", key });
        added += r.added;
        updated += r.updated;
        newCols.push(...r.newColumns);
      }
      if (newCols.length) onColumnsAdded(newCols);
      toast.success(`${added} row${added === 1 ? "" : "s"} added, ${updated} updated`);
      setOpen(false);
      setPaste("");
      setFile(null);
    } catch (e) {
      toast.error(`Import stopped: ${(e as Error).message}`, { description: added + updated ? `${added} added and ${updated} updated before the error.` : undefined });
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (progress) return;
        setOpen(o);
        if (o) setKey(dataset.link?.keyColumn);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <IconTableImport /> Import rows
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import rows into “{dataset.name}”</DialogTitle>
          <DialogDescription>Columns are matched by name; new columns are added.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <TableFileInput key={open ? "open" : "closed"} onTable={setFile} />
          <Textarea
            rows={6}
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setFile(null);
            }}
            placeholder="…or paste cells from a spreadsheet (with the header row)"
            className="font-mono text-xs"
          />
          <div className="space-y-1.5">
            <Label>Match existing rows by</Label>
            <Pick value={key} onChange={setKey} none="Don't match: add everything as new rows" options={dataset.columns.map((c) => ({ value: c.id, label: c.name }))} className="w-full" />
          </div>
          <Hint>
            {progress ?? (table ? `${table.rows.length} rows ready.` : "Choose a file or paste rows.")} Rows with the same {key ? "key" : "values"} are{" "}
            {key ? "updated in place" : "added again"}.
          </Hint>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!!progress} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!table?.rows.length || !!progress} onClick={run}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
