/**
 * Preflight: things that will print badly, found before printing.
 *
 * `preflight()` renders the label (or reuses a render) and turns what the
 * renderer reports per node (`RenderResult.facts`: final text size, whether it
 * fits, barcode module size and symbol position) plus the 1-bit output into
 * plain-language issues. Pure apart from the render itself, so the same checks
 * run in the browser and in Node tests (canvas seam).
 *
 * Thresholds are in printer dots, so the same template can be fine on the M2
 * (300 dpi) and too small on the N1 (203 dpi).
 */
import { CODE_FORMATS } from "./codes";
import type { LaidOut } from "./layout";
import { inkCoverage, renderLabel, type NodeFacts, type RenderOptions, type RenderResult } from "./render";
import { resolveLabel } from "./rules";
import { templateNodeId } from "./parts";
import { iconStatus, imageStatus } from "./elements";
import { placeholdersIn, boundText, type Label, type LabelNode, type Template } from "./schema";

export type PreflightSeverity = "error" | "warning" | "info";

export type PreflightRule =
  | "text-small"
  | "text-shrunk"
  | "text-overflow"
  | "code-invalid"
  | "code-too-small"
  | "code-thin"
  | "code-quiet-zone"
  | "code-reversed"
  | "dead-zone"
  | "bleed-strips"
  | "empty-field"
  | "not-loaded"
  | "heavy-ink";

export interface PreflightIssue {
  rule: PreflightRule;
  severity: PreflightSeverity;
  /** Template node the issue is about (none for label-wide issues). Copies in mirrored halves report the mirror frame. */
  nodeId?: string;
  /** Node name for display. */
  nodeName?: string;
  /** What is wrong, in plain words. */
  message: string;
  /** What to do about it. */
  fix?: string;
}

/** `labelMm` (on RenderOptions) lets checks tell the printhead band from the stock (N1 on 14 mm tape). */
export type PreflightOptions = RenderOptions;

/** Capital letters shorter than this (dots) are hard to read on a thermal print. */
export const MIN_CAP_DOTS = 7;
/** Narrowest reliable bar / module (dots). */
export const MIN_MODULE_DOTS = 2;
/** Ink coverage above which a normal (not inverted) label gets a note. */
export const HEAVY_INK = 0.7;
/** Text drawn at less than this fraction of its size counts as heavily shrunk. */
const SHRUNK = 0.7;

const ORDER: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 };

const TYPE_NAMES: Record<LabelNode["type"], string> = {
  frame: "Group",
  text: "Text",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  polygon: "Shape",
  image: "Picture",
  icon: "Icon",
  code: "Code",
  table: "Table",
  component: "Component",
};
const nameOf = (n: LabelNode) => n.name ?? (n.type === "text" ? n.text.split("\n")[0].slice(0, 24) || "Text" : TYPE_NAMES[n.type]);

/** Check one label. Pass `rendered` to reuse a render made with the same options. */
export function preflight(
  t: Template,
  label: Pick<Label, "values" | "overrides"> | undefined,
  o: PreflightOptions,
  rendered?: RenderResult,
): PreflightIssue[] {
  const r = rendered ?? renderLabel(t, label, o);
  const issues: PreflightIssue[] = [];
  const seen = new Set<string>();
  const add = (it: LaidOut | undefined, issue: Omit<PreflightIssue, "nodeId" | "nodeName">) => {
    // A mirrored copy reports on its mirror frame, once per rule.
    const id = it ? (it.copyOf ? it.node.id.split("~")[0] : it.node.id) : undefined;
    const key = `${issue.rule}\u0000${id ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const own = id ? r.layout.byId.get(id) : undefined;
    const node = own?.node ?? it?.node;
    // Unnamed text shows what it says on this label, not its {{placeholders}}.
    const name = node && (node.type === "text" && !node.name && own?.text?.trim() ? own.text.split("\n")[0].slice(0, 24) : nameOf(node));
    // Nodes inside a component instance report on the instance (the template node).
    issues.push({ ...issue, ...(id ? { nodeId: templateNodeId(id), nodeName: name } : {}) });
  };

  const across = acrossHead(o);
  const values = { ...Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ""])), ...(resolveLabel(t, label)?.values ?? {}) };
  const fieldLabel = new Map(t.fields.map((f) => [f.key, f.label || f.key]));
  const img = r.canvas.getContext("2d")!.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
  const dotAt = (x: number, y: number) => img[(y * r.canvas.width + x) * 4] === 0;

  for (const it of r.layout.items) {
    const f = r.facts.get(it.node.id);
    if (!f) continue;
    const isRoot = it === r.layout.items[0];
    if (it.node.type === "text") textChecks(it, f, add);
    if (it.node.type === "icon" && it.text?.trim() && ["error", "missing"].includes(iconStatus(it.text, !!it.node.filled)))
      add(it, { rule: "not-loaded", severity: "error", message: `The icon "${it.text.trim()}" didn't load, so a crossed box prints instead.`, fix: "Check the connection and try again, or pick another icon." });
    if (it.node.type === "image" && it.text?.trim() && imageStatus(it.text) === "error")
      add(it, { rule: "not-loaded", severity: "error", message: "The picture didn't load, so a crossed box prints instead.", fix: "Check the connection and try again, or pick another picture." });
    if (it.node.type === "code") codeChecks(it, f, o, add, dotAt);
    if (!isRoot && !it.copyOf) emptyFieldCheck(it, values, fieldLabel, add);
    if (!isRoot && paints(it.node) && outside(f, o)) {
      add(it, {
        rule: "dead-zone",
        severity: "warning",
        message: across.trimmed
          ? `Part of this is outside the ${fmt(across.bandMm)} mm the printer can reach on ${fmt(across.stockMm)} mm stock, so it will be cut off.`
          : "Part of this is outside the label, so it will be cut off.",
        fix: "Move it inwards or make it smaller.",
      });
    }
  }

  if (o.invert && t.invertArea !== "content" && across.trimmed && across.stockMm - across.bandMm > 0.5)
    add(undefined, {
      rule: "bleed-strips",
      severity: "info",
      message: `The printer can't reach the outer ${fmt((across.stockMm - across.bandMm) / 2)} mm of ${fmt(across.stockMm)} mm stock, so the black background leaves thin unprinted strips along the edges.`,
      fix: "Expected on this tape. For a tidy look use a border (Template > Inverted area: inside the margin).",
    });

  const ink = inkCoverage(r.canvas);
  // Inverted labels are solid by design, so only a normal label this heavy is worth a note.
  if (!o.invert && ink > HEAVY_INK)
    add(undefined, {
      rule: "heavy-ink",
      severity: "info",
      message: `${Math.round(ink * 100)}% of this label is printed solid, which uses a lot of ribbon.`,
      fix: "Lower the darkness if it smudges.",
    });

  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

type Add = (it: LaidOut | undefined, issue: Omit<PreflightIssue, "nodeId" | "nodeName">) => void;

function textChecks(it: LaidOut, f: NodeFacts, add: Add) {
  const tf = f.text;
  if (!tf) return;
  if (tf.pixelScale !== undefined ? tf.pixelScale < 0.95 : tf.capDots < MIN_CAP_DOTS)
    add(it, {
      rule: "text-small",
      severity: "warning",
      message:
        tf.pixelScale !== undefined
          ? "Text too small for this pixel font at this size: some of its pixels get dropped."
          : `Text too small to read at this size (letters are only ${Math.max(1, Math.round(tf.capDots))} dots tall).`,
      fix: "Make the box bigger or shorten the text.",
    });
  else if (tf.usedPt < tf.requestedPt * SHRUNK)
    add(it, {
      rule: "text-shrunk",
      severity: "info",
      message: `Text shrunk to ${fmt(tf.usedPt, 1)} pt (of ${fmt(tf.requestedPt, 1)} pt) to fit.`,
      fix: "Make the box bigger or shorten the text to keep it larger.",
    });
  if (tf.overflow)
    add(it, {
      rule: "text-overflow",
      severity: "warning",
      message: "Text doesn't fit its box, so it may be cut off or run into other things.",
      fix: "Make the box bigger, shorten the text, or let it shrink (Fit: shrink) with a smaller minimum size.",
    });
}

function codeChecks(it: LaidOut, f: NodeFacts, o: PreflightOptions, add: Add, dotAt: (x: number, y: number) => boolean) {
  const c = f.code;
  const n = it.node;
  if (!c || n.type !== "code" || c.empty || c.pending) return;
  const info = CODE_FORMATS[n.format];
  if (c.error) return add(it, { rule: "code-invalid", severity: "error", message: c.error, fix: "Change the value or pick another kind of code." });
  if (c.tooSmall || !c.symbol || !c.module)
    return add(it, { rule: "code-too-small", severity: "error", message: "Code too small to print.", fix: "Make it bigger or shorten the value." });
  const thin = Math.min(c.module, info.shape === "rect" && c.moduleH ? c.moduleH : c.module);
  if (thin < MIN_MODULE_DOTS)
    add(it, {
      rule: "code-thin",
      severity: "warning",
      message: `The ${info.shape === "1d" ? "bars" : "squares"} of this code are only 1 dot wide, too fine for most scanners.`,
      fix: "Make the code bigger or shorten the value.",
    });

  // Blank margin: sample the printed result around the symbol (anything printed there, inverted backgrounds included).
  const s = c.symbol;
  const q = Math.max(1, c.quietModules) * c.module;
  const sideways = n.rotate === 90 || n.rotate === 270;
  const horizontal = info.shape !== "1d" || !sideways; // 1D codes need the margin across the bars only
  const vertical = info.shape !== "1d" || sideways;
  const extra = stockMarginDots(o);
  let dots = 0, total = 0, outsideStock = 0;
  const sample = (x: number, y: number) => {
    total++;
    if (x < 0 || y < 0 || x >= o.w || y >= o.h) {
      // Off the printed band: blank stock, unless it is off the label too.
      if (x < -extra.x || y < -extra.y || x >= o.w + extra.x || y >= o.h + extra.y) outsideStock++;
      return;
    }
    if (dotAt(x, y)) dots++;
  };
  const step = Math.max(1, Math.floor(q / 4));
  // Whole dots: a symbol placed at a half dot must not count its own edge bars as the margin.
  const x0 = Math.floor(s.x), x1 = Math.ceil(s.x + s.w), y0 = Math.floor(s.y), y1 = Math.ceil(s.y + s.h);
  for (let y = y0 - (vertical ? q : 0); y < y1 + (vertical ? q : 0); y += step)
    for (let x = x0 - (horizontal ? q : 0); x < x1 + (horizontal ? q : 0); x += step) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inside) sample(x, y);
    }
  if (!total) return;
  if (dots / total > 0.5)
    add(it, {
      rule: "code-reversed",
      severity: "warning",
      message: "This code prints light on dark. Many scanners and phones can't read reversed codes.",
      fix: "Print it dark on light: change its color, or put it on a white area.",
    });
  else if (c.quietModules > 0 && (dots / total > 0.03 || outsideStock / total > 0.03))
    add(it, {
      rule: "code-quiet-zone",
      severity: "warning",
      message: "There isn't enough blank space around this code, so scanners may not find it.",
      fix: c.quietZone ? "Move other things away from it, or move it in from the edge." : 'Turn on "Blank margin (quiet zone)", or move other things away from it.',
    });
}

function emptyFieldCheck(it: LaidOut, values: Record<string, string>, fieldLabel: Map<string, string>, add: Add) {
  const raw = boundText(it.node);
  if (raw === undefined || it.text?.trim()) return;
  const empty = placeholdersIn(raw).filter((k) => fieldLabel.has(k) && !values[k]?.trim());
  if (!empty.length) return;
  const names = empty.map((k) => `"${fieldLabel.get(k)}"`).join(", ");
  add(it, {
    rule: "empty-field",
    severity: "warning",
    message: `${names} ${empty.length > 1 ? "are" : "is"} empty, so this prints nothing.`,
    fix: "Fill it in, or hide this element on labels that don't need it.",
  });
}

/** Does the node put dots on the label (frames only with a fill or outline)? */
function paints(n: LabelNode) {
  if (n.hidden) return false;
  if (n.type === "frame") return (!!n.fill && n.fill !== "none") || (!!n.stroke && n.stroke !== "none" && !!n.strokeMm);
  if (n.type === "text") return !!n.text.trim();
  return true;
}

/** Box runs off the printed band by more than a dot. */
const outside = (f: NodeFacts, o: RenderOptions) => f.box.x < -1 || f.box.y < -1 || f.box.x + f.box.w > o.w + 1 || f.box.y + f.box.h > o.h + 1;

/** Blank stock beyond the printed band on each side, in dots. */
function stockMarginDots(o: PreflightOptions) {
  if (!o.labelMm) return { x: 0, y: 0 };
  return { x: Math.max(0, (o.labelMm.w * o.dpmm - o.w) / 2), y: Math.max(0, (o.labelMm.h * o.dpmm - o.h) / 2) };
}

/** Across-head size of the band vs the stock (N1: 12 mm band on 14 mm tape). */
function acrossHead(o: PreflightOptions) {
  if (!o.labelMm) return { trimmed: false, bandMm: 0, stockMm: 0 };
  const dw = o.labelMm.w - o.w / o.dpmm, dh = o.labelMm.h - o.h / o.dpmm;
  const useH = dh >= dw;
  return { trimmed: Math.max(dw, dh) > 0.5, bandMm: useH ? o.h / o.dpmm : o.w / o.dpmm, stockMm: useH ? o.labelMm.h : o.labelMm.w };
}

const fmt = (v: number, digits = 1) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/** Worst severity and counts, for badges. */
export function preflightSummary(issues: PreflightIssue[]) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const worst: PreflightSeverity | null = counts.error ? "error" : counts.warning ? "warning" : counts.info ? "info" : null;
  return { worst, counts };
}

/** Issues grouped by node id (for per-layer badges). */
export function issuesByNode(issues: PreflightIssue[]) {
  const m = new Map<string, PreflightIssue[]>();
  for (const i of issues) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
  return m;
}
