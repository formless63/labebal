// Inspect a font: family + pixel grid. Usage: pnpm --filter @labebal/core exec tsx scripts/font-grid.ts font.ttf
import { readFileSync } from "node:fs";
import { inspectFont } from "../src/fontgrid";

for (const file of process.argv.slice(2)) {
  const info = inspectFont(readFileSync(file));
  console.log(file, JSON.stringify(info));
}
