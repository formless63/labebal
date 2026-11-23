"use client";
import { useMemo } from "react";
import { allPrinters, labelInvert, otherSizesFor, printerFor, sizesFor, usableSizes, type Label, type Library, type Template } from "@labebal/core";
import { useLabelStore } from "./store";
import { useNetProfiles } from "../netprinters/api";

/** Derived print context shared by the workspace components. */
export function usePrintContext() {
  const settings = useLabelStore((s) => s.settings);
  // Network printers arrive from the server after the first render.
  const netVersion = useNetProfiles((s) => s.version);
  return useMemo(() => {
    const printer = printerFor(settings.printer);
    // Sizes sold for this printer (and custom ones), then other printers' rolls that fit it.
    const sizes = sizesFor(settings.printer);
    const otherSizes = otherSizesFor(settings.printer);
    const size = usableSizes(printer.model).find((z) => z.id === settings.sizeId) ?? sizes[0];
    return { settings, printer, sizes, otherSizes, size, printers: allPrinters() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, netVersion]);
}

export const templateOf = (lib: Library | undefined, l: Label | undefined): Template | undefined =>
  l ? lib?.templates.find((t) => t.id === l.templateId) : undefined;

/** Effective invert: the label's own setting (or template rules / default), flipped by "Invert all". */
export const isInverted = (l: Label, t: Template | undefined, invertAll: boolean) => labelInvert(t, l) !== invertAll;
