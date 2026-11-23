"use client";
import { useEffect, useRef } from "react";
import { preloadAssets, renderLabel, type IconNode, type Template } from "@labebal/core";
import { cn } from "../../lib/utils";

/**
 * Renders an icon through the label renderer (1-bit, so it shows exactly what
 * prints). `px` is the render resolution, `size` the CSS size.
 */
export function IconThumb({ id, filled, size, px = 48, className }: { id: string; filled?: boolean; size: number; px?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (!id) {
      c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
      return;
    }
    const node: IconNode = { id: "i", type: "icon", icon: id, filled, color: "black", w: { kind: "fill" }, h: { kind: "fill" } };
    const mm = px / 8;
    const t: Template = { id: "thumb", name: "", schema: 2, design: { w: mm, h: mm }, fields: [], root: { id: "r", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [node] } };
    let cancelled = false;
    const draw = () => {
      if (cancelled || !ref.current) return;
      renderLabel(t, undefined, { w: px, h: px, dpmm: 8, marginMm: 0, invert: false }, ref.current);
    };
    // Draw once loaded (an immediate draw would flash the "missing" placeholder).
    void preloadAssets(t).then(draw);
    return () => {
      cancelled = true;
    };
  }, [id, filled, px]);
  return <canvas ref={ref} aria-hidden className={cn("shrink-0 bg-white", className)} style={{ width: size, height: size }} />;
}
