"use client";
/**
 * Printer calibration (print pipeline stage 3) and darkness presets.
 *
 * - Offsets: per printer model, in dots, positive = move the print right / down
 *   (reading orientation). The rendered canvas is shifted, never scaled. If a
 *   shift would push printed dots off the label, the user is told (toast) which
 *   label and how many dots; nothing is cropped silently.
 * - Darkness: each stock has a preset (catalogue default, or the user's own
 *   value from Settings). Picking a stock applies it; the toolbar slider still
 *   overrides it for the session.
 */
import { createCanvas, feedOf, materialDensity, printerFor, type PrintJob } from "@labebal/core";
import { toast } from "sonner";
import type { PrintContext } from "./print";

export interface Offset {
  x: number;
  y: number;
}

/** Calibration fields stored with the print settings (all optional: older saved settings lack them). */
export interface CalibrationSettings {
  /** Per printer model, dots. */
  offsets?: Record<string, Offset>;
  /** User darkness per `${printer}:${material}`. */
  densityPresets?: Record<string, number>;
  /** Roll barcode -> size/material the user confirmed for it. */
  learnedRolls?: Record<string, { sizeId: string; materialId?: string }>;
}

export const offsetFor = (s: CalibrationSettings, model: string): Offset => s.offsets?.[model] ?? { x: 0, y: 0 };

/** Darkness for a printer + stock: user preset, else catalogue default. */
export function presetDensity(s: CalibrationSettings, model: string, material: string) {
  const user = s.densityPresets?.[`${model}:${material}`];
  return user ?? materialDensity(printerFor(model), material);
}

/** Count dots that fall off the canvas when shifted by (dx, dy). */
export function lostDots(canvas: HTMLCanvasElement, dx: number, dy: number) {
  if (!dx && !dy) return 0;
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
  let lost = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = x + dx, ny = y + dy;
      if ((nx < 0 || ny < 0 || nx >= w || ny >= h) && d[(y * w + x) * 4] === 0) lost++;
    }
  return lost;
}

/** Shift a 1-bit canvas by whole dots; uncovered area stays white (no dot). */
export function shiftCanvas(src: HTMLCanvasElement, dx: number, dy: number) {
  const out = createCanvas(src.width, src.height);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, Math.round(dx), Math.round(dy));
  return out;
}

/**
 * Split an offset into the part along the feed and the part across the head.
 * The printer prints whatever image height it gets along the feed, so moving the
 * print away from the leading edge grows the image there (nothing is cut);
 * across the head the image width is fixed, so that part shifts.
 * Leading edge: canvas top for "top" printers (M2), canvas left for "left"
 * printers (N1, whose image is rotated 90 degrees by the encoder).
 */
export function feedPadding(direction: "left" | "top", x: number, y: number) {
  const along = direction === "top" ? y : x;
  const pad = Math.max(0, Math.round(along));
  return direction === "top" ? { padTop: pad, padLeft: 0, dx: x, dy: y - pad } : { padTop: 0, padLeft: pad, dx: x - pad, dy: y };
}

/** Add blank dots at the top / left (the leading edge along the feed). */
export function padCanvas(src: HTMLCanvasElement, padLeft: number, padTop: number) {
  if (!padLeft && !padTop) return src;
  const out = createCanvas(src.width + padLeft, src.height + padTop);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, padLeft, padTop);
  return out;
}

export function applyCalibration(jobs: PrintJob[], ctx: PrintContext): PrintJob[] {
  const { x, y } = offsetFor(ctx.settings, ctx.printer.model);
  if (!x && !y) return jobs;
  const { padTop, padLeft, dx, dy } = feedPadding(feedOf(ctx.size), x, y);
  const cut: string[] = [];
  const out = jobs.map((j) => {
    const lost = lostDots(j.canvas, dx, dy);
    if (lost) cut.push(`${j.name} (${lost} dots)`);
    const shifted = dx || dy ? shiftCanvas(j.canvas, dx, dy) : j.canvas;
    return { ...j, canvas: padCanvas(shifted, padLeft, padTop) };
  });
  if (cut.length)
    toast.warning("The printer offset pushes part of the design off the label", {
      description: `${cut.slice(0, 3).join(", ")}${cut.length > 3 ? ` and ${cut.length - 3} more` : ""}. Increase the margin or reduce the offset in Settings.`,
      duration: 10_000,
    });
  return out;
}
