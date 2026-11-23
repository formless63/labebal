"use client";
/** Small form helpers shared by the data, runs and history pages. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../lib/utils";

/** Radix Select can't hold "" as a value; this stands in for "nothing chosen". */
export const NONE = "__none";

export interface Option {
  value: string;
  label: string;
}

export function Pick({
  value,
  onChange,
  options,
  placeholder,
  none,
  className,
  size = "sm",
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Option[];
  placeholder?: string;
  /** Label of an extra "nothing" option (value undefined). */
  none?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  return (
    // "" shows the placeholder; NONE selects the explicit "nothing" option.
    <Select value={value ?? (none !== undefined ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger size={size} className={cn("min-w-32", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {none !== undefined && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">{none}</span>
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}
