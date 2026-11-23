"use client";
/**
 * Loaded roll, read from its RFID tag: remaining labels (tag and our own count,
 * whichever is lower), ribbon, detected size, and a one-click "use this roll".
 * Silent when the printer has no RFID or no tag.
 */
import { IconRefresh, IconTag } from "@tabler/icons-react";
import { consumableKey, matchRoll, materialById, printerFor, sizeById, usageEstimate, usageLevel } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { usePrinterStore } from "../printers/store";
import { printerKey } from "../printers/targets";
import { cn } from "../../lib/utils";
import { usePrinters } from "./printer";
import { useLabelStore } from "./store";

/** `connectionId`: which printer (default the first). `compact`: just the count (extra printers in the header). */
export function RollStatus({ connectionId, compact }: { connectionId?: string; compact?: boolean } = {}) {
  const list = usePrinters();
  const p = (connectionId ? list.find((x) => x.id === connectionId) : list[0]) ?? list[0];
  const primary = p === list[0];
  const settings = useLabelStore((s) => s.settings);
  const setSettings = useLabelStore((s) => s.setSettings);
  const setPrinter = useLabelStore((s) => s.setPrinter);
  const usage = usePrinterStore((s) => s.usage);
  const saveProfile = usePrinterStore((s) => s.saveProfile);
  if (!p?.connected || !p.model) return null;
  const roll = p.roll;
  const printer = printerFor(p.model);

  if (!roll) {
    if (compact) return null;
    // With the lid open the printer cannot read the roll or ribbon tags.
    if (p.live?.lidClosed === false)
      return (
        <span className="text-xs text-amber-700 dark:text-amber-400" title="Close the lid so the printer can read the roll and ribbon.">
          Lid open
        </span>
      );
    return (
      <span className="hidden text-xs text-muted-foreground xl:inline" title="The printer did not report an RFID roll tag (no tag, or not supported).">
        Roll: not detected
      </span>
    );
  }

  const est = usageEstimate(usage[consumableKey("roll", roll.serial, roll.barcode)], roll);
  const level = usageLevel(est.left, est.total);
  const rib = roll.ribbon ? usageEstimate(usage[consumableKey("ribbon", roll.ribbon.serial, roll.ribbon.barcode)], roll.ribbon) : null;
  const ribLevel = rib ? usageLevel(rib.left, rib.total) : null;
  const low = level === "low" || level === "empty" || ribLevel === "low" || ribLevel === "empty";
  const match = matchRoll(roll, printer, settings.learnedRolls);
  const size = match ? sizeById(match.sizeId) : undefined;
  const key = printerKey(p);
  const inUse = primary
    ? size && settings.sizeId === size.id && (!match?.materialId || match.materialId === settings.material)
    : size && usePrinterStore.getState().profiles[key ?? ""]?.sizeId === size.id;

  const remember = (sizeId: string, materialId?: string) =>
    setSettings({ learnedRolls: { ...(settings.learnedRolls ?? {}), [roll.barcode]: { sizeId, ...(materialId ? { materialId } : {}) } } });
  const useRoll = () => {
    if (!size) return;
    if (primary) {
      if (settings.printer !== printer.model) setPrinter(printer.model);
      setSettings({ sizeId: size.id, ...(match?.materialId ? { material: match.materialId } : {}) });
    } else if (key) {
      saveProfile(key, { model: printer.model, sizeId: size.id, ...(match?.materialId ? { material: match.materialId } : {}) });
    }
    remember(size.id, match?.materialId);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className={cn("gap-1.5", compact && "h-5 px-1", low && "text-destructive")} title={low ? "Roll or ribbon running low" : "Loaded label roll"}>
          <IconTag className="size-4" />
          <span className="tabular-nums">{est.left}</span>
          {!compact && <span className="hidden text-muted-foreground lg:inline">left{size ? ` · ${size.name}` : ""}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <div>
          <p className="font-medium">Loaded roll</p>
          <p className={cn("text-muted-foreground", (level === "low" || level === "empty") && "text-destructive")}>
            About {est.left} of {est.total} labels left{level === "empty" ? ": the roll looks empty." : level === "low" ? ": running low, have a new roll ready." : "."}
          </p>
          {est.printedHere > 0 && <p className="text-xs text-muted-foreground">{est.printedHere} printed with labebal so far (all browsers).</p>}
          {rib && (
            <p className={cn("text-muted-foreground", (ribLevel === "low" || ribLevel === "empty") && "text-destructive")} title="The ribbon is the ink film the printer melts onto the label.">
              Ribbon (ink): about {rib.total ? Math.round((rib.left / rib.total) * 100) : 0}% left{ribLevel === "low" ? ", running low" : ribLevel === "empty" ? ", looks used up" : ""}.
            </p>
          )}
        </div>
        {size ? (
          <div className="space-y-2">
            <p>
              {match?.sure ? "This roll is" : "Looks like"} <b>{size.name}</b>
              {match?.materialId ? ` ${materialById(match.materialId).name.toLowerCase()}` : ""} labels.
            </p>
            {inUse ? (
              <p className="text-xs text-muted-foreground">Already selected.</p>
            ) : (
              <Button size="sm" onClick={useRoll} disabled={!primary && !key}>
                Use this roll
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">This roll&apos;s size isn&apos;t known yet.</p>
            {primary && (
              <Button size="sm" variant="outline" onClick={() => remember(settings.sizeId, settings.material)} disabled={settings.printer !== printer.model}>
                It&apos;s {sizeById(settings.sizeId)?.name ?? "the selected size"}: remember
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span title="Roll barcode / serial">
            {roll.barcode || "?"} · {roll.serial || "?"}
          </span>
          <Button size="icon" variant="ghost" className="size-7" title="Read the roll again" onClick={() => void p.connection.refreshRoll()}>
            <IconRefresh className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
