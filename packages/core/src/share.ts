/**
 * Share one template as a file: `<name>.labebal.json` holding the template, its
 * labels (optional) and the uploaded assets it uses (images, custom icons,
 * fonts) as base64. Import also accepts a zip with `template.json` +
 * `assets/<id>` files. Framework-free.
 */
import JSZip from "jszip";
import type { Label, LabelComponent, Template, TextStyle } from "./schema";
import { fromBase64, toBase64 } from "./png";

export const SHARE_FORMAT = "labebal.template";
export const SHARE_VERSION = 1;

export interface SharedAsset {
  id: string;
  name: string;
  kind: "image" | "font" | "icon";
  mime: string;
  meta: Record<string, unknown>;
  /** File bytes. */
  data: Uint8Array;
}

export interface TemplateBundle {
  format: typeof SHARE_FORMAT;
  version: number;
  exportedAt: string;
  template: Template;
  labels: Label[];
  assets: SharedAsset[];
  /** Library text styles and components the template uses (components transitively). */
  styles?: TextStyle[];
  components?: LabelComponent[];
}

const ASSET_URL = /\/api\/assets\/([\w-]+)/g;
const CUSTOM_ICON = /custom:([\w-]+)/g;
const FONT = /"font":"((?:[^"\\]|\\.)*)"/g;

/** Uploaded assets (ids) and font families a template (and its labels) use, anywhere: nodes, variants, rules, overrides, values. */
export function templateAssetRefs(t: Template, labels: Label[] = [], parts: { styles?: TextStyle[]; components?: LabelComponent[] } = {}): { assetIds: string[]; fonts: string[] } {
  const json = JSON.stringify([t, labels, parts]);
  const ids = new Set<string>();
  for (const m of json.matchAll(ASSET_URL)) ids.add(m[1]);
  for (const m of json.matchAll(CUSTOM_ICON)) ids.add(m[1]);
  const fonts = new Set<string>();
  for (const m of json.matchAll(FONT)) fonts.add(JSON.parse(`"${m[1]}"`));
  return { assetIds: [...ids], fonts: [...fonts] };
}

export function makeBundle(template: Template, labels: Label[], assets: SharedAsset[], parts: { styles?: TextStyle[]; components?: LabelComponent[] } = {}): TemplateBundle {
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: new Date().toISOString(),
    template,
    labels,
    assets,
    ...(parts.styles?.length ? { styles: parts.styles } : {}),
    ...(parts.components?.length ? { components: parts.components } : {}),
  };
}

/** JSON text of a bundle (assets base64-encoded). */
export function bundleToJson(b: TemplateBundle): string {
  return JSON.stringify({ ...b, assets: b.assets.map((a) => ({ ...a, data: toBase64(a.data) })) });
}

/** `drawer-bin.labebal.json` */
export const bundleFileName = (t: Pick<Template, "name">) => `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template"}.labebal.json`;

function check(o: unknown): Omit<TemplateBundle, "assets"> & { assets: unknown[] } {
  const b = o as Partial<TemplateBundle> | null;
  if (!b || b.format !== SHARE_FORMAT) throw new Error("not a labebal template file");
  if ((b.version ?? 0) > SHARE_VERSION) throw new Error("this template file is from a newer labebal");
  const t = b.template;
  if (!t || typeof t.id !== "string" || t.schema !== 2 || !t.root) throw new Error("template file has no valid template");
  return {
    ...(b as TemplateBundle),
    labels: Array.isArray(b.labels) ? b.labels.filter((l) => l?.templateId === t.id) : [],
    assets: Array.isArray(b.assets) ? b.assets : [],
    styles: Array.isArray(b.styles) ? b.styles.filter((s) => typeof s?.id === "string" && typeof s.name === "string") : undefined,
    components: Array.isArray(b.components) ? b.components.filter((c) => typeof c?.id === "string" && c.root?.type === "frame" && !!c.design) : undefined,
  };
}

const asAsset = (a: Record<string, unknown>, data: Uint8Array): SharedAsset => {
  const kind = a.kind === "font" || a.kind === "icon" ? a.kind : "image";
  return { id: String(a.id), name: String(a.name ?? a.id), kind, mime: String(a.mime ?? "application/octet-stream"), meta: (a.meta as Record<string, unknown>) ?? {}, data };
};

/** Parse a `.labebal.json` (text or bytes) or a zip (`template.json` + `assets/<id>`). */
export async function parseBundle(input: string | Uint8Array | ArrayBuffer): Promise<TemplateBundle> {
  const bytes = typeof input === "string" ? null : input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes);
    const main = zip.file("template.json") ?? zip.file(/\.labebal\.json$/)[0];
    if (!main) throw new Error("zip has no template.json");
    const b = check(JSON.parse(await main.async("string")));
    const assets: SharedAsset[] = [];
    for (const raw of b.assets as Record<string, unknown>[]) {
      if (typeof raw.data === "string") assets.push(asAsset(raw, fromBase64(raw.data)));
      else {
        const f = zip.file(`assets/${raw.id}`);
        if (f) assets.push(asAsset(raw, await f.async("uint8array")));
      }
    }
    return { ...b, assets };
  }
  const text = typeof input === "string" ? input : new TextDecoder().decode(bytes!);
  const b = check(JSON.parse(text));
  return { ...b, assets: (b.assets as Record<string, unknown>[]).filter((a) => typeof a.data === "string").map((a) => asAsset(a, fromBase64(a.data as string))) };
}

/** A zip of named files (PNG exports...). Duplicate names get " (2)", " (3)"... */
export async function zipFiles(files: { name: string; data: Uint8Array | string }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = f.name.replace(/(\.[^.]*)?$/, (ext) => ` (${k})${ext}`);
    used.add(name.toLowerCase());
    zip.file(name, f.data);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Safe file name from a label / template name. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim().slice(0, 120) || "label";

/** Give the bundle's template (and its labels) new ids, e.g. to import next to an existing copy. */
export function renameBundle(b: TemplateBundle, templateId: string, name = `${b.template.name} (imported)`): TemplateBundle {
  const suffix = templateId.replace(/^t-/, "");
  return {
    ...b,
    template: { ...b.template, id: templateId, name },
    labels: b.labels.map((l) => ({ ...l, id: `${l.id}-${suffix}`, templateId })),
  };
}
