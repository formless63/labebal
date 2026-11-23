"use client";
/**
 * Settings > Network printers: Zebra (and other ZPL) printers on the network.
 * The server prints to them, so every browser (phones too) can use them
 * without pairing. Admins add them by address; the printer reports its
 * resolution and head width itself.
 */
import { useState } from "react";
import { IconNetwork, IconRefresh, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { THERMAL_NAMES } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useCan } from "../auth/me-client";
import { Hint } from "../printers/ui";
import { fetchNetStatus, useNetPrinterActions, useNetPrinters, type NetPrinter, type NetPrinterDetection, type NetPrinterStatus } from "./api";

const THERMAL_OPTIONS: { value: NetPrinter["thermal"]; label: string }[] = [
  { value: "both", label: "Ribbon or no ribbon (the stock decides)" },
  { value: "direct", label: `${THERMAL_NAMES.direct.name} only (no ribbon)` },
  { value: "transfer", label: `${THERMAL_NAMES.transfer.name} only (always a ribbon)` },
];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function NetPrintersSection() {
  const { data: list, isLoading } = useNetPrinters();
  const canAdmin = useCan("admin");
  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list?.length ? (
        <ul className="divide-y rounded-md border">
          {list.map((p) => (
            <NetPrinterRow key={p.id} p={p} canAdmin={canAdmin} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No network printers yet.{canAdmin ? " Add one below by its IP address." : " An admin can add them."}</p>
      )}
      {canAdmin && <AddNetPrinter />}
    </div>
  );
}

function StatusDot({ s }: { s: NetPrinterStatus | null }) {
  if (!s) return <span className="size-2 rounded-full bg-muted-foreground/40" title="Not checked" />;
  const ok = s.reachable && !s.problem;
  return <span className={`size-2 rounded-full ${ok ? "bg-emerald-500" : s.reachable ? "bg-amber-500" : "bg-destructive"}`} title={ok ? "Ready" : (s.problem ?? s.error ?? "Problem")} />;
}

function NetPrinterRow({ p, canAdmin }: { p: NetPrinter; canAdmin: boolean }) {
  const { update, remove } = useNetPrinterActions();
  const [status, setStatus] = useState<NetPrinterStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      setStatus(await fetchNetStatus(p.id));
    } finally {
      setChecking(false);
    }
  };
  const widthMm = Math.round((p.headDots / (p.dpi / 25.4)) * 10) / 10;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <StatusDot s={status} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-muted-foreground">
          {p.host}:{p.port} · {p.model || "ZPL"} · {p.dpi} dpi · {widthMm} mm wide
          {status && <> · {status.reachable ? (status.problem ?? "Ready") + (status.thermalTransfer !== undefined ? `, set to ${status.thermalTransfer ? "thermal transfer" : "direct thermal"}` : "") : (status.error ?? "Not reachable")}</>}
        </div>
      </div>
      {canAdmin && (
        <Select
          value={p.thermal}
          onValueChange={(v) =>
            update(p.id, { thermal: v as NetPrinter["thermal"] }).catch((e) => toast.error(errText(e)))
          }
        >
          <SelectTrigger size="sm" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THERMAL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
        <IconRefresh className={checking ? "animate-spin" : undefined} /> Check
      </Button>
      {canAdmin && (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Remove"
          onClick={async () => {
            if (await confirmDialog({ title: `Remove ${p.name}?`, description: "It disappears from everyone's printer list. Labels and history stay.", confirmLabel: "Remove", destructive: true }))
              await remove(p.id).catch((e) => toast.error(errText(e)));
          }}
        >
          <IconTrash />
        </Button>
      )}
    </li>
  );
}

function AddNetPrinter() {
  const { detect, add } = useNetPrinterActions();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9100");
  const [found, setFound] = useState<NetPrinterDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portN = Math.trunc(Number(port)) || 9100;

  const runDetect = async () => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const d = await detect(host.trim(), portN);
      setFound(d);
      if (!name.trim()) setName(d.model.replace(/-\d+dpi$/i, "") || "Label printer");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await add({ name: name.trim() || found?.model || "Label printer", host: host.trim(), port: portN, ...(found ? { dpi: found.dpi, headDots: found.headDots, model: found.model } : {}) });
      toast.success("Printer added");
      setName("");
      setHost("");
      setFound(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <IconNetwork className="size-4" /> Add a network printer
        <Hint>Zebra and other printers that speak ZPL, on the same network as the labebal server (raw printing, usually port 9100). The printer&apos;s IP address is on its network configuration label.</Hint>
      </h4>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <UiLabel htmlFor="np-host" className="text-xs text-muted-foreground">
            IP address or host name
          </UiLabel>
          <Input id="np-host" className="w-48" placeholder="192.168.1.50" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <UiLabel htmlFor="np-port" className="text-xs text-muted-foreground">
            Port
          </UiLabel>
          <Input id="np-port" className="w-20" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
        <Button variant="outline" disabled={!host.trim() || busy} onClick={() => void runDetect()}>
          Detect
        </Button>
        <div className="space-y-1.5">
          <UiLabel htmlFor="np-name" className="text-xs text-muted-foreground">
            Name
          </UiLabel>
          <Input id="np-name" className="w-48" placeholder="e.g. Shipping Zebra" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button disabled={!host.trim() || busy} onClick={() => void save()}>
          Add
        </Button>
      </div>
      {found && (
        <p className="text-xs text-muted-foreground">
          Found {found.model} ({found.firmware}): {found.dpi} dpi, {found.headDots}-dot head ({Math.round((found.headDots / (found.dpi / 25.4)) * 10) / 10} mm)
          {found.method ? `, currently set to ${found.method === "transfer" ? "thermal transfer" : "direct thermal"}` : ""}
          {found.mediaType ? `, ${found.mediaType.toLowerCase()} media` : ""}.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
