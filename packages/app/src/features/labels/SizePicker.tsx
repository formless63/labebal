"use client";
/**
 * Label size picker: sizes sold for the printer, custom sizes (other suppliers'
 * rolls), and other printers' rolls that also fit it (e.g. N1 14 mm rolls in an
 * M2, printed turned). "Add custom size…" opens a small form.
 */
import { useState } from "react";
import { findPrinter, printerFor, tapeWidthMm, type LabelSize } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "../../components/ui/select";
import { usePrintContext } from "./context";
import { useLabelStore } from "./store";

const ADD = "__add-custom";
const shortModel = (m: string) => (m === "M2_H" ? "M2" : m === "zpl" ? "label printer" : (findPrinter(m)?.name ?? m));

export function SizePicker() {
  const { settings, printer, sizes, otherSizes } = usePrintContext();
  const set = useLabelStore((s) => s.setSettings);
  const [adding, setAdding] = useState(false);
  const own = sizes.filter((z) => !z.custom);
  const custom = sizes.filter((z) => z.custom);

  return (
    <>
      <Select value={settings.sizeId} onValueChange={(v) => (v === ADD ? setAdding(true) : set({ sizeId: v }))}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{printer.name} rolls</SelectLabel>
            {own.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.name}
              </SelectItem>
            ))}
          </SelectGroup>
          {custom.length > 0 && (
            <SelectGroup>
              <SelectSeparator />
              <SelectLabel>Your sizes</SelectLabel>
              {custom.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {otherSizes.length > 0 && (
            <SelectGroup>
              <SelectSeparator />
              <SelectLabel>Other printers&apos; rolls that fit</SelectLabel>
              {otherSizes.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.name} <span className="text-muted-foreground">({shortModel(z.printer)} roll)</span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectSeparator />
          <SelectItem value={ADD}>Add custom size…</SelectItem>
        </SelectContent>
      </Select>
      <CustomSizeDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

/** Form for a size that isn't in the list (another supplier's roll). */
function CustomSizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { settings, printer } = usePrintContext();
  const set = useLabelStore((s) => s.setSettings);
  const [w, setW] = useState("40");
  const [h, setH] = useState("20");
  const [gap, setGap] = useState("2");
  const [feed, setFeed] = useState<"top" | "left">(printer.direction);
  const width = Number(w), height = Number(h);
  const valid = width >= 5 && width <= 300 && height >= 5 && height <= 300;
  const draft: LabelSize = { id: "draft", printer: printer.model, name: "", widthMm: width, heightMm: height, feed };
  const tooWide = valid && tapeWidthMm(draft) > printerFor(printer.model).maxTapeMm;
  const custom = settings.customSizes ?? [];

  function save() {
    if (!valid) return;
    const fmt = (n: number) => String(Math.round(n * 10) / 10);
    const size: LabelSize = {
      id: `custom-${fmt(width)}x${fmt(height)}-${feed}`.replaceAll(".", "_"),
      printer: printer.model,
      // Like the built-in names: roll width × length along the roll.
      name: feed === "left" ? `${fmt(height)} × ${fmt(width)} mm` : `${fmt(width)} × ${fmt(height)} mm`,
      widthMm: width,
      heightMm: height,
      gapMm: Math.max(0, Number(gap) || 0),
      feed,
      group: "Custom",
    };
    set({ customSizes: [...custom.filter((z) => z.id !== size.id), size], sizeId: size.id });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom label size</DialogTitle>
          <DialogDescription>For a roll from another supplier. Sizes are as you read the label. It&apos;s saved for everyone on the team.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <UiLabel htmlFor="cs-w">Width (mm)</UiLabel>
            <Input id="cs-w" type="number" min={5} max={300} step={0.5} value={w} onChange={(e) => setW(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <UiLabel htmlFor="cs-h">Height (mm)</UiLabel>
            <Input id="cs-h" type="number" min={5} max={300} step={0.5} value={h} onChange={(e) => setH(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <UiLabel htmlFor="cs-gap">Gap (mm)</UiLabel>
            <Input id="cs-gap" type="number" min={0} max={20} step={0.5} value={gap} onChange={(e) => setGap(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <UiLabel>How it comes off the roll</UiLabel>
          <Select value={feed} onValueChange={(v) => setFeed(v as "top" | "left")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Upright: the width runs across the roll (die-cut labels)</SelectItem>
              <SelectItem value="left">Sideways: the height runs across the roll (tape, like the N1&apos;s 14 mm rolls)</SelectItem>
            </SelectContent>
          </Select>
          {valid && (
            <p className={tooWide ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              The roll is {tapeWidthMm(draft)} mm wide{tooWide ? `, wider than the ${printer.name} takes (${printer.maxTapeMm} mm).` : "."}
            </p>
          )}
        </div>
        {custom.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Your sizes</p>
            <ul className="divide-y rounded-md border text-sm">
              {custom.map((z) => (
                <li key={z.id} className="flex items-center justify-between px-2 py-1">
                  <span>
                    {z.name} <span className="text-xs text-muted-foreground">({shortModel(z.printer)})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set({ customSizes: custom.filter((x) => x.id !== z.id), ...(settings.sizeId === z.id ? { sizeId: printer.model === "N1" ? "n1-14x30" : "m2-30x15" } : {}) })}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || tooWide}>
            Add and use
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
