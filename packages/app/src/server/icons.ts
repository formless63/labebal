import {
  CUSTOM_ICON_SET,
  DEFAULT_ICON_SET,
  formatIconId,
  iconifyToSvg,
  parseIconId,
  resolveIconifyIcon,
  sanitizeSvg,
  type IconifyCollection,
} from "@labebal/core";
import { getAsset, listAssets, type AssetInfo } from "./assets";

/**
 * Icon libraries, all offline:
 * - Tabler (default; plain names) from the `@tabler/icons` package data,
 * - Iconify JSON sets (`@iconify-json/<set>`): Material Design Icons, Lucide,
 *   Game Icons, Simple Icons (brand logos),
 * - custom SVGs uploaded as assets of kind "icon" (`custom:<assetId>`).
 *
 * The JSON is bundled with the server (no runtime file access) and each set
 * is loaded on first use. Icon ids are `set:name` (see core `parseIconId`).
 */

export interface IconSetInfo {
  id: string;
  /** Short tab label. */
  label: string;
  title: string;
  count: number;
  license: { title: string; spdx?: string; url?: string };
  author?: { name: string; url?: string };
  /** Has filled variants (`?filled=1`). */
  filled: boolean;
  /** Shown in the picker (attribution / trademark notes). */
  note?: string;
}

export interface IconHit {
  /** What to store in an icon node: `set:name` (Tabler: plain name). */
  id: string;
  /** Name within its set. */
  name: string;
  set: string;
  /** A filled variant exists (Tabler only). */
  filled: boolean;
}

interface Entry {
  set: string;
  name: string;
  /** Lowercased alias names, tags and categories. */
  aliases: string[];
  tags: string[];
  categories: string[];
  filled: boolean;
}

/* ------------------------------------------------------------- iconify */

type IconifySetId = "mdi" | "lucide" | "game-icons" | "simple-icons";

const ICONIFY: Record<IconifySetId, { label: string; info: () => Promise<{ default: unknown }>; icons: () => Promise<{ default: unknown }>; meta?: () => Promise<{ default: unknown }>; note?: string }> = {
  mdi: {
    label: "Material",
    info: () => import("@iconify-json/mdi/info.json", { with: { type: "json" } }),
    icons: () => import("@iconify-json/mdi/icons.json", { with: { type: "json" } }),
    meta: () => import("@iconify-json/mdi/metadata.json", { with: { type: "json" } }),
  },
  lucide: {
    label: "Lucide",
    info: () => import("@iconify-json/lucide/info.json", { with: { type: "json" } }),
    icons: () => import("@iconify-json/lucide/icons.json", { with: { type: "json" } }),
  },
  "game-icons": {
    label: "Game",
    info: () => import("@iconify-json/game-icons/info.json", { with: { type: "json" } }),
    icons: () => import("@iconify-json/game-icons/icons.json", { with: { type: "json" } }),
    note: "Game Icons are CC BY 3.0: credit game-icons.net if you publish labels using them.",
  },
  "simple-icons": {
    label: "Brands",
    info: () => import("@iconify-json/simple-icons/info.json", { with: { type: "json" } }),
    icons: () => import("@iconify-json/simple-icons/icons.json", { with: { type: "json" } }),
    note: "Brand logos are trademarks of their owners. Use them only to say what a part is for or fits.",
  },
};
const isIconify = (s: string): s is IconifySetId => Object.hasOwn(ICONIFY, s);

const collections = new Map<IconifySetId, Promise<IconifyCollection>>();
const loadCollection = (id: IconifySetId) => {
  let p = collections.get(id);
  if (!p) {
    p = ICONIFY[id].icons().then((m) => m.default as IconifyCollection);
    p.catch(() => collections.delete(id));
    collections.set(id, p);
  }
  return p;
};

async function iconifyEntries(id: IconifySetId): Promise<Entry[]> {
  const set = await loadCollection(id);
  const cats = new Map<string, string[]>();
  if (ICONIFY[id].meta) {
    const meta = (await ICONIFY[id].meta!()).default as { categories?: Record<string, string[]> };
    for (const [cat, names] of Object.entries(meta.categories ?? {})) for (const n of names) (cats.get(n) ?? cats.set(n, []).get(n)!).push(cat.toLowerCase());
  }
  const aliases = new Map<string, string[]>();
  for (const [alias, a] of Object.entries(set.aliases ?? {})) {
    // Only plain renames are useful as search keywords (flipped/rotated aliases are separate icons).
    if (a.rotate || a.hFlip || a.vFlip) continue;
    (aliases.get(a.parent) ?? aliases.set(a.parent, []).get(a.parent)!).push(alias);
  }
  return Object.entries(set.icons)
    .filter(([, icon]) => !icon.hidden)
    .map(([name]) => ({
      set: id,
      name,
      aliases: aliases.get(name) ?? [],
      tags: KEYWORDS[`${id}:${name}`] ?? [],
      categories: cats.get(name) ?? [],
      filled: false,
    }));
}

/** Extra search words for parts the set names don't describe (matched like tags). */
const KEYWORDS: Record<string, string[]> = {
  "mdi:circle-double": ["washer", "ring", "spacer"],
  "mdi:hexagon-outline": ["nut", "hex"],
  "game-icons:hexagonal-nut": ["hex", "bolt"],
  "mdi:screw-machine-round-top": ["bolt", "socket", "cap"],
  "mdi:screw-machine-flat-top": ["bolt", "countersunk"],
  "mdi:integrated-circuit-chip": ["ic", "dip", "chip"],
  "mdi:chip": ["ic", "soic"],
  "mdi:video-input-component": ["ypbpr", "rca"],
  "mdi:video-input-svideo": ["s-video", "mini-din"],
  "mdi:expansion-card": ["pcb", "board", "card"],
  "lucide:circuit-board": ["pcb", "board"],
  "game-icons:circuitry": ["pcb", "board"],
  "mdi:fuse": ["polyfuse"],
  "mdi:archive": ["drawer", "bin"],
};

/* --------------------------------------------------------------- tabler */

type IconNodes = Record<string, [string, Record<string, string>][]>;
interface TablerMeta {
  name: string;
  category?: string;
  tags?: (string | number)[];
  styles?: { outline?: unknown; filled?: unknown };
}

let tablerOutline: Promise<IconNodes> | null = null;
let tablerFilled: Promise<IconNodes> | null = null;
const loadTablerNodes = (variant: "outline" | "filled") =>
  variant === "outline"
    ? (tablerOutline ??= import("@tabler/icons/tabler-nodes-outline.json", { with: { type: "json" } }).then((m) => m.default as unknown as IconNodes))
    : (tablerFilled ??= import("@tabler/icons/tabler-nodes-filled.json", { with: { type: "json" } }).then((m) => m.default as unknown as IconNodes));

const tablerEntries = async (): Promise<Entry[]> =>
  Object.values((await import("@tabler/icons/icons.json", { with: { type: "json" } })).default as unknown as Record<string, TablerMeta>).map((m) => ({
    set: DEFAULT_ICON_SET,
    name: m.name,
    aliases: [],
    tags: (m.tags ?? []).map((t) => String(t).toLowerCase()),
    categories: m.category ? [m.category.toLowerCase()] : [],
    filled: !!m.styles?.filled,
  }));

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

async function tablerSvg(name: string, wantFilled: boolean) {
  let variant: "outline" | "filled" = wantFilled ? "filled" : "outline";
  let nodes = (await loadTablerNodes(variant))[name];
  if (!nodes && variant === "filled") {
    variant = "outline";
    nodes = (await loadTablerNodes(variant))[name];
  }
  if (!nodes) return null;
  const root =
    variant === "outline"
      ? `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
      : `fill="currentColor"`;
  const body = nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ")} />`)
    .join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${root}>${body}</svg>`, filled: variant === "filled" };
}

/* -------------------------------------------------------------- custom */

/** Display name of a custom icon: `meta.title`, else the file name without extension. */
export const customIconTitle = (a: Pick<AssetInfo, "name" | "meta">) =>
  (typeof a.meta.title === "string" && a.meta.title.trim()) || a.name.replace(/\.svg$/i, "");

const customEntries = async (): Promise<(Entry & { title: string })[]> =>
  (await listAssets("icon")).map((a) => {
    const title = customIconTitle(a);
    const tags = Array.isArray(a.meta.keywords) ? a.meta.keywords.map((k) => String(k).toLowerCase()) : [];
    return { set: CUSTOM_ICON_SET, name: a.id, title, aliases: [title.toLowerCase()], tags, categories: [], filled: false };
  });

/* --------------------------------------------------------------- index */

/** Order: tabs, tie-breaks in search. */
export const ICON_SET_IDS = [DEFAULT_ICON_SET, "mdi", "lucide", "game-icons", "simple-icons", CUSTOM_ICON_SET] as const;
const BUILTIN_IDS = ICON_SET_IDS.filter((s) => s !== CUSTOM_ICON_SET);

const indexes = new Map<string, Promise<Entry[]>>();
const loadIndex = (set: string): Promise<Entry[]> => {
  let p = indexes.get(set);
  if (!p) {
    p = set === DEFAULT_ICON_SET ? tablerEntries() : isIconify(set) ? iconifyEntries(set) : Promise.resolve([]);
    p.catch(() => indexes.delete(set));
    indexes.set(set, p);
  }
  return p;
};

export async function iconSets(): Promise<IconSetInfo[]> {
  const out: IconSetInfo[] = [
    {
      id: DEFAULT_ICON_SET,
      label: "Tabler",
      title: "Tabler Icons",
      count: (await loadIndex(DEFAULT_ICON_SET)).length,
      license: { title: "MIT", spdx: "MIT", url: "https://github.com/tabler/tabler-icons/blob/main/LICENSE" },
      author: { name: "Paweł Kuna", url: "https://tabler.io/icons" },
      filled: true,
    },
  ];
  for (const id of Object.keys(ICONIFY) as IconifySetId[]) {
    const info = (await ICONIFY[id].info()).default as { name: string; total?: number; license: IconSetInfo["license"]; author?: IconSetInfo["author"] };
    out.push({ id, label: ICONIFY[id].label, title: info.name, count: info.total ?? 0, license: info.license, author: info.author, filled: false, note: ICONIFY[id].note });
  }
  out.push({
    id: CUSTOM_ICON_SET,
    label: "Custom",
    title: "Your uploaded icons",
    count: (await listAssets("icon")).length,
    license: { title: "Your own" },
    filled: false,
  });
  return out;
}

const words = (s: string) => s.toLowerCase().trim().split(/[\s,]+/).filter(Boolean);

function scoreWord(e: Entry, w: string): number {
  const n = e.name;
  if (n === w) return 100;
  if (n.startsWith(w)) return 60;
  const parts = n.split(/[-_]/);
  if (parts.includes(w)) return 50;
  if (n.includes(w)) return 30;
  if (e.aliases.some((a) => a === w)) return 45;
  if (e.aliases.some((a) => a.includes(w))) return 25;
  if (e.tags.some((t) => t === w)) return 55;
  if (e.tags.some((t) => t.includes(w))) return 10;
  if (e.categories.some((c) => c.includes(w))) return 5;
  return 0;
}

/**
 * Search icons in one set or all of them (`set` = "all" / empty). Every word
 * must match; exact names rank first, then prefixes, name parts, aliases, tags,
 * categories. `mdi:usb` style queries restrict to that set. An empty query
 * lists the set(s) alphabetically.
 */
export async function searchIcons(query: string, opts: { set?: string; limit?: number } = {}): Promise<IconHit[]> {
  const limit = opts.limit ?? 60;
  let q = query;
  let only = opts.set && opts.set !== "all" ? opts.set : undefined;
  const pref = /^\s*([a-z0-9-]+):(.*)$/i.exec(q);
  if (pref && (ICON_SET_IDS as readonly string[]).includes(pref[1].toLowerCase())) {
    only = pref[1].toLowerCase();
    q = pref[2];
  }
  if (only && !(ICON_SET_IDS as readonly string[]).includes(only)) return [];
  const sets = only ? [only] : [...BUILTIN_IDS, CUSTOM_ICON_SET];
  const lists = await Promise.all(sets.map((s) => (s === CUSTOM_ICON_SET ? customEntries() : loadIndex(s))));
  const hit = (e: Entry): IconHit => ({ id: formatIconId(e.set, e.name), name: e.name, set: e.set, filled: e.filled });
  const ws = words(q);
  if (!ws.length) {
    // Custom icons first (few, and the reason you'd open that tab), then each set in order.
    const all = only ? lists[0] : [...lists[lists.length - 1], ...lists.slice(0, -1).flat()];
    return all.slice(0, limit).map(hit);
  }
  const scored: [number, Entry][] = [];
  lists.forEach((list, si) => {
    for (const e of list) {
      let score = 0;
      for (const w of ws) {
        const s = scoreWord(e, w);
        if (!s) {
          score = 0;
          break;
        }
        score += s;
      }
      if (score) scored.push([score - e.name.length * 0.01 - si * 0.001, e]);
    }
  });
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, e]) => hit(e));
}

/** Display name for a custom icon id, for listings. */
export async function customIconTitles(): Promise<Record<string, string>> {
  return Object.fromEntries((await customEntries()).map((e) => [formatIconId(e.set, e.name), e.title]));
}

/**
 * SVG markup for an icon id (Tabler: filled variant when requested and
 * available), or null if unknown. Custom SVGs are re-sanitised on the way out.
 */
export async function iconSvg(id: string, wantFilled: boolean): Promise<{ svg: string; filled: boolean; custom: boolean } | null> {
  const ref = parseIconId(id);
  if (!ref) return null;
  if (ref.set === DEFAULT_ICON_SET) {
    const t = await tablerSvg(ref.name, wantFilled);
    return t && { ...t, custom: false };
  }
  if (isIconify(ref.set)) {
    const icon = resolveIconifyIcon(await loadCollection(ref.set), ref.name);
    return icon && { svg: iconifyToSvg(icon), filled: false, custom: false };
  }
  if (ref.set === CUSTOM_ICON_SET) {
    const a = await getAsset(ref.name);
    if (!a || a.kind !== "icon") return null;
    const svg = sanitizeSvg(Buffer.from(a.data).toString("utf8"));
    return svg ? { svg, filled: false, custom: true } : null;
  }
  return null;
}
