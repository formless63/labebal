"use client";
/** Settings section: printer offsets, test pattern, darkness per stock. */
import { useEffect, useRef, useState } from "react";
import { IconPrinter, IconRestore } from "@tabler/icons-react";
import { toast } from "sonner";
import { allMaterials, allPrinters, feedOf, labelPixels, materialDensity, mediaKindById, printerFor, renderTestPattern, sizesFor, tintDots, type PrintTaskName } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { feedPadding, offsetFor, padCanvas, shiftCanvas } from "../labels/calibration";
import { usePrinters } from "../labels/printer";
import { useLabelStore } from "../labels/store";
import { usePrinterStore } from "../printers/store";
import { printerKey, printerSetup } from "../printers/targets";
import { saveSharedCalibration, serialOfKey, useOwnOffset } from "../printers/calibrations";
import { MediaKindPicker, PrintTaskPicker } from "../printers/pickers";

const shortName = (model: string) => (model === "M2_H" ? "M2" : model);

export function CalibrationSection() {
  const settings = useLabelStore((s) => s.settings);
  const setSettings = useLabelStore((s) => s.setSettings);
  const list = usePrinters();
  const [model, setModel] = useState(settings.printer);
  // A connected printer of the model being calibrated (any of several).
  const p = list.find((x) => x.connected && x.model === model) ?? list[0];
  const modelDefaults = usePrinterStore((s) => s.models[model]);
  const setModelDefaults = usePrinterStore((s) => s.setModel);
  /** Print task to try for the test pattern (before locking it as the default). */
  const [tryTask, setTryTask] = useState<PrintTaskName | undefined>(undefined);
  const printer = printerFor(model);
  const sizes = sizesFor(model);
  const [sizeId, setSizeId] = useState(settings.printer === model ? settings.sizeId : sizes[0].id);
  const size = sizes.find((s) => s.id === sizeId) ?? sizes[0];
  const [allLevels, setAllLevels] = useState(false);
  // The connected printer's own position (saved against its serial) wins over the model offset.
  const ownKey = p?.connected && p.model === model ? printerKey(p) : null;
  const own = useOwnOffset(ownKey);
  const off = own?.offset ?? offsetFor(settings, model);
  const px = labelPixels(size, printer);
  const preview = useRef<HTMLCanvasElement>(null);

  const setOffset = (k: "x" | "y", v: number) => {
    const next = { ...off, [k]: Number.isFinite(v) ? Math.round(v) : 0 };
    if (own && ownKey) saveSharedCalibration(ownKey, { model, name: usePrinterStore.getState().profiles[ownKey]?.name, offset: next });
    else setSettings({ offsets: { ...(settings.offsets ?? {}), [model]: next } });
  };

  // Same rule as printing: along the feed the image grows at the leading edge, across the head it shifts.
  const pattern = (density: number) => {
    const f = feedPadding(feedOf(size), off.x, off.y);
    const base = renderTestPattern({ ...px, caption: `${shortName(model)} D${density} ${fmt(off.x)}/${fmt(off.y)}` });
    return padCanvas(f.dx || f.dy ? shiftCanvas(base, f.dx, f.dy) : base, f.padLeft, f.padTop);
  };

  useEffect(() => {
    if (preview.current) tintDots(pattern(settings.density), [17, 17, 17], preview.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, size.id, off.x, off.y, settings.density]);

  async function printPattern() {
    const levels = allLevels ? range(printer.densityMin, printer.densityMax) : [settings.density];
    // Same label type / print task / printer offset as a real print on this printer.
    const setup = printerSetup(p, { settings: { ...settings, printer: model, sizeId: size.id }, printer, size });
    try {
      for (const d of levels) {
        const r = await p.connection.print([{ canvas: pattern(d), qty: 1, name: `Test pattern D${d}` }], {
          density: d,
          direction: feedOf(size),
          labelType: mediaKindById(setup.mediaKind).labelType,
          printTask: tryTask ?? setup.printTask,
        });
        if (r.status === "cancelled") return;
        if (r.status === "failed") throw new Error(r.error ?? "Print failed");
      }
      toast.success(levels.length > 1 ? `Printed ${levels.length} test patterns` : "Printed a test pattern");
    } catch (e) {
      toast.error(String(e));
    }
  }

  // The frame sits on the outermost dots, so any offset moves part of it off the label.
  const shifted = off.x !== 0 || off.y !== 0;
  const canPrint = p.connected && !p.busy && p.model === model;
  const scale = Math.min(12, 520 / size.widthMm);
  const bandW = px.w / px.dpmm, bandH = px.h / px.dpmm;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Printer</UiLabel>
          <Select
            value={model}
            onValueChange={(m) => {
              setModel(m);
              setTryTask(undefined);
              setSizeId(m === settings.printer ? settings.sizeId : sizesFor(m)[0].id);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allPrinters().map((x) => (
                <SelectItem key={x.model} value={x.model}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Move print right (dots)</UiLabel>
          <Input type="number" className="w-28" step={1} min={-40} max={40} value={off.x} onChange={(e) => setOffset("x", e.target.valueAsNumber)} />
        </div>
        <div className="space-y-1.5">
          <UiLabel className="text-xs text-muted-foreground">Move print down (dots)</UiLabel>
          <Input type="number" className="w-28" step={1} min={-40} max={40} value={off.y} onChange={(e) => setOffset("y", e.target.valueAsNumber)} />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          1 dot = {(1 / px.dpmm).toFixed(3)} mm on the {printer.name}. Negative = left / up.
        </p>
      </div>
      {ownKey && (
        <p className="-mt-3 text-xs text-muted-foreground">
          {own
            ? `These numbers are this ${shortName(model)}'s own position (${serialOfKey(ownKey) ? `serial ${serialOfKey(ownKey)}, used in every browser` : "this browser"}). Switch off "Own print position" above to use the offset for all ${shortName(model)} printers.`
            : `These numbers apply to every ${shortName(model)} printer. To calibrate only the connected one, switch on "Own print position" above.`}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <MediaKindPicker
          label={`Label type (${printer.name})`}
          value={modelDefaults?.mediaKind}
          onChange={(v) => setModelDefaults(model, { mediaKind: v })}
          autoText="Automatic (from the stock and the roll)"
        />
        <PrintTaskPicker
          model={model}
          detected={p.connected && p.model === model ? ((p.printTask ?? undefined) as PrintTaskName | undefined) : undefined}
          locked={modelDefaults?.printTask}
          trying={tryTask}
          onTry={setTryTask}
          onLock={(v) => {
            setModelDefaults(model, { printTask: v });
            setTryTask(undefined);
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          <div className="flex items-center justify-center rounded-lg bg-muted/60 p-6">
            <div className="relative rounded-[3px] bg-white shadow-sm ring-1 ring-border" style={{ width: size.widthMm * scale, height: size.heightMm * scale }}>
              <canvas
                ref={preview}
                className="absolute"
                style={{
                  width: bandW * scale,
                  height: bandH * scale,
                  left: ((size.widthMm - bandW) / 2) * scale,
                  top: ((size.heightMm - bandH) / 2) * scale,
                  imageRendering: "pixelated",
                }}
              />
            </div>
          </div>
          {shifted && <p className="text-xs text-muted-foreground">With an offset, one side of the outer frame runs off the printable area. That is expected: the inner frame and the cross show the result.</p>}
        </div>
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Load a roll and print the test pattern.</li>
            <li>The cross should sit in the middle of the label. If it is too far left, increase &quot;Move print right&quot;; too high, increase &quot;Move print down&quot;.</li>
            <li>Print again until it is centered. The ruler ticks are 1 mm apart.</li>
            <li>The gray squares show how dark the stock prints; pick the lowest darkness that gives solid black.</li>
          </ol>
          <div className="space-y-1.5">
            <UiLabel className="text-xs text-muted-foreground">Label size</UiLabel>
            <Select value={size.id} onValueChange={setSizeId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="all-levels" checked={allLevels} onCheckedChange={setAllLevels} />
            <UiLabel htmlFor="all-levels" className="font-normal">
              One per darkness level ({printer.densityMin}–{printer.densityMax})
            </UiLabel>
          </div>
          <Button disabled={!canPrint} onClick={printPattern} title={canPrint ? "" : `Connect the ${printer.name} first`}>
            <IconPrinter /> Print test pattern
          </Button>
          {!canPrint && <p className="text-xs text-muted-foreground">Connect the {printer.name} to print.</p>}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Darkness per stock ({printer.name})</h3>
        <p className="text-xs text-muted-foreground">
          Choosing a stock in the print toolbar sets this darkness. Foil, film and kraft need more heat than white paper.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
          {allMaterials().map((m) => {
            const key = `${model}:${m.id}`;
            const user = settings.densityPresets?.[key];
            const dflt = materialDensity(printer, m.id);
            const value = user ?? dflt;
            const setPreset = (v: number | undefined) => {
              const next = { ...(settings.densityPresets ?? {}) };
              if (v === undefined || v === dflt) delete next[key];
              else next[key] = v;
              // Keep the toolbar in sync when editing the stock that is in use.
              const live = settings.printer === model && settings.material === m.id ? { density: v ?? dflt } : {};
              setSettings({ densityPresets: next, ...live });
            };
            return (
              <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <span className="size-5 shrink-0 rounded-sm ring-1 ring-border" style={{ background: m.css }} />
                <span className="min-w-0 flex-1 truncate text-sm" title={m.name}>
                  {m.name}
                </span>
                <Select value={String(value)} onValueChange={(v) => setPreset(Number(v))}>
                  <SelectTrigger size="sm" className="w-16">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {range(printer.densityMin, printer.densityMax).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="size-7" disabled={user === undefined} title={`Back to default (${dflt})`} onClick={() => setPreset(undefined)}>
                  <IconRestore className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fmt = (n: number) => (n >= 0 ? `+${n}` : String(n));
