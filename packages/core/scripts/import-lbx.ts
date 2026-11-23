/**
 * Import a folder of P-touch .lbx files into a library JSON (v2 templates + labels).
 *
 *   pnpm --filter @labebal/core import-lbx "<folder>" out.json [Obj=field,...] [Template name]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { mergeParsed, parseLabelXml, readLbx } from "../src/lbx";

const [dir, out, fieldArg, ...nameParts] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: import-lbx "<folder>" <out.json> [Obj=field,...] [Template name]');
  process.exit(1);
}
const fieldNames = Object.fromEntries(
  (fieldArg ?? "").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
);
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".lbx")).sort();
const parsed = [];
for (const f of files) parsed.push(parseLabelXml(f, await readLbx(readFileSync(join(dir, f))), DOMParser as never));
const res = mergeParsed(parsed, { fieldNames, templateNames: nameParts.length ? [nameParts.join(" ")] : undefined });
writeFileSync(out, JSON.stringify({ version: 2, templates: res.templates, labels: res.labels }, null, 2) + "\n");
console.log(`${files.length} files -> ${res.templates.length} template(s), ${res.labels.length} labels`);
for (const w of new Set(res.warnings)) console.log("  warn:", w);
