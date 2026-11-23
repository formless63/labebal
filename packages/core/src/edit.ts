/**
 * Pure editing helpers for template trees (used by the GUI editor).
 *
 * Every function is immutable: it returns a new tree (sharing untouched
 * subtrees) and never mutates its input. Framework-free.
 */
import { BOUND_PROPS, walk, type FrameNode, type Label, type LabelNode, type Template } from "./schema";
import type { Box } from "./layout";

/* ------------------------------------------------------------------ ids */

let counter = 0;
/** Short unique id, e.g. `text-k3j9x2`. */
export function newId(prefix = "n") {
  const rnd = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}${(counter++).toString(36)}`;
}

/* -------------------------------------------------------------- queries */

/** Parent frame of a node (null for the root or when not found). */
export function findParent(root: FrameNode, id: string): FrameNode | null {
  let hit: FrameNode | null = null;
  walk(root, (n, p) => {
    if (n.id === id) hit = p;
  });
  return hit;
}

/** Chain of nodes from the root down to `id` (inclusive), or null. */
export function findPath(root: LabelNode, id: string): LabelNode[] | null {
  if (root.id === id) return [root];
  if (root.type !== "frame") return null;
  for (const c of root.children) {
    const p = findPath(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

/** True when `id` is `ancestorId` or somewhere inside it. */
export function isInside(root: FrameNode, ancestorId: string, id: string) {
  return !!findPath(root, id)?.some((n) => n.id === ancestorId);
}

/** All ids in a subtree (pre-order). */
export function subtreeIds(n: LabelNode) {
  const ids: string[] = [];
  walk(n, (x) => ids.push(x.id));
  return ids;
}

/** Drop ids whose ancestor is also in the list (so a subtree is only handled once). */
export function topmost(root: FrameNode, ids: string[]) {
  const set = new Set(ids);
  return ids.filter((id) => !findPath(root, id)?.slice(0, -1).some((a) => set.has(a.id)));
}

/* ------------------------------------------------------------ transforms */

/** Replace one node (anywhere in the tree) with `fn(node)`. */
export function mapNode(root: FrameNode, id: string, fn: (n: LabelNode) => LabelNode): FrameNode {
  const rec = (n: LabelNode): LabelNode => {
    if (n.id === id) return fn(n);
    if (n.type !== "frame") return n;
    let changed = false;
    const children = n.children.map((c) => {
      const r = rec(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...n, children } : n;
  };
  const r = rec(root);
  if (r.type !== "frame") throw new Error("root must stay a frame");
  return r;
}

/** Shallow-merge a patch into a node; keys set to `undefined` are removed. */
export function applyPatch<T extends object>(node: T, patch: Partial<T> | Record<string, unknown>): T {
  const out = { ...node } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

export const patchNode = (root: FrameNode, id: string, patch: Partial<LabelNode>) =>
  mapNode(root, id, (n) => applyPatch(n, patch as Partial<typeof n>));

/** Remove nodes (the root itself is never removed). */
export function removeNodes(root: FrameNode, ids: string[]): FrameNode {
  const set = new Set(ids);
  const rec = (n: FrameNode): FrameNode => {
    let changed = false;
    const children: LabelNode[] = [];
    for (const c of n.children) {
      if (set.has(c.id)) {
        changed = true;
        continue;
      }
      const r = c.type === "frame" ? rec(c) : c;
      if (r !== c) changed = true;
      children.push(r);
    }
    return changed ? { ...n, children } : n;
  };
  return rec(root);
}

/** Insert a node into a frame at `index` (clamped; -1 or omitted = end). */
export function insertNode(root: FrameNode, parentId: string, node: LabelNode, index = -1): FrameNode {
  return mapNode(root, parentId, (p) => {
    if (p.type !== "frame") throw new Error(`${parentId} is not a frame`);
    const children = [...p.children];
    const i = index < 0 || index > children.length ? children.length : index;
    children.splice(i, 0, node);
    return { ...p, children };
  });
}

/**
 * Move a node into `parentId` at `index` (index counts the target's children
 * after the node has been taken out). Returns the tree unchanged when the move
 * is impossible (root, missing ids, or moving a frame into itself).
 */
export function moveNode(root: FrameNode, id: string, parentId: string, index = -1): FrameNode {
  if (id === root.id) return root;
  const node = findPath(root, id)?.at(-1);
  const target = findPath(root, parentId)?.at(-1);
  if (!node || !target || target.type !== "frame" || isInside(root, id, parentId)) return root;
  return insertNode(removeNodes(root, [id]), parentId, node, index);
}

/** Deep copy with new ids for every node. */
export function cloneWithFreshIds<T extends LabelNode>(node: T, makeId: (old: LabelNode) => string = (n) => newId(n.type)) {
  const idMap: Record<string, string> = {};
  const rec = (n: LabelNode): LabelNode => {
    const id = makeId(n);
    idMap[n.id] = id;
    const copy = { ...structuredClone(n), id } as LabelNode;
    if (copy.type === "frame" && n.type === "frame") copy.children = n.children.map(rec);
    return copy;
  };
  return { node: rec(node) as T, idMap };
}

/**
 * Duplicate nodes next to their originals. Nodes in free frames are offset by
 * `offset` mm so the copy is visible. Returns the new ids in the input order.
 */
export function duplicateNodes(root: FrameNode, ids: string[], offset = 1): { root: FrameNode; ids: string[]; idMap: Record<string, string> } {
  const out: string[] = [];
  const idMap: Record<string, string> = {};
  let r = root;
  for (const id of topmost(root, ids.filter((x) => x !== root.id))) {
    const parent = findParent(r, id);
    if (!parent) continue;
    const index = parent.children.findIndex((c) => c.id === id);
    const { node, idMap: m } = cloneWithFreshIds(parent.children[index]);
    Object.assign(idMap, m);
    if (parent.layout === "free") {
      node.x = r2((node.x ?? 0) + offset);
      node.y = r2((node.y ?? 0) + offset);
    }
    r = insertNode(r, parent.id, node, index + 1);
    out.push(node.id);
  }
  return { root: r, ids: out, idMap };
}

/**
 * Move several nodes into `parentId` at `index`, keeping their relative tree
 * order (index counts the target's children after the nodes have been taken
 * out). Nodes inside other moved nodes travel with them; the root, missing ids
 * and moves into a moved node itself are skipped.
 */
export function moveNodes(root: FrameNode, ids: string[], parentId: string, index = -1): FrameNode {
  const target = findPath(root, parentId)?.at(-1);
  if (!target || target.type !== "frame") return root;
  const wanted = new Set(topmost(root, ids.filter((id) => id !== root.id)).filter((id) => !isInside(root, id, parentId)));
  const nodes: LabelNode[] = [];
  walk(root, (n) => {
    if (wanted.has(n.id)) nodes.push(n);
  });
  if (!nodes.length) return root;
  let r = removeNodes(root, nodes.map((n) => n.id));
  const len = (findPath(r, parentId)!.at(-1) as FrameNode).children.length;
  const at = index < 0 || index > len ? len : index;
  nodes.forEach((n, i) => (r = insertNode(r, parentId, n, at + i)));
  return r;
}

const r2 = (v: number) => Math.round(v * 1000) / 1000;

const union = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export interface WrapOptions {
  id?: string;
  name?: string;
  /**
   * Current boxes of the wrapped nodes in the parent's content space (design
   * size, mm). Needed to size/position the new frame; falls back to the nodes'
   * own x/y and fixed sizes.
   */
  boxes?: Record<string, Box>;
}

/**
 * Wrap sibling nodes in a new frame (at the position of the first one).
 * Returns null when the ids are not siblings or include the root.
 */
export function wrapNodes(root: FrameNode, ids: string[], layout: FrameNode["layout"], opts: WrapOptions = {}): { root: FrameNode; id: string } | null {
  if (!ids.length || ids.includes(root.id)) return null;
  const parent = findParent(root, ids[0]);
  if (!parent || ids.some((id) => findParent(root, id)?.id !== parent.id)) return null;
  const set = new Set(ids);
  const kids = parent.children.filter((c) => set.has(c.id));
  const index = parent.children.findIndex((c) => set.has(c.id));
  const boxOf = (n: LabelNode): Box =>
    opts.boxes?.[n.id] ?? { x: n.x ?? 0, y: n.y ?? 0, w: n.w.kind === "fixed" ? n.w.mm : 0, h: n.h.kind === "fixed" ? n.h.mm : 0 };
  const bounds = union(kids.map(boxOf));

  const children = kids.map((k) => {
    const c = { ...k } as LabelNode;
    if (layout === "free") {
      const b = boxOf(k);
      c.x = r2(b.x - bounds.x);
      c.y = r2(b.y - bounds.y);
    } else {
      delete c.x;
      delete c.y;
      delete c.ax;
      delete c.ay;
    }
    return c;
  });

  const fixedBounds = layout === "free" || parent.layout === "free";
  const frame: FrameNode = {
    id: opts.id ?? newId("frame"),
    name: opts.name ?? (layout === "row" ? "Row" : layout === "column" ? "Column" : "Group"),
    type: "frame",
    layout,
    w: fixedBounds ? { kind: "fixed", mm: r2(bounds.w) } : { kind: "hug" },
    h: fixedBounds ? { kind: "fixed", mm: r2(bounds.h) } : { kind: "hug" },
    ...(layout !== "free" ? { gap: 0, align: "start" as const } : {}),
    children,
  };
  if (parent.layout === "free") {
    frame.x = r2(bounds.x);
    frame.y = r2(bounds.y);
  }
  let r = removeNodes(root, ids);
  r = insertNode(r, parent.id, frame, index);
  return { root: r, id: frame.id };
}

/**
 * Replace a frame by its children. When the frame sits in a free frame, child
 * positions are converted to the outer frame (from `boxes`, in the outer
 * frame's content space, or from the frame's own x/y + padding).
 */
export function unwrapNode(root: FrameNode, id: string, boxes?: Record<string, Box>): FrameNode {
  if (id === root.id) return root;
  const parent = findParent(root, id);
  const frame = parent?.children.find((c) => c.id === id);
  if (!parent || !frame || frame.type !== "frame") return root;
  const index = parent.children.indexOf(frame);
  const [pt, , , pl] = frame.padding ?? [0, 0, 0, 0];
  const kids = frame.children.map((k) => {
    const c = { ...k } as LabelNode;
    if (parent.layout === "free") {
      const b = boxes?.[k.id];
      c.x = r2(b ? b.x : (frame.x ?? 0) + pl + (frame.layout === "free" ? (k.x ?? 0) : 0));
      c.y = r2(b ? b.y : (frame.y ?? 0) + pt + (frame.layout === "free" ? (k.y ?? 0) : 0));
    }
    return c;
  });
  return mapNode(root, parent.id, (p) => {
    const f = p as FrameNode;
    const children = [...f.children];
    children.splice(index, 1, ...kids);
    return { ...f, children };
  });
}

/* --------------------------------------------------------------- variants */

/** Base node merged with a variant's patch for it. */
export function effectiveNode(t: Template, id: string, variantId?: string | null): LabelNode | undefined {
  const base = findPath(t.root, id)?.at(-1);
  if (!base) return undefined;
  const patch = variantId ? t.variants?.find((v) => v.id === variantId)?.patches[id] : undefined;
  return patch ? ({ ...base, ...patch } as LabelNode) : base;
}

/**
 * Merge `patch` into `variant.patches[nodeId]`. Keys set to `undefined` drop
 * the override (back to the base value). Empty patches are removed.
 */
export function setVariantPatch(t: Template, variantId: string, nodeId: string, patch: Partial<LabelNode> | Record<string, unknown>): Template {
  return {
    ...t,
    variants: (t.variants ?? []).map((v) => {
      if (v.id !== variantId) return v;
      const next = applyPatch((v.patches[nodeId] ?? {}) as Record<string, unknown>, patch as Record<string, unknown>);
      const patches = { ...v.patches };
      if (Object.keys(next).length) patches[nodeId] = next as Partial<LabelNode>;
      else delete patches[nodeId];
      return { ...v, patches };
    }),
  };
}

/* ------------------------------------------- structural edits in variants
 *
 * A variant only patches properties, so structure is expressed through
 * visibility: an element added while editing a variant lives in the base tree
 * with `hidden: true` and the variant patches it back to `hidden: false`
 * ("only in this variant"). Deleting while editing a variant hides the element
 * in that variant instead of removing it everywhere. Nothing new in the
 * document format: older readers just see `hidden` + patches.
 */

/** Variants that show a node which is hidden in the base tree. */
export function variantsShowing(t: Template, id: string): string[] {
  const base = findPath(t.root, id)?.at(-1);
  if (!base?.hidden) return [];
  return (t.variants ?? []).filter((v) => v.patches[id]?.hidden === false).map((v) => v.id);
}

/** True when the node exists only for this variant (hidden in the base, shown by this variant and no other). */
export function isVariantOnly(t: Template, id: string, variantId: string) {
  const v = variantsShowing(t, id);
  return v.length === 1 && v[0] === variantId;
}

/** Make nodes appear only in a variant: hidden in the base tree, shown by the variant. */
export function markVariantOnly(t: Template, variantId: string, ids: string[]): Template {
  if (!t.variants?.some((v) => v.id === variantId)) return t;
  let out = t;
  for (const id of ids) {
    if (!findPath(out.root, id)) continue;
    out = { ...out, root: patchNode(out.root, id, { hidden: true }) };
    out = setVariantPatch(out, variantId, id, { hidden: false });
  }
  return out;
}

/** Insert a node that only shows when `variantId` applies. */
export function addToVariant(t: Template, variantId: string, parentId: string, node: LabelNode, index = -1): Template {
  return markVariantOnly({ ...t, root: insertNode(t.root, parentId, node, index) }, variantId, [node.id]);
}

/**
 * "Delete" while editing a variant: nodes that exist only for this variant are
 * removed for real; everything else is hidden in this variant's patches (other
 * sizes keep it).
 */
export function hideInVariant(t: Template, variantId: string, ids: string[]): Template {
  if (!t.variants?.some((v) => v.id === variantId)) return t;
  const top = topmost(t.root, ids.filter((id) => id !== t.root.id && findPath(t.root, id)));
  const gone = top.filter((id) => isVariantOnly(t, id, variantId));
  let out: Template = gone.length ? prunePatches({ ...t, root: removeNodes(t.root, gone) }) : t;
  for (const id of top) if (!gone.includes(id)) out = setVariantPatch(out, variantId, id, { hidden: true });
  return out;
}

/** Copy one variant's patches from original nodes to their copies (after duplicating / pasting). */
export function copyVariantPatches(t: Template, variantId: string, idMap: Record<string, string>): Template {
  const v = t.variants?.find((x) => x.id === variantId);
  if (!v) return t;
  let out = t;
  for (const [from, to] of Object.entries(idMap)) if (v.patches[from]) out = setVariantPatch(out, variantId, to, structuredClone(v.patches[from]));
  return out;
}

/** Drop patches for nodes that no longer exist in the tree. */
export function prunePatches(t: Template): Template {
  if (!t.variants?.length) return t;
  const ids = new Set(subtreeIds(t.root));
  return {
    ...t,
    variants: t.variants.map((v) => ({
      ...v,
      patches: Object.fromEntries(Object.entries(v.patches).filter(([id]) => ids.has(id))),
    })),
  };
}

/* ----------------------------------------------------------------- fields */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rename `{{old}}` / `{{old:arg}}` placeholders in a string. */
export function renamePlaceholder(text: string, oldKey: string, newKey: string) {
  // Keeps token args (`:x`) and filter chains (`|upper`) after the key.
  return text.replace(new RegExp(`\\{\\{(\\s*)${escapeRe(oldKey)}(\\s*(?:[:|][^}]*)?)\\}\\}`, "g"), `{{$1${newKey}$2}}`);
}

const renameInNode = <T extends Partial<LabelNode>>(n: T, type: LabelNode["type"] | undefined, oldKey: string, newKey: string): T => {
  const prop = type ? (BOUND_PROPS as Record<string, string>)[type] : undefined;
  const rec = n as Record<string, unknown>;
  if (!prop || typeof rec[prop] !== "string") return n;
  const next = renamePlaceholder(rec[prop] as string, oldKey, newKey);
  return next === rec[prop] ? n : ({ ...n, [prop]: next } as T);
};

/**
 * Rename a field: its definition and every `{{key}}` placeholder in the tree and
 * in variant patches. No-op if `newKey` is already used by another field.
 */
export function renameField(t: Template, oldKey: string, newKey: string): Template {
  if (oldKey === newKey || !newKey || t.fields.some((f) => f.key === newKey)) return t;
  const types = new Map<string, LabelNode["type"]>();
  walk(t.root, (n) => types.set(n.id, n.type));
  const rec = (n: LabelNode): LabelNode => {
    const r = renameInNode(n, n.type, oldKey, newKey);
    return r.type === "frame" ? { ...r, children: r.children.map(rec) } : r;
  };
  return {
    ...t,
    fields: t.fields.map((f) => (f.key === oldKey ? { ...f, key: newKey } : f)),
    root: rec(t.root) as FrameNode,
    variants: t.variants?.map((v) => ({
      ...v,
      patches: Object.fromEntries(Object.entries(v.patches).map(([id, p]) => [id, renameInNode(p, types.get(id), oldKey, newKey)])),
    })),
  };
}

/** Same rename applied to a label's values (so existing labels keep their data). */
export function renameLabelField(l: Label, oldKey: string, newKey: string): Label {
  if (!(oldKey in l.values) || oldKey === newKey) return l;
  const values = { ...l.values, [newKey]: l.values[oldKey] };
  delete values[oldKey];
  return { ...l, values };
}

/** Ids of nodes whose bound text uses `{{key}}`. */
export function nodesUsingField(t: Template, key: string) {
  const re = new RegExp(`\\{\\{\\s*${escapeRe(key)}\\s*(?::[^}]*)?\\}\\}`);
  const ids: string[] = [];
  walk(t.root, (n) => {
    const prop = (BOUND_PROPS as Record<string, string>)[n.type];
    const v = prop ? (n as unknown as Record<string, unknown>)[prop] : undefined;
    if (typeof v === "string" && re.test(v)) ids.push(n.id);
  });
  return ids;
}

/* ------------------------------------------------------ align / snapping */

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Offsets that align boxes to each other (their union), or to `bounds` when
 * given (e.g. the parent frame when only one box is selected).
 */
export function alignBoxes(boxes: Box[], mode: AlignMode, bounds?: Box): { dx: number; dy: number }[] {
  if (!boxes.length) return [];
  const u = bounds ?? union(boxes);
  return boxes.map((b) => {
    switch (mode) {
      case "left":
        return { dx: u.x - b.x, dy: 0 };
      case "right":
        return { dx: u.x + u.w - (b.x + b.w), dy: 0 };
      case "hcenter":
        return { dx: u.x + u.w / 2 - (b.x + b.w / 2), dy: 0 };
      case "top":
        return { dx: 0, dy: u.y - b.y };
      case "bottom":
        return { dx: 0, dy: u.y + u.h - (b.y + b.h) };
      case "vcenter":
        return { dx: 0, dy: u.y + u.h / 2 - (b.y + b.h / 2) };
    }
  });
}

/** Offsets that space boxes evenly (equal gaps) between the outermost two. */
export function distributeBoxes(boxes: Box[], axis: "h" | "v"): { dx: number; dy: number }[] {
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const pos = (b: Box) => (axis === "h" ? b.x : b.y);
  const len = (b: Box) => (axis === "h" ? b.w : b.h);
  const order = boxes.map((b, i) => ({ b, i })).sort((a, z) => pos(a.b) - pos(z.b));
  const first = order[0].b;
  const last = order.reduce((m, o) => (pos(o.b) + len(o.b) > pos(m) + len(m) ? o.b : m), first);
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - boxes.reduce((a, b) => a + len(b), 0)) / (boxes.length - 1);
  let at = pos(first);
  for (const { b, i } of order) {
    const d = at - pos(b);
    out[i] = axis === "h" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    at += len(b) + gap;
  }
  return out;
}

/**
 * Snap along one axis: given the moving edges (e.g. left, centre, right) and
 * candidate lines, returns the smallest offset that lines one up, if within
 * `threshold`.
 */
export function snapAxis(moving: number[], targets: number[], threshold: number): { offset: number; line: number } | null {
  let best: { offset: number; line: number } | null = null;
  for (const m of moving)
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, line: t };
    }
  return best;
}

/** Edges and centre of a box along one axis. */
export const edgesOf = (b: Box, axis: "x" | "y") => (axis === "x" ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h]);
