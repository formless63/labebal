"use client";
/** Property panel section for table elements: cells, rows / columns, borders, text. */
import { useEffect, useRef, useState } from "react";
import { IconColumnInsertRight, IconPlus, IconRowInsertBottom, IconTrash } from "@tabler/icons-react";
import {
  addTableColumn,
  addTableRow,
  removeTableColumn,
  removeTableRow,
  setTableCell,
  type TableNode,
  type TableSize,
} from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Choice, ChoiceField, Field, NumField, NumInput, PaintField, Row, Section, SwitchField } from "./controls";
import { FontPicker } from "./NodeProps";
import { useEditor } from "./store";

type SetFn = (patch: Record<string, unknown>, key?: string) => void;

type Kind = TableSize["kind"];

function TrackSize({ size, onChange, label }: { size: TableSize; onChange: (s: TableSize) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <Choice<Kind>
        className="w-20"
        ariaLabel={`${label} sizing`}
        value={size.kind}
        onChange={(k) => onChange(k === "fixed" ? { kind: "fixed", mm: size.kind === "fixed" ? size.mm : 5 } : k === "fill" ? { kind: "fill" } : { kind: "hug" })}
        options={[
          { value: "hug", label: "Fit" },
          { value: "fill", label: "Fill" },
          { value: "fixed", label: "Fixed" },
        ]}
      />
      {size.kind === "fixed" && <NumInput className="w-16" unit="mm" min={0.5} step={0.5} value={size.mm} onChange={(v) => v && onChange({ kind: "fixed", mm: v })} ariaLabel={`${label} width`} />}
      {size.kind === "fill" && <NumInput className="w-14" min={0.1} step={0.5} value={size.weight ?? 1} onChange={(v) => onChange({ kind: "fill", weight: v && v !== 1 ? v : undefined })} ariaLabel={`${label} share`} />}
    </div>
  );
}

export function TableSection({ node, set }: { node: TableNode; set: SetFn }) {
  const id = node.id;
  const t = useEditor((s) => s.template)!;
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const grid = useRef<HTMLDivElement>(null);
  // Patch only the structure (so variants / overrides don't copy the whole node).
  const setT = (n: TableNode, key?: string) => set({ cols: n.cols, rows: n.rows, cells: n.cells, ...(n.colAlign ? { colAlign: n.colAlign } : {}) }, key);
  const cell = (r: number, c: number) => grid.current?.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`);

  // Double-click on the canvas (optionally on a cell) focuses that cell.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const at = (e as CustomEvent<{ r: number; c: number } | null>).detail ?? { r: 0, c: 0 };
      requestAnimationFrame(() => cell(at.r, at.c)?.focus());
    };
    window.addEventListener("editor:focus-content", onFocus);
    return () => window.removeEventListener("editor:focus-content", onFocus);
  }, []);

  const insertField = (key: string) => {
    const cur = node.cells[focus.r]?.[focus.c] ?? "";
    setT(setTableCell(node, focus.r, focus.c, `${cur}{{${key}}}`), `cell:${id}:${focus.r}:${focus.c}`);
    requestAnimationFrame(() => cell(focus.r, focus.c)?.focus());
  };

  /** Arrow up/down and Enter move between cells (like a spreadsheet). */
  const onKey = (e: React.KeyboardEvent, r: number, c: number) => {
    const go = (rr: number, cc: number) => {
      const el = cell(rr, cc);
      if (!el) return;
      e.preventDefault();
      el.focus();
    };
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) go(r + 1, c);
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) go(r - 1, c);
  };

  return (
    <>
      <Section
        title="Table"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground">
                <IconPlus /> Field
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Insert into row {focus.r + 1}, column {focus.c + 1}</DropdownMenuLabel>
              {t.fields.map((f) => (
                <DropdownMenuItem key={f.key} onSelect={() => insertField(f.key)}>
                  {f.label} <span className="ml-auto font-mono text-[10px] text-muted-foreground">{`{{${f.key}}}`}</span>
                </DropdownMenuItem>
              ))}
              {!t.fields.length && <DropdownMenuItem disabled>No fields yet</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <p className="text-[11px] text-muted-foreground">Cells take text, {"{{fields}}"} and icons ({"{{icon:mdi:nut}}"}). Enter / arrows move between cells.</p>
        <div ref={grid} className="overflow-x-auto" role="grid" aria-label="Table cells">
          <table className="border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th />
                {node.cols.map((_, c) => (
                  <th key={c} className="px-0.5 text-[10px] font-normal text-muted-foreground">
                    <div className="flex items-center justify-center gap-0.5">
                      {c + 1}
                      <button
                        className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                        disabled={node.cols.length <= 1}
                        onClick={() => setT(removeTableColumn(node, c))}
                        aria-label={`Delete column ${c + 1}`}
                        title="Delete column"
                      >
                        <IconTrash className="size-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((_, r) => (
                <tr key={r}>
                  <th className="pr-0.5 text-[10px] font-normal text-muted-foreground">
                    <div className="flex items-center gap-0.5">
                      {r + 1}
                      <button
                        className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                        disabled={node.rows.length <= 1}
                        onClick={() => setT(removeTableRow(node, r))}
                        aria-label={`Delete row ${r + 1}`}
                        title="Delete row"
                      >
                        <IconTrash className="size-3" />
                      </button>
                    </div>
                  </th>
                  {node.cols.map((_, c) => (
                    <td key={c}>
                      <Input
                        data-cell={`${r}:${c}`}
                        className={cn("h-7 w-24 min-w-0 px-1.5 text-xs", focus.r === r && focus.c === c && "border-sky-500")}
                        value={node.cells[r]?.[c] ?? ""}
                        onFocus={() => setFocus({ r, c })}
                        onKeyDown={(e) => onKey(e, r, c)}
                        onChange={(e) => setT(setTableCell(node, r, c, e.target.value), `cell:${id}:${r}:${c}`)}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-1">
          <Button size="xs" variant="outline" onClick={() => setT(addTableRow(node, focus.r + 1))}>
            <IconRowInsertBottom /> Row below
          </Button>
          <Button size="xs" variant="outline" onClick={() => setT(addTableColumn(node, focus.c + 1))}>
            <IconColumnInsertRight /> Column right
          </Button>
        </div>
      </Section>

      <Section title="Columns & rows" defaultOpen={false}>
        <p className="text-[11px] text-muted-foreground">Fit = as wide as the content. Fill = share the rest (bigger number, bigger share). Fixed = always this size.</p>
        {node.cols.map((s, c) => (
          <Field key={`c${c}`} label={`Column ${c + 1}`}>
            <div className="flex items-center gap-1">
              <TrackSize size={s} label={`Column ${c + 1}`} onChange={(v) => set({ cols: node.cols.map((x, i) => (i === c ? v : x)) }, `col:${id}:${c}`)} />
              <Choice<"auto" | "left" | "center" | "right">
                className="w-20"
                ariaLabel={`Column ${c + 1} alignment`}
                value={node.colAlign?.[c] ?? "auto"}
                onChange={(v) => {
                  const colAlign = node.cols.map((_, i) => (i === c ? (v === "auto" ? null : v) : (node.colAlign?.[i] ?? null)));
                  set({ colAlign: colAlign.some(Boolean) ? colAlign : undefined });
                }}
                options={[
                  { value: "auto", label: "Align: table" },
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
          </Field>
        ))}
        {node.rows.map((s, r) => (
          <Field key={`r${r}`} label={`Row ${r + 1} height`}>
            <TrackSize size={s} label={`Row ${r + 1}`} onChange={(v) => set({ rows: node.rows.map((x, i) => (i === r ? v : x)) }, `row:${id}:${r}`)} />
          </Field>
        ))}
      </Section>

      <Section title="Table style">
        <FontPicker value={node.font} onChange={(font) => set({ font })} />
        <Row>
          <NumField label="Text size" hint="Preferred size; each cell shrinks to fit." unit="pt" min={1} max={200} step={0.5} value={node.sizePt} onChange={(v) => v && set({ sizePt: v }, `size:${id}`)} />
          <NumField label="Smallest size" unit="pt" min={0} allowEmpty placeholder="none" value={node.minSizePt} onChange={(v) => set({ minSizePt: v }, `minsize:${id}`)} />
        </Row>
        <Row>
          <ChoiceField
            label="Align"
            value={node.align ?? "left"}
            onChange={(align) => set({ align: align === "left" ? undefined : align })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
          <ChoiceField
            label="Header"
            value={node.header ?? "none"}
            onChange={(header) => set({ header: header === "none" ? undefined : header })}
            options={[
              { value: "none", label: "None" },
              { value: "row", label: "First row" },
              { value: "column", label: "First column" },
              { value: "both", label: "Both" },
            ]}
          />
        </Row>
        {node.header && node.header !== "none" && (
          <ChoiceField
            label="Header style"
            value={node.headerStyle ?? "bold"}
            onChange={(headerStyle) => set({ headerStyle: headerStyle === "bold" ? undefined : headerStyle })}
            options={[
              { value: "bold", label: "Bold" },
              { value: "invert", label: "White on black" },
            ]}
          />
        )}
        <Row>
          <ChoiceField
            label="Lines"
            value={node.border ?? "all"}
            onChange={(border) => set({ border: border === "all" ? undefined : border })}
            options={[
              { value: "all", label: "All" },
              { value: "outer", label: "Outside only" },
              { value: "inner", label: "Inside only" },
              { value: "rows", label: "Between rows" },
              { value: "columns", label: "Between columns" },
              { value: "none", label: "None" },
            ]}
          />
          <NumField label="Line width" unit="mm" min={0.05} step={0.05} value={node.borderMm ?? 0.2} onChange={(v) => v && set({ borderMm: v }, `border:${id}`)} />
        </Row>
        <NumField label="Cell padding" hint="Space between the lines and the text." unit="mm" min={0} step={0.1} value={node.cellPaddingMm ?? 0.3} onChange={(v) => set({ cellPaddingMm: v ?? 0 }, `pad:${id}`)} />
        <SwitchField label="Capitals" checked={!!node.uppercase} onChange={(v) => set({ uppercase: v || undefined })} />
        <PaintField label="Color" value={node.color} allowNone={false} onChange={(color) => set({ color })} />
      </Section>
    </>
  );
}
