/**
 * Which connected printer prints a board tile, and what to say when none can.
 * Pure (takes the printers' models and current sizes), so it is unit tested.
 */
import { findPrinter, printerForSize, sizeById, sizesFor, usableSizes, type LabelSize, type PrinterProfile } from "@labebal/core";

export interface TargetInfo {
  model: string | null;
  /** The size this printer is set up for right now. */
  sizeId: string;
  primary: boolean;
}

/** The size can be printed by this printer model. */
export const printerTakes = (model: string | null | undefined, sizeId: string) => !!model && usableSizes(model).some((s) => s.id === sizeId);

/**
 * Index of the printer for a tile, best first: one already set up for that size
 * (its roll is loaded), then one the size is made for (an N1 roll goes to the
 * N1, not to an M2 it also fits), then the first printer. -1 when no connected
 * printer takes it.
 */
export function pickTarget(sizeId: string, targets: readonly TargetInfo[]): number {
  let best = -1;
  let bestScore = -1;
  targets.forEach((t, i) => {
    if (!printerTakes(t.model, sizeId)) return;
    const score = (t.sizeId === sizeId ? 4 : 0) + (sizesFor(t.model!).some((s) => s.id === sizeId) ? 2 : 0) + (t.primary ? 1 : 0);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best;
}

/** Plain name of the kind of printer a size is made for ("a network label printer", "an M2"...). */
export function printerNeeded(size: LabelSize | undefined): string {
  if (!size) return "a printer";
  if (size.printer === "zpl") return "a network label printer";
  const p = findPrinter(size.printer);
  if (!p) return "a printer";
  if (p.family === "brother-pt") return "the P-touch";
  return `an ${p.model === "M2_H" ? "M2" : p.name}`;
}

/** A printer profile to draw a size with when nothing that takes it is connected. */
export function previewPrinterFor(sizeId: string): PrinterProfile | undefined {
  const size = sizeById(sizeId);
  if (!size) return undefined;
  return printerForSize(size);
}
