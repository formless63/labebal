"use client";
import { useState } from "react";
import { IconClipboard, IconFileSpreadsheet, IconPlus, IconTable } from "@tabler/icons-react";
import { toast } from "sonner";
import { columnIdFor, newRowId, parseTable, type Dataset, type ParsedTable } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { useDatasetActions } from "./api";
import { TableFileInput } from "./spreadsheet";
import { Hint } from "./ui";

const newId = () => `ds-${crypto.randomUUID().slice(0, 8)}`;

function blankTable(names: string): ParsedTable {
  const taken = new Set<string>();
  const columns = names
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ id: columnIdFor(name, taken), name }));
  return { columns, rows: [{ id: newRowId(), values: Object.fromEntries(columns.map((c) => [c.id, ""])) }], warnings: [] };
}

function TablePeek({ t }: { t: ParsedTable | null }) {
  if (!t) return null;
  if (!t.columns.length) return <Hint>Nothing found yet.</Hint>;
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-2 text-sm">
      <div>
        <strong>{t.rows.length}</strong> row{t.rows.length === 1 ? "" : "s"}, columns: {t.columns.map((c) => c.name).join(", ")}
      </div>
      {t.warnings.slice(0, 3).map((w) => (
        <div key={w} className="text-xs text-amber-700 dark:text-amber-400">
          {w}
        </div>
      ))}
    </div>
  );
}

/** "New dataset": import a CSV file, paste from a spreadsheet, or start a blank table. */
export function NewDatasetDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("file");
  const [name, setName] = useState("");
  const [fileTable, setFileTable] = useState<ParsedTable | null>(null);
  const [paste, setPaste] = useState("");
  const [cols, setCols] = useState("Name, Category, SKU");
  const { create } = useDatasetActions();

  const pasted = paste.trim() ? parseTable(paste) : null;
  const table = tab === "file" ? fileTable : tab === "paste" ? pasted : blankTable(cols);

  async function submit() {
    if (!table?.columns.length) return;
    const d: Dataset = { id: newId(), name: name.trim() || "Untitled data", columns: table.columns, rows: table.rows };
    try {
      await create.mutateAsync(d);
      toast.success(`Created "${d.name}" with ${d.rows.length} rows`);
      setOpen(false);
      setFileTable(null);
      setPaste("");
      setName("");
      onCreated(d.id);
    } catch (e) {
      toast.error(`Could not create: ${(e as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IconPlus /> New data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New data</DialogTitle>
          <DialogDescription>Bring in your records. The first row should hold the column names.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ds-name">Name</Label>
            <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drawer contents" />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="file">
                <IconFileSpreadsheet /> File
              </TabsTrigger>
              <TabsTrigger value="paste">
                <IconClipboard /> Paste
              </TabsTrigger>
              <TabsTrigger value="blank">
                <IconTable /> Blank table
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="space-y-2 pt-2">
              <TableFileInput onTable={setFileTable} onName={(n) => setName((cur) => cur || n)} />
              <Hint>CSV, Excel (.xlsx) or OpenDocument (.ods). From Google Sheets or Numbers use File &gt; Download as .xlsx or CSV.</Hint>
              <TablePeek t={fileTable} />
            </TabsContent>
            <TabsContent value="paste" className="space-y-2 pt-2">
              <Textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Select the cells in your spreadsheet (including the header row), copy, and paste here." className="font-mono text-xs" />
              <TablePeek t={pasted} />
            </TabsContent>
            <TabsContent value="blank" className="space-y-2 pt-2">
              <Label htmlFor="ds-cols">Column names (comma separated)</Label>
              <Input id="ds-cols" value={cols} onChange={(e) => setCols(e.target.value)} />
              <Hint>You can add, rename and remove columns later.</Hint>
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!table?.columns.length || create.isPending} onClick={submit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
