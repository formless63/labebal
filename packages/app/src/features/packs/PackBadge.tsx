"use client";
import { IconPackage } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { packOf } from "./api";
import type { LibraryWithPacks } from "./types";

/** Small "from pack X" marker for templates / labels (amber dot = changed here). */
export function PackBadge({ lib, kind, id, compact, className }: { lib: LibraryWithPacks | undefined; kind: "template" | "label"; id: string; compact?: boolean; className?: string }) {
  const p = packOf(lib, kind, id);
  if (!p) return null;
  const title = `From the ${p.name} pack${p.version ? ` (${p.version})` : ""}${p.changed ? ": changed here (updates keep your version; reset in its menu)" : ""}`;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[10px] leading-4 text-muted-foreground", className)} title={title} aria-label={title}>
      <IconPackage className="size-3" />
      {!compact && <span className="max-w-24 truncate">{p.name}</span>}
      {p.changed && <span className="size-1.5 rounded-full bg-amber-500" />}
    </span>
  );
}
