"use client";
import { BrotherPtPrinter, sizesFor, type LoadedMedia } from "@labebal/core";
import { printers } from "./printer";
import { useLabelStore } from "./store";

/** Connect a Brother P-touch over its (Bluetooth) serial port. Returns null when the picker was closed. */
export async function connectBrother() {
  const p = printers.use(new BrotherPtPrinter(printers.nextId())) as BrotherPtPrinter;
  await p.connect();
  const s = p.getSnapshot();
  if (!s.connected) {
    await printers.remove(p.id);
    if (s.error && !/cancel|no port selected|no device selected/i.test(s.error)) throw new Error(s.error);
    return null;
  }
  return p;
}

/**
 * Match the toolbar to the tape in the cassette: the size with the same tape
 * width (keeping the length when there is one), the tape colour as stock and
 * the text colour as ribbon.
 */
export function applyLoadedTape(model: string, media: LoadedMedia) {
  const st = useLabelStore.getState();
  const s = st.settings;
  const tapes = sizesFor(model).filter((z) => Math.abs(z.heightMm - media.widthMm) < 0.6);
  const cur = sizesFor(model).find((z) => z.id === s.sizeId);
  const size = tapes.find((z) => cur && Math.abs(z.widthMm - cur.widthMm) < 0.5) ?? tapes.find((z) => z.common) ?? tapes[0];
  const patch: Partial<typeof s> = {};
  if (size && size.id !== s.sizeId) patch.sizeId = size.id;
  if (media.materialId && media.materialId !== s.material) patch.material = media.materialId;
  if (media.ribbonId && media.ribbonId !== s.ribbon) patch.ribbon = media.ribbonId;
  if (Object.keys(patch).length) st.setSettings(patch);
}
