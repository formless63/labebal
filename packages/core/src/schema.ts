/**
 * Label document model (v2).
 *
 * A template is a tree of nodes under a root frame. Frames lay out their
 * children either freely (absolute positions + Figma-style constraints) or as a
 * row/column stack (flexbox-like: fixed / hug / fill sizing, gap, padding,
 * alignment). The same template therefore reflows to any label size instead of
 * just scaling. Variants patch nodes for particular size ranges, and labels
 * (rows) fill `{{field}}` placeholders and may override node properties.
 *
 * All lengths are millimetres; text sizes are points.
 */
import type { RuleSet } from "./rules";

/** How something is painted onto what is already on the label (1-bit world). */
export type Paint =
  | "black" // print dots
  | "white" // clear dots (knock out whatever is underneath)
  | "invert" // flip whatever is underneath
  | "none";

/** How a node is sized along one axis. */
export type Sizing =
  | { kind: "fixed"; mm: number }
  | { kind: "hug" } // fit content
  | { kind: "fill"; weight?: number } // take remaining space (stack) / whole parent (free)
  | { kind: "pct"; pct: number }; // percentage of parent content box

/** Free-layout constraint for one axis (what stays fixed when the parent resizes). */
export type Anchor = "start" | "end" | "center" | "stretch" | "scale";

export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "between" | "around";
export type Rotation = 0 | 90 | 180 | 270;

/** Size-based condition, evaluated against the label's printable area (mm). */
export interface SizeRule {
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** width / height */
  minAspect?: number;
  maxAspect?: number;
}

interface NodeBase {
  id: string;
  name?: string;
  w: Sizing;
  h: Sizing;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** Position in the parent's content box, used when the parent layout is "free" (design-time mm). */
  x?: number;
  y?: number;
  /** Free-layout constraints. Default start/start. */
  ax?: Anchor;
  ay?: Anchor;
  /**
   * Inside a row / column: float freely instead of taking part in the line-up
   * (like absolute positioning). Placed by x / y / ax / ay like a child of a
   * free frame, and drawn on top of the parent's other children.
   */
  float?: boolean;
  /** Cross-axis alignment override inside a stack. */
  alignSelf?: Align;
  rotate?: Rotation;
  hidden?: boolean;
  /** Only shown when the label size matches. */
  showWhen?: SizeRule;
  locked?: boolean;
}

export interface FrameNode extends NodeBase {
  type: "frame";
  layout: "free" | "row" | "column";
  gap?: number;
  /** [top, right, bottom, left] */
  padding?: [number, number, number, number];
  align?: Align;
  justify?: Justify;
  fill?: Paint;
  stroke?: Paint;
  strokeMm?: number;
  radius?: number;
  clip?: boolean;
  children: LabelNode[];
  /**
   * Cable flags: draw a live copy of another frame's contents in this frame
   * (its own children are ignored). See cable.ts.
   */
  mirror?: MirrorSpec;
  /**
   * Cable wrap zone: this frame's length (along its parent row / column) is the
   * cable's circumference for this diameter, mm. See `cableWrapMm`.
   */
  wrapDiameterMm?: number;
  /**
   * Lockup (logo / wordmark): the frame's contents are scaled as one unit by
   * a single factor k (text sizes, gaps, padding, fixed sizes, strokes), so
   * their size ratios stay as designed. k is the largest scale at which the
   * contents fit the box the frame gets at their packed size (justified words
   * need only their letters plus a minimum gap, not their designed spacing).
   * Hug axes then take the content size at k; other axes the scaled design
   * size up to the space available (justified words spread over it with small
   * gaps). The result is centred in the frame's box. With pixel fonts k is
   * snapped down so the largest text lands on a whole number of printer dots
   * per font pixel; the others take the nearest or next lower whole scale
   * (within one step of their designed ratio). The template text scale does
   * not apply inside a lockup.
   */
  lockup?: boolean;
}

/**
 * How a mirrored half copies its source: "repeat" (same layout), "reflect"
 * (positions flipped left-right so the halves line up back to back when
 * folded around a cable; letters are not mirrored) or "rotate" (turned 180°,
 * for a strip that hangs down from a cable).
 */
export interface MirrorSpec {
  of: string;
  mode: "repeat" | "reflect" | "rotate";
}

export interface TextNode extends NodeBase {
  type: "text";
  /** Literal text with `{{field}}` placeholders; newlines allowed. */
  text: string;
  font: string;
  /** Preferred size (pt) at the template's design size. */
  sizePt: number;
  /** Never shrink below this (pt). */
  minSizePt?: number;
  /** shrink: shrink to fit the box. fill: grow/shrink to fill the box. fixed: never change. */
  fit?: "shrink" | "fill" | "fixed";
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  /** Line height as a multiple of font size (non-pixel fonts). */
  lineHeight?: number;
  /** Extra space between characters, mm. */
  letterSpacing?: number;
  uppercase?: boolean;
  color: Paint;
  weight?: number;
  /** Outline (stroke) around glyphs, e.g. outlined or knockout text. */
  stroke?: Paint;
  strokeMm?: number;
  /**
   * Rich text: styles applied to character ranges of `text` (offsets into the
   * raw text, before placeholders are filled). Inline icons are written in the
   * text itself as `{{icon:set:name}}`. See richtext.ts.
   */
  spans?: TextSpan[];
  /**
   * Shared text style (library `TextStyle.id`). The style's values replace the
   * node's own font / size / weight... when laid out, so editing the style
   * updates every text using it (see parts.ts). The node's own values are a
   * copy kept as a fallback (style deleted, file opened without the library).
   */
  style?: string;
  /** Style properties this node sets itself (per-node overrides; they win over the style). */
  styleOverrides?: TextStyleKey[];
}

/** Text properties a shared text style can set. */
export const TEXT_STYLE_KEYS = ["font", "sizePt", "minSizePt", "fit", "weight", "letterSpacing", "lineHeight", "align", "valign", "uppercase", "color", "stroke", "strokeMm"] as const;
export type TextStyleKey = (typeof TEXT_STYLE_KEYS)[number];

/**
 * Named text style stored once in the library and used by reference
 * (`TextNode.style`). Plain JSON, shipped in packs:
 * `{ "id": "ts-heading", "name": "Heading", "font": "Pixel Operator", "sizePt": 12, "weight": 700, "uppercase": true }`.
 * A property left out means the default (e.g. no `uppercase` = normal case);
 * `font`, `sizePt` and `color` left out keep the text's own value.
 */
export type TextStyle = { id: string; name: string; description?: string } & Partial<Pick<TextNode, TextStyleKey>>;

/**
 * Instance of a library component (`LabelComponent`): laid out like a frame
 * holding a copy of the component's contents, so editing the component
 * updates every instance. Size, position, anchors, rotation and visibility are
 * the instance's own (like any node). Children laid out from an instance get
 * ids `<instance id>/<component node id>` (nested instances chain them), which
 * variant patches and label overrides may target.
 */
export interface ComponentNode extends NodeBase {
  type: "component";
  /** `LabelComponent.id`. */
  ref: string;
  /**
   * Per-instance changes to the component's nodes, by component node id (a
   * nested instance's nodes: `<nested instance id>/<node id>`). The editor
   * writes the bound text (`text`, `icon`, `value`, `src`) and `hidden`.
   */
  overrides?: Record<string, Partial<LabelNode>>;
}

/**
 * Reusable node subtree stored once in the library (e.g. a logo lockup) and
 * placed in templates as `ComponentNode` instances. Plain JSON, shipped in packs.
 */
export interface LabelComponent {
  id: string;
  name: string;
  description?: string;
  /** Size it is designed at (mm): new instances start at this size; free children are positioned in it. */
  design: { w: number; h: number };
  /** Contents. Its layout, gap, padding, fill, lockup... apply; its own size / position props are ignored (the instance's apply). */
  root: FrameNode;
  tags?: string[];
}

/** Library-level parts templates refer to by id. */
export interface LibraryParts {
  styles?: TextStyle[];
  components?: LabelComponent[];
}

/** Style for a character range [start, end) of a text node's raw text. */
export interface TextSpan {
  start: number;
  end: number;
  bold?: boolean;
  /** Size relative to the node's size (1 = same). */
  scale?: number;
  /** White on black (flips the run's line box). */
  invert?: boolean;
}

/** Column width / row height of a table. hug = fit the content. */
export type TableSize = { kind: "fixed"; mm: number } | { kind: "fill"; weight?: number } | { kind: "hug" };

/**
 * Table / grid: rows x columns of text cells (fields, tokens and inline icons
 * allowed) with borders. Columns and rows are fixed, hug or share the rest
 * (fill), so the grid reflows with its box. See table.ts.
 */
export interface TableNode extends NodeBase {
  type: "table";
  cols: TableSize[];
  rows: TableSize[];
  /** cells[row][col], raw text like a text node's `text`. */
  cells: string[][];
  font: string;
  sizePt: number;
  minSizePt?: number;
  fit?: "shrink" | "fill" | "fixed";
  weight?: number;
  align?: "left" | "center" | "right";
  /** Per-column alignment (overrides `align`). */
  colAlign?: ("left" | "center" | "right" | null)[];
  uppercase?: boolean;
  color: Paint;
  /** Which grid lines to draw (default all). */
  border?: "all" | "outer" | "inner" | "rows" | "columns" | "none";
  borderMm?: number;
  /** Space between a cell's border and its text, mm. */
  cellPaddingMm?: number;
  /** Header cells: first row, first column or both. */
  header?: "none" | "row" | "column" | "both";
  headerStyle?: "bold" | "invert";
}

export interface RectNode extends NodeBase {
  type: "rect";
  fill: Paint;
  stroke?: Paint;
  strokeMm?: number;
  radius?: number;
}

export interface EllipseNode extends NodeBase {
  type: "ellipse";
  fill: Paint;
  stroke?: Paint;
  strokeMm?: number;
}

export interface LineNode extends NodeBase {
  type: "line";
  /** Drawn along the box: horizontal centre line, vertical centre line, or a diagonal. */
  direction: "horizontal" | "vertical" | "down" | "up";
  color: Paint;
  strokeMm: number;
  dashMm?: number;
}

/** Raster image (PNG/JPG/SVG), converted to 1-bit by dithering. */
export interface ImageNode extends NodeBase {
  type: "image";
  /** Asset URL (`/api/assets/:id`), data URL, or `{{field}}` resolving to one. */
  src: string;
  fit: "contain" | "cover" | "stretch";
  dither: "threshold" | "floyd-steinberg" | "atkinson" | "ordered";
  /** 0-255, pixels darker than this print (threshold / bias for dithering). */
  threshold?: number;
  /** Flip the image before dithering. */
  invertImage?: boolean;
  /** Paint used for the image's dark pixels. */
  color: Paint;
}

/** Icon from the Tabler set (https://tabler.io/icons), rendered as vector. */
export interface IconNode extends NodeBase {
  type: "icon";
  /**
   * Icon id: `set:name` (e.g. "mdi:screw-flat-top", "custom:<assetId>"), a plain
   * Tabler name (e.g. "nut"), or `{{field}}`.
   */
  icon: string;
  /** Use the filled variant when the set has one (Tabler). */
  filled?: boolean;
  /** Stroke width in mm for outline icons (default scales with size). */
  strokeMm?: number;
  color: Paint;
}

/** Regular polygon or star, inscribed in its box. */
export interface PolygonNode extends NodeBase {
  type: "polygon";
  /** Number of corners (3-24); for stars, the number of points. */
  sides: number;
  star?: boolean;
  /** Star inner radius as a fraction of the outer radius (0.1-0.95). */
  innerRatio?: number;
  /** Extra rotation of the shape inside its box, degrees (0 = point up). */
  angle?: number;
  fill: Paint;
  stroke?: Paint;
  strokeMm?: number;
}

/** Barcode symbologies (see CODE_FORMATS in codes.ts for names, quiet zones and what each holds). */
export type CodeFormat =
  | "qrcode"
  | "microqr"
  | "rmqr"
  | "datamatrix"
  | "gs1datamatrix"
  | "pdf417"
  | "aztec"
  | "code128"
  | "gs1_128"
  | "code39"
  | "code93"
  | "ean13"
  | "ean8"
  | "upca"
  | "itf14"
  | "upce"
  | "itf"
  | "codabar"
  | "code39ext"
  | "msi"
  | "pharmacode"
  | "databar"
  | "databarexpanded"
  | "gs1qr"
  | "uspsimb"
  | "royalmail"
  | "datamatrixrect"
  | "dotcode"
  | "hanxin"
  | "swissqr";

/** Barcode / 2D code. */
export interface CodeNode extends NodeBase {
  type: "code";
  format: CodeFormat;
  /** Encoded value; supports `{{field}}` and dynamic tokens. */
  value: string;
  /** Human-readable text under 1D codes. */
  showText?: boolean;
  ecc?: "L" | "M" | "Q" | "H";
  /** Keep the standard blank margin around the symbol (helps scanners). */
  quietZone?: boolean;
  color: Paint;
}

export type LabelNode = FrameNode | TextNode | RectNode | EllipseNode | LineNode | PolygonNode | ImageNode | IconNode | CodeNode | TableNode | ComponentNode;
export type NodeType = LabelNode["type"];

/** Node properties that hold user text supporting `{{field}}` / dynamic tokens. */
export const BOUND_PROPS = { text: "text", image: "src", icon: "icon", code: "value" } as const satisfies Partial<Record<NodeType, string>>;

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "multiline";
  default?: string;
  /**
   * Ask for this value when printing (print-time form) instead of storing it on
   * the label. The value fills the field for that print only and is recorded in
   * history. `default` prefills the form; for dates it may be "today" or an
   * offset such as "+30d".
   */
  askAtPrint?: boolean;
  /** Print-time form: question shown instead of `label`, help text, input kind, required. */
  prompt?: string;
  help?: string;
  askType?: "text" | "number" | "date";
  required?: boolean;
}

export interface Variant {
  id: string;
  name: string;
  when: SizeRule;
  /** Node id -> properties to override when this variant applies. */
  patches: Record<string, Partial<LabelNode>>;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  schema: 2;
  /** Size the template was designed at (mm, printable area). Free layouts and text scaling are relative to it. */
  design: { w: number; h: number };
  /** Scale text sizes with the label (relative to `design`) before fitting. */
  scaleText?: boolean;
  root: FrameNode;
  fields: FieldDef[];
  variants?: Variant[];
  /**
   * Persistent counter (Settings > Counters) that numbers `{{seq}}` when
   * printing, instead of starting at 1. A "Start #" typed when printing still
   * overrides it.
   */
  seqCounter?: string;
  /** Invert the whole label by default (e.g. designs drawn for white ink on black tape). */
  invertByDefault?: boolean;
  /**
   * What an inverted label fills: the whole printable band ("bleed", default)
   * or only the area inside the margin ("content", leaves a clean border).
   */
  invertArea?: "bleed" | "content";
  /** Optional border drawn around the content area, mm (0 = none). */
  borderMm?: number;
  borderRadiusMm?: number;
  tags?: string[];
  /**
   * Rules applied to every label of this template when it is rendered
   * (conditions test field keys). See `resolveLabel` in rules.ts.
   */
  rules?: RuleSet;
  /**
   * Link to this record in another system (inventory, orders): a pattern
   * filled with the label's values, e.g. `https://inventory.example/parts/{{sku}}`.
   * Shown as "Open in inventory" on the label page and available as `{{recordUrl}}`.
   */
  recordUrl?: string;
}

/**
 * Values available to dynamic tokens at render time.
 * Tokens: {{date}}, {{date+30d:YYYY-MM-DD}}, {{time}}, {{seq}}, {{seq:000}}, {{copy}}, {{copies}},
 * {{counter:name}}, {{counter:name:000}}, {{team:name}}, {{labelUrl}}, {{recordUrl}} (see tokens.ts).
 */
export interface RenderContext {
  now?: Date;
  /** Sequence number for this copy (starts at the template/label's seqStart). */
  seq?: number;
  /** 1-based copy index within a print job, and total copies. */
  copy?: number;
  copies?: number;
  /** Persistent counter numbers for this copy by counter id, with the counter's display format. */
  counters?: Record<string, { n: number; format?: string }>;
  /** Id of the label being rendered, for `{{labelUrl}}` (layout fills it from the label when it has an id). */
  labelId?: string;
  /** Base URL of the label pages (`{{labelUrl}}` = base + `/l/<id>`); default: `setLabelUrlBase`, else the page origin. */
  baseUrl?: string;
  /** The template's `recordUrl` filled with this label's values (layout fills it). */
  recordUrl?: string;
  /** Team values for `{{team:name}}` (lower-case names); default: `setTeamValues`. */
  team?: Record<string, string>;
}

/** A concrete label: template + field values (+ optional per-node overrides). */
export interface Label {
  id: string;
  templateId: string;
  name: string;
  values: Record<string, string>;
  overrides?: Record<string, Partial<LabelNode>>;
  /** Overrides the template's invertByDefault when set. */
  invert?: boolean;
  tags?: string[];
}

export interface Library extends LibraryParts {
  version: 2;
  templates: Template[];
  labels: Label[];
}

export const matchesRule = (r: SizeRule | undefined, w: number, h: number) => {
  if (!r) return true;
  const a = w / h;
  return (
    (r.minW === undefined || w >= r.minW) &&
    (r.maxW === undefined || w <= r.maxW) &&
    (r.minH === undefined || h >= r.minH) &&
    (r.maxH === undefined || h <= r.maxH) &&
    (r.minAspect === undefined || a >= r.minAspect) &&
    (r.maxAspect === undefined || a <= r.maxAspect)
  );
};

/** Visit every node (pre-order). */
export function walk(node: LabelNode, fn: (n: LabelNode, parent: FrameNode | null) => void, parent: FrameNode | null = null) {
  fn(node, parent);
  if (node.type === "frame") for (const c of node.children) walk(c, fn, node);
}

export const findNode = (root: LabelNode, id: string): LabelNode | undefined => {
  let hit: LabelNode | undefined;
  walk(root, (n) => {
    if (n.id === id) hit = n;
  });
  return hit;
};

/**
 * Token resolver for `{{name}}` / `{{name:arg}}` placeholders that are not
 * plain fields (dates, sequence numbers...). Registered by `tokens.ts`.
 */
export type TokenResolver = (name: string, arg: string | undefined, ctx: RenderContext) => string | undefined;
let tokenResolver: TokenResolver = () => undefined;
export const setTokenResolver = (r: TokenResolver) => {
  tokenResolver = r;
};

/**
 * Filters for computed fields: `{{key|upper}}`, `{{key|pad:4}}`, chained left to right.
 * upper, lower, title, trim, pad:N (zero-pad), truncate:N, default:text,
 * prefix:text / suffix:text (only when the value is not empty), replace:from:to.
 */
export const FILTERS: Record<string, (v: string, arg?: string) => string> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  title: (v) => v.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()),
  trim: (v) => v.trim(),
  pad: (v, a) => v.padStart(Number(a) || 0, "0"),
  truncate: (v, a) => {
    const n = Number(a) || 0;
    return n > 0 && [...v].length > n ? [...v].slice(0, Math.max(1, n - 1)).join("") + "…" : v;
  },
  default: (v, a) => (v.trim() ? v : (a ?? "")),
  prefix: (v, a) => (v ? (a ?? "") + v : v),
  suffix: (v, a) => (v ? v + (a ?? "") : v),
  replace: (v, a) => {
    const i = (a ?? "").indexOf(":");
    return i < 0 ? v : v.split((a ?? "").slice(0, i)).join((a ?? "").slice(i + 1));
  },
};

export const applyFilters = (v: string, chain: string | undefined) => {
  if (!chain) return v;
  for (const f of chain.split("|").slice(1)) {
    const i = f.indexOf(":");
    const name = (i < 0 ? f : f.slice(0, i)).trim();
    const fn = FILTERS[name];
    if (fn) v = fn(v, i < 0 ? undefined : f.slice(i + 1));
  }
  return v;
};

/** `{{key}}`, `{{token:arg}}`, `{{date+30d:arg}}`, each optionally followed by `|filter[:arg]` chains. */
const PLACEHOLDER = /\{\{\s*([\w+-]+)(?::([^}|]*))?((?:\|[^}|]*)*)\s*\}\}/g;

export const fillPlaceholders = (text: string, values: Record<string, string>, ctx: RenderContext = {}) =>
  text.replace(PLACEHOLDER, (_, k: string, arg: string | undefined, chain: string | undefined) =>
    applyFilters(k in values && arg === undefined ? values[k] : (tokenResolver(k, arg, ctx) ?? values[k] ?? ""), chain),
  );

export const placeholdersIn = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);

/** The bound (user-text) property value of a node, if it has one. */
export const boundText = (n: LabelNode): string | undefined => {
  const key = (BOUND_PROPS as Record<string, string>)[n.type];
  return key ? ((n as unknown as Record<string, string>)[key] ?? "") : undefined;
};
