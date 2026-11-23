/**
 * Print one calibration test pattern from the desktop (no browser), through
 * the PowerShell bridge, using the same renderer and print task as the app.
 *
 *   pnpm --filter @labebal/core exec tsx scripts/print-test.ts --com COM7 --size m2-50x30 [--density 3] [--down 6] [--png out.png]
 *
 * --down N moves the print N dots further along the feed (blank rows are added
 * at the leading edge, so nothing at the far edge is cut).
 *
 * --png only renders the pattern to a file (nothing is printed).
 */
import { writeFileSync } from "node:fs";
import { createCanvas as napiCanvas } from "@napi-rs/canvas";
import { ImageEncoder, LabelType, PageColorType } from "@mmote/niimbluelib";
import { labelPixels, printerFor, renderTestPattern, setCanvasFactory, sizeById } from "../src";
import { BridgeClient } from "./printer-probe";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sizeId = arg("size") ?? "m2-50x30";
const size = sizeById(sizeId);
if (!size) throw new Error(`unknown size ${sizeId}`);
const printer = printerFor(size.printer);
const density = Number(arg("density") ?? printer.densityDefault);
const down = Math.trunc(Number(arg("down") ?? 0));

setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
const px = labelPixels(size, printer);
const pattern = renderTestPattern({ w: px.w, h: px.h, dpmm: px.dpmm, caption: `${printer.model.replace("_H", "")} D${density} +0/${down >= 0 ? "+" : ""}${down}` });
// Shift along the feed by growing the image at the leading edge (M2 feeds top first).
const canvas = down > 0 ? napiCanvas(px.w, px.h + down) as unknown as HTMLCanvasElement : pattern;
if (down > 0) {
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, px.w, px.h + down);
  c.drawImage(pattern as unknown as CanvasImageSource, 0, down);
}
console.error(`pattern ${px.w}x${px.h} dots for ${size.name} on ${printer.name}, darkness ${density}`);

const png = arg("png");
if (png) {
  writeFileSync(png, (canvas as unknown as { toBuffer(t: string): Buffer }).toBuffer("image/png"));
  console.error(`wrote ${png}`);
  process.exit(0);
}

const com = arg("com");
if (!com) throw new Error("--com COMx required (or --png to only render)");
const client = new BridgeClient(["-Com", com], (s) => console.error(`  [bridge] ${s}`));
client.setHeartbeatAutoStart(false);
try {
  await client.connect();
  const meta = client.getModelMetadata();
  if (meta?.model !== printer.model) throw new Error(`connected printer is ${meta?.model}, expected ${printer.model}`);
  const task = client.protocol.newPrintTask(client.getPrintTaskType() ?? "B1", {
    totalPages: 1,
    density,
    labelType: LabelType.WithGaps,
    statusPollIntervalMs: 100,
    statusTimeoutMs: 15_000,
  });
  const encoded = ImageEncoder.encodeCanvas(canvas, PageColorType.SingleColor, printer.direction);
  await task.printInit();
  await task.printPage(encoded, 1);
  await task.waitForPageFinished();
  await task.waitForFinished();
  await task.printEnd();
  console.error("printed 1 label");
  const rfid = await client.fetchRfidInfo().catch(() => null);
  if (rfid?.labelRfidInfo?.tagPresent) console.error(`roll now ${rfid.labelRfidInfo.usedPaper}/${rfid.labelRfidInfo.allPaper} used; ribbon ${rfid.ribbonRfidInfo?.usedPaper}/${rfid.ribbonRfidInfo?.allPaper}`);
} catch (e) {
  console.error("print failed:", e);
  process.exitCode = 1;
} finally {
  await client.disconnect();
  setTimeout(() => process.exit(), 2000);
}
