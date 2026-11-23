"use client";
/**
 * File input for tables: CSV / TSV as text, Excel (.xlsx / .xls / .xlsm) and
 * OpenDocument (.ods) through SheetJS, parsed in the browser (the file never
 * goes to the server as-is). Workbooks with several sheets get a sheet picker.
 */
import { useState } from "react";
import { parseTable, type ParsedTable } from "@labebal/core";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Hint, Pick } from "./ui";

export const TABLE_FILE_ACCEPT = ".csv,.tsv,.txt,text/csv,.xlsx,.xlsm,.xls,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet";

const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|ods|fods)$/i;

export const isSpreadsheetFile = (name: string) => SPREADSHEET.test(name);

/** Strip the extension for a default dataset name. */
export const baseName = (name: string) => name.replace(/\.(csv|tsv|txt|xlsx|xlsm|xlsb|xls|ods|fods)$/i, "");

type WorkBook = import("@labebal/app/vendor/xlsx").WorkBook;

/** Sheet -> table via CSV, so column naming / trimming match CSV imports exactly. */
export async function sheetToTable(wb: WorkBook, sheet: string): Promise<ParsedTable> {
  const XLSX = await import("@labebal/app/vendor/xlsx");
  const ws = wb.Sheets[sheet];
  if (!ws) return { columns: [], rows: [], warnings: [`No sheet "${sheet}"`] };
  // Formatted text (what the cell shows), so dates / leading zeros look like in Excel.
  const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false, strip: true });
  return parseTable(csv, { delimiter: "," });
}

export async function readWorkbook(file: File): Promise<WorkBook> {
  const XLSX = await import("@labebal/app/vendor/xlsx");
  return XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, dense: true });
}

/**
 * Pick a file; calls `onTable` with the parsed table (null when cleared) and
 * `onName` with the file's base name. Shows a sheet picker for workbooks.
 */
export function TableFileInput({ onTable, onName, id }: { onTable: (t: ParsedTable | null) => void; onName?: (name: string) => void; id?: string }) {
  const [wb, setWb] = useState<WorkBook | null>(null);
  const [sheet, setSheet] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(f: File | undefined) {
    setError(null);
    setWb(null);
    setSheet(undefined);
    if (!f) return onTable(null);
    onName?.(baseName(f.name));
    if (!isSpreadsheetFile(f.name)) return onTable(parseTable(await f.text()));
    setBusy(true);
    try {
      const book = await readWorkbook(f);
      setWb(book);
      // First sheet with something in it.
      const first = book.SheetNames.find((n) => book.Sheets[n]?.["!ref"]) ?? book.SheetNames[0];
      setSheet(first);
      onTable(first ? await sheetToTable(book, first) : null);
    } catch (e) {
      setError(`Could not read the workbook: ${(e as Error).message}`);
      onTable(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input id={id} type="file" accept={TABLE_FILE_ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} />
      {busy && <Hint>Reading workbook…</Hint>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {wb && wb.SheetNames.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Sheet</Label>
          <Pick
            value={sheet}
            onChange={async (s) => {
              setSheet(s);
              onTable(s ? await sheetToTable(wb, s) : null);
            }}
            options={wb.SheetNames.map((n) => ({ value: n, label: n }))}
            className="w-full"
            aria-label="Sheet"
          />
        </div>
      )}
    </div>
  );
}
