"use client";
/**
 * User tags: free words people attach to labels, templates, stock and sizes
 * to find them again ("freezer", "outdoor", "garage"). Internal tags
 * (folder:, dataset:, pack...) are hidden from people; see `userTags`.
 */
import { cn } from "../../lib/utils";

/** Tags that are bookkeeping, not words a person typed. */
const INTERNAL = /^(folder|dataset|pack|reprint|source|run|seed):/;

export const userTags = (tags: readonly string[] | undefined) => (tags ?? []).filter((t) => !INTERNAL.test(t));

/** "Freezer, outdoor ,, garage" -> ["freezer", "outdoor", "garage"] (lower case, unique, max 20). */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (t && !INTERNAL.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

export function TagChips({ tags, className, onPick }: { tags: readonly string[] | undefined; className?: string; onPick?: (tag: string) => void }) {
  const list = userTags(tags);
  if (!list.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {list.map((t) =>
        onPick ? (
          <button key={t} type="button" className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => onPick(t)} title={`Show only "${t}"`}>
            {t}
          </button>
        ) : (
          <span key={t} className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
            {t}
          </span>
        ),
      )}
    </span>
  );
}
