"use client";
/**
 * Editing operations used by the canvas, layers, toolbar and shortcuts. They
 * read the latest layout from `geometry.getGeo()` to convert between what is on
 * screen and what is stored, and commit through the editor store.
 */
import { toast } from "sonner";
import {
  addToVariant,
  alignBoxes,
  detachInstance,
  detachTextStyle,
  getLibraryParts,
  instanceChildId,
  mapNode,
  newId,
  subtreeIds,
  textStyleProps,
  withTextStyle,
  wouldCycle,
  type ComponentNode,
  type LabelComponent,
  type TextNode,
  type TextStyle,
  cloneWithFreshIds,
  copyVariantPatches,
  distributeBoxes,
  duplicateNodes,
  effectiveNode,
  findParent,
  findPath,
  hideInVariant,
  insertNode,
  markVariantOnly,
  moveNodes,
  patchNode,
  prunePatches,
  removeNodes,
  topmost,
  unwrapNode,
  wrapNodes,
  type AlignMode,
  type Box,
  type FrameNode,
  type LabelNode,
  type Template,
} from "@labebal/core";
import { contentOf, getGeo, r3, toDesign } from "./geometry";
import { editorLibrary } from "./library";
import { makeNode, type AddKind } from "./nodes";
import { useEditor, writeProps } from "./store";

const state = () => useEditor.getState();
const tpl = () => state().template!;

export const nodeById = (t: Template, id: string) => findPath(t.root, id)?.at(-1);

/** Layout of the parent as currently shown (respects variants). */
function shownParent(t: Template, id: string) {
  const parent = findParent(t.root, id);
  if (!parent) return null;
  const shown = getGeo()?.actual.byId.get(parent.id)?.node as FrameNode | undefined;
  return shown ?? parent;
}

/** Placed by position: in a free frame, or floating in a row / column. */
export const inFreeParent = (t: Template, id: string) => shownParent(t, id)?.layout === "free" || !!effectiveNode(t, id, state().variantId)?.float;

/** Everything needed to move/resize a free-layout child on screen. */
export function freeInfo(id: string) {
  const geo = getGeo();
  const t = tpl();
  const parent = findParent(t.root, id);
  if (!geo || !parent) return null;
  const pa = geo.actual.byId.get(parent.id);
  const it = geo.actual.byId.get(id);
  if (!pa || !it || ((pa.node as FrameNode).layout !== "free" && !it.node.float)) return null;
  const P = contentOf(pa);
  const pd = geo.design.byId.get(parent.id);
  const D = pd ? contentOf(pd) : P;
  const node = effectiveNode(t, id, state().variantId)!;
  return { node, parentId: parent.id, P, D, rel: { x: it.box.x - P.x, y: it.box.y - P.y, w: it.box.w, h: it.box.h } };
}

type FreeInfo = NonNullable<ReturnType<typeof freeInfo>>;

/** Design-space patch that puts a free child at `rel` (parent content space, as shown). */
export function freePatch(info: FreeInfo, rel: Box, what: { pos?: boolean; size?: boolean }) {
  const [dx, dw] = toDesign(info.node.ax ?? "start", rel.x, rel.w, info.D.w, info.P.w);
  const [dy, dh] = toDesign(info.node.ay ?? "start", rel.y, rel.h, info.D.h, info.P.h);
  const patch: Partial<LabelNode> = {};
  if (what.pos) Object.assign(patch, { x: r3(dx), y: r3(dy) });
  if (what.size) Object.assign(patch, { w: { kind: "fixed", mm: r3(Math.max(0.1, dw)) }, h: { kind: "fixed", mm: r3(Math.max(0.1, dh)) } });
  return patch;
}

/** Where new / pasted nodes go: into the selected frame, after the selected node, or into the root. */
function insertionPoint(t: Template): { parentId: string; index: number } {
  const sel = state().selection;
  const last = sel.at(-1);
  const node = last ? nodeById(t, last) : undefined;
  if (node?.type === "frame") return { parentId: node.id, index: -1 };
  if (node) {
    const parent = findParent(t.root, node.id)!;
    return { parentId: parent.id, index: parent.children.findIndex((c) => c.id === node.id) + 1 };
  }
  return { parentId: t.root.id, index: -1 };
}

/** Centre of a frame's content at design size (for placing new free children). */
function designCentre(parentId: string) {
  const it = getGeo()?.design.byId.get(parentId);
  if (!it) return { x: 1, y: 1 };
  const c = contentOf(it);
  return { x: c.w / 2, y: c.h / 2 };
}

export function addNode(kind: AddKind, extra: { field?: string; font?: string } = {}) {
  const t = tpl();
  const { parentId, index } = insertionPoint(t);
  const parent = nodeById(t, parentId) as FrameNode;
  const free = (getGeo()?.actual.byId.get(parentId)?.node as FrameNode | undefined)?.layout === "free" || parent.layout === "free";
  const node = makeNode(kind, { free, ...extra });
  if (free) {
    const c = designCentre(parentId);
    const w = node.w.kind === "fixed" ? node.w.mm : 6;
    const h = node.h.kind === "fixed" ? node.h.mm : 3;
    node.x = r3(Math.max(0, c.x - w / 2));
    node.y = r3(Math.max(0, c.y - h / 2));
  }
  const variant = activeVariant();
  if (variant) {
    // Added while editing a variant: only exists on that variant's sizes.
    state().commit((x) => addToVariant(x, variant.id, parentId, node, index));
    if (!getGeo()?.actual.variants.includes(variant.id))
      toast.info(`Added to “${variant.name}” only. It shows on sizes where this variant applies, not at the size shown now.`);
  } else state().commit((x) => ({ ...x, root: insertNode(x.root, parentId, node, index) }));
  state().select([node.id]);
}

/** The variant being edited, if any. */
export function activeVariant() {
  const { variantId, template } = state();
  return (variantId && template?.variants?.find((v) => v.id === variantId)) || null;
}

/**
 * Edits that can't be limited to a variant (grouping, reordering...). Returns
 * true and explains when one is attempted while editing a variant.
 */
export function blockedInVariant(what: string) {
  const v = activeVariant();
  if (!v) return false;
  toast.info(`${what} changes every label size, so it's not available while editing the variant “${v.name}”. Click Done in the yellow bar first.`);
  return true;
}

/** Delete; while editing a variant, hide on that variant's sizes instead (elements added only for it are removed). */
export function deleteSelection() {
  const t = tpl();
  const ids = state().selection.filter((id) => id !== t.root.id);
  if (!ids.length) return;
  const variant = activeVariant();
  if (variant) state().commit((x) => hideInVariant(x, variant.id, ids));
  else state().commit((x) => prunePatches({ ...x, root: removeNodes(x.root, ids) }));
  state().select([]);
}

export function duplicateSelection() {
  const ids = state().selection;
  if (!ids.length) return;
  const variant = activeVariant();
  let out: string[] = [];
  state().commit((x) => {
    const r = duplicateNodes(x.root, ids);
    out = r.ids;
    if (!variant) return { ...x, root: r.root };
    // In a variant the copies keep that variant's changes and only show on its sizes.
    return markVariantOnly(copyVariantPatches({ ...x, root: r.root }, variant.id, r.idMap), variant.id, r.ids);
  });
  state().select(out);
}

/* ------------------------------------------------------------- clipboard */

const CLIP_KEY = "labebal:editor-clipboard";
let clipboard: LabelNode[] = [];

export function copySelection() {
  const t = tpl();
  const nodes = topmost(t.root, state().selection.filter((id) => id !== t.root.id))
    .map((id) => effectiveNode(t, id, state().variantId))
    .filter((n): n is LabelNode => !!n);
  if (!nodes.length) return false;
  clipboard = structuredClone(nodes);
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(nodes));
  } catch {
    // storage full / disabled: in-memory clipboard still works
  }
  return true;
}

export function paste() {
  let nodes = clipboard;
  try {
    const raw = localStorage.getItem(CLIP_KEY);
    if (raw) nodes = JSON.parse(raw) as LabelNode[];
  } catch {
    // ignore
  }
  if (!nodes.length) return false;
  const t = tpl();
  const { parentId, index } = insertionPoint(t);
  const free = (nodeById(t, parentId) as FrameNode).layout === "free";
  const fresh = nodes.map((n) => {
    const c = cloneWithFreshIds(n).node;
    if (free) {
      c.x = r3((c.x ?? 0) + 1);
      c.y = r3((c.y ?? 0) + 1);
    }
    return c;
  });
  const variant = activeVariant();
  state().commit((x) => {
    let root = x.root;
    fresh.forEach((n, i) => (root = insertNode(root, parentId, n, index < 0 ? -1 : index + i)));
    return variant ? markVariantOnly({ ...x, root }, variant.id, fresh.map((n) => n.id)) : { ...x, root };
  });
  state().select(fresh.map((n) => n.id));
  return true;
}

/* ------------------------------------------------------------ structure */

/** Boxes of nodes relative to `parentId`'s content, at design size. */
function designBoxes(parentId: string, ids: string[]) {
  const geo = getGeo();
  const pa = geo?.design.byId.get(parentId);
  if (!geo || !pa) return undefined;
  const c = contentOf(pa);
  const out: Record<string, Box> = {};
  for (const id of ids) {
    const it = geo.design.byId.get(id);
    if (it) out[id] = { x: r3(it.box.x - c.x), y: r3(it.box.y - c.y), w: r3(it.box.w), h: r3(it.box.h) };
  }
  return out;
}

/**
 * Switch a side-by-side / top-to-bottom group to free placement without
 * anything moving: each child gets the position and size it has now (at the
 * design size), and scales with the label on other sizes. Then everything in
 * it can be dragged anywhere.
 */
export function makeFree(frameId: string) {
  const t = tpl();
  const frame = nodeById(t, frameId);
  if (!frame || frame.type !== "frame" || frame.layout === "free") return false;
  if (blockedInVariant("Switching to free placement")) return true;
  const boxes = designBoxes(frameId, frame.children.map((c) => c.id));
  if (!boxes) return false;
  state().commit((x) => {
    let root = patchNode(x.root, frameId, { layout: "free" } as Partial<LabelNode>);
    for (const c of frame.children) {
      const b = boxes[c.id];
      if (b) root = patchNode(root, c.id, { x: b.x, y: b.y, w: { kind: "fixed", mm: b.w }, h: { kind: "fixed", mm: b.h }, ax: "scale", ay: "scale" } as Partial<LabelNode>);
    }
    return { ...x, root };
  });
  toast.success("Free placement: drag things anywhere", { description: "Everything stays where it was and scales with the label on other sizes." });
  return true;
}

/**
 * Let items in a row / column float freely (on) or rejoin the line-up (off).
 * Floating keeps the item exactly where it is now.
 */
export function setFloat(ids: string[], on: boolean) {
  const t = tpl();
  if (blockedInVariant(on ? "Floating an item" : "Putting an item back in line")) return;
  const targets = ids.filter((id) => {
    const p = findParent(t.root, id);
    return p && p.layout !== "free" && !!nodeById(t, id)?.float !== on;
  });
  if (!targets.length) return;
  state().commit((x) => {
    let root = x.root;
    for (const id of targets) {
      if (!on) {
        root = patchNode(root, id, { float: undefined, x: undefined, y: undefined, ax: undefined, ay: undefined } as Partial<LabelNode>);
        continue;
      }
      const parent = findParent(x.root, id)!;
      const b = designBoxes(parent.id, [id])?.[id];
      root = patchNode(root, id, { float: true, ...(b ? { x: b.x, y: b.y, w: { kind: "fixed", mm: b.w }, h: { kind: "fixed", mm: b.h } } : { x: 0, y: 0 }) } as Partial<LabelNode>);
    }
    return { ...x, root };
  });
}

/** Wrap selected siblings in a new group. Returns false when they aren't siblings. */
export function wrapSelection(layout: FrameNode["layout"]) {
  const t = tpl();
  const ids = state().selection.filter((id) => id !== t.root.id);
  if (!ids.length) return false;
  if (blockedInVariant("Grouping")) return true;
  const parent = findParent(t.root, ids[0]);
  if (!parent) return false;
  const r = wrapNodes(t.root, ids, layout, { boxes: designBoxes(parent.id, ids) });
  if (!r) return false;
  state().commit((x) => ({ ...x, root: r.root }));
  state().select([r.id]);
  return true;
}

export function unwrapSelection() {
  const t = tpl();
  const id = state().selection[0];
  const node = id ? nodeById(t, id) : undefined;
  if (!node || node.type !== "frame" || id === t.root.id) return false;
  if (blockedInVariant("Ungrouping")) return true;
  const parent = findParent(t.root, id)!;
  const kids = node.children.map((c) => c.id);
  state().commit((x) => prunePatches({ ...x, root: unwrapNode(x.root, id, designBoxes(parent.id, kids)) }));
  state().select(kids);
  return true;
}

/**
 * Move nodes into a frame at an index (layers drag-and-drop, stack
 * reordering). Several nodes keep their relative order; `index` counts the
 * frame's children without the moved ones.
 */
export function moveInto(ids: string | string[], parentId: string, index: number) {
  const list = typeof ids === "string" ? [ids] : ids;
  const t = tpl();
  const parent = nodeById(t, parentId);
  if (!parent || parent.type !== "frame" || !list.length) return;
  if (blockedInVariant("Changing the order or grouping")) return;
  state().commit((x) => {
    let root = moveNodes(x.root, list, parentId, index);
    if (root === x.root || JSON.stringify(root) === JSON.stringify(x.root)) return x;
    // Entering a free frame: give them a position so they don't jump to the corner unexpectedly.
    if (parent.layout === "free") {
      const at = designCentre(parentId);
      list.forEach((id, i) => {
        const moved = nodeById({ ...x, root }, id);
        if (moved && findParent(root, id)?.id === parentId && moved.x === undefined)
          root = patchNode(root, id, { x: r3(Math.max(0, at.x - 2 + i)), y: r3(Math.max(0, at.y - 1 + i)) });
      });
    }
    return { ...x, root };
  });
}

/** Step stack children earlier (-1) or later (+1); several siblings move as a block. */
export function reorder(ids: string | string[], delta: number) {
  const t = tpl();
  const list = typeof ids === "string" ? [ids] : ids;
  const parent = list.length ? findParent(t.root, list[0]) : null;
  if (!parent || list.some((id) => findParent(t.root, id)?.id !== parent.id)) return;
  if (blockedInVariant("Changing the order")) return;
  const set = new Set(list);
  const idx = parent.children.map((c, i) => (set.has(c.id) ? i : -1)).filter((i) => i >= 0);
  const without = parent.children.length - idx.length;
  // Position of the block among the other children, stepped by one.
  const at = Math.max(0, Math.min(without, idx[0] + Math.sign(delta)));
  if (at === idx[0] && idx.every((v, k) => v === idx[0] + k)) return;
  state().commit((x) => ({ ...x, root: moveNodes(x.root, list, parent.id, at) }), `reorder:${list.join(",")}`);
}

/* ------------------------------------------------------------- position */

export type Captured = [string, FreeInfo][];

/** Snapshot of free-layout nodes before a drag (positions are applied relative to it). */
export const captureFree = (ids: string[]): Captured =>
  ids.map((id) => [id, freeInfo(id)] as const).filter((e): e is [string, FreeInfo] => !!e[1] && !e[1].node.locked);

/** Move free-layout nodes by an on-screen offset (mm at the shown size). */
export function moveBy(ids: string[], dx: number, dy: number, key?: string) {
  applyMove(captureFree(ids), dx, dy, key ?? `move:${ids.join(",")}`);
}

export function applyMove(infos: Captured, dx: number, dy: number, key: string) {
  if (!infos.length) return;
  const { variantId } = state();
  state().commit((t) => {
    let out = t;
    for (const [id, info] of infos) out = writeProps(out, id, freePatch(info, { ...info.rel, x: info.rel.x + dx, y: info.rel.y + dy }, { pos: true }), variantId);
    return out;
  }, key);
}

/** Arrow keys: free nodes move, stack children step through their siblings. */
export function nudge(dx: number, dy: number) {
  const t = tpl();
  const ids = state().selection.filter((id) => id !== t.root.id);
  const free = ids.filter((id) => inFreeParent(t, id));
  if (free.length) moveBy(free, dx, dy, `nudge:${free.join(",")}`);
  // Stack children step through their siblings, selected siblings as one block.
  const byParent = new Map<string, string[]>();
  for (const id of ids.filter((x) => !inFreeParent(t, x))) {
    const p = findParent(t.root, id);
    if (p) byParent.set(p.id, [...(byParent.get(p.id) ?? []), id]);
  }
  for (const group of byParent.values()) {
    const p = shownParent(t, group[0]);
    if (!p) continue;
    const along = p.layout === "row" ? dx : dy;
    if (along) reorder(group, Math.sign(along));
  }
}

function selectedFreeBoxes() {
  const t = tpl();
  const ids = state().selection.filter((id) => id !== t.root.id);
  const infos = ids.map((id) => ({ id, info: freeInfo(id) })).filter((e) => !!e.info && !e.info.node.locked) as { id: string; info: FreeInfo }[];
  // Align only within one parent.
  const parentId = infos[0]?.info.parentId;
  return infos.filter((e) => e.info.parentId === parentId);
}

export const canAlign = () => selectedFreeBoxes().length >= 1;
export const canDistribute = () => selectedFreeBoxes().length >= 3;

/** Align selection to each other, or a single node to its parent. */
export function alignSelection(mode: AlignMode) {
  const items = selectedFreeBoxes();
  if (!items.length) return;
  const bounds = items.length === 1 ? { x: 0, y: 0, w: items[0].info.P.w, h: items[0].info.P.h } : undefined;
  const d = alignBoxes(items.map((e) => e.info.rel), mode, bounds);
  applyOffsets(items, d, `align:${mode}`);
}

export function distributeSelection(axis: "h" | "v") {
  const items = selectedFreeBoxes();
  if (items.length < 3) return;
  applyOffsets(items, distributeBoxes(items.map((e) => e.info.rel), axis), `distribute:${axis}`);
}

function applyOffsets(items: { id: string; info: FreeInfo }[], d: { dx: number; dy: number }[], key: string) {
  const { variantId } = state();
  state().commit((t) => {
    let out = t;
    items.forEach(({ id, info }, i) => {
      const rel = { ...info.rel, x: info.rel.x + d[i].dx, y: info.rel.y + d[i].dy };
      out = writeProps(out, id, freePatch(info, rel, { pos: true }), variantId);
    });
    return out;
  }, key);
}

/** Select the parent of the (first) selected node. */
export function selectParent() {
  const t = tpl();
  const id = state().selection[0];
  const p = id ? findParent(t.root, id) : null;
  state().select(p ? [p.id] : []);
}

export function selectFirstChild() {
  const t = tpl();
  const id = state().selection[0];
  const n = id ? nodeById(t, id) : undefined;
  if (n?.type === "frame" && n.children[0]) state().select([n.children[0].id]);
}

/* ------------------------------------------------- drag into other groups */

/**
 * Canvas drag that ends over another group: move `ids` into `targetId`. In a
 * free group they keep their on-screen boxes (`boxes`: content mm at the
 * shown size); in a row / column they join the line-up at `index` (counting
 * the group's children without the moved ones). Committed with the drag's
 * `key` so the whole drag is one undo step.
 */
export function dropInto(ids: string[], targetId: string, index: number, boxes: Record<string, Box>, key: string) {
  const t = tpl();
  const geo = getGeo();
  const target = nodeById(t, targetId);
  if (!geo || !target || target.type !== "frame" || !ids.length) return false;
  if (blockedInVariant("Moving things into another group")) return false;
  const ta = geo.actual.byId.get(targetId);
  if (!ta) return false;
  const free = (ta.node as FrameNode).layout === "free";
  const P = contentOf(ta);
  const td = geo.design.byId.get(targetId);
  const D = td ? contentOf(td) : P;
  const before = new Map(ids.map((id) => [id, findParent(t.root, id)?.id]));
  state().commit((x) => {
    let root = moveNodes(x.root, ids, targetId, free ? -1 : index);
    for (const id of ids) {
      const n = nodeById({ ...x, root }, id);
      if (!n || findParent(root, id)?.id !== targetId) continue;
      if (free) {
        const b = boxes[id];
        if (!b) continue;
        const [dx, dw] = toDesign(n.ax ?? "start", b.x - P.x, b.w, D.w, P.w);
        const [dy, dh] = toDesign(n.ay ?? "start", b.y - P.y, b.h, D.h, P.h);
        const patch: Record<string, unknown> = { x: r3(dx), y: r3(dy), float: undefined };
        // Sizes relative to the old group become the size it has now.
        if (n.w.kind === "fill" || n.w.kind === "pct") patch.w = { kind: "fixed", mm: r3(Math.max(0.1, dw)) };
        if (n.h.kind === "fill" || n.h.kind === "pct") patch.h = { kind: "fixed", mm: r3(Math.max(0.1, dh)) };
        root = patchNode(root, id, patch as Partial<LabelNode>);
      } else if (before.get(id) !== targetId || n.float) {
        root = patchNode(root, id, { float: undefined, x: undefined, y: undefined, ax: undefined, ay: undefined } as Partial<LabelNode>);
      }
    }
    return { ...x, root };
  }, key);
  state().select(ids);
  return true;
}

/* -------------------------------------------------------------- components */

/** Node props an instance takes over from the group it replaces. */
const PLACEMENT = ["name", "w", "h", "minW", "maxW", "minH", "maxH", "x", "y", "ax", "ay", "float", "alignSelf", "rotate", "hidden", "showWhen", "locked"] as const;

/** Place an instance of a library component (into the selected group, after the selection, or the label). */
export function addInstance(componentId: string) {
  const t = tpl();
  const c = getLibraryParts().components?.find((x) => x.id === componentId);
  if (!c) return;
  const mode = state().mode;
  if (mode.kind === "component" && wouldCycle(componentId, mode.id, getLibraryParts())) {
    toast.error(`“${c.name}” can't go inside itself`, { description: "It already contains the component you're editing (or is it)." });
    return;
  }
  const { parentId, index } = insertionPoint(t);
  const parent = nodeById(t, parentId) as FrameNode;
  const free = (getGeo()?.actual.byId.get(parentId)?.node as FrameNode | undefined)?.layout === "free" || parent.layout === "free";
  const fixedW = { kind: "fixed" as const, mm: c.design.w }, fixedH = { kind: "fixed" as const, mm: c.design.h };
  // New instances size like the component was (hug / fill / fixed), at its design size in free groups.
  const sized = (s: FrameNode["w"], fixed: typeof fixedW) => (free && s.kind !== "fixed" ? fixed : s.kind === "pct" ? fixed : s);
  const node: ComponentNode = { id: newId("component"), type: "component", ref: c.id, w: sized(c.root.w, fixedW), h: sized(c.root.h, fixedH) };
  if (free) {
    const at = designCentre(parentId);
    node.x = r3(Math.max(0, at.x - c.design.w / 2));
    node.y = r3(Math.max(0, at.y - c.design.h / 2));
  }
  const variant = activeVariant();
  if (variant) state().commit((x) => addToVariant(x, variant.id, parentId, node, index));
  else state().commit((x) => ({ ...x, root: insertNode(x.root, parentId, node, index) }));
  state().select([node.id]);
}

/**
 * Make the selection a library component and put an instance in its place.
 * One selected group becomes the component; several siblings are grouped
 * first. Variant changes to nodes inside follow them into the instance.
 */
export function createComponentFromSelection(name: string): LabelComponent | null {
  const t = tpl();
  const geo = getGeo();
  const lib = editorLibrary();
  const ids = topmost(t.root, state().selection.filter((id) => id !== t.root.id));
  if (!ids.length || !geo || !lib) return null;
  if (blockedInVariant("Making a component")) return null;
  const parent = findParent(t.root, ids[0]);
  if (!parent || ids.some((id) => findParent(t.root, id)?.id !== parent.id)) {
    toast.error("Select elements in the same group to make a component.");
    return null;
  }
  let root = t.root;
  let frameId = ids[0];
  const single = ids.length === 1 && nodeById(t, ids[0])?.type === "frame";
  let size: { w: number; h: number };
  if (single) {
    const b = geo.design.byId.get(frameId)?.box ?? geo.actual.byId.get(frameId)?.box;
    size = { w: r3(b?.w ?? 10), h: r3(b?.h ?? 5) };
  } else {
    const boxes = designBoxes(parent.id, ids);
    const shown = (geo.actual.byId.get(parent.id)?.node as FrameNode | undefined) ?? parent;
    const r = wrapNodes(root, ids, shown.layout === "free" ? "free" : shown.layout, { boxes, name });
    if (!r) return null;
    root = r.root;
    frameId = r.id;
    const bs = Object.values(boxes ?? {});
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    size = bs.length ? { w: r3(Math.max(...bs.map((b) => b.x + b.w)) - x0), h: r3(Math.max(...bs.map((b) => b.y + b.h)) - y0) } : { w: 10, h: 5 };
  }
  const frame = nodeById({ ...t, root }, frameId) as FrameNode;
  const croot = structuredClone(frame) as FrameNode & Record<string, unknown>;
  for (const k of PLACEMENT) if (k !== "w" && k !== "h") delete croot[k];
  // Default size of new instances: as the group was (fill / pct become its size).
  if (croot.w.kind === "pct" || croot.w.kind === "fill") croot.w = { kind: "fixed", mm: size.w };
  if (croot.h.kind === "pct" || croot.h.kind === "fill") croot.h = { kind: "fixed", mm: size.h };
  const comp: LabelComponent = { id: newId("comp"), name: name.trim() || frame.name || "Component", design: { w: Math.max(0.5, size.w), h: Math.max(0.5, size.h) }, root: croot };

  const inst = { id: frame.id, type: "component", ref: comp.id } as ComponentNode & Record<string, unknown>;
  for (const k of PLACEMENT) if (frame[k] !== undefined) (inst as Record<string, unknown>)[k] = structuredClone(frame[k]);
  if (single && frame.name === undefined) delete inst.name;
  // Register first, so the instance never shows empty.
  void lib.saveComponent(comp, { immediate: true });
  const inner = new Set(subtreeIds(frame).filter((id) => id !== frame.id));
  state().commit((x) => {
    const variants = x.variants?.map((v) => ({
      ...v,
      patches: Object.fromEntries(Object.entries(v.patches).map(([k, p]) => [inner.has(k) ? instanceChildId(frame.id, k) : k, p])),
    }));
    return { ...x, root: mapNode(root, frame.id, () => inst), ...(variants ? { variants } : {}) };
  });
  state().select([frame.id]);
  return comp;
}

/** Turn selected instances into plain groups (their contents copied in, overrides kept). */
export function detachSelection() {
  const t = tpl();
  const ids = state().selection.filter((id) => nodeById(t, id)?.type === "component");
  if (!ids.length) return false;
  if (blockedInVariant("Detaching an instance")) return true;
  const parts = getLibraryParts();
  state().commit((x) => {
    let root = x.root;
    let variants = x.variants;
    for (const id of ids) {
      const n = nodeById({ ...x, root }, id) as ComponentNode | undefined;
      if (!n) continue;
      const map = new Map<string, string>();
      const frame = detachInstance(n, parts, (old) => {
        const nid = newId(old.type);
        map.set(old.id, nid);
        return nid;
      });
      root = mapNode(root, id, () => frame);
      // Variant changes to the instance's contents follow the copies.
      variants = variants?.map((v) => ({
        ...v,
        patches: Object.fromEntries(Object.entries(v.patches).map(([k, p]) => [k.startsWith(id + "/") && map.has(k.slice(id.length + 1)) ? map.get(k.slice(id.length + 1))! : k, p])),
      }));
    }
    return prunePatches({ ...x, root, ...(variants ? { variants } : {}) });
  });
  return true;
}

/** Set (or clear, `undefined` removes) per-instance overrides of a component node. */
export function setInstanceOverride(instanceId: string, nodeId: string, patch: Record<string, unknown>, key?: string) {
  state().commit((x) => {
    const n = nodeById(x, instanceId);
    if (!n || n.type !== "component") return x;
    const cur = { ...(n.overrides?.[nodeId] ?? {}) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete cur[k];
      else cur[k] = v;
    }
    const overrides = { ...n.overrides } as Record<string, Partial<LabelNode>>;
    if (Object.keys(cur).length) overrides[nodeId] = cur as Partial<LabelNode>;
    else delete overrides[nodeId];
    return { ...x, root: patchNode(x.root, instanceId, { overrides: Object.keys(overrides).length ? overrides : undefined } as Partial<LabelNode>) };
  }, key ?? `override:${instanceId}:${nodeId}:${Object.keys(patch).join(",")}`);
}

/* ------------------------------------------------------------- text styles */

const baseText = (t: Template, id: string) => {
  const n = nodeById(t, id);
  return n?.type === "text" ? n : undefined;
};

/** Use a library style on a text (or `null`: detach, keeping how it looks). Always on the base node. */
export function applyStyle(id: string, styleId: string | null) {
  const styles = getLibraryParts().styles ?? [];
  const s = styleId ? styles.find((x) => x.id === styleId) : undefined;
  state().commit((x) => {
    const n = baseText(x, id);
    if (!n) return x;
    const next = s ? withTextStyle(n, s) : detachTextStyle(n, styles);
    return { ...x, root: mapNode(x.root, id, () => next) };
  });
}

/** New library style from a text's look; the text then uses it. */
export function createStyleFromText(id: string, name: string): TextStyle | null {
  const lib = editorLibrary();
  const n = baseText(tpl(), id);
  if (!n || !lib) return null;
  const shown = detachTextStyle(n, getLibraryParts().styles);
  const style: TextStyle = { id: newId("style"), name: name.trim() || "Text style", ...textStyleProps(shown) };
  void lib.saveStyle(style, { immediate: true });
  applyStyle(id, style.id);
  return style;
}

/** Push a text's own changes (its overrides) into its style: every text using the style follows. */
export function updateStyleFromText(id: string) {
  const lib = editorLibrary();
  const n = baseText(tpl(), id);
  const s = n?.style ? getLibraryParts().styles?.find((x) => x.id === n.style) : undefined;
  if (!n || !s || !lib) return;
  const shown = detachTextStyle(n, getLibraryParts().styles);
  const next: TextStyle = { id: s.id, name: s.name, ...(s.description ? { description: s.description } : {}), ...textStyleProps(shown) };
  void lib.saveStyle(next);
  state().commit((x) => {
    const b = baseText(x, id);
    return b ? { ...x, root: mapNode(x.root, id, () => withTextStyle(b, next)) } : x;
  });
}

/** Drop a text's own changes so it follows its style again. */
export function resetStyleOverrides(id: string, keys?: string[]) {
  state().commit((x) => {
    const n = baseText(x, id);
    const s = n?.style ? getLibraryParts().styles?.find((y) => y.id === n.style) : undefined;
    if (!n || !s) return x;
    const left = keys ? (n.styleOverrides ?? []).filter((k) => !keys.includes(k)) : [];
    const next = withTextStyle(n, s);
    if (left.length) {
      // Keep the remaining overrides' values.
      const out = next as unknown as Record<string, unknown>;
      for (const k of left) out[k] = (n as unknown as Record<string, unknown>)[k];
      next.styleOverrides = left as TextNode["styleOverrides"];
    }
    return { ...x, root: mapNode(x.root, id, () => next) };
  });
}