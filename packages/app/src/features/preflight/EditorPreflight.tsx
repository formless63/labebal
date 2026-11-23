"use client";
/**
 * Template editor preflight: a collapsible bar under the canvas listing what
 * would print badly at the size shown (click an issue to select its element),
 * plus per-layer badges (`LayerIssueBadge`).
 */
import { useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconCircleCheck } from "@tabler/icons-react";
import { issuesByNode, preflightSummary, type Label, type LabelSize, type PrinterProfile, type Template } from "@labebal/core";
import { useEditor } from "../editor/store";
import { cn } from "../../lib/utils";
import { IssueList, SEVERITY, SeverityIcon, summaryText } from "./PreflightBadge";
import { useEditorPreflight, usePreflight } from "./use-preflight";

export interface EditorPreflightProps {
  template: Template;
  label?: Pick<Label, "values" | "overrides">;
  invert: boolean;
  size: LabelSize;
  printer: PrinterProfile;
  marginMm: number;
  /** Render size in dots for the editor's design-size view (not a real roll). */
  pixels?: { w: number; h: number; dpmm: number };
}

export function EditorPreflight(p: EditorPreflightProps) {
  const issues = usePreflight({ ...p }, 200);
  const [open, setOpen] = useState(false);
  const publish = useEditorPreflight((s) => s.set);
  useEffect(() => {
    if (issues) publish(issues);
  }, [issues, publish]);
  useEffect(() => () => publish([]), [publish]);

  if (!issues) return null;
  const { worst } = preflightSummary(issues);
  return (
    <div className="border-t bg-card text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-muted/60 disabled:hover:bg-transparent"
        onClick={() => setOpen(!open)}
        disabled={!worst}
        aria-expanded={open}
      >
        {worst ? <SeverityIcon severity={worst} /> : <IconCircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
        <span className={cn("font-medium", worst && SEVERITY[worst].className)}>Preflight</span>
        <span className="text-muted-foreground">
          {worst ? `${summaryText(issues)} at ${p.size.name}` : `No print problems at ${p.size.name}${p.label ? "" : " (with the field defaults)"}.`}
        </span>
        {worst && <IconChevronDown className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && worst && <IssueList issues={issues} onSelect={(id) => useEditor.getState().select([id])} className="max-h-40 overflow-y-auto px-2 pb-2" />}
    </div>
  );
}

/** Worst-issue icon for a layer row (nothing when the element is fine). */
export function LayerIssueBadge({ nodeId }: { nodeId: string }) {
  const all = useEditorPreflight((s) => s.issues);
  const mine = useMemo(() => issuesByNode(all).get(nodeId), [all, nodeId]);
  if (!mine?.length) return null;
  const { worst } = preflightSummary(mine);
  return (
    <span title={mine.map((i) => `${i.message} ${i.fix ?? ""}`.trim()).join("\n")} className="flex shrink-0">
      <SeverityIcon severity={worst!} />
    </span>
  );
}
