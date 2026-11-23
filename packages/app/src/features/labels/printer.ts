"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BUILTIN_FONTS, PrinterRegistry, disconnectedSnapshot, loadFonts, transportsSupported, type LabelPrinter, type PrinterSnapshot } from "@labebal/core";
import { uploadedFontsReady } from "../fonts/fonts-client";

/** All printers of this browser tab. The first one always exists (single-printer screens use it). */
export const printers = typeof window !== "undefined" ? new PrinterRegistry() : (null as unknown as PrinterRegistry);

const noop = () => () => {};
// Assume support on the server so the first render doesn't flash a warning.
const serverSupport = { bluetooth: true, serial: false };
const clientSupport = typeof window !== "undefined" ? transportsSupported() : serverSupport;

const serverSnapshot: PrinterSnapshot = disconnectedSnapshot("p1");
const serverList: PrinterSnapshot[] = [serverSnapshot];

/** The first printer's state (the first slot can change: a Brother or network printer takes it when free). */
export function usePrinter() {
  const list = useSyncExternalStore(printers?.subscribe ?? noop, printers?.getSnapshot ?? (() => serverList), () => serverList);
  const state = list[0] ?? serverSnapshot;
  const supported = useSyncExternalStore(noop, () => clientSupport, () => serverSupport);
  return { ...state, supported, connection: (printers?.primary ?? null) as LabelPrinter };
}

/** Every printer slot (connected or not), with its connection. */
export function usePrinters() {
  const list = useSyncExternalStore(printers?.subscribe ?? noop, printers?.getSnapshot ?? (() => serverList), () => serverList);
  return useMemo(() => list.map((s) => ({ ...s, connection: printers?.get(s.id) as LabelPrinter })), [list]);
}

/** Connect one more printer (keeps the ones already connected). Removes the slot again if connecting fails. */
export async function connectAnotherPrinter(transport: "bluetooth" | "serial") {
  const free = printers.list().find((c) => !c.getSnapshot().connected && c !== printers.primary);
  const c = !printers.primary.getSnapshot().connected ? printers.primary : (free ?? printers.add());
  await c.connect(transport);
  const s = c.getSnapshot();
  if (!s.connected) {
    if (c !== printers.primary) await printers.remove(c.id);
    // Closing the browser's device picker is not an error worth showing.
    if (s.error && !/cancel|no device selected/i.test(s.error)) throw new Error(s.error);
    return null;
  }
  return c;
}

/** Load label fonts once; re-renders when ready. */
let fontsPromise: Promise<void> | null = null;
export function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fontsPromise ??= Promise.all([loadFonts(BUILTIN_FONTS.map((f) => f.family)), uploadedFontsReady()]).then(() => undefined);
    void fontsPromise.then(() => setReady(true));
  }, []);
  return ready;
}
