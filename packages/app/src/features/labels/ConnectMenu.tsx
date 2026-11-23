"use client";
/**
 * One "Connect printer" menu for every kind of link: Niimbot over Bluetooth or
 * a USB cable, Brother P-touch over its Bluetooth serial port, and the team's
 * network printers (ZPL, through the server). Once a printer is connected the
 * same menu shrinks to a "+" button that connects another one.
 */
import { IconBluetooth, IconCheck, IconNetwork, IconPlus, IconPrinter, IconSettings, IconTag, IconUsb } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Link } from "../../lib/router";
import { useCan } from "../auth/me-client";
import { netModel, useNetPrinters, type NetPrinter } from "../netprinters/api";
import { connectNetworkPrinter } from "../netprinters/connect";
import { connectBrother } from "./brother";
import { connectAnotherPrinter, usePrinter, usePrinters } from "./printer";
import { useLabelStore } from "./store";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ConnectMenu({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const p = usePrinter();
  const all = usePrinters();
  const { data: net } = useNetPrinters();
  const setPrinter = useLabelStore((s) => s.setPrinter);
  const admin = useCan("admin");
  const anyConnected = all.some((x) => x.connected);
  const inUse = new Set(all.filter((x) => x.connected && x.model).map((x) => x.model));
  const { bluetooth, serial } = p.supported;

  const niimbot = (transport: "bluetooth" | "serial") => connectAnotherPrinter(transport).catch((e) => toast.error(errorText(e)));
  const brother = () => connectBrother().catch((e) => toast.error(errorText(e)));
  const network = async (np: NetPrinter) => {
    try {
      const c = await connectNetworkPrinter(np);
      // The first printer follows the toolbar; make the toolbar follow it.
      if (c === all[0]?.connection || !anyConnected) setPrinter(netModel(np.id));
      toast.success(`${np.name} is ready`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const lg = size === "lg";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {anyConnected ? (
          <Button size={lg ? "icon-lg" : "icon-sm"} variant="ghost" title="Connect another printer" aria-label="Connect another printer" className={className}>
            <IconPlus />
          </Button>
        ) : (
          <Button size={lg ? "lg" : "sm"} className={className}>
            <IconPrinter /> Connect printer
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>Niimbot</DropdownMenuLabel>
        <DropdownMenuItem disabled={!bluetooth} onSelect={() => void niimbot("bluetooth")}>
          <IconBluetooth /> <span className="flex-1">Bluetooth</span>
          {!bluetooth && <span className="text-xs text-muted-foreground">Chrome / Edge</span>}
        </DropdownMenuItem>
        {serial && (
          <DropdownMenuItem onSelect={() => void niimbot("serial")}>
            <IconUsb /> USB cable
          </DropdownMenuItem>
        )}
        {serial && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Brother</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void brother()}>
              <IconTag /> <span className="flex-1">P-touch (PT-D610BT)</span>
              <span className="text-xs text-muted-foreground">Bluetooth serial</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Network printers</DropdownMenuLabel>
        {net?.map((np) => (
          <DropdownMenuItem key={np.id} onSelect={() => void network(np)}>
            {inUse.has(netModel(np.id)) ? <IconCheck /> : <IconNetwork />}
            <span className="flex-1">{np.name}</span>
            <span className="text-xs text-muted-foreground">{np.dpi} dpi</span>
          </DropdownMenuItem>
        ))}
        {!net?.length &&
          (admin ? (
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <IconSettings /> Add one in Settings
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>None set up yet</DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
