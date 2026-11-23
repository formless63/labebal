"use client";
import { useLayoutEffect, useRef } from "react";
import {
  materialById,
  ribbonById,
  cornerRadiusMm,
  inkCoverage,
  labelPixels,
  preloadAssets,
  renderLabel,
  type Label,
  type LabelSize,
  type PrinterProfile,
  type Template,
} from "@labebal/core";
import { cn } from "../../lib/utils";
import { bandBox, crispScale, paintDots, useDevicePixelRatio, usesPixelated } from "./dots";
import { useFontsReady } from "./printer";

export interface LabelPreviewProps {
  template: Template;
  label?: Pick<Label, "values" | "overrides">;
  invert: boolean;
  size: LabelSize;
  printer: PrinterProfile;
  material: string;
  ribbon: string;
  marginMm: number;
  /** On-screen pixels per mm (may be snapped down a little, see `snap`). */
  scale?: number;
  /**
   * Snap the scale down to a whole number of device pixels per printer dot
   * when that keeps at least this fraction of the size (default 0.9; fitted
   * previews can afford less). Otherwise the dots are resampled smoothly.
   */
  snap?: number;
  /** Outline the printable band. */
  guides?: boolean;
  onCoverage?: (fraction: number) => void;
  className?: string;
}

/**
 * Shows exactly the dots that will print, on the chosen label stock and ribbon
 * colour, at physical proportions (printable band centred on the label).
 */
export function LabelPreview({ template, label, invert, size, printer, material, ribbon, marginMm, scale: scaleIn = 8, snap = 0.9, guides, onCoverage, className }: LabelPreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fontsReady = useFontsReady();
  const dpr = useDevicePixelRatio();
  const mat = materialById(material);
  const rib = ribbonById(ribbon);
  const px = labelPixels(size, printer);
  const scale = crispScale(scaleIn, px.dpmm, dpr, snap);
  const band = bandBox(px.w, px.h, px.dpmm, (size.widthMm - px.w / px.dpmm) / 2, (size.heightMm - px.h / px.dpmm) / 2, scale, dpr);

  // Layout effect: the bitmap for a new size / scale is in place before the browser paints.
  useLayoutEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (cancelled || !ref.current) return;
      const { canvas } = renderLabel(template, label, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm, labelMm: { w: size.widthMm, h: size.heightMm }, invert });
      onCoverage?.(inkCoverage(canvas));
      paintDots(canvas, ref.current, band.devW, band.devH, rib.rgb);
    };
    draw();
    // Images / icons load asynchronously; redraw once they're cached.
    void preloadAssets(template, label ? [label] : []).then(draw);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, label, invert, px.w, px.h, px.dpmm, size.widthMm, size.heightMm, marginMm, rib, fontsReady, band.devW, band.devH]);

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-[3px] shadow-sm ring-1 ring-border", className)}
      style={{ width: size.widthMm * scale, height: size.heightMm * scale, background: mat.css, borderRadius: cornerRadiusMm(size) * scale }}
      title={`${size.name} on ${mat.name}, ${rib.name} ribbon`}
    >
      <canvas
        ref={ref}
        className={cn("absolute", guides && "outline-1 outline-dashed outline-pink-500/60")}
        style={{
          left: band.left,
          top: band.top,
          width: band.width,
          height: band.height,
          imageRendering: usesPixelated(px.w, px.h, band.devW, band.devH) ? "pixelated" : "auto",
        }}
      />
    </div>
  );
}
