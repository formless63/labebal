/**
 * Pack authoring CLI.
 *
 *   pnpm packs check <dir|manifest|collection|bundle>   validate + render every template and label headlessly
 *   pnpm packs bundle <dir> [-o out.json]                one self-contained JSON (collection -> all its packs)
 *   pnpm packs new <dir> [--id my-pack] [--name "My pack"]  scaffold a pack
 *   pnpm packs schema [outDir]                           write the JSON Schemas (default packs/schema)
 *
 * Paths are relative to where you ran the command (INIT_CWD under pnpm).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import {
  BUILTIN_FONTS,
  PACK_COLLECTION,
  PACK_MANIFEST,
  PACK_SCHEMA_BASE,
  PRINTERS,
  SIZES,
  checkPack,
  labelPixels,
  listPackEntries,
  loadPack,
  makeCollectionBundle,
  makePackBundle,
  packJsonSchemas,
  preflight,
  registerFont,
  renderLabel,
  setCanvasFactory,
  type PackIssue,
  type PackReader,
  type ResolvedPack,
  type Template,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const cwd = process.env.INIT_CWD ?? process.cwd();

const fsReader: PackReader = {
  text: async (u) => readFileSync(new URL(u), "utf8"),
  bytes: async (u) => new Uint8Array(readFileSync(new URL(u))),
};

/** File URL of the manifest / collection / bundle a path names. */
function entryUrl(p: string): string {
  const abs = resolve(cwd, p);
  if (!existsSync(abs)) throw new Error(`${p}: not found`);
  if (statSync(abs).isDirectory()) {
    for (const f of [PACK_COLLECTION, PACK_MANIFEST]) if (existsSync(join(abs, f))) return pathToFileURL(join(abs, f)).href;
    throw new Error(`${p}: no ${PACK_MANIFEST} or ${PACK_COLLECTION} in this folder`);
  }
  return pathToFileURL(abs).href;
}

const show = (u: string) => relative(cwd, fileURLToPath(u.split("#")[0])) || ".";

async function loadAll(p: string) {
  const url = entryUrl(p);
  const list = await listPackEntries(url, fsReader);
  const packs: { url: string; pack: ResolvedPack }[] = [];
  for (const e of list.entries) packs.push({ url: e.url, pack: await loadPack(e.url, fsReader, { withAssets: true }, e.doc) });
  return { list, packs };
}

/* ---------------------------------------------------------- render check */

let canvasReady = false;
function setupCanvas() {
  if (canvasReady) return;
  setCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
  for (const f of BUILTIN_FONTS) GlobalFonts.registerFromPath(join(repo, "packages/app/assets", f.url), f.family);
  canvasReady = true;
}

/** Render each template at its design size and each label at its template's size; collect errors + preflight problems. */
function renderCheck(p: ResolvedPack, manifestUrl: string): PackIssue[] {
  setupCanvas();
  const issues: PackIssue[] = [];
  const base = dirname(fileURLToPath(manifestUrl.split("#")[0]));
  for (const a of p.assets.filter((x) => x.kind === "font")) {
    const family = String(a.meta.family);
    const path = typeof a.meta.path === "string" ? join(base, a.meta.path) : null;
    if (path && existsSync(path)) GlobalFonts.registerFromPath(path, family);
    else GlobalFonts.register(Buffer.from(a.data), family);
    registerFont({ family, url: `/api/assets/${a.id}`, pixel: a.meta.pixel as never });
  }
  const printer = PRINTERS.find((x) => x.model === "M2_H") ?? PRINTERS[0];
  const sizeFor = (t: Template) => {
    const near = [...SIZES].sort((a, b) => Math.abs(a.widthMm - t.design.w) + Math.abs(a.heightMm - t.design.h) - (Math.abs(b.widthMm - t.design.w) + Math.abs(b.heightMm - t.design.h)))[0];
    return near;
  };
  const one = (t: Template, label: Parameters<typeof renderLabel>[1], what: string, file?: string) => {
    const size = sizeFor(t);
    const pr = PRINTERS.find((x) => x.model === size.printer) ?? printer;
    const px = labelPixels(size, pr);
    try {
      const opts = { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: 0.5, invert: false, labelMm: { w: size.widthMm, h: size.heightMm } };
      const r = renderLabel(t, label, opts);
      for (const i of preflight(t, label ?? { values: {} }, opts, r))
        if (i.severity === "error") issues.push({ level: "warning", file, message: `${what} on ${size.name}: ${i.message}` });
    } catch (e) {
      issues.push({ level: "error", file, message: `${what}: render failed: ${(e as Error).message ?? e}` });
    }
  };
  for (const t of p.templates) one(t, undefined, `template "${t.name}"`, p.files[`template:${t.id}`]);
  for (const l of p.labels) {
    const t = p.templates.find((x) => x.id === l.templateId);
    if (t) one(t, l, `label "${l.name}"`, p.files[`label:${l.id}`]);
  }
  return issues;
}

/* --------------------------------------------------------------- commands */

async function check(target: string, opts: { render: boolean }) {
  const { packs } = await loadAll(target);
  let errors = 0;
  for (const { url, pack } of packs) {
    const issues = [...checkPack(pack), ...(opts.render ? renderCheck(pack, url) : [])];
    const m = pack.manifest;
    console.log(`\n${m.name} (${m.id}) ${m.version}  ${show(url)}`);
    console.log(`  ${pack.templates.length} templates, ${pack.labels.length} labels, ${pack.datasets.length} datasets, ${pack.assets.length} assets/fonts`);
    for (const i of issues) {
      if (i.level === "error") errors++;
      console.log(`  ${i.level === "error" ? "ERROR" : "warn "} ${i.file ? `${i.file}: ` : ""}${i.message}`);
    }
    if (!issues.length) console.log("  ok");
  }
  if (errors) {
    console.error(`\n${errors} error${errors === 1 ? "" : "s"}`);
    process.exitCode = 1;
  }
}

async function bundle(target: string, out?: string) {
  const { list, packs } = await loadAll(target);
  const doc = list.kind === "collection" ? makeCollectionBundle(list.name ?? "packs", packs.map((p) => p.pack), list.description) : makePackBundle(packs[0].pack);
  const file = resolve(cwd, out ?? `${list.kind === "collection" ? "packs" : packs[0].pack.manifest.id}.labebal-pack.json`);
  writeFileSync(file, JSON.stringify(doc));
  console.log(`wrote ${relative(cwd, file)} (${Math.round(statSync(file).size / 1024)} kB, ${packs.length} pack${packs.length === 1 ? "" : "s"})`);
}

function scaffold(dir: string, id?: string, name?: string) {
  const abs = resolve(cwd, dir);
  if (existsSync(join(abs, PACK_MANIFEST))) throw new Error(`${dir}/${PACK_MANIFEST} already exists`);
  const packId = id ?? (abs.split(/[\\/]/).pop() ?? "my-pack").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const tplId = `t-${packId}-name`;
  const files: Record<string, string> = {
    [PACK_MANIFEST]: JSON.stringify(
      {
        $schema: `${PACK_SCHEMA_BASE}labebal-pack.schema.json`,
        id: packId,
        name: name ?? packId,
        version: "0.1.0",
        description: "",
        author: "",
        folder: name ?? packId,
        templates: ["templates/name-tag.json"],
        labels: ["labels/name-tags.csv"],
      },
      null,
      2,
    ),
    "templates/name-tag.json": JSON.stringify(
      {
        $schema: `${PACK_SCHEMA_BASE}template.schema.json`,
        id: tplId,
        name: "Name tag",
        schema: 2,
        design: { w: 40, h: 12 },
        scaleText: true,
        fields: [
          { key: "title", label: "Title", type: "text", default: "Title" },
          { key: "detail", label: "Detail", type: "text", default: "" },
        ],
        root: {
          id: "root",
          name: "Label",
          type: "frame",
          layout: "column",
          w: { kind: "fill" },
          h: { kind: "fill" },
          padding: [0.5, 1, 0.5, 1],
          align: "stretch",
          children: [
            { id: "title", name: "Title", type: "text", text: "{{title}}", font: "Arial", weight: 700, sizePt: 12, fit: "shrink", align: "center", valign: "middle", color: "black", w: { kind: "fill" }, h: { kind: "fill", weight: 2 } },
            { id: "detail", name: "Detail", type: "text", text: "{{detail}}", font: "Arial", sizePt: 7, fit: "shrink", align: "center", valign: "middle", color: "black", w: { kind: "fill" }, h: { kind: "fill" } },
          ],
        },
      },
      null,
      2,
    ),
    "labels/name-tags.csv": `id,name,template,folder,title,detail\n,Screws,${tplId},,SCREWS,M3 / M4\n,Nuts,${tplId},Hardware,NUTS,hex + nylon\n`,
    "README.md": `# ${name ?? packId}\n\nA labebal pack. Check it with \`pnpm packs check .\` (from a labebal checkout), then commit and push.\nAdd it in labebal under Settings > Packs with \`owner/repo\` (GitHub) or the raw URL of ${PACK_MANIFEST}.\n`,
  };
  for (const [p, data] of Object.entries(files)) {
    mkdirSync(dirname(join(abs, p)), { recursive: true });
    writeFileSync(join(abs, p), data.endsWith("\n") ? data : data + "\n");
  }
  console.log(`created ${relative(cwd, abs) || "."}/ (${Object.keys(files).join(", ")})`);
}

function schemas(outDir?: string) {
  const dir = resolve(outDir ? cwd : repo, outDir ?? "packs/schema");
  mkdirSync(dir, { recursive: true });
  for (const [name, schema] of Object.entries(packJsonSchemas())) writeFileSync(join(dir, name), JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote ${Object.keys(packJsonSchemas()).length} schemas to ${relative(cwd, dir)}`);
}

const USAGE = `usage:
  packs check <dir|file> [--no-render]
  packs bundle <dir|file> [-o out.json]
  packs new <dir> [--id my-pack] [--name "My pack"]
  packs schema [outDir]`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n: string) => {
    const i = rest.indexOf(n);
    if (i < 0) return undefined;
    const v = rest[i + 1];
    rest.splice(i, 2);
    return v;
  };
  const has = (n: string) => {
    const i = rest.indexOf(n);
    if (i >= 0) rest.splice(i, 1);
    return i >= 0;
  };
  if (cmd === "check") {
    const noRender = has("--no-render");
    if (!rest[0]) throw new Error(USAGE);
    await check(rest[0], { render: !noRender });
  } else if (cmd === "bundle") {
    const out = flag("-o") ?? flag("--out");
    if (!rest[0]) throw new Error(USAGE);
    await bundle(rest[0], out);
  } else if (cmd === "new") {
    const id = flag("--id");
    const name = flag("--name");
    if (!rest[0]) throw new Error(USAGE);
    scaffold(rest[0], id, name);
  } else if (cmd === "schema") schemas(rest[0]);
  else throw new Error(USAGE);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
