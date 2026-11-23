"use client";
import { useLayoutEffect, useRef } from "react";
import { labelInvert, preloadAssets, renderLabel, type Label, type Template } from "@labebal/core";
import { cn } from "../../lib/utils";
import { useFontsReady } from "../labels/printer";
import { bandBox, crispScale, paintDots, useDevicePixelRatio, usesPixelated } from "../labels/dots";
import { makeView } from "../editor/geometry";

/**
 * Live 1-bit render of a template at a label size ("design" = its design size),
 * drawn as black dots on a white label.
 */
export function TemplateThumb({
  template,
  label,
  sizeId = "design",
  printer = "M2_H",
  marginMm = 0.5,
  scale,
  maxW,
  maxH,
  className,
  title,
}: {
  template: Template;
  label?: Pick<Label, "values" | "overrides" | "invert">;
  sizeId?: string;
  printer?: string;
  marginMm?: number;
  /** Screen px per mm (or fit into maxW × maxH). */
  scale?: number;
  maxW?: number;
  maxH?: number;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fontsReady = useFontsReady();
  const dpr = useDevicePixelRatio();
  const view = makeView(template, sizeId, printer, marginMm);
  const invert = labelInvert(template, label ?? {});
  const fitted = scale === undefined;
  // Whole device pixels per dot where possible; a fitted thumb may shrink more for it.
  const s = crispScale(scale ?? Math.min((maxW ?? 200) / view.size.widthMm, (maxH ?? 80) / view.size.heightMm), view.dpmm, dpr, fitted ? 0.7 : 0.9);
  const band = bandBox(view.w, view.h, view.dpmm, view.bandX, view.bandY, s, dpr);

  useLayoutEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (cancelled || !ref.current) return;
      const { canvas } = renderLabel(template, label, { w: view.w, h: view.h, dpmm: view.dpmm, marginMm, labelMm: { w: view.size.widthMm, h: view.size.heightMm }, invert });
      paintDots(canvas, ref.current, band.devW, band.devH);
    };
    draw();
    void preloadAssets(template, label ? [label] : []).then(draw);
    return () => {
      cancelled = true;
    };
  }, [template, label, view.w, view.h, view.dpmm, view.size.widthMm, view.size.heightMm, marginMm, invert, fontsReady, band.devW, band.devH]);

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-[2px] bg-white shadow-sm ring-1 ring-border", className)}
      style={{ width: view.size.widthMm * s, height: view.size.heightMm * s }}
      title={title ?? view.size.name}
    >
      <canvas
        ref={ref}
        className="absolute"
        style={{ left: band.left, top: band.top, width: band.width, height: band.height, imageRendering: usesPixelated(view.w, view.h, band.devW, band.devH) ? "pixelated" : "auto" }}
      />
    </div>
  );
}
