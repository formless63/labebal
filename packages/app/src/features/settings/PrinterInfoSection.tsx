"use client";
/**
 * Everything the connected printer reports about itself: identity, firmware,
 * battery, live status (lid, paper, ribbon) and the loaded roll / ribbon RFID.
 */
import { IconBluetooth, IconRefresh, IconUsb } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { consumableKey, mediaKindById, mediaKindFromLabelType, rollRemaining, usageEstimate, usageLevel, type LabelPrinter, type PrinterSnapshot } from "@labebal/core";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { connectAnotherPrinter, usePrinter, usePrinters } from "../labels/printer";
import { PrinterProfileEditor, SavedPrinters } from "../printers/PrinterProfiles";
import { usePrinterStore } from "../printers/store";

function Row({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

function Flag({ ok, yes, no }: { ok: boolean | undefined; yes: string; no: string }) {
  if (ok === undefined) return null;
  return <Badge variant={ok ? "secondary" : "destructive"}>{ok ? yes : no}</Badge>;
}

/** Remaining roll / ribbon: the lower of the tag and labebal's own count. */
function Meter({ left, total, printedHere, percent }: { left: number; total: number; printedHere: number; percent?: boolean }) {
  const pct = total > 0 ? (left / total) * 100 : 0;
  const level = usageLevel(left, total);
  return (
    <div className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={level === "low" || level === "empty" ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
      <div className={level === "low" || level === "empty" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {percent ? `About ${Math.round(pct)}% left` : `About ${left} of ${total} left`}{level === "low" ? " (running low)" : level === "empty" ? " (used up?)" : ""}
        {printedHere > 0 ? ` · ${printedHere} printed with labebal` : ""}
      </div>
    </div>
  );
}

export function PrinterInfoSection() {
  const p = usePrinter();
  const all = usePrinters();
  const connected = all.filter((x) => x.connected);
  const add = async (transport: "bluetooth" | "serial") => {
    try {
      await connectAnotherPrinter(transport);
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (connected.length) {
    return (
      <div className="space-y-6">
        {connected.map((x, i) => (
          <div key={x.id} className={i ? "border-t pt-6" : ""}>
            <PrinterCard p={x} />
            <div className="mt-4">
              <PrinterProfileEditor snapshot={x} primary={x.id === all[0]?.id} />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button size="sm" variant="outline" disabled={!p.supported.bluetooth} onClick={() => void add("bluetooth")}>
            <IconBluetooth /> Connect another printer
          </Button>
          {p.supported.serial && (
            <Button size="sm" variant="outline" onClick={() => void add("serial")}>
              <IconUsb /> Another via USB / serial
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            With two printers (say an N1 and an M2), each label in the queue goes to the printer whose label size fits it best; you can also pick one per label.
          </span>
        </div>
        <SavedPrinters />
      </div>
    );
  }

  return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Connect a printer to see its serial number, firmware, battery, lid and paper status, and what the loaded roll and ribbon report.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!p.supported.bluetooth} onClick={() => p.connection.connect("bluetooth")}>
            <IconBluetooth /> Connect (Bluetooth)
          </Button>
          {p.supported.serial && (
            <Button size="sm" variant="outline" onClick={() => p.connection.connect("serial")}>
              <IconUsb /> Connect (USB / serial)
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Tip for Windows: a printer paired in Windows Bluetooth settings also appears as a &quot;Standard Serial over Bluetooth link&quot; COM port, which
          you can pick with <em>Connect (USB / serial)</em>. Make sure the printer is switched on and not connected to a phone or another tab.
        </p>
        {p.error && <p className="text-xs text-destructive">{p.error}</p>}
      </div>
  );
}

/** Everything one connected printer reports. */
function PrinterCard({ p }: { p: PrinterSnapshot & { connection: LabelPrinter } }) {
  const [busy, setBusy] = useState(false);
  const usage = usePrinterStore((s) => s.usage);
  const d = p.device;
  const live = p.live;
  const roll = p.roll;
  const battery = live?.batteryPercents ?? d?.batteryPercents;

  const refresh = async () => {
    setBusy(true);
    try {
      await p.connection.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">{p.model ?? "Printer"}</h3>
          <Button size="sm" variant="outline" disabled={busy || p.busy} onClick={refresh}>
            <IconRefresh className={busy ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
        <Row label="Name" value={d?.name} />
        <Row label="Serial number" value={d?.serial} mono />
        <Row label="Bluetooth address" value={d?.mac} mono />
        <Row label="Firmware" value={d?.firmware} />
        <Row label="Hardware" value={d?.hardware} />
        <Row label="Protocol" value={d?.protocol} />
        <Row label="Model id" value={d?.modelId} />
        <Row label="Printhead" value={d?.printheadPixels ? `${d.printheadPixels} dots${d.dpi ? ` @ ${d.dpi} dpi (${((d.printheadPixels / d.dpi) * 25.4).toFixed(1)} mm)` : ""}` : undefined} />
        <Row label="Auto power-off" value={d?.autoShutdown} />
        <Row label="Sounds" value={d?.sounds ? `power ${d.sounds.power ? "on" : "off"}, connect ${d.sounds.connection ? "on" : "off"}` : undefined} />
        <Row label="Print protocol (detected)" value={p.printTask ?? undefined} mono />
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-sm font-medium">Status</h3>
          <div className="flex flex-wrap gap-1.5">
            <Flag ok={live?.lidClosed} yes="Lid closed" no="Lid open" />
            <Flag ok={live?.paperInserted} yes="Labels loaded" no="No labels" />
            <Flag ok={live?.ribbonInserted} yes="Ribbon loaded" no="No ribbon" />
            {battery !== undefined && <Badge variant={battery < 20 ? "destructive" : "secondary"}>Battery {battery}%</Badge>}
            {live?.temp !== undefined && <Badge variant="secondary">Head {live.temp} °C</Badge>}
            {!live && <span className="text-xs text-muted-foreground">No live status reported yet.</span>}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Loaded roll</h3>
          {roll ? (
            <div className="space-y-2">
              <Meter {...usageEstimate(usage[consumableKey("roll", roll.serial, roll.barcode)], roll)} />
              <Row label="Barcode" value={roll.barcode} mono />
              <Row label="Serial" value={roll.serial} mono />
              <Row label="Type" value={mediaKindFromLabelType(roll.type) ? mediaKindById(mediaKindFromLabelType(roll.type)).name : `Type ${roll.type}`} />
              <Row label="Label pitch" value={roll.totalDots ? `${roll.totalDots} dots (gap ${roll.gapDots ?? "?"})` : undefined} />
              <Row label="Tag says" value={`${rollRemaining(roll)} labels left`} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No RFID tag read from the roll (no tag, or not supported by this printer).</p>
          )}
        </div>

        {roll?.ribbon && (
          <div>
            <h3 className="mb-2 text-sm font-medium">
              Ribbon <span className="font-normal text-muted-foreground">(the ink film)</span>
            </h3>
            {/* Ribbon tags count in their own unit: show a percentage. */}
            <Meter {...usageEstimate(usage[consumableKey("ribbon", roll.ribbon.serial, roll.ribbon.barcode)], roll.ribbon)} percent />
            <Row label="Barcode" value={roll.ribbon.barcode} mono />
            <Row label="Serial" value={roll.ribbon.serial} mono />
          </div>
        )}
      </div>
    </div>
  );
}
