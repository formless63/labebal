"use client";
/** Small form controls for the editor's property panels. */
import { useState, type ReactNode } from "react";
import { IconChevronDown, IconInfoCircle } from "@tabler/icons-react";
import { SIZES, contentSize, labelPixels, matchesRule, printerForSize, sizePrinterName, type Anchor, type Paint, type SizeRule, type Sizing } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

export function Tip({ tip, children, side }: { tip: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Icon button with a tooltip. */
export function IconBtn({ tip, onClick, disabled, active, children, className }: { tip: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <Tip tip={tip}>
      <Button variant={active ? "secondary" : "ghost"} size="icon-sm" onClick={onClick} disabled={disabled} aria-label={typeof tip === "string" ? tip : undefined} aria-pressed={active} className={className}>
        {children}
      </Button>
    </Tip>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
        {label}
        {hint && (
          <Tip tip={hint}>
            <IconInfoCircle className="size-3 opacity-60" />
          </Tip>
        )}
      </Label>
      {children}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-1">
        <button className="flex flex-1 items-center gap-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase" onClick={() => setOpen(!open)}>
          <IconChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="mt-2 space-y-2.5">{children}</div>}
    </section>
  );
}

export const Row = ({ children, cols = 2 }: { children: ReactNode; cols?: number }) => (
  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
    {children}
  </div>
);

const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000);

/** Number input that tolerates half-typed values ("1.", "") and supports arrow-key steps. */
export function NumInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  unit,
  placeholder,
  allowEmpty,
  className,
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const shown = draft ?? (value === undefined ? "" : fmtNum(value));
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        className={cn("h-7 px-2 text-xs tabular-nums", unit && "pr-7")}
        value={shown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          const s = e.target.value;
          setDraft(s);
          const v = parseFloat(s.replace(",", "."));
          if (Number.isFinite(v)) onChange(clamp(v));
          else if (s.trim() === "" && allowEmpty) onChange(undefined);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === "ArrowUp" ? 1 : -1);
            const v = clamp(Math.round(((value ?? 0) + k) * 1000) / 1000);
            setDraft(null);
            onChange(v);
          } else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {unit && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  );
}

export function NumField(props: Parameters<typeof NumInput>[0] & { label: string; hint?: ReactNode }) {
  const { label, hint, ...rest } = props;
  return (
    <Field label={label} hint={hint}>
      <NumInput {...rest} ariaLabel={label} />
    </Field>
  );
}

export function Choice<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className={cn("h-7 w-full text-xs", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ChoiceField<T extends string>(props: Parameters<typeof Choice<T>>[0] & { label: string; hint?: ReactNode }) {
  const { label, hint, ...rest } = props;
  return (
    <Field label={label} hint={hint}>
      <Choice {...rest} ariaLabel={label} />
    </Field>
  );
}

export function SwitchField({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {hint && (
          <Tip tip={hint}>
            <IconInfoCircle className="size-3 opacity-60" />
          </Tip>
        )}
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/* ---------------------------------------------------------------- paint */

export const PAINTS: { value: Paint; label: string }[] = [
  { value: "black", label: "Print (black)" },
  { value: "white", label: "Knock out (white)" },
  { value: "invert", label: "Invert what's below" },
  { value: "none", label: "None" },
];

export function PaintField({ label, value, onChange, hint, allowNone = true }: { label: string; value: Paint | undefined; onChange: (p: Paint) => void; hint?: ReactNode; allowNone?: boolean }) {
  return (
    <Field label={label} hint={hint ?? "Print = dots. Knock out = clears dots under it (white on black). Invert = flips whatever is underneath."}>
      <Select value={value ?? "none"} onValueChange={(v) => onChange(v as Paint)}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAINTS.filter((p) => allowNone || p.value !== "none").map((p) => (
            <SelectItem key={p.value} value={p.value} className="text-xs">
              <PaintSwatch paint={p.value} /> {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PaintSwatch({ paint }: { paint: Paint }) {
  return (
    <span
      className={cn(
        "inline-block size-3 rounded-[3px] border border-foreground/40",
        paint === "black" && "bg-black",
        paint === "white" && "bg-white",
        paint === "invert" && "bg-[linear-gradient(135deg,#000_50%,#fff_50%)]",
        paint === "none" && "bg-[repeating-linear-gradient(45deg,transparent_0_2px,rgb(127_127_127/.5)_2px_3px)]",
      )}
    />
  );
}

/* --------------------------------------------------------------- sizing */

const SIZING_KINDS: { value: Sizing["kind"]; label: string }[] = [
  { value: "hug", label: "Fit content" },
  { value: "fixed", label: "Fixed" },
  { value: "fill", label: "Fill space" },
  { value: "pct", label: "% of parent" },
];

export function SizingField({
  label,
  sizing,
  natural,
  onChange,
  min,
  max,
  onLimits,
}: {
  label: string;
  sizing: Sizing;
  /** Current size on the canvas, used when switching to fixed. */
  natural?: number;
  onChange: (s: Sizing) => void;
  min?: number;
  max?: number;
  onLimits: (min: number | undefined, max: number | undefined) => void;
}) {
  const [limits, setLimits] = useState(min !== undefined || max !== undefined);
  const change = (kind: Sizing["kind"]) => {
    if (kind === sizing.kind) return;
    if (kind === "fixed") onChange({ kind, mm: Math.round((natural ?? 5) * 100) / 100 });
    else if (kind === "pct") onChange({ kind, pct: 100 });
    else if (kind === "fill") onChange({ kind });
    else onChange({ kind: "hug" });
  };
  return (
    <Field
      label={label}
      hint="Fit content: as big as what's inside. Fixed: exact size. Fill space: takes the room that's left (weight shares it between several). % of parent: a share of the group it's in."
    >
      <div className="flex gap-1.5">
        <Choice value={sizing.kind} onChange={change} options={SIZING_KINDS} className="flex-1" ariaLabel={`${label} sizing`} />
        {sizing.kind === "fixed" && <NumInput className="w-20" value={sizing.mm} min={0} unit="mm" onChange={(v) => v !== undefined && onChange({ kind: "fixed", mm: v })} ariaLabel={`${label} mm`} />}
        {sizing.kind === "pct" && <NumInput className="w-20" value={sizing.pct} min={0} max={100} step={1} unit="%" onChange={(v) => v !== undefined && onChange({ kind: "pct", pct: v })} ariaLabel={`${label} percent`} />}
        {sizing.kind === "fill" && (
          <Tip tip="Weight: with several 'fill' items, a weight of 2 gets twice the space of 1.">
            <div>
              <NumInput className="w-16" value={sizing.weight ?? 1} min={0.1} step={0.5} unit="×" onChange={(v) => onChange({ kind: "fill", weight: v === 1 ? undefined : v })} ariaLabel={`${label} weight`} />
            </div>
          </Tip>
        )}
      </div>
      {limits ? (
        <div className="flex items-center gap-1.5 pt-1">
          <NumInput className="flex-1" value={min} allowEmpty placeholder="min" unit="mm" onChange={(v) => onLimits(v, max)} ariaLabel={`${label} minimum`} />
          <NumInput className="flex-1" value={max} allowEmpty placeholder="max" unit="mm" onChange={(v) => onLimits(min, v)} ariaLabel={`${label} maximum`} />
        </div>
      ) : (
        <button className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setLimits(true)}>
          + min / max
        </button>
      )}
    </Field>
  );
}

/* -------------------------------------------------------------- anchors */

const H_ANCHORS: { value: Anchor; label: string }[] = [
  { value: "start", label: "Left" },
  { value: "end", label: "Right" },
  { value: "stretch", label: "Left & right" },
  { value: "center", label: "Center" },
  { value: "scale", label: "Scale" },
];
const V_ANCHORS: { value: Anchor; label: string }[] = [
  { value: "start", label: "Top" },
  { value: "end", label: "Bottom" },
  { value: "stretch", label: "Top & bottom" },
  { value: "center", label: "Center" },
  { value: "scale", label: "Scale" },
];

/**
 * Figma-style constraint widget: click the edges the element should stay
 * pinned to when the label is bigger or smaller than the design.
 */
export function AnchorWidget({ ax = "start", ay = "start", onChange }: { ax?: Anchor; ay?: Anchor; onChange: (ax: Anchor, ay: Anchor) => void }) {
  const on = (a: Anchor, side: "start" | "end") => a === side || a === "stretch";
  const toggle = (a: Anchor, side: "start" | "end"): Anchor => {
    const s = on(a, "start"), e = on(a, "end");
    const [ns, ne] = side === "start" ? [!s, e] : [s, !e];
    return ns && ne ? "stretch" : ns ? "start" : ne ? "end" : "center";
  };
  const bar = (active: boolean) => cn("absolute rounded-full transition-colors", active ? "bg-sky-500" : "bg-muted-foreground/30 hover:bg-muted-foreground/60");
  return (
    <Field label="Pin to edges" hint="When the label is a different size from the design, pinned edges keep their distance. Pin both sides to stretch; none to stay centered; Scale moves and sizes proportionally.">
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0 rounded-md border bg-background">
          <div className="absolute inset-4 rounded-[2px] border border-dashed border-muted-foreground/50" />
          <button aria-label="Pin to top" className={cn(bar(on(ay, "start")), "top-1 left-1/2 h-2.5 w-1 -translate-x-1/2")} onClick={() => onChange(ax, toggle(ay, "start"))} />
          <button aria-label="Pin to bottom" className={cn(bar(on(ay, "end")), "bottom-1 left-1/2 h-2.5 w-1 -translate-x-1/2")} onClick={() => onChange(ax, toggle(ay, "end"))} />
          <button aria-label="Pin to left" className={cn(bar(on(ax, "start")), "top-1/2 left-1 h-1 w-2.5 -translate-y-1/2")} onClick={() => onChange(toggle(ax, "start"), ay)} />
          <button aria-label="Pin to right" className={cn(bar(on(ax, "end")), "top-1/2 right-1 h-1 w-2.5 -translate-y-1/2")} onClick={() => onChange(toggle(ax, "end"), ay)} />
          <button aria-label="Center horizontally" className={cn(bar(ax === "center"), "top-1/2 left-1/2 h-1 w-4 -translate-1/2")} onClick={() => onChange(ax === "center" ? "start" : "center", ay)} />
          <button aria-label="Center vertically" className={cn(bar(ay === "center"), "top-1/2 left-1/2 h-4 w-1 -translate-1/2")} onClick={() => onChange(ax, ay === "center" ? "start" : "center")} />
        </div>
        <div className="grid flex-1 gap-1.5">
          <Choice value={ax} onChange={(v) => onChange(v, ay)} options={H_ANCHORS} ariaLabel="Horizontal pin" />
          <Choice value={ay} onChange={(v) => onChange(ax, v)} options={V_ANCHORS} ariaLabel="Vertical pin" />
        </div>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------ size rules */

/** Content area of each stock label size (what size rules are checked against). */
export function stockAreas(marginMm: number) {
  return SIZES.map((s) => {
    const px = labelPixels(s, printerForSize(s));
    return { size: s, ...contentSize({ ...px, marginMm }) };
  });
}

export function ruleSummary(r: SizeRule) {
  const parts: string[] = [];
  if (r.minW !== undefined) parts.push(`width ≥ ${r.minW}`);
  if (r.maxW !== undefined) parts.push(`width ≤ ${r.maxW}`);
  if (r.minH !== undefined) parts.push(`height ≥ ${r.minH}`);
  if (r.maxH !== undefined) parts.push(`height ≤ ${r.maxH}`);
  if (r.minAspect !== undefined) parts.push(`w/h ≥ ${r.minAspect}`);
  if (r.maxAspect !== undefined) parts.push(`w/h ≤ ${r.maxAspect}`);
  return parts.length ? `${parts.join(", ")} mm` : "all sizes";
}

/** Edit a size rule (min/max width, height, aspect) and show which stock sizes match. */
export function SizeRuleEditor({ rule, onChange, marginMm }: { rule: SizeRule; onChange: (r: SizeRule) => void; marginMm: number }) {
  const set = (k: keyof SizeRule, v: number | undefined) => {
    const next = { ...rule };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const areas = stockAreas(marginMm);
  return (
    <div className="space-y-2">
      <Row>
        <NumField label="Min width" unit="mm" allowEmpty value={rule.minW} onChange={(v) => set("minW", v)} />
        <NumField label="Max width" unit="mm" allowEmpty value={rule.maxW} onChange={(v) => set("maxW", v)} />
        <NumField label="Min height" unit="mm" allowEmpty value={rule.minH} onChange={(v) => set("minH", v)} />
        <NumField label="Max height" unit="mm" allowEmpty value={rule.maxH} onChange={(v) => set("maxH", v)} />
        <NumField label="Min width ÷ height" hint="Shape: 2 means at least twice as wide as tall." allowEmpty value={rule.minAspect} onChange={(v) => set("minAspect", v)} />
        <NumField label="Max width ÷ height" allowEmpty value={rule.maxAspect} onChange={(v) => set("maxAspect", v)} />
      </Row>
      <div className="flex flex-wrap gap-1">
        {areas.map((a) => {
          const hit = matchesRule(rule, a.width, a.height);
          return (
            <Tip key={a.size.id} tip={`Printable area ${a.width.toFixed(1)} × ${a.height.toFixed(1)} mm`}>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", hit ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-muted text-muted-foreground line-through")}>
                {sizePrinterName(a.size)} {a.size.name}
              </span>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}
