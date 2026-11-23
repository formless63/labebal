"use client";
import { printers } from "../labels/printer";
import type { NetPrinter } from "./api";
import { NetworkZplPrinter } from "./driver";

/** The connection for a network printer, if one is open in this tab. */
export const netConnection = (id: string) => printers.list().find((c): c is NetworkZplPrinter => c instanceof NetworkZplPrinter && c.netId === id);

/**
 * Use a network printer: it takes the first printer slot when that is free,
 * else it is added next to the connected printers. Throws when it can't be reached.
 */
export async function connectNetworkPrinter(np: NetPrinter) {
  const open = netConnection(np.id);
  if (open?.getSnapshot().connected) return open;
  const p = open ?? (printers.use(new NetworkZplPrinter(printers.nextId(), np)) as NetworkZplPrinter);
  await p.connect();
  const s = p.getSnapshot();
  if (!s.connected) {
    await printers.remove(p.id);
    throw new Error(s.error ?? `Can't reach ${np.name}`);
  }
  return p;
}
