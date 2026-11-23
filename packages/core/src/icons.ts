/**
 * Vector icons.
 *
 * Icon ids are `set:name` (e.g. `mdi:screw-machine-round-top`, `custom:a-1234`);
 * a plain name is a Tabler icon (backward compatible: `screw` = `tabler:screw`).
 *
 * Core never fetches app URLs itself: the app registers an icon source with
 * `setIconSource(async (id, filled) => svgString)`. SVGs are parsed into a
 * small list of shapes (path, circle, ellipse, rect, line, polyline, polygon)
 * with inherited group styles and transforms resolved, so they can be redrawn
 * at any size and stroke width. Fill-based (Iconify) and stroke-based (Tabler)
 * icons both work; light-coloured shapes cut holes (they print as paper).
 *
 * Also here (pure string functions, no DOM): Iconify JSON -> SVG conversion
 * and an allow-list SVG sanitiser for uploaded custom icons.
 */

export type IconSource = (id: string, filled: boolean) => Promise<string>;

let source: IconSource | null = null;
export const setIconSource = (fn: IconSource | null) => {
  source = fn;
};
export const iconSource = () => source;

/* ------------------------------------------------------------------ ids */

/** The default set: plain names belong to it. */
export const DEFAULT_ICON_SET = "tabler";
/** Uploaded SVG icons: `custom:<assetId>`. */
export const CUSTOM_ICON_SET = "custom";

const SET_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_RE = /^[a-z0-9]+([-_.][a-z0-9]+)*$/i;

export interface IconRef {
  set: string;
  name: string;
}

/**
 * Parse an icon id: `mdi:chip` -> { set: "mdi", name: "chip" }, `chip` -> Tabler.
 * Returns null for anything that isn't a well-formed id (e.g. unfilled `{{field}}`).
 */
export function parseIconId(id: string): IconRef | null {
  const s = id.trim();
  const i = s.indexOf(":");
  const set = i < 0 ? DEFAULT_ICON_SET : s.slice(0, i).toLowerCase();
  const name = i < 0 ? s : s.slice(i + 1);
  if (!SET_RE.test(set) || !NAME_RE.test(name)) return null;
  return { set, name: set === CUSTOM_ICON_SET ? name : name.toLowerCase() };
}

/** Canonical id: Tabler icons stay plain names. */
export const formatIconId = (set: string, name: string) => (set === DEFAULT_ICON_SET ? name : `${set}:${name}`);

/* -------------------------------------------------------------- iconify */

/** The parts of an Iconify JSON collection (`@iconify-json/<set>/icons.json`) used here. */
export interface IconifyIcon {
  body: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
  hidden?: boolean;
}
export interface IconifyCollection {
  prefix: string;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, Omit<IconifyIcon, "body"> & { parent: string }>;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** Resolve an icon or alias (alias transforms are merged onto the parent), or null. */
export function resolveIconifyIcon(set: IconifyCollection, name: string): Required<Omit<IconifyIcon, "hidden">> | null {
  let rotate = 0, hFlip = false, vFlip = false;
  const props: Partial<IconifyIcon> = {};
  let cur = name;
  for (let depth = 0; depth < 8; depth++) {
    const icon = set.icons[cur];
    const alias = icon ? undefined : set.aliases?.[cur];
    const node = icon ?? alias;
    if (!node) return null;
    rotate += node.rotate ?? 0;
    hFlip = hFlip !== !!node.hFlip;
    vFlip = vFlip !== !!node.vFlip;
    for (const k of ["left", "top", "width", "height"] as const) if (props[k] === undefined && node[k] !== undefined) props[k] = node[k];
    if (icon)
      return {
        body: icon.body,
        left: props.left ?? set.left ?? 0,
        top: props.top ?? set.top ?? 0,
        width: props.width ?? set.width ?? 16,
        height: props.height ?? set.height ?? 16,
        rotate: rotate % 4,
        hFlip,
        vFlip,
      };
    cur = alias!.parent;
  }
  return null;
}

/** Standalone SVG for a resolved Iconify icon (flips/rotation in quarter turns applied as a group transform). */
export function iconifyToSvg(icon: Required<Omit<IconifyIcon, "hidden">>): string {
  const { left: x, top: y, width: w, height: h } = icon;
  const t: string[] = [];
  let body = icon.body;
  if (icon.hFlip) t.push(`translate(${w + 2 * x} 0) scale(-1 1)`);
  if (icon.vFlip) t.push(`translate(0 ${h + 2 * y}) scale(1 -1)`);
  let vw = w, vh = h;
  const r = ((icon.rotate % 4) + 4) % 4;
  if (r) {
    const cx = x + w / 2, cy = y + h / 2;
    t.unshift(`rotate(${r * 90} ${cx} ${cy})`);
    if (r % 2) {
      // Swap the box around the same centre.
      [vw, vh] = [h, w];
    }
  }
  if (t.length) body = `<g transform="${t.join(" ")}">${body}</g>`;
  const vx = x + (w - vw) / 2, vy = y + (h - vh) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}">${body}</svg>`;
}

/* ---------------------------------------------------------------- parse */

export interface IconShape {
  tag: "path" | "circle" | "ellipse" | "rect" | "line" | "polyline" | "polygon";
  /** Own geometry attributes plus resolved (inherited) paint attributes. */
  attrs: Record<string, string>;
  /** Combined transform (SVG matrix a b c d e f), when not identity. */
  matrix?: Matrix;
}

export interface IconData {
  viewBox: [number, number, number, number];
  /** Root defaults ("none" or a colour). */
  fill: string;
  stroke: string;
  strokeWidth: number;
  shapes: IconShape[];
}

export type Matrix = [number, number, number, number, number, number];

const SHAPES = new Set<IconShape["tag"]>(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
/** Containers whose content is never painted directly. */
const NON_RENDERED = new Set(["defs", "mask", "clippath", "symbol", "pattern", "lineargradient", "radialgradient", "marker", "filter", "style", "script", "title", "desc", "metadata", "foreignobject"]);
/** Paint properties that inherit from groups. */
const INHERITED = ["fill", "stroke", "stroke-width", "fill-rule", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity", "display", "visibility"];
const STYLE_PROPS = new Set([...INHERITED, "opacity"]);

const attrsOf = (s: string) =>
  Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1], decodeEntities(m[3] ?? m[4])]));

const decodeEntities = (v: string) =>
  v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[l] ?? _;
  });

/** Fold a `style="fill:#000;stroke:none"` attribute into plain presentation attributes. */
function withStyle(a: Record<string, string>): Record<string, string> {
  if (!a.style) return a;
  const out = { ...a };
  delete out.style;
  for (const decl of a.style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).replace(/!important/i, "").trim();
    if (STYLE_PROPS.has(k) && v) out[k] = v;
  }
  return out;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const isIdentity = (m: Matrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** Parse an SVG `transform` list into one matrix. Unknown functions are ignored. */
export function parseTransform(t: string | undefined): Matrix {
  let m = IDENTITY;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((v) => !Number.isFinite(v))) continue;
    let n: Matrix = IDENTITY;
    switch (fn) {
      case "matrix":
        if (a.length === 6) n = a as Matrix;
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        n = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

/** Parse an SVG string into drawable shapes (framework-free; no DOM needed). */
export function parseIconSvg(svg: string): IconData {
  const rootTag = /<svg\b([^>]*)>/i.exec(svg);
  const root = withStyle(attrsOf(rootTag?.[1] ?? ""));
  const vb = (root.viewBox ?? `0 0 ${parseFloat(root.width ?? "") || 24} ${parseFloat(root.height ?? "") || 24}`).split(/[\s,]+/).map(Number);
  const shapes: IconShape[] = [];

  interface Ctx {
    tag: string;
    paint: Record<string, string>;
    opacity: number;
    matrix: Matrix;
    hidden: boolean;
  }
  const rootPaint: Record<string, string> = {};
  for (const k of INHERITED) if (root[k] !== undefined) rootPaint[k] = root[k];
  const stack: Ctx[] = [{ tag: "svg", paint: rootPaint, opacity: Number(root.opacity ?? 1), matrix: IDENTITY, hidden: false }];

  const body = rootTag ? svg.slice(rootTag.index + rootTag[0].length) : svg;
  for (const m of body.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<(\/?)([\w:.-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g)) {
    const [, close, rawTag, rawAttrs, selfClose] = m;
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    const top = stack[stack.length - 1];
    if (close) {
      if (stack.length > 1 && top.tag === tag) stack.pop();
      else {
        // Tolerate sloppy nesting: pop back to the matching open tag.
        const i = stack.map((c) => c.tag).lastIndexOf(tag);
        if (i > 0) stack.length = i;
      }
      continue;
    }
    if (tag === "svg" && stack.length === 1 && !top.hidden) continue; // stray nested root, ignore
    const a = withStyle(attrsOf(rawAttrs ?? ""));
    const paint = { ...top.paint };
    for (const k of INHERITED) if (a[k] !== undefined && a[k] !== "inherit") paint[k] = a[k];
    const ctx: Ctx = {
      tag,
      paint,
      opacity: top.opacity * (a.opacity !== undefined ? Number(a.opacity) || 0 : 1),
      matrix: a.transform ? mul(top.matrix, parseTransform(a.transform)) : top.matrix,
      hidden: top.hidden || NON_RENDERED.has(tag) || paint.display === "none" || paint.visibility === "hidden",
    };
    const isShape = SHAPES.has(tag as IconShape["tag"]);
    if (isShape && !ctx.hidden) {
      const fill = paint.fill ?? "black";
      const stroke = paint.stroke ?? "none";
      const op = (k: string) => ctx.opacity * (paint[k] !== undefined ? Number(paint[k]) : 1);
      // Mostly-transparent shapes (duotone backgrounds, Tabler's bounding box) don't print.
      const fillOn = fill !== "none" && !/^url\(/i.test(fill) && op("fill-opacity") >= 0.5 && tag !== "line";
      const strokeOn = stroke !== "none" && !/^url\(/i.test(stroke) && op("stroke-opacity") >= 0.5;
      if (fillOn || strokeOn) {
        const attrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(a)) if (!INHERITED.includes(k) && k !== "opacity" && k !== "transform" && k !== "class" && k !== "id") attrs[k] = v;
        attrs.fill = fillOn ? fill : "none";
        attrs.stroke = strokeOn ? stroke : "none";
        for (const k of ["stroke-width", "fill-rule", "stroke-linecap", "stroke-linejoin"]) if (paint[k] !== undefined) attrs[k] = paint[k];
        shapes.push(isIdentity(ctx.matrix) ? { tag: tag as IconShape["tag"], attrs } : { tag: tag as IconShape["tag"], attrs, matrix: ctx.matrix });
      }
    }
    if (!selfClose && !isShape) stack.push(ctx);
    else if (!selfClose && isShape) stack.push({ ...ctx, hidden: true }); // children of a shape (title, animate) never paint
  }
  return {
    viewBox: [vb[0] || 0, vb[1] || 0, vb[2] || 24, vb[3] || 24],
    fill: root.fill ?? "black",
    stroke: root.stroke ?? "none",
    strokeWidth: Number(root["stroke-width"] ?? 1) || 1,
    shapes,
  };
}

const NAMED_LIGHT = new Set(["white", "snow", "ivory", "ghostwhite", "whitesmoke", "seashell", "linen", "floralwhite", "mintcream", "azure", "aliceblue", "lavenderblush", "honeydew", "oldlace", "cornsilk", "beige", "lightyellow", "transparent"]);

/** True for colours that should print as paper (white-ish), e.g. the highlight in a two-colour logo. */
export function isLightColor(c: string): boolean {
  const s = c.trim().toLowerCase();
  if (NAMED_LIGHT.has(s)) return true;
  let r: number, g: number, b: number;
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((x) => x + x).join("") : hex;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  } else {
    const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(s);
    if (!rgb) return false;
    [r, g, b] = rgb.slice(1, 4).map((v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v)));
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 160;
}

const num = (a: Record<string, string>, k: string, d = 0) => Number.parseFloat(a[k] ?? String(d)) || 0;

/** Path2D for one shape (browser). */
export function shapePath(s: IconShape): Path2D {
  const a = s.attrs;
  if (s.tag === "path") return new Path2D(a.d ?? "");
  const p = new Path2D();
  switch (s.tag) {
    case "circle":
      p.arc(num(a, "cx"), num(a, "cy"), num(a, "r"), 0, Math.PI * 2);
      break;
    case "ellipse":
      p.ellipse(num(a, "cx"), num(a, "cy"), num(a, "rx"), num(a, "ry"), 0, 0, Math.PI * 2);
      break;
    case "rect": {
      const rx = num(a, "rx", Number.parseFloat(a.ry ?? "0") || 0);
      if (rx > 0) p.roundRect(num(a, "x"), num(a, "y"), num(a, "width"), num(a, "height"), rx);
      else p.rect(num(a, "x"), num(a, "y"), num(a, "width"), num(a, "height"));
      break;
    }
    case "line":
      p.moveTo(num(a, "x1"), num(a, "y1"));
      p.lineTo(num(a, "x2"), num(a, "y2"));
      break;
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < pts.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, pts[i], pts[i + 1]);
      if (s.tag === "polygon") p.closePath();
      break;
    }
  }
  return p;
}

/**
 * Draw an icon in black onto a transparent context (viewBox mapped to a
 * `size` square at the origin, aspect kept and centred). Light-coloured shapes
 * erase what's under them. `strokePx` overrides the stroke width in output
 * pixels (stroked icons such as Tabler; fill-only icons are unaffected).
 */
export function drawIcon(ctx: CanvasRenderingContext2D, icon: IconData, size: number, strokePx?: number) {
  const [vx, vy, vw, vh] = icon.viewBox;
  const k = size / Math.max(vw, vh);
  ctx.save();
  ctx.translate((size - vw * k) / 2, (size - vh * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  ctx.fillStyle = ctx.strokeStyle = "#000";
  for (const s of icon.shapes) {
    const a = s.attrs;
    const fill = a.fill ?? icon.fill;
    const stroke = a.stroke ?? icon.stroke;
    const path = shapePath(s);
    ctx.save();
    let scale = 1;
    if (s.matrix) {
      ctx.transform(...s.matrix);
      scale = Math.sqrt(Math.abs(s.matrix[0] * s.matrix[3] - s.matrix[1] * s.matrix[2])) || 1;
    }
    ctx.lineCap = (a["stroke-linecap"] as CanvasLineCap | undefined) ?? "round";
    ctx.lineJoin = (a["stroke-linejoin"] as CanvasLineJoin | undefined) ?? "round";
    if (fill !== "none" && s.tag !== "line") {
      ctx.globalCompositeOperation = isLightColor(fill) ? "destination-out" : "source-over";
      ctx.fill(path, a["fill-rule"] === "evenodd" ? "evenodd" : "nonzero");
    }
    if (stroke !== "none") {
      const own = a["stroke-width"] !== undefined ? Number.parseFloat(a["stroke-width"]) || 0 : icon.strokeWidth;
      ctx.lineWidth = strokePx !== undefined ? strokePx / k / scale : own;
      ctx.globalCompositeOperation = isLightColor(stroke) ? "destination-out" : "source-over";
      if (ctx.lineWidth > 0) ctx.stroke(path);
    }
    ctx.restore();
  }
  ctx.restore();
}

/* ------------------------------------------------------------- sanitise */

const SAFE_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "title", "desc"]);
const SAFE_ATTRS = new Set([
  "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "fill-rule", "clip-rule",
  "opacity", "fill-opacity", "stroke-opacity", "display", "visibility", "preserveaspectratio",
]);
const CASED: Record<string, string> = { viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio" };
const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Rebuild an untrusted SVG from an allow-list of shape elements and
 * presentation attributes. Everything else is dropped: scripts, styles,
 * foreignObject, images, `use`/links, event handlers, `url(...)` and
 * `javascript:` values, comments, doctypes and entities. Inline `style`
 * paint properties are kept as attributes. The result has one `<svg>` root
 * with a viewBox. Returns null if nothing drawable remains.
 */
export function sanitizeSvg(input: string): string | null {
  const svg = input.replace(/^﻿/, "");
  const out: string[] = [];
  const stack: { tag: string; keep: boolean }[] = [];
  let skip = 0; // depth inside a dropped element
  let shapes = 0;
  let rootDone = false;
  for (const m of svg.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<(\/?)([\w:.-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g)) {
    const [, close, rawTag, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      const top = stack[stack.length - 1];
      if (!skip && top?.keep && (top.tag === "title" || top.tag === "desc")) out.push(escText(decodeEntities(text)));
      continue;
    }
    if (!rawTag) continue; // comments, CDATA, doctype, processing instructions
    // Namespaced elements (sodipodi:, inkscape:, svg:foo) are dropped with their content.
    const tag = rawTag.toLowerCase();
    if (close) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i < 0) continue;
      while (stack.length > i) {
        const s = stack.pop()!;
        if (s.keep) out.push(`</${s.tag}>`);
        else skip--;
      }
      continue;
    }
    const keep = !skip && SAFE_TAGS.has(tag) && (tag === "svg" ? !rootDone && !stack.length : stack.length > 0);
    if (!keep) {
      if (!selfClose) {
        stack.push({ tag, keep: false });
        skip++;
      }
      continue;
    }
    if (tag === "svg") rootDone = true;
    const attrs = withStyle(attrsOf(rawAttrs ?? ""));
    if (tag === "svg" && !attrs.viewBox) {
      const w = parseFloat(attrs.width ?? ""), h = parseFloat(attrs.height ?? "");
      if (w > 0 && h > 0) attrs.viewBox = `0 0 ${w} ${h}`;
    }
    const kept: string[] = tag === "svg" ? [`xmlns="http://www.w3.org/2000/svg"`] : [];
    for (const [k, v] of Object.entries(attrs)) {
      const lk = k.toLowerCase();
      if (!SAFE_ATTRS.has(lk)) continue;
      if (/url\s*\(|javascript:|expression\s*\(|[<>]/i.test(v)) continue;
      kept.push(`${CASED[lk] ?? lk}="${escAttr(v)}"`);
    }
    if (SHAPES.has(tag as IconShape["tag"])) shapes++;
    const open = `<${tag}${kept.length ? " " + kept.join(" ") : ""}`;
    if (selfClose) out.push(`${open}/>`);
    else {
      out.push(`${open}>`);
      stack.push({ tag, keep: true });
    }
  }
  while (stack.length) {
    const s = stack.pop()!;
    if (s.keep) out.push(`</${s.tag}>`);
  }
  if (!rootDone || !shapes) return null;
  return out.join("");
}
