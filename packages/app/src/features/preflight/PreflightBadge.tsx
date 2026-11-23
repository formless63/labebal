"use client";
/** Preflight UI for the print workspace: a badge (queue rows) and a list (label editor). */
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";
import { preflightSummary, type Label, type PreflightIssue, type PreflightSeverity, type Template } from "@labebal/core";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import { useLabelPreflight } from "./use-preflight";

export const SEVERITY: Record<PreflightSeverity, { icon: typeof IconAlertTriangle; className: string; word: [string, string] }> = {
  error: { icon: IconCircleX, className: "text-red-600 dark:text-red-400", word: ["problem", "problems"] },
  warning: { icon: IconAlertTriangle, className: "text-amber-600 dark:text-amber-400", word: ["warning", "warnings"] },
  info: { icon: IconInfoCircle, className: "text-sky-600 dark:text-sky-400", word: ["note", "notes"] },
};

/** "1 problem, 2 warnings" */
export function summaryText(issues: PreflightIssue[]) {
  const { counts } = preflightSummary(issues);
  return (["error", "warning", "info"] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${SEVERITY[s].word[counts[s] > 1 ? 1 : 0]}`)
    .join(", ");
}

export function SeverityIcon({ severity, className }: { severity: PreflightSeverity; className?: string }) {
  const S = SEVERITY[severity];
  return <S.icon className={cn("size-3.5 shrink-0", S.className, className)} aria-label={severity} />;
}

/** One issue: what is wrong, then what to do. */
export function IssueLine({ issue, onSelect, showNode = true }: { issue: PreflightIssue; onSelect?: (nodeId: string) => void; showNode?: boolean }) {
  const body = (
    <>
      <SeverityIcon severity={issue.severity} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        {showNode && issue.nodeName && <span className="font-medium">{issue.nodeName}: </span>}
        {issue.message}
        {issue.fix && <span className="text-muted-foreground"> {issue.fix}</span>}
      </span>
    </>
  );
  return onSelect && issue.nodeId ? (
    <button type="button" className="flex w-full gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted" onClick={() => onSelect(issue.nodeId!)}>
      {body}
    </button>
  ) : (
    <div className="flex gap-1.5 px-1 py-0.5 text-xs">{body}</div>
  );
}

export function IssueList({ issues, onSelect, className }: { issues: PreflightIssue[]; onSelect?: (nodeId: string) => void; className?: string }) {
  return (
    <ul className={cn("space-y-0.5", className)}>
      {issues.map((i, k) => (
        <li key={`${i.rule}-${i.nodeId ?? ""}-${k}`}>
          <IssueLine issue={i} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

/** Small icon badge for a list of issues (nothing when there are none); click for the details. */
export function IssuesBadge({ issues, className }: { issues: PreflightIssue[]; className?: string }) {
  const { worst } = preflightSummary(issues);
  if (!worst) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex items-center gap-0.5 rounded px-1 text-[11px] hover:bg-muted", SEVERITY[worst].className, className)} title={summaryText(issues)}>
          <SeverityIcon severity={worst} />
          {issues.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="mb-1 px-1 text-xs font-medium">Before you print: {summaryText(issues)}</p>
        <IssueList issues={issues} />
      </PopoverContent>
    </Popover>
  );
}

/** Preflight badge for a library label at the current print settings (print queue rows). */
export function PreflightBadge({ template, label, className }: { template: Template | undefined; label: Label | undefined; className?: string }) {
  const issues = useLabelPreflight(template, label);
  return issues ? <IssuesBadge issues={issues} className={className} /> : null;
}

/** Preflight list for a library label at the current print settings (label editor). */
export function PreflightList({ template, label, className }: { template: Template | undefined; label: Label | undefined; className?: string }) {
  const issues = useLabelPreflight(template, label);
  if (!issues) return null;
  if (!issues.length)
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <IconCircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Preflight: no print problems found at this size.
      </p>
    );
  return (
    <div className={cn("rounded-lg border bg-card p-2", className)}>
      <p className="mb-1 px-1 text-xs font-medium">Before you print: {summaryText(issues)}</p>
      <IssueList issues={issues} />
    </div>
  );
}
