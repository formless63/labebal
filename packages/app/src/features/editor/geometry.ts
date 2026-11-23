"use client";
/**
 * Canvas geometry: which label size is shown, its dot grid, and conversions
 * between what you see (the label at the chosen size) and what is stored
 * (free-layout positions in design-size mm).
 */
import {
  sizeById,
  contentSize,
  labelPixels,
  printerFor,
  printerForSize,
  type Anchor,
  type Box,
  type LabelSize,
  type LaidOut,
  type LayoutResult,
  type PrinterProfile,
  type Template,
} from "@labebal/core";

export interface View {
  /** Physical label (for the design size: the design area plus margins). */
  size: LabelSize;
  printer: PrinterProfile;
  /** Printable band in dots. */
  w: number;
  h: number;
  dpmm: number;
  marginMm: number;
  /** Top-left of the printable band on the label, mm. */
  bandX: number;
  bandY: number;
  /** Top-left of the content area (layout origin) on the label, mm. */
  originX: number;
  originY: number;
  /** Content area size (what the layout gets), mm. */
  width: number;
  height: number;
  isDesign: boolean;
}

export function makeView(t: Template, sizeId: string, printerModel: string, marginMm: number): View {
  const size = sizeById(sizeId);
  if (size) {
    const printer = printerForSize(size);
    const px = labelPixels(size, printer);
    const bandX = (size.widthMm - px.w / px.dpmm) / 2;
    const bandY = (size.heightMm - px.h / px.dpmm) / 2;
    return { size, printer, ...px, marginMm, bandX, bandY, originX: bandX + marginMm, originY: bandY + marginMm, ...contentSize({ ...px, marginMm }), isDesign: false };
  }
  const printer = printerFor(printerModel);
  const dpmm = printer.dpi / 25.4;
  const w = Math.max(8, Math.round((t.design.w + 2 * marginMm) * dpmm));
  const h = Math.max(8, Math.round((t.design.h + 2 * marginMm) * dpmm));
  const design: LabelSize = { id: "design", printer: printer.model, name: `Design size ${fmt(t.design.w)} × ${fmt(t.design.h)} mm`, widthMm: w / dpmm, heightMm: h / dpmm };
  return { size: design, printer, w, h, dpmm, marginMm, bandX: 0, bandY: 0, originX: marginMm, originY: marginMm, ...contentSize({ w, h, dpmm, marginMm }), isDesign: true };
}

export const fmt = (v: number, digits = 2) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/** Content area (box minus padding) of a laid-out frame. */
export function contentOf(it: LaidOut): Box {
  const n = it.node;
  const [pt, pr, pb, pl] = n.type === "frame" ? (n.padding ?? [0, 0, 0, 0]) : [0, 0, 0, 0];
  return { x: it.box.x + pl, y: it.box.y + pt, w: Math.max(0, it.box.w - pl - pr), h: Math.max(0, it.box.h - pt - pb) };
}

/**
 * Inverse of the layout engine's free-layout constraint: the design-space
 * position/size that yields actual position `x` and size `w` (relative to the
 * parent's content box). D = parent design size, P = parent actual size.
 */
export function toDesign(a: Anchor, x: number, w: number, D: number, P: number): [number, number] {
  switch (a) {
    case "start":
      return [x, w];
    case "end":
      return [x - P + D, w];
    case "center":
      return [x - (P - D) / 2, w];
    case "stretch":
      return [x, Math.max(0, w - P + D)];
    case "scale": {
      const k = D ? P / D : 1;
      return [x / k, w / k];
    }
  }
}

/** Latest layout shown on the canvas (written by the canvas, read by editing operations). */
export interface Geo {
  view: View;
  /** Layout at the shown size. */
  actual: LayoutResult;
  /** Layout at the template's design size (free-layout positions live here). */
  design: LayoutResult;
}

let current: Geo | null = null;
export const setGeo = (g: Geo) => {
  current = g;
};
export const getGeo = () => current;

/** Snap a content-space coordinate to the printer's dot grid. */
export function snapToDot(v: number, view: View) {
  const off = view.marginMm * view.dpmm;
  return (Math.round(off + v * view.dpmm) - off) / view.dpmm;
}

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
