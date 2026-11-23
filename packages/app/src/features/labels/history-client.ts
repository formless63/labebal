"use client";
/**
 * Records each print job to /api/history (called by print.ts). Each item keeps
 * a snapshot: the resolved field values and a small 1-bit PNG of what was
 * printed (the server stamps the template version), so it can be reprinted
 * exactly from History.
 */
import { bitmapThumb, canvasBitmap, labelPixels, renderLabel, resolveLabel, type Label, type Library } from "@labebal/core";
import { getWho } from "../history/who";
import { sendHistory } from "../pwa/history-queue";
import { isInverted } from "./context";
import type { PrintContext, PrintOptions } from "./print";

/** "Chrome 142 on Windows" from the user agent (no full UA string stored). */
export function clientSummary(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browsers: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Version\/(\d+).*Safari\//, "Safari"],
  ];
  let browser = "Browser";
  for (const [re, name] of browsers) {
    const m = re.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Thumbnails rendered per job (big dataset jobs keep values only after this). */
const THUMBS = 60;

/** Header sent with saves so versions / voids record who did it. */
export const whoHeader = (): Record<string, string> => {
  const w = getWho();
  return w ? { "x-labebal-who": encodeURIComponent(w) } : {};
};

export async function recordHistory(lib: Library, items: { label: Label; qty: number }[], ctx: PrintContext, opts: PrintOptions): Promise<void> {
  if (!items.length) return;
  const px = labelPixels(ctx.size, ctx.printer);
  const snapshot = await Promise.all(
    items.map(async ({ label, qty }, n) => {
      const t = lib.templates.find((x) => x.id === label.templateId);
      const invert = isInverted(label, t, ctx.settings.invertAll);
      let thumb: string | undefined;
      if (t && n < THUMBS) {
        try {
          const { canvas } = renderLabel(t, label, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: ctx.settings.marginMm, labelMm: { w: ctx.size.widthMm, h: ctx.size.heightMm }, invert, context: { seq: opts.seqStart ?? 1, copy: 1, copies: qty } });
          thumb = await bitmapThumb(canvasBitmap(canvas));
        } catch (e) {
          console.warn("history thumbnail failed", e);
        }
      }
      const resolved = t ? resolveLabel(t, label) : label;
      return {
        labelId: label.id,
        name: label.name,
        templateId: label.templateId,
        templateName: t?.name,
        qty,
        invert,
        values: { ...Object.fromEntries((t?.fields ?? []).map((f) => [f.key, f.default ?? ""])), ...resolved?.values },
        ...(label.overrides ? { overrides: label.overrides } : {}),
        ...(thumb ? { thumb } : {}),
      };
    }),
  );
  const body = {
    source: opts.source ?? "queue",
    printer: ctx.printer.name,
    sizeId: ctx.size.id,
    sizeName: ctx.size.name,
    material: ctx.settings.material,
    ribbon: ctx.settings.ribbon,
    density: ctx.settings.density,
    invertAll: ctx.settings.invertAll,
    client: clientSummary(),
    who: getWho(),
    // reserved counter numbers + print-time form answers.
    ...(opts.counters?.length ? { counters: opts.counters } : {}),
    ...(opts.printValues && Object.keys(opts.printValues).length ? { printValues: opts.printValues } : {}),
    // how the run ended (status, printed, total, nextLabel, printer, label type); items carry the printed counts.
    outcome: opts.outcome,
    // per-item snapshot (resolved values, overrides, 1-bit thumbnail).
    items: snapshot,
  };
  // Queued in this browser when offline, sent when the connection is back (PWA).
  await sendHistory(body);
}
