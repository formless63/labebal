/**
 * Library parts: shared text styles and reusable components.
 *
 * Templates refer to them by id (`TextNode.style`, `ComponentNode.ref`).
 * `resolveTemplate` turns a template into a plain one before it is laid out:
 * component instances become frames holding a copy of the component's
 * contents, and styled texts take their style's values. `layout()` (and so
 * render, preflight, mirrors, variants) and `preloadAssets` call it, so every
 * render path agrees. Pure and framework-free.
 *
 * The parts come from `LayoutInput.parts` or, by default, from what the app
 * registered with `setLibraryParts` (the web app registers its library).
 */
import {
  TEXT_STYLE_KEYS,
  walk,
  type ComponentNode,
  type FrameNode,
  type LabelComponent,
  type LabelNode,
  type LibraryParts,
  type Template,
  type TextNode,
  type TextStyle,
  type TextStyleKey,
} from "./schema";

/** Separates an instance's id from its component's node ids in laid-out ids. */
export const INSTANCE_SEP = "/";
/** Id of a component node laid out inside an instance. */
export const instanceChildId = (instanceId: string, nodeId: string) => `${instanceId}${INSTANCE_SEP}${nodeId}`;
/** For a laid-out node id, the id of the template node it belongs to (the outermost instance, or itself). */
export const templateNodeId = (id: string) => id.split(INSTANCE_SEP)[0];
/** True for ids of nodes laid out from an instance (not editable in the template itself). */
export const isInstanceChildId = (id: string) => id.includes(INSTANCE_SEP);

/** Instances nested deeper than this lay out empty (with cycles, they would never end). */
export const MAX_COMPONENT_DEPTH = 8;

/* --------------------------------------------------------------- registry */

let registered: LibraryParts = {};

/** Register the library's styles and components as the default for layout / preload. */
export function setLibraryParts(p: LibraryParts) {
  if (p.styles === registered.styles && p.components === registered.components) return;
  registered = { styles: p.styles, components: p.components };
}
export const getLibraryParts = (): LibraryParts => registered;

/* ----------------------------------------------------------------- styles */

/** Style keys that a text node always has (left out of a style = keep the node's own). */
const REQUIRED = new Set<TextStyleKey>(["font", "sizePt", "color"]);

/** The style a text uses, when it exists. */
export const styleOf = (n: Pick<TextNode, "style">, styles: TextStyle[] | undefined) => (n.style ? styles?.find((s) => s.id === n.style) : undefined);

/**
 * A text node with its style applied: every style property the node doesn't
 * override (`styleOverrides`) takes the style's value. Unknown style = unchanged.
 */
export function applyTextStyle(n: TextNode, styles: TextStyle[] | undefined): TextNode {
  const s = styleOf(n, styles);
  if (!s) return n;
  const own = new Set(n.styleOverrides ?? []);
  const out = { ...n } as Record<string, unknown>;
  for (const k of TEXT_STYLE_KEYS) {
    if (own.has(k)) continue;
    const v = s[k];
    if (v !== undefined) out[k] = v;
    else if (!REQUIRED.has(k)) delete out[k];
  }
  return out as unknown as TextNode;
}

/** The style properties of a text (to create a style from it, or bake one in). */
export function textStyleProps(n: TextNode): Partial<Pick<TextNode, TextStyleKey>> {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_STYLE_KEYS) if (n[k] !== undefined) out[k] = n[k];
  return out as Partial<Pick<TextNode, TextStyleKey>>;
}

/**
 * Give a text a style: its stored values become the style's (so it still
 * looks the same without the library) and its overrides are cleared.
 */
export function withTextStyle(n: TextNode, s: TextStyle): TextNode {
  const base = { ...n, style: s.id } as TextNode;
  delete base.styleOverrides;
  const out = applyTextStyle(base, [s]);
  return out;
}

/** Detach a text from its style: keeps how it looks now (style values baked in). */
export function detachTextStyle(n: TextNode, styles: TextStyle[] | undefined): TextNode {
  const out = { ...applyTextStyle(n, styles) };
  delete out.style;
  delete out.styleOverrides;
  return out;
}

/* ------------------------------------------------------------- components */

/** Node properties an instance keeps for itself (the component root's are ignored). */
const INSTANCE_KEYS = ["id", "name", "w", "h", "minW", "maxW", "minH", "maxH", "x", "y", "ax", "ay", "float", "alignSelf", "rotate", "hidden", "showWhen", "locked"] as const;

/** An override without the keys it may not change (identity, type, children). */
function overridePatch(ov: Partial<LabelNode>) {
  const rest = structuredClone(ov) as Record<string, unknown>;
  delete rest.id;
  delete rest.type;
  delete rest.children;
  return rest;
}

const componentMap = (parts: LibraryParts) => new Map((parts.components ?? []).map((c) => [c.id, c]));

/**
 * Lay an instance out as a frame: the component root's layout settings with
 * the instance's size / position, holding a copy of the component's nodes
 * (ids prefixed with the instance id) with the instance's overrides applied.
 * Nested instances expand too; a missing component, a cycle or too deep
 * nesting gives an empty frame.
 */
export function expandInstance(n: ComponentNode, parts: LibraryParts, stack: string[] = [], comps = componentMap(parts)): FrameNode {
  const own: Record<string, unknown> = {};
  for (const k of INSTANCE_KEYS) if (n[k] !== undefined) own[k] = structuredClone(n[k]);
  const c = comps.get(n.ref);
  if (!c || stack.includes(n.ref) || stack.length >= MAX_COMPONENT_DEPTH) return { ...(own as Pick<FrameNode, "id" | "w" | "h">), type: "frame", layout: "free", children: [] };

  const prefix = n.id + INSTANCE_SEP;
  const local = new Set<string>();
  walk(c.root, (m) => local.add(m.id));
  const inner = [...stack, n.ref];
  const copy = (m: LabelNode): LabelNode => {
    const out = { ...structuredClone(m), id: prefix + m.id } as LabelNode;
    if (out.type === "frame" && m.type === "frame") {
      out.children = m.children.map(copy);
      if (out.mirror && local.has(out.mirror.of)) out.mirror = { ...out.mirror, of: prefix + out.mirror.of };
    }
    if (out.type === "component") return expandInstance(out, parts, inner, comps);
    return out;
  };

  const root = c.root;
  const frame = { ...structuredClone(root), ...own, type: "frame", children: root.children.map(copy) } as FrameNode;
  // Keys the instance doesn't set fall back to defaults, not to the component root's.
  for (const k of INSTANCE_KEYS) if (n[k] === undefined) delete (frame as unknown as Record<string, unknown>)[k];
  if (!frame.name) frame.name = c.name;
  if (frame.mirror && local.has(frame.mirror.of)) frame.mirror = { ...frame.mirror, of: prefix + frame.mirror.of };

  // Instance overrides, by component node id (also reaching into nested instances).
  if (n.overrides && Object.keys(n.overrides).length) {
    const visit = (m: LabelNode) => {
      const ov = m.id.startsWith(prefix) ? n.overrides![m.id.slice(prefix.length)] : undefined;
      if (ov) {
        Object.assign(m, overridePatch(ov));
      }
      if (m.type === "frame") m.children.forEach(visit);
    };
    frame.children.forEach(visit);
  }
  return frame;
}

/** Ids of the components a component uses (directly or through nested instances). */
export function componentDeps(id: string, parts: LibraryParts): Set<string> {
  const comps = componentMap(parts);
  const out = new Set<string>();
  const visit = (cid: string) => {
    const c = comps.get(cid);
    if (!c) return;
    walk(c.root, (m) => {
      if (m.type === "component" && !out.has(m.ref)) {
        out.add(m.ref);
        visit(m.ref);
      }
    });
  };
  visit(id);
  return out;
}

/** Whether placing component `id` inside component `into` would make a cycle. */
export const wouldCycle = (id: string, into: string, parts: LibraryParts) => id === into || componentDeps(id, parts).has(into);

/** Styles and components a template uses (components transitively; styles also inside them). */
export function partsUsedBy(t: Template, parts: LibraryParts): { styles: TextStyle[]; components: LabelComponent[] } {
  const comps = componentMap(parts);
  const styleIds = new Set<string>();
  const compIds = new Set<string>();
  const visit = (root: LabelNode) =>
    walk(root, (m) => {
      if (m.type === "text" && m.style) styleIds.add(m.style);
      if (m.type === "component" && !compIds.has(m.ref)) {
        compIds.add(m.ref);
        const c = comps.get(m.ref);
        if (c) visit(c.root);
      }
    });
  visit(t.root);
  return {
    styles: (parts.styles ?? []).filter((s) => styleIds.has(s.id)),
    components: (parts.components ?? []).filter((c) => compIds.has(c.id)),
  };
}

/** True when a template (or component tree) refers to a style or a component. */
export function usesParts(root: LabelNode) {
  let hit = false;
  walk(root, (m) => {
    if ((m.type === "text" && m.style) || m.type === "component") hit = true;
  });
  return hit;
}

/** Templates that use a component (directly or through other components). */
export function templatesUsingComponent(templates: Template[], id: string, parts: LibraryParts) {
  return templates.filter((t) => partsUsedBy(t, parts).components.some((c) => c.id === id));
}

/** Templates that use a text style (also inside components they use). */
export function templatesUsingStyle(templates: Template[], id: string, parts: LibraryParts) {
  return templates.filter((t) => partsUsedBy(t, parts).styles.some((s) => s.id === id));
}

/** Expand every instance and apply every style in a tree (new tree; untouched input). */
export function resolveTree(root: FrameNode, parts: LibraryParts): FrameNode {
  const comps = componentMap(parts);
  const rec = (n: LabelNode): LabelNode => {
    if (n.type === "component") return rec(expandInstance(n, parts, [], comps));
    if (n.type === "text") return applyTextStyle(n, parts.styles);
    if (n.type === "frame") return { ...n, children: n.children.map(rec) };
    return n;
  };
  return rec(root) as FrameNode;
}

const resolved = new WeakMap<Template, { styles?: TextStyle[]; components?: LabelComponent[]; out: Template }>();

/**
 * The template as layout sees it: instances expanded, styles applied. Returns
 * the template itself when it uses neither (renders stay byte-identical).
 * Cached per template object and parts.
 */
export function resolveTemplate(t: Template, parts: LibraryParts = registered): Template {
  if (!usesParts(t.root)) return t;
  const hit = resolved.get(t);
  if (hit && hit.styles === parts.styles && hit.components === parts.components) return hit.out;
  const out = { ...t, root: resolveTree(t.root, parts) };
  resolved.set(t, { styles: parts.styles, components: parts.components, out });
  return out;
}

/**
 * Replace an instance by a plain group with its contents (fresh ids, overrides
 * applied). Texts keep their style references. Nested instances stay instances.
 */
export function detachInstance(n: ComponentNode, parts: LibraryParts, makeId: (old: LabelNode) => string): FrameNode {
  const comps = componentMap(parts);
  const c = comps.get(n.ref);
  const own: Record<string, unknown> = {};
  for (const k of INSTANCE_KEYS) if (n[k] !== undefined) own[k] = structuredClone(n[k]);
  if (!c) return { ...(own as Pick<FrameNode, "id" | "w" | "h">), type: "frame", layout: "free", children: [] };
  const ids = new Map<string, string>();
  const copy = (m: LabelNode): LabelNode => {
    const id = makeId(m);
    ids.set(m.id, id);
    const out = { ...structuredClone(m), id } as LabelNode;
    const ov = n.overrides?.[m.id];
    if (ov) Object.assign(out, overridePatch(ov));
    if (out.type === "component") {
      // Overrides reaching into a nested instance move onto it.
      const pre = m.id + INSTANCE_SEP;
      for (const [k, v] of Object.entries(n.overrides ?? {}))
        if (k.startsWith(pre)) {
          const key = k.slice(pre.length);
          out.overrides = { ...out.overrides, [key]: Object.assign({}, out.overrides?.[key], structuredClone(v)) as Partial<LabelNode> };
        }
    }
    if (out.type === "frame" && m.type === "frame") out.children = m.children.map(copy);
    return out;
  };
  const children = c.root.children.map(copy);
  const frame = { ...structuredClone(c.root), ...own, type: "frame", name: n.name ?? c.name, children } as FrameNode;
  for (const k of INSTANCE_KEYS) if (n[k] === undefined && k !== "name") delete (frame as unknown as Record<string, unknown>)[k];
  // Mirrors inside the component point at the copies.
  walk(frame, (m) => {
    if (m.type === "frame" && m.mirror && ids.has(m.mirror.of)) m.mirror = { ...m.mirror, of: ids.get(m.mirror.of)! };
  });
  return frame;
}

/**
 * A component's tree as a template (to edit it with the template editor, or
 * preview it). Fields are the placeholders it uses, with their names as
 * example values.
 */
export function componentAsTemplate(c: LabelComponent, fieldKeys: string[] = []): Template {
  return {
    id: `component:${c.id}`,
    name: c.name,
    schema: 2,
    design: { ...c.design },
    root: c.root,
    fields: fieldKeys.map((key) => ({ key, label: key, type: "text", default: key })),
  };
}

/**
 * Detach every instance of component `ref` in a tree (before deleting the
 * component, so templates keep how they look). Returns the tree unchanged
 * when there is none.
 */
export function detachInstancesOf(root: FrameNode, ref: string, parts: LibraryParts, makeId: (old: LabelNode) => string): FrameNode {
  let changed = false;
  const rec = (n: LabelNode): LabelNode => {
    if (n.type === "component" && n.ref === ref) {
      changed = true;
      return detachInstance(n, parts, makeId);
    }
    if (n.type !== "frame") return n;
    const children = n.children.map(rec);
    return children.some((c, i) => c !== n.children[i]) ? { ...n, children } : n;
  };
  const out = rec(root) as FrameNode;
  return changed ? out : root;
}

/** Detach every text using style `id` in a tree, keeping how it looks (before deleting the style). */
export function detachStyleIn(root: FrameNode, id: string, styles: TextStyle[] | undefined): FrameNode {
  const rec = (n: LabelNode): LabelNode => {
    if (n.type === "text" && n.style === id) return detachTextStyle(n, styles);
    if (n.type !== "frame") return n;
    const children = n.children.map(rec);
    return children.some((c, i) => c !== n.children[i]) ? { ...n, children } : n;
  };
  return rec(root) as FrameNode;
}
