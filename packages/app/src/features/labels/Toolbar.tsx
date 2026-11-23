"use client";
import { IconAlertTriangle, IconPlugConnectedX, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { THERMAL_NAMES, mediaKindById, thermalFor } from "@labebal/core";
import { usePrinterTargets } from "../printers/targets";
import { Hint } from "../printers/ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { usePrintContext } from "./context";
import { printers, usePrinter } from "./printer";
import { ConnectMenu } from "./ConnectMenu";
import { RollStatus } from "./RollStatus";
import { SizePicker } from "./SizePicker";
import { useLabelStore } from "./store";
import { netIdOfModel, useNetProfiles } from "../netprinters/api";
import { connectNetworkPrinter, netConnection } from "../netprinters/connect";
import { applyLoadedTape } from "./brother";
import { swatchOptions, useSwatches } from "./swatches";
import { useEffect } from "react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Pick({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className}>
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
  );
}

function ExtraPrinters() {
  const all = usePrinterTargets();
  const extra = all.filter((t) => !t.primary);
  return (
    <>
      {extra.map((t) => (
        <span key={t.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" title={`${t.name}: ${t.ctx.size.name}. Queue items go to the printer whose label fits best.`}>
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t.name}
          <RollStatus connectionId={t.id} compact />
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Disconnect ${t.name}`} title="Disconnect" onClick={() => void printers.remove(t.id)}>
            <IconX className="size-3" />
          </button>
        </span>
      ))}
    </>
  );
}

/** "DT" / "TT" chip: direct thermal (no ribbon) or thermal transfer, with a warning when stock and printer don't go together. */
export function ThermalBadge({ kind, problem }: { kind: "direct" | "transfer"; problem?: string }) {
  const t = THERMAL_NAMES[kind];
  return (
    <span
      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${problem ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
      title={problem ?? `${t.name}: ${t.help}`}
    >
      {problem && <IconAlertTriangle className="size-3" aria-hidden />}
      {t.short}
    </span>
  );
}

export function PrinterStatus() {
  const p = usePrinter();
  const setPrinter = useLabelStore((s) => s.setPrinter);

  // Follow the connected printer's model.
  useEffect(() => {
    if (p.model) setPrinter(p.model);
  }, [p.model, setPrinter]);
  // Printers that report their tape (Brother): match size, stock and text colour to it.
  useEffect(() => {
    if (p.model && p.media) applyLoadedTape(p.model, p.media);
  }, [p.model, p.media]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${p.connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
        {p.status !== "Not connected" && <span className="max-w-48 truncate text-sm text-muted-foreground">{p.status}</span>}
        <RollStatus />
        <ExtraPrinters />
        {p.connected && (
          <Button size="icon-sm" variant="ghost" title={`Disconnect ${p.status.replace(/^Connected: /, "")}`} aria-label="Disconnect printer" onClick={() => void printers.remove(p.connection.id)}>
            <IconPlugConnectedX />
          </Button>
        )}
        <ConnectMenu />
      </div>
    </div>
  );
}

export function Toolbar() {
  const { settings, printer, printers } = usePrintContext();
  const set = useLabelStore((s) => s.setSettings);
  const setPrinter = useLabelStore((s) => s.setPrinter);
  const main = usePrinterTargets().find((t) => t.primary);
  const media = main ? mediaKindById(main.mediaKind) : null;
  // Picking a network printer connects to it (no pairing needed).
  const pickPrinter = (model: string) => {
    setPrinter(model);
    const id = netIdOfModel(model);
    const np = id ? useNetProfiles.getState().list.find((x) => x.id === id) : undefined;
    if (np && !netConnection(np.id)?.getSnapshot().connected) connectNetworkPrinter(np).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };
  const { materials, ribbons } = useSwatches();
  const thermal = thermalFor(printer, settings.material, main?.snapshot.live?.thermal);
  const cassette = printer.ink === "cassette";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2">
      <Field label="Printer">
        <Pick value={settings.printer} onChange={pickPrinter} options={printers.map((p) => ({ value: p.model, label: p.name }))} />
      </Field>
      <Field label="Label size">
        <SizePicker />
      </Field>
      <Field label="Stock">
        <Pick value={settings.material} onChange={(v) => set({ material: v })} options={swatchOptions(materials)} />
        <ThermalBadge kind={thermal.kind} problem={thermal.problem} />
        {media && media.id !== "gap" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {media.name}
            <Hint>
              {media.hint} {main?.mediaSource === "auto" ? "Picked from the stock or the roll's tag." : "Set in Settings > Printers."}
            </Hint>
          </span>
        )}
      </Field>
      {thermal.ribbon && (
        <Field label={cassette ? "Text colour" : "Ribbon"}>
          <Pick value={settings.ribbon} onChange={(v) => set({ ribbon: v })} options={swatchOptions(ribbons)} />
        </Field>
      )}
      <Field label="Margin">
        <Input
          type="number"
          className="h-8 w-16"
          min={0}
          max={5}
          step={0.25}
          value={settings.marginMm}
          onChange={(e) => set({ marginMm: Number(e.target.value) || 0 })}
        />
        <span className="text-xs text-muted-foreground">mm</span>
      </Field>
      <Field label="Darkness">
        <Slider
          className="w-24"
          min={printer.densityMin}
          max={printer.densityMax}
          step={1}
          value={[settings.density]}
          onValueChange={([v]) => set({ density: v })}
        />
        <span className="w-3 text-sm">{settings.density}</span>
      </Field>
      <div className="flex items-center gap-2">
        <Switch id="invert-all" checked={settings.invertAll} onCheckedChange={(v) => set({ invertAll: v })} />
        <UiLabel htmlFor="invert-all" className="text-sm font-normal">
          Invert all
        </UiLabel>
      </div>
    </div>
  );
}
