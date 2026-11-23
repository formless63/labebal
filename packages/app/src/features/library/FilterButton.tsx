"use client";
/**
 * "Filter" buttons for the label list and the templates page: tags (with how
 * many items carry each), and what the items are. Active filters show as a
 * count on the button and as removable chips (`ActiveFilters`).
 */
import { useState, type ReactNode } from "react";
import { IconFilter, IconX } from "@tabler/icons-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import { SIZE_BUCKETS, activeCount, toggle, type LabelFilter, type Source, type TemplateFilter } from "./filter";

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Tag chips with counts; a search box once there are many. */
function TagPicker({ all, chosen, onToggle }: { all: { tag: string; count: number }[]; chosen: string[]; onToggle: (t: string) => void }) {
  const [q, setQ] = useState("");
  if (!all.length) return <p className="text-xs text-muted-foreground">No tags yet. Add them on a label or a template.</p>;
  const shown = all.filter((t) => chosen.includes(t.tag) || !q || t.tag.includes(q.trim().toLowerCase())).slice(0, 60);
  return (
    <div className="space-y-1.5">
      {all.length > 12 && <Input className="h-7" placeholder="Find a tag" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {shown.map(({ tag, count }) => (
          <Chip key={tag} on={chosen.includes(tag)} onClick={() => onToggle(tag)}>
            {tag} <span className="opacity-70">{count}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}

function FilterShell({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={count ? "secondary" : "ghost"} className="h-7" aria-label="Filter">
          <IconFilter /> Filter{count ? ` (${count})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        {children}
        {count > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const LABEL_SOURCES: { id: Source; name: string }[] = [
  { id: "own", name: "Made here" },
  { id: "data", name: "From data" },
  { id: "pack", name: "From a pack" },
];

export function LabelFilterButton({ value, onChange, tags, templates }: { value: LabelFilter; onChange: (f: LabelFilter) => void; tags: { tag: string; count: number }[]; templates: { id: string; name: string; count: number }[] }) {
  return (
    <FilterShell count={activeCount(value)} onClear={() => onChange({ tags: [], templates: [], sources: [], invert: "any" })}>
      <Group title="Tags (all of)">
        <TagPicker all={tags} chosen={value.tags} onToggle={(t) => onChange({ ...value, tags: toggle(value.tags, t) })} />
      </Group>
      <Group title="Template">
        {templates.map((t) => (
          <Chip key={t.id} on={value.templates.includes(t.id)} onClick={() => onChange({ ...value, templates: toggle(value.templates, t.id) })}>
            {t.name} <span className="opacity-70">{t.count}</span>
          </Chip>
        ))}
      </Group>
      <Group title="Where it came from">
        {LABEL_SOURCES.map((s) => (
          <Chip key={s.id} on={value.sources.includes(s.id)} onClick={() => onChange({ ...value, sources: toggle(value.sources, s.id) })}>
            {s.name}
          </Chip>
        ))}
      </Group>
      <Group title="Colours">
        <Chip on={value.invert === "no"} onClick={() => onChange({ ...value, invert: value.invert === "no" ? "any" : "no" })}>
          Dark on light
        </Chip>
        <Chip on={value.invert === "yes"} onClick={() => onChange({ ...value, invert: value.invert === "yes" ? "any" : "yes" })}>
          Inverted
        </Chip>
      </Group>
    </FilterShell>
  );
}

export function TemplateFilterButton({ value, onChange, tags }: { value: TemplateFilter; onChange: (f: TemplateFilter) => void; tags: { tag: string; count: number }[] }) {
  return (
    <FilterShell count={activeCount(value)} onClear={() => onChange({ tags: [], sizes: [], sources: [], usage: "any" })}>
      <Group title="Tags (all of)">
        <TagPicker all={tags} chosen={value.tags} onToggle={(t) => onChange({ ...value, tags: toggle(value.tags, t) })} />
      </Group>
      <Group title="Size it was designed at">
        {SIZE_BUCKETS.map((b) => (
          <Chip key={b.id} title={b.hint} on={value.sizes.includes(b.id)} onClick={() => onChange({ ...value, sizes: toggle(value.sizes, b.id) })}>
            {b.name}
          </Chip>
        ))}
      </Group>
      <Group title="Where it came from">
        <Chip on={value.sources.includes("own")} onClick={() => onChange({ ...value, sources: toggle(value.sources, "own") })}>
          Made here
        </Chip>
        <Chip on={value.sources.includes("pack")} onClick={() => onChange({ ...value, sources: toggle(value.sources, "pack") })}>
          From a pack
        </Chip>
      </Group>
      <Group title="Labels">
        <Chip on={value.usage === "used"} onClick={() => onChange({ ...value, usage: value.usage === "used" ? "any" : "used" })}>
          Has labels
        </Chip>
        <Chip on={value.usage === "unused"} onClick={() => onChange({ ...value, usage: value.usage === "unused" ? "any" : "unused" })}>
          No labels yet
        </Chip>
      </Group>
    </FilterShell>
  );
}

/** Removable chips for the active tag filters (the most common kind), under the search box. */
export function ActiveTagChips({ tags, onRemove }: { tags: string[]; onRemove: (t: string) => void }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="text-muted-foreground hover:text-foreground" onClick={() => onRemove(t)}>
            <IconX className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
