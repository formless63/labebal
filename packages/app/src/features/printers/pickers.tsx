"use client";
/** Label type and print task pickers (Settings > Printers and saved printer profiles). */
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { MEDIA_KINDS, PRINT_TASK_NAMES, type MediaKind, type PrintTaskName } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Hint } from "./ui";

const AUTO = "auto";

export function MediaKindPicker({ label, value, onChange, autoText }: { label: string; value: MediaKind | undefined; onChange: (v: MediaKind | undefined) => void; autoText: string }) {
  return (
    <div className="space-y-1.5">
      <UiLabel className="text-xs text-muted-foreground">
        {label}
        <Hint>
          How the printer finds where each label starts. Usually automatic: clear stock prints as &quot;transparent&quot;, and rolls with a tag tell the
          printer themselves. Change it only if labels drift, skip, or the printer feeds blank labels.
        </Hint>
      </UiLabel>
      <Select value={value ?? AUTO} onValueChange={(v) => onChange(v === AUTO ? undefined : (v as MediaKind))}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{autoText}</SelectItem>
          {MEDIA_KINDS.map((k) => (
            <SelectItem key={k.id} value={k.id} title={k.hint}>
              {k.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Print task version: pick one to try (test pattern), then lock it as the
 * default for this model. Unlocked = niimbluelib picks it from the model.
 */
export function PrintTaskPicker({
  model,
  detected,
  locked,
  trying,
  onTry,
  onLock,
}: {
  model: string;
  /** What niimbluelib chose for the connected printer. */
  detected?: PrintTaskName;
  locked?: PrintTaskName;
  trying?: PrintTaskName;
  onTry: (v: PrintTaskName | undefined) => void;
  onLock: (v: PrintTaskName | undefined) => void;
}) {
  const shown = trying ?? locked;
  const short = model === "M2_H" ? "M2" : model;
  return (
    <div className="space-y-1.5">
      <UiLabel className="text-xs text-muted-foreground">
        Print protocol ({short})
        <Hint>
          Niimbot printers speak slightly different print &quot;protocols&quot; depending on model and firmware. labebal picks one automatically. If prints come
          out blank, cut short or the printer stops, try another one with the test pattern, then lock the one that works.
        </Hint>
      </UiLabel>
      <div className="flex items-center gap-2">
        <Select value={shown ?? AUTO} onValueChange={(v) => onTry(v === AUTO ? undefined : (v as PrintTaskName))}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>Automatic{detected ? ` (${detected})` : ""}</SelectItem>
            {PRINT_TASK_NAMES.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
                {n === detected ? " (detected)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {locked && !trying ? (
          <Button size="sm" variant="outline" onClick={() => onLock(undefined)} title="Go back to automatic">
            <IconLockOpen /> Unlock
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!trying} onClick={() => onLock(trying)} title={`Always print on the ${short} with this protocol`}>
            <IconLock /> Lock as default
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {locked ? `Locked: every ${short} print uses ${locked}.` : "Automatic."}
        {trying && trying !== locked ? ` Trying ${trying} for the test pattern below.` : ""}
      </p>
    </div>
  );
}
