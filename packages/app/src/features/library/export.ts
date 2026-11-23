"use client";
/**
 * Exports of rendered labels: a true-size proof sheet PDF (laser-print for
 * approval) and 1-bit PNGs (one file, or a zip), rendered exactly as they
 * would print at the current printer / label size / margin / invert settings.
 */
import {
  BUILTIN_FONTS,
  canvasBitmap,
  encodePng1,
  fileSafe,
  labelPixels,
  loadFonts,
  preloadAssets,
  proofSheetPdf,
  renderLabel,
  zipFiles,
  type Bitmap,
  type Label,
  type Library,
} from "@labebal/core";
import { uploadedFontsReady } from "../fonts/fonts-client";
import { isInverted } from "../labels/context";
import type { PrintContext } from "../labels/print";

export interface ExportItem {
  label: Label;
  qty?: number;
}

interface Rendered {
  label: Label;
  qty: number;
  bitmap: Bitmap;
  dpmm: number;
}

async function renderAll(lib: Library, items: ExportItem[], ctx: Pick<PrintContext, "settings" | "printer" | "size">): Promise<Rendered[]> {
  await Promise.all([loadFonts(BUILTIN_FONTS.map((f) => f.family)), uploadedFontsReady()]);
  const px = labelPixels(ctx.size, ctx.printer);
  const out: Rendered[] = [];
  for (const t of lib.templates) {
    const ls = items.filter((i) => i.label.templateId === t.id).map((i) => i.label);
    if (ls.length) await preloadAssets(t, ls);
  }
  for (const { label, qty = 1 } of items) {
    const t = lib.templates.find((x) => x.id === label.templateId);
    if (!t) continue;
    const { canvas } = renderLabel(t, label, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: ctx.settings.marginMm, labelMm: { w: ctx.size.widthMm, h: ctx.size.heightMm }, invert: isInverted(label, t, ctx.settings.invertAll), context: { seq: 1, copy: 1, copies: qty } });
    out.push({ label, qty, bitmap: canvasBitmap(canvas), dpmm: px.dpmm });
  }
  return out;
}

export function download(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Contact-sheet PDF at true size. */
export async function exportProofPdf(lib: Library, items: ExportItem[], ctx: Pick<PrintContext, "settings" | "printer" | "size">, title = "Label proof") {
  const rendered = await renderAll(lib, items, ctx);
  if (!rendered.length) throw new Error("nothing to export");
  const pdf = await proofSheetPdf(
    rendered.map((r) => ({
      name: r.label.name,
      caption: `${ctx.size.name}${r.qty > 1 ? ` · ×${r.qty}` : ""}${isInverted(r.label, lib.templates.find((t) => t.id === r.label.templateId), ctx.settings.invertAll) ? " · inverted" : ""}`,
      widthMm: ctx.size.widthMm,
      heightMm: ctx.size.heightMm,
      bitmap: r.bitmap,
      dpmm: r.dpmm,
    })),
    { title, subtitle: `${stamp()} · ${ctx.printer.name} · ${rendered.length} label${rendered.length === 1 ? "" : "s"}` },
  );
  download(pdf, `${fileSafe(title)}-${stamp()}.pdf`, "application/pdf");
  return rendered.length;
}

/** 1-bit PNGs at printer resolution (with true-size DPI): one PNG, or a zip for several. */
export async function exportPngs(lib: Library, items: ExportItem[], ctx: Pick<PrintContext, "settings" | "printer" | "size">, zipName = "labels") {
  const rendered = await renderAll(lib, items, ctx);
  if (!rendered.length) throw new Error("nothing to export");
  const files = await Promise.all(rendered.map(async (r) => ({ name: `${fileSafe(r.label.name)}.png`, data: await encodePng1(r.bitmap, r.dpmm) })));
  if (files.length === 1) download(files[0].data, files[0].name, "image/png");
  else download(await zipFiles(files), `${fileSafe(zipName)}-${stamp()}.zip`, "application/zip");
  return files.length;
}
