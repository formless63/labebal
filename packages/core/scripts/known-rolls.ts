/**
 * Regenerate src/known-rolls.ts: RFID roll barcodes -> size / material for the
 * N1 / B18, from the niimbench label catalogue (github.com/ywy50/niimbench,
 * docs/labels/catalogue.json: Niimbot's own cloud label listing, one roll per
 * line, with every barcode the roll's tag may carry).
 *
 *   pnpm --filter @labebal/core exec tsx scripts/known-rolls.ts <catalogue.json | --fetch> [--report]
 *
 * Only rolls whose name states a size we have (n1-<across>x<length>) are kept;
 * the material only when the name states a plain colour we know. Rolls with
 * printed designs, cable / heat-shrink tubes and unknown sizes are left out
 * (matchRoll then falls back to the label length / user's choice).
 * The catalogue data is Niimbot's (no data licence): the table only keeps the
 * barcode -> size / colour facts needed to pick the right size.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SIZES } from "../src/media";

const URL_RAW = "https://raw.githubusercontent.com/ywy50/niimbench/main/docs/labels/catalogue.json";

interface Row {
  barcode: string;
  name: string;
  width_mm: number;
  height_mm: number;
  paper_type: number;
  machines?: string[];
  codes?: string[];
}

/** Colour words in Niimbot roll names (English and Chinese) -> material id. */
const COLOURS: [RegExp, string][] = [
  [/^(laser\s*gold|金色镭射|镭射金)$/i, "laser-gold"],
  [/^(laser\s*silver|lasrslvr|silver\s*laser|sliver\s*laser|银色镭射|镭射银)$/i, "laser-silver"],
  [/^(gold|金色)$/i, "gold"],
  [/^(silver|银色)$/i, "silver"],
  [/^(matte\s*silver|哑银)$/i, "matte-silver"],
  [/^(kraft|牛皮纸)$/i, "kraft"],
  [/^(white|白色?)$/i, "white"],
  [/^(yellow|黄色)$/i, "yellow"],
  [/^(red|红色)$/i, "red"],
  [/^(green|绿色)$/i, "green"],
  [/^(blue|蓝色)$/i, "blue"],
  [/^(pink|粉色|粉红色)$/i, "pink"],
  [/^(orange|橙色)$/i, "orange"],
  [/^(purple|紫色)$/i, "purple"],
  [/^(black|黑色)$/i, "black"],
  [/^(clear|transparent|透明|高透)$/i, "transparent"],
];

/**
 * "EW14*30-190White" -> across 14, length 30, colour "White". Prefix letters:
 * T / EW / EL / ET (white, laser, transparent...). Returns null for anything
 * else (tubes "φ3-...", designs without the size pattern).
 */
export function parseRollName(name: string) {
  const m = /^([A-Z]{1,3})(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?)-(\d+)\s*(.*)$/.exec(name.trim());
  if (!m) return null;
  const [, prefix, a, b, count, rest] = m;
  const colour = rest
    .replace(/[()（）]/g, " ")
    .replace(/\bRND\b|\bround\b|圆角/gi, "")
    .trim();
  return { prefix, across: Math.min(+a, +b), length: Math.max(+a, +b), count: +count, colour };
}

export function materialFor(prefix: string, colour: string): string | undefined {
  for (const [re, id] of COLOURS) if (re.test(colour)) return id;
  if (!colour && prefix === "ET") return "transparent";
  return undefined;
}

export function buildTable(rows: Row[]) {
  const sizeIds = new Set(SIZES.filter((s) => s.printer === "N1").map((s) => s.id));
  const table = new Map<string, { sizeId: string; materialId?: string; name: string }>();
  const skipped: string[] = [];
  const isN1 = (r: Row) => !!r.machines?.some((m) => m === "N1" || m === "B18" || m === "B18S");
  // Codes also listed for other printers' rolls (e.g. an M2 roll) could pick the wrong size: left out.
  const elsewhere = new Set(rows.filter((r) => !isN1(r)).flatMap((r) => [r.barcode, ...(r.codes ?? [])]));
  for (const r of rows) {
    if (!isN1(r)) continue;
    const p = parseRollName(r.name);
    const sizeId = p && `n1-${p.across}x${p.length}`;
    // The listed size must agree with the name (guards against odd names).
    if (!p || !sizeId || !sizeIds.has(sizeId) || Math.min(r.width_mm, r.height_mm) !== p.across || Math.max(r.width_mm, r.height_mm) !== p.length) {
      skipped.push(r.name);
      continue;
    }
    const materialId = materialFor(p.prefix, p.colour);
    // Design / pattern rolls: the colour text is a design name, keep the size only.
    const entry = { sizeId, ...(materialId ? { materialId } : {}), name: r.name };
    for (const code of [r.barcode, ...(r.codes ?? [])]) {
      if (!/^[\w.-]{1,64}$/.test(code) || elsewhere.has(code)) continue;
      const prev = table.get(code);
      // A code listed for two different rolls is ambiguous: drop it.
      if (prev && (prev.sizeId !== entry.sizeId || prev.materialId !== entry.materialId)) table.set(code, { sizeId: "", name: "" });
      else if (!prev) table.set(code, entry);
    }
  }
  for (const [k, v] of table) if (!v.sizeId) table.delete(k);
  return { table, skipped };
}

export function parseCatalogue(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim().replace(/,$/, "");
    if (!l.startsWith("{")) continue;
    try {
      rows.push(JSON.parse(l) as Row);
    } catch {
      // Not one roll per line: fall through to whole-file parsing below.
    }
  }
  return rows.length ? rows : (JSON.parse(text) as Row[]);
}

function render(table: Map<string, { sizeId: string; materialId?: string; name: string }>) {
  // Group codes by (size, material) to keep the file small.
  const groups = new Map<string, string[]>();
  for (const [code, v] of [...table].sort(([a], [b]) => a.localeCompare(b))) {
    const k = JSON.stringify([v.sizeId, v.materialId ?? ""]);
    groups.set(k, [...(groups.get(k) ?? []), code]);
  }
  const lines = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, codes]) => {
      const [sizeId, materialId] = JSON.parse(k) as [string, string];
      return `  [${JSON.stringify(sizeId)}, ${materialId ? JSON.stringify(materialId) : "undefined"}, ${JSON.stringify(codes.join(" "))}],`;
    });
  return `/**
 * GENERATED by scripts/known-rolls.ts — do not edit by hand.
 *
 * Niimbot N1 / B18 roll barcodes (as reported by the roll's RFID tag) -> size
 * and, where the roll name states a plain colour, material. Source: the
 * niimbench label catalogue (https://github.com/ywy50/niimbench,
 * docs/labels/catalogue.json), itself a listing of Niimbot's cloud label
 * database; each roll lists every barcode its tag may carry. Generated
 * ${new Date().toISOString().slice(0, 10)}: ${table.size} barcodes.
 */
export const CATALOGUE_ROLL_GROUPS: [sizeId: string, materialId: string | undefined, barcodes: string][] = [
${lines.join("\n")}
];
`;
}

async function main() {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith("--"));
  const text = args.includes("--fetch") ? await (await fetch(URL_RAW)).text() : src ? readFileSync(src, "utf8") : null;
  if (!text) throw new Error("usage: known-rolls.ts <catalogue.json> | --fetch [--report]");
  const { table, skipped } = buildTable(parseCatalogue(text));
  if (args.includes("--report")) {
    const names = new Map<string, number>();
    for (const v of table.values()) names.set(`${v.sizeId} ${v.materialId ?? "-"} ${v.name}`, (names.get(`${v.sizeId} ${v.materialId ?? "-"} ${v.name}`) ?? 0) + 1);
    for (const [n, c] of [...names].sort()) console.log(c, n);
    console.log(`skipped ${skipped.length} N1/B18 rolls (no matching size)`);
  }
  const out = fileURLToPath(new URL("../src/known-rolls.ts", import.meta.url));
  writeFileSync(out, render(table));
  console.log(`wrote ${table.size} barcodes to ${out}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/known-rolls.ts")) void main();
