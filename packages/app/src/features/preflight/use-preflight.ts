"use client";
/**
 * Preflight hooks: run core `preflight()` for a label at a stock size, after
 * fonts and assets are loaded. Results are cached per template object + label
 * + options, so the queue badge and the label editor share one render.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  createCanvas,
  labelPixels,
  preflight,
  preloadAssets,
  renderLabel,
  type Label,
  type LabelSize,
  type PreflightIssue,
  type PrinterProfile,
  type Template,
} from "@labebal/core";
import { isInverted, usePrintContext } from "../labels/context";
import { useFontsReady } from "../labels/printer";

export interface PreflightTarget {
  template: Template;
  label?: Pick<Label, "values" | "overrides">;
  invert: boolean;
  size: LabelSize;
  printer: PrinterProfile;
  marginMm: number;
  /** Render size in dots instead of the stock's (editor design size, which is not a real roll; no stock edge checks then). */
  pixels?: { w: number; h: number; dpmm: number };
}

const cache = new WeakMap<Template, Map<string, PreflightIssue[]>>();
let scratch: HTMLCanvasElement | null = null;

const keyOf = (p: PreflightTarget) => JSON.stringify([p.label?.values ?? null, p.label?.overrides ?? null, p.invert, p.size.id, p.size.widthMm, p.size.heightMm, p.printer.model, p.marginMm, p.pixels ? [p.pixels.w, p.pixels.h, p.pixels.dpmm] : null]);

/** Synchronous check (assets must already be loaded). */
export function checkLabel(p: PreflightTarget): PreflightIssue[] {
  const key = keyOf(p);
  let m = cache.get(p.template);
  const hit = m?.get(key);
  if (hit) return hit;
  const px = p.pixels ? { w: p.pixels.w, h: p.pixels.h, dpmm: p.pixels.dpmm } : labelPixels(p.size, p.printer);
  const o = { ...px, marginMm: p.marginMm, invert: p.invert, labelMm: p.pixels ? undefined : { w: p.size.widthMm, h: p.size.heightMm } };
  scratch ??= createCanvas(px.w, px.h);
  const issues = preflight(p.template, p.label, o, renderLabel(p.template, p.label, o, scratch));
  if (!m) cache.set(p.template, (m = new Map()));
  if (m.size > 200) m.clear();
  m.set(key, issues);
  return issues;
}

/**
 * Issues for a label at a size, or null while fonts / images / the barcode
 * encoder are loading. `delayMs` debounces fast edits (editor).
 */
export function usePreflight(target: PreflightTarget | null, delayMs = 0): PreflightIssue[] | null {
  const fontsReady = useFontsReady();
  const [result, setResult] = useState<{ key: string; template: Template; issues: PreflightIssue[] } | null>(null);
  const t = target?.template;
  const key = target ? keyOf(target) : "";

  useEffect(() => {
    if (!target || !fontsReady) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void preloadAssets(target.template, target.label ? [target.label] : []).then(() => {
        if (!cancelled) setResult({ key, template: target.template, issues: checkLabel(target) });
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // target is rebuilt every render; its identity is template + key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, key, fontsReady, delayMs]);

  if (!target || !result) return null;
  // Keep showing the last result while an edit is being re-checked (no flicker).
  return result.issues;
}

/** Issues for a library label with the workspace's print settings (printer, size, margin, invert all). */
export function useLabelPreflight(template: Template | undefined, label: Label | undefined): PreflightIssue[] | null {
  const { settings, printer, size } = usePrintContext();
  return usePreflight(
    template && label ? { template, label, invert: isInverted(label, template, settings.invertAll), size, printer, marginMm: settings.marginMm } : null,
  );
}

/** Latest editor preflight result, shared between the panel and the layer badges. */
export const useEditorPreflight = create<{ issues: PreflightIssue[]; set: (issues: PreflightIssue[]) => void }>()((set) => ({
  issues: [],
  set: (issues) => set({ issues }),
}));
