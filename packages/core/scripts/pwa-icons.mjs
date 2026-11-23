// Generates the PWA icons in apps/web/public/pwa (run from packages/core: node scripts/pwa-icons.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/pwa");
mkdirSync(out, { recursive: true });

/** A label tag with a dotted barcode on a dark tile. `safe` shrinks the art into the maskable safe zone. */
function draw(size, safe) {
  const c = createCanvas(size, size);
  const x = c.getContext("2d");
  const s = size / 512;
  x.fillStyle = "#18181b";
  if (safe) x.fillRect(0, 0, size, size);
  else {
    x.beginPath();
    x.roundRect(0, 0, size, size, 96 * s);
    x.fill();
  }
  x.save();
  const k = safe ? 0.72 : 1;
  x.translate(size / 2, size / 2);
  x.scale(k, k);
  x.translate(-size / 2, -size / 2);
  // Label body with a hole.
  x.fillStyle = "#fafafa";
  x.beginPath();
  x.roundRect(86 * s, 150 * s, 340 * s, 212 * s, 28 * s);
  x.fill();
  x.fillStyle = "#18181b";
  x.beginPath();
  x.arc(130 * s, 256 * s, 16 * s, 0, Math.PI * 2);
  x.fill();
  // Barcode bars.
  const bars = [8, 4, 12, 4, 6, 10, 4, 8, 4, 12, 6, 4, 10];
  let bx = 172 * s;
  bars.forEach((w, i) => {
    if (i % 2 === 0) x.fillRect(bx, 196 * s, w * s * 1.6, 120 * s);
    bx += w * s * 1.6 + 6 * s;
  });
  x.restore();
  return c.toBuffer("image/png");
}

for (const [name, size, safe] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  writeFileSync(resolve(out, name), draw(size, safe));
  console.log("wrote", name);
}
