"use client";
import { useEffect } from "react";
import { useLibrary } from "./api";
import { LabelEditor } from "./LabelEditor";
import { LabelList } from "./LabelList";
import { usePrinter } from "./printer";
import { PrintQueue } from "./PrintQueue";
import { useLabelStore } from "./store";
import { Toolbar } from "./Toolbar";

/** The label printing workspace: library, editor/preview, print queue. */
export function Workspace() {
  const { data: lib, error, isLoading } = useLibrary();
  const p = usePrinter();
  const selected = useLabelStore((s) => s.selectedLabelId);
  const select = useLabelStore((s) => s.select);
  const label = lib?.labels.find((l) => l.id === selected);

  useEffect(() => {
    const first = lib && (lib.labels.find((l) => l.tags?.includes("welcome")) ?? lib.labels[0]);
    if (!label && first) select(first.id);
  }, [lib, label, select]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!p.supported.bluetooth && (
        <p className="bg-destructive/10 px-4 py-2 text-sm">This browser can&apos;t talk to Bluetooth printers. Open this page in Chrome or Edge.</p>
      )}
      {p.error && <p className="bg-destructive/10 px-4 py-2 text-sm">{p.error}</p>}
      <Toolbar />
      {isLoading && <p className="m-auto text-muted-foreground">Loading library…</p>}
      {error && <p className="m-auto text-destructive">Could not load the library: {String(error)}</p>}
      {lib && (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_280px]">
          <LabelList lib={lib} />
          {label ? <LabelEditor lib={lib} label={label} /> : <p className="m-auto text-muted-foreground">Pick a label, or import P-touch files.</p>}
          <PrintQueue lib={lib} />
        </main>
      )}
    </div>
  );
}
