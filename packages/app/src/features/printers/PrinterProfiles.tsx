"use client";
/**
 * Saved printer profiles: one per physical printer (by serial number), shared
 * with the team (features/settings/sync.tsx). Name, the label loaded in a second printer, and optional
 * overrides of the model settings (label type, print protocol). The print
 * position is saved on the server against the serial (see calibrations.ts).
 */
import { useEffect } from "react";
import { IconTrash } from "@tabler/icons-react";
import { PRINT_TASK_NAMES, sizesFor, type PrintTaskName, type PrinterSnapshot } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { offsetFor, type Offset } from "../labels/calibration";
import { useLabelStore } from "../labels/store";
import { swatchOptions, useSwatches } from "../labels/swatches";
import { describeOffset, forgetSharedCalibration, modelHint, saveSharedCalibration, serialOfKey, useOwnOffset } from "./calibrations";
import { MediaKindPicker } from "./pickers";
import { usePrinterStore } from "./store";
import { printerKey, shortModel } from "./targets";
import { Hint } from "./ui";

const SAME = "same";

function Pick({ label, value, onChange, options, hint, className = "w-48" }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string; className?: string }) {
  return (
    <div className="space-y-1.5">
      <UiLabel className="text-xs text-muted-foreground">
        {label}
        {hint && <Hint>{hint}</Hint>}
      </UiLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** This printer's own settings (shown under its info in Settings). */
export function PrinterProfileEditor({ snapshot, primary }: { snapshot: PrinterSnapshot; primary: boolean }) {
  const key = printerKey(snapshot);
  const profile = usePrinterStore((s) => (key ? s.profiles[key] : undefined));
  const models = usePrinterStore((s) => s.models);
  const saveProfile = usePrinterStore((s) => s.saveProfile);
  const settings = useLabelStore((s) => s.settings);
  const { materials } = useSwatches();
  const model = snapshot.model ?? "";

  // Remember every printer that connects, so it shows up in the saved list.
  useEffect(() => {
    if (key && model) saveProfile(key, { model, lastSeen: Date.now() });
  }, [key, model, saveProfile]);

  if (!model) return null;
  if (!key) return <p className="text-xs text-muted-foreground">This printer did not report a serial number or name, so it can&apos;t have its own saved settings. It uses the settings for its model.</p>;
  const save = (patch: Parameters<typeof saveProfile>[1]) => saveProfile(key, { model, ...patch });
  const sizes = sizesFor(model);
  const modelOffset = offsetFor(settings, model);
  const modelTask = models[model]?.printTask;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="text-sm font-medium">This printer&apos;s settings</h4>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Name</UiLabel>
          <Input className="w-48" placeholder={shortModel(model)} value={profile?.name ?? ""} onChange={(e) => save({ name: e.target.value })} />
        </div>
        {!primary && (
          <>
            <Pick
              label="Label size loaded"
              hint="The first printer uses the size chosen in the print toolbar. Other printers use the size set here (or the one their roll's tag reports)."
              value={profile?.sizeId && sizes.some((z) => z.id === profile.sizeId) ? profile.sizeId : SAME}
              onChange={(v) => save({ sizeId: v === SAME ? undefined : v })}
              options={[{ value: SAME, label: "From the roll's tag" }, ...sizes.map((z) => ({ value: z.id, label: z.name }))]}
            />
            <Pick
              label="Stock"
              value={profile?.material ?? SAME}
              onChange={(v) => save({ material: v === SAME ? undefined : v })}
              options={[{ value: SAME, label: "From the roll / toolbar" }, ...swatchOptions(materials)]}
            />
          </>
        )}
        <MediaKindPicker label="Label type" value={profile?.mediaKind} onChange={(v) => save({ mediaKind: v })} autoText={`Same as all ${shortModel(model)} printers`} />
        <Pick
          label="Print protocol"
          hint="Only change this if this one printer needs a different protocol than other printers of its model (e.g. older firmware). Try protocols with the test pattern under Printers below."
          value={profile?.printTask ?? SAME}
          onChange={(v) => save({ printTask: v === SAME ? undefined : (v as PrintTaskName) })}
          options={[{ value: SAME, label: `Same as all ${shortModel(model)} (${modelTask ?? "automatic"})` }, ...PRINT_TASK_NAMES.map((n) => ({ value: n, label: n }))]}
          className="w-56"
        />
      </div>
      <OwnPosition printerKey={key} model={model} name={profile?.name} modelOffset={modelOffset} />
    </div>
  );
}

/**
 * This printer's own print position, saved against its serial number on the
 * server (so every browser uses it), plus the model's typical offset as a
 * suggestion for a printer that has none yet.
 */
function OwnPosition({ printerKey: key, model, name, modelOffset }: { printerKey: string; model: string; name?: string; modelOffset: Offset }) {
  const own = useOwnOffset(key);
  const dismissed = usePrinterStore((s) => s.hintDismissed.includes(key));
  const saveProfile = usePrinterStore((s) => s.saveProfile);
  const hint = modelHint(model);
  const serial = serialOfKey(key);
  const set = (offset: Offset, source: "calibrated" | "suggested" = "calibrated") => saveSharedCalibration(key, { model, name, offset, source });
  const off = () => {
    saveProfile(key, { offset: undefined });
    void forgetSharedCalibration(key);
  };
  const short = shortModel(model);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Switch id={`own-offset-${key}`} checked={!!own} onCheckedChange={(on) => (on ? set({ ...(hint?.offset ?? modelOffset) }) : off())} />
        <UiLabel htmlFor={`own-offset-${key}`} className="text-sm font-normal">
          Own print position
          <Hint>
            Each printer can print slightly off-center. Without its own position a printer uses the offset shared by all {short} printers (under Printers below). {serial ? `Saved against serial ${serial}, so it applies in every browser.` : "This printer has no serial number, so this is saved against its Bluetooth name."}
          </Hint>
        </UiLabel>
        {own && (
          <>
            <span className="text-xs text-muted-foreground">right</span>
            <Input type="number" className="h-8 w-20" step={1} min={-40} max={40} value={own.offset.x} onChange={(e) => set({ ...own.offset, x: Math.round(e.target.valueAsNumber || 0) })} aria-label="Move print right (dots)" />
            <span className="text-xs text-muted-foreground">down</span>
            <Input type="number" className="h-8 w-20" step={1} min={-40} max={40} value={own.offset.y} onChange={(e) => set({ ...own.offset, y: Math.round(e.target.valueAsNumber || 0) })} aria-label="Move print down (dots)" />
            <span className="text-xs text-muted-foreground">dots</span>
            {own.source === "suggested" && (
              <span className="text-xs text-amber-700 dark:text-amber-400" title={hint?.basis}>
                Suggested for the {short}, not yet checked on this printer.{" "}
                <button type="button" className="underline" onClick={() => set(own.offset)}>
                  It&apos;s right
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {!own && hint && !dismissed && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground" title={hint.basis}>
            Other {short} printers needed their print moved {describeOffset(hint.offset)}. Use the same here? Print the test pattern under Printers below to check.
          </span>
          <Button size="sm" variant="outline" onClick={() => set(hint.offset, "suggested")}>
            Use suggested
          </Button>
          <Button size="sm" variant="ghost" onClick={() => usePrinterStore.getState().dismissHint(key)}>
            Not needed
          </Button>
        </div>
      )}
    </div>
  );
}

/** Saved printers and tracked rolls / ribbons (shared by the team). */
export function SavedPrinters() {
  const profiles = usePrinterStore((s) => s.profiles);
  const usage = usePrinterStore((s) => s.usage);
  const removeProfile = usePrinterStore((s) => s.removeProfile);
  const forgetUsage = usePrinterStore((s) => s.forgetUsage);
  const saved = Object.values(profiles).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const rolls = Object.entries(usage).sort((a, b) => (b[1].lastUsed ?? 0) - (a[1].lastUsed ?? 0));
  if (!saved.length && !rolls.length) return null;
  return (
    <div className="grid gap-6 border-t pt-4 md:grid-cols-2">
      {saved.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Saved printers</h4>
          <ul className="divide-y text-sm">
            {saved.map((p) => (
              <li key={p.key} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {p.name || shortModel(p.model)} <span className="text-xs text-muted-foreground">({shortModel(p.model)}{p.lastSeen ? `, last seen ${new Date(p.lastSeen).toLocaleDateString()}` : ""})</span>
                </span>
                <Button size="icon-sm" variant="ghost" title="Forget this printer's settings" onClick={() => removeProfile(p.key)}>
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rolls.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Rolls and ribbons used
            <Hint>Labels printed with labebal (from every browser) on each roll and ribbon (recognized by its tag). Used to warn you before a roll or ribbon runs out.</Hint>
          </h4>
          <ul className="max-h-56 divide-y overflow-y-auto text-sm">
            {rolls.map(([k, u]) => (
              <li key={k} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {u.kind === "roll" ? "Roll" : "Ribbon"} <span className="font-mono text-xs">{k.split(":").slice(1).join(":")}</span>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {u.printed} printed{u.lastUsed ? ` · ${new Date(u.lastUsed).toLocaleDateString()}` : ""}
                  </span>
                </span>
                <Button size="icon-sm" variant="ghost" title="Forget this roll" onClick={() => forgetUsage(k)}>
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
