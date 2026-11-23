"use client";
import { toast } from "sonner";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "../../lib/router";
import {
  edgesOf,
  effectiveNode,
  findParent,
  isInside,
  isInstanceChildId,
  layout,
  measurer,
  preloadAssets,
  renderLabel,
  snapAxis,
  templateNodeId,
  topmost,
  walk,
  type Box,
  type FrameNode,
  type LaidOut,
  type Label,
  type LabelNode,
  type Template,
} from "@labebal/core";
import { IconMinus, IconPlus, IconZoomReset } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { useFontsReady } from "../labels/printer";
import { bandBox, crispScale, paintDots, useDevicePixelRatio, usesPixelated } from "../labels/dots";
import { contentOf, setGeo, snapToDot, type Geo, type View } from "./geometry";
import { useLibrary } from "../labels/api";
import { applyMove, blockedInVariant, captureFree, dropInto, freePatch, makeFree, moveInto, nodeById, setFloat, type Captured } from "./ops";
import { componentHref } from "./library";
import { nodeLabel } from "./nodes";
import { tableCellAt, useCanvasA11y } from "./canvas-a11y";
import { useEditor, useEditorView, writeProps, type Guide } from "./store";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

let dragSeq = 0;

/** Groups whose "drag only reorders" hint was shown this session. */
const explained = new Set<string>();
/** Dragging inside a row / column reorders; say so once per group, with the way out. */
function explainReorder(parentId: string, ids: string[]) {
  if (explained.has(parentId)) return;
  explained.add(parentId);
  const t = useEditor.getState().template;
  const group = parentId === t?.root.id ? "This label" : "This group";
  toast(`${group} lines things up automatically`, {
    description: "Dragging changes the order, and everything reflows on each label size. To drag things anywhere, let just this item float, or switch the whole group to free placement (nothing moves).",
    duration: 12_000,
    action: { label: ids.length > 1 ? "Float these" : "Float this one", onClick: () => setFloat(ids, true) },
    cancel: { label: "Place all freely", onClick: () => makeFree(parentId) },
  });
}

/** Another group a drag would drop into: its id and, for a row / column, the slot. */
interface DropTarget {
  id: string;
  index: number;
}

/** Hovering over a group inside the row / column being reordered must last this long before it counts (ms). */
const DWELL_MS = 450;
const clock = () => Date.now();

/** What a drag that can change groups tracks (pointer, candidate group and since when). */
interface IntoState {
  target: DropTarget | null;
  pending: { id: string; since: number } | null;
  last: { x: number; y: number; alt: boolean } | null;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; px: number; py: number }
  | ({ kind: "move"; sx: number; sy: number; started: boolean; infos: Captured; union: Box; tx: number[]; ty: number[]; key: string } & IntoState)
  | ({ kind: "reorder"; sx: number; sy: number; started: boolean; ids: string[]; parentId: string; index: number | null; origin: Record<string, Box> } & IntoState)
  | { kind: "marquee"; sx: number; sy: number; started: boolean; base: string[]; clickId: string | null }
  | { kind: "resize"; sx: number; sy: number; id: string; handle: Handle; box: Box; tx: number[]; ty: number[]; key: string };

export interface CanvasProps {
  template: Template;
  label?: Pick<Label, "values" | "overrides">;
  invert: boolean;
  view: View;
}

/** The label at the chosen size (real 1-bit render) with selection, handles and guides on top. */
export function Canvas({ template, label, invert, view }: CanvasProps) {
  const fontsReady = useFontsReady();
  const selection = useEditor((s) => s.selection);
  const hoverId = useEditor((s) => s.hoverId);
  const guides = useEditor((s) => s.guides);
  const { zoom, showGrid, snap } = useEditorView();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ w: 800, h: 360 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drop, setDrop] = useState<Box | null>(null);
  /** Drag feedback: the group things would go into, and where reordered items would land. */
  const [into, setInto] = useState<{ box: Box; name: string } | null>(null);
  const [ghosts, setGhosts] = useState<Box[] | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  // Library styles / components: the layout resolves them, so redraw when they change.
  const { data: lib } = useLibrary();
  const partsKey = useMemo(() => ({ styles: lib?.styles, components: lib?.components }), [lib?.styles, lib?.components]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const [assetsTick, setAssetsTick] = useState(0);

  const dpr = useDevicePixelRatio();
  const fit = Math.max(1, Math.min((vp.w - 64) / view.size.widthMm, (vp.h - 64) / view.size.heightMm, 60));
  // Fitted: whole device pixels per dot when that costs little size (user zoom stays exact).
  const S = zoom ?? crispScale(fit, view.dpmm, dpr, 0.7);
  const band = bandBox(view.w, view.h, view.dpmm, view.bandX, view.bandY, S, dpr);
  const labelW = view.size.widthMm * S;
  const labelH = view.size.heightMm * S;
  const left = (vp.w - labelW) / 2 + (zoom ? pan.x : 0);
  const top = (vp.h - labelH) / 2 + (zoom ? pan.y : 0);

  // Layout for the overlay (and editing maths). Same inputs as the render.
  const geo: Geo = useMemo(() => {
    void fontsReady;
    void assetsTick; // decoded images change hug sizes (natural aspect)
    void partsKey;
    const m = measurer(view.dpmm);
    return {
      view,
      actual: layout({ template, label, width: view.width, height: view.height, measurer: m }),
      design: layout({ template, label, width: template.design.w, height: template.design.h, measurer: m }),
    };
  }, [template, label, view, fontsReady, assetsTick, partsKey]);
  useLayoutEffect(() => setGeo(geo), [geo]);

  // Render the dots offscreen, then put them on screen at the current zoom
  // (zooming only repaints, it doesn't re-render the label).
  const dots = useMemo(() => {
    void fontsReady;
    void assetsTick;
    void partsKey;
    if (typeof document === "undefined") return null;
    return renderLabel(template, label, { w: view.w, h: view.h, dpmm: view.dpmm, marginMm: view.marginMm, labelMm: { w: view.size.widthMm, h: view.size.heightMm }, invert }).canvas;
  }, [template, label, view, invert, fontsReady, assetsTick, partsKey]);
  useLayoutEffect(() => {
    if (canvasRef.current && dots) paintDots(dots, canvasRef.current, band.devW, band.devH);
  }, [dots, band.devW, band.devH]);

  useEffect(() => {
    let cancelled = false;
    void preloadAssets(template, label ? [label] : []).then(() => !cancelled && setAssetsTick((n) => n + 1));
    return () => {
      cancelled = true;
    };
  }, [template, label, partsKey]);

  // Track the viewport size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Wheel: pan, Ctrl/Cmd + wheel: zoom around the cursor.
  const viewRef = useRef({ S, left, top, labelW, labelH, vp, pan });
  useLayoutEffect(() => {
    viewRef.current = { S, left, top, labelW, labelH, vp, pan };
  });
  /** Zoom to S2 (px per mm) keeping the point (px, py) of the viewport still. */
  const zoomAt = (px: number, py: number, S2: number) => {
    const v = viewRef.current;
    S2 = Math.max(1, Math.min(200, S2));
    const mx = (px - v.left) / v.S, my = (py - v.top) / v.S;
    const L2 = px - mx * S2, T2 = py - my * S2;
    const W2 = (v.labelW / v.S) * S2, H2 = (v.labelH / v.S) * S2;
    setPan({ x: L2 - (v.vp.w - W2) / 2, y: T2 - (v.vp.h - H2) / 2 });
    useEditorView.getState().set({ zoom: S2 });
  };
  const zoomStep = (dir: "in" | "out" | "fit") => {
    const v = viewRef.current;
    if (dir === "fit") {
      setPan({ x: 0, y: 0 });
      useEditorView.getState().set({ zoom: null });
    } else zoomAt(v.vp.w / 2, v.vp.h / 2, v.S * (dir === "in" ? 1.25 : 0.8));
  };
  const zoomStepRef = useRef(zoomStep);
  const zoomAtRef = useRef(zoomAt);
  useLayoutEffect(() => {
    zoomStepRef.current = zoomStep;
    zoomAtRef.current = zoomAt;
  });
  // Keyboard shortcuts (hooks.ts) ask for zoom steps through a window event.
  useEffect(() => {
    const on = (e: Event) => zoomStepRef.current((e as CustomEvent<"in" | "out" | "fit">).detail);
    window.addEventListener("editor:zoom", on);
    return () => window.removeEventListener("editor:zoom", on);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAtRef.current(e.clientX - r.left, e.clientY - r.top, v.S * Math.exp(-e.deltaY * 0.0025));
      } else {
        const z = useEditorView.getState().zoom;
        if (z === null) useEditorView.getState().set({ zoom: v.S });
        const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
        setPan((p) => ({ x: (z === null ? 0 : p.x) - dx, y: (z === null ? 0 : p.y) - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space bar held = hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && (space.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ---------------------------------------------------------- hit testing */

  const locked = useMemo(() => lockedIds(geo.actual.root), [geo]);
  const a11y = useCanvasA11y(geo, locked);

  /** Content-space mm under a client point. */
  const toContent = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - left) / S - view.originX, y: (clientY - r.top - top) / S - view.originY };
  };

  const hitTest = (p: { x: number; y: number }) => {
    const items = geo.actual.items;
    for (let i = items.length - 1; i >= 1; i--) {
      const { box, node } = items[i];
      if (locked.has(node.id)) continue;
      // Anything inside a component instance picks the instance.
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return templateNodeId(node.id);
    }
    const root = items[0]?.box;
    const onLabel = p.x >= -view.originX && p.y >= -view.originY && p.x <= view.size.widthMm - view.originX && p.y <= view.size.heightMm - view.originY;
    return root && onLabel ? geo.actual.root.id : null;
  };

  /** Snap targets: sibling edges/centres and the parent's content box. */
  const targetsFor = (ids: string[]) => {
    const t = useEditor.getState().template!;
    const parent = findParent(t.root, ids[0]);
    const tx: number[] = [], ty: number[] = [];
    if (!parent) return { tx, ty };
    const pa = geo.actual.byId.get(parent.id);
    if (pa) {
      const c = contentOf(pa);
      tx.push(...edgesOf(c, "x"));
      ty.push(...edgesOf(c, "y"));
    }
    for (const c of parent.children) {
      if (ids.includes(c.id)) continue;
      const it = geo.actual.byId.get(c.id);
      if (!it) continue;
      tx.push(...edgesOf(it.box, "x"));
      ty.push(...edgesOf(it.box, "y"));
    }
    return { tx, ty };
  };

  /* ------------------------------------------- drag into / out of groups */

  // Timers re-check a hovered group after the pointer stopped: read the latest layout.
  const geoRef = useRef(geo);
  const lockedRef = useRef(locked);
  useLayoutEffect(() => {
    geoRef.current = geo;
    lockedRef.current = locked;
  });

  /** Slot in a row / column under the pointer: index among the children without the moved ones, and the indicator bar. */
  const stackSlot = (frameId: string, p: { x: number; y: number }, moving: Set<string>) => {
    const g = geoRef.current;
    const t = useEditor.getState().template!;
    const base = nodeById(t, frameId);
    const pa = g.actual.byId.get(frameId);
    if (!pa || !base || base.type !== "frame") return null;
    const row = (pa.node as FrameNode).layout === "row";
    const shown = base.children.filter((c) => !moving.has(c.id) && g.actual.byId.has(c.id));
    const along = row ? p.x : p.y;
    let k = shown.findIndex((c) => {
      const b = g.actual.byId.get(c.id)!.box;
      return along < (row ? b.x + b.w / 2 : b.y + b.h / 2);
    });
    if (k < 0) k = shown.length;
    const without = base.children.filter((c) => !moving.has(c.id));
    const index = k < shown.length ? without.indexOf(shown[k]) : shown.length ? without.indexOf(shown[shown.length - 1]) + 1 : 0;
    const c = contentOf(pa);
    const ref = shown[Math.min(k, shown.length - 1)];
    const rb = ref ? g.actual.byId.get(ref.id)!.box : c;
    const at = k < shown.length ? (row ? rb.x : rb.y) : row ? rb.x + rb.w : rb.y + rb.h;
    const bar: Box = row ? { x: at - 0.15, y: c.y, w: 0.3, h: c.h } : { x: c.x, y: at - 0.15, w: c.w, h: 0.3 };
    return { index, bar };
  };

  /**
   * The deepest group under the pointer that could take the dragged items.
   * Not: the items themselves or groups inside them, locked groups, mirrored
   * copies, component instances. Outside every group: the label itself.
   */
  const groupUnder = (p: { x: number; y: number }, ids: string[]) => {
    const g = geoRef.current;
    const t = useEditor.getState().template!;
    let best: LaidOut | null = null;
    for (const it of g.actual.items) {
      const n = it.node;
      if (n.type !== "frame" || it.copyOf || n.mirror || isInstanceChildId(n.id) || lockedRef.current.has(n.id)) continue;
      if (nodeById(t, n.id)?.type !== "frame") continue; // instances lay out as frames
      if (ids.some((id) => isInside(t.root, id, n.id))) continue;
      const b = it.box;
      if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
      if (!best || it.depth >= best.depth) best = it;
    }
    return best?.node.id ?? t.root.id;
  };

  /**
   * Work out which group a drag would drop into, and show it. Inside the row /
   * column being reordered, a group must be hovered for a moment first;
   * leaving the row / column, or any group for a freely placed item, counts at
   * once. Alt keeps everything in its group; variants never regroup.
   */
  const evaluateInto = (d: Extract<Drag, { kind: "move" | "reorder" }>) => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
    const st = useEditor.getState();
    const t = st.template!;
    const last = d.last;
    const ids = d.kind === "move" ? d.infos.map(([id]) => id) : d.ids;
    let target: DropTarget | null = null;
    if (last && !last.alt && !st.variantId && ids.length) {
      const id = groupUnder(last, ids);
      const parents = new Set(ids.map((x) => findParent(t.root, x)?.id));
      const current = parents.size === 1 ? [...parents][0]! : null;
      if (id !== current) {
        const inside = d.kind === "reorder" && current !== null && isInside(t.root, current, id);
        const ready = !inside || (d.pending?.id === id && clock() - d.pending.since >= DWELL_MS);
        if (!inside) d.pending = null;
        else if (d.pending?.id !== id) d.pending = { id, since: clock() };
        if (ready) {
          const shown = geoRef.current.actual.byId.get(id)?.node as FrameNode | undefined;
          const slot = shown && shown.layout !== "free" ? stackSlot(id, last, new Set(ids)) : null;
          target = { id, index: slot?.index ?? -1 };
        } else dwellTimer.current = setTimeout(() => drag.current === d && evaluateInto(d), DWELL_MS + 20);
      } else d.pending = null;
    } else d.pending = null;
    d.target = target;
    if (!target) {
      setInto(null);
      return;
    }
    const it = geoRef.current.actual.byId.get(target.id)!;
    const node = nodeById(t, target.id);
    setInto({ box: it.box, name: target.id === t.root.id ? "the label" : node ? nodeLabel(node) : "group" });
    const shown = it.node as FrameNode;
    setDrop(shown.layout !== "free" && last ? (stackSlot(target.id, last, new Set(ids))?.bar ?? null) : null);
  };

  const thr = 6 / S;
  const snapping = (e: { altKey: boolean }) => snap && !e.altKey;

  /* ------------------------------------------------------------- pointer */

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (zoom === null) useEditorView.getState().set({ zoom: S });
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: zoom === null ? 0 : pan.x, py: zoom === null ? 0 : pan.y };
      return;
    }
    if (e.button !== 0) return;
    const st = useEditor.getState();
    const p = toContent(e.clientX, e.clientY);
    const hit = hitTest(p);
    const t = st.template!;
    // Empty space (or the label background): drag a selection rectangle; a plain click selects the label / nothing.
    if (!hit || hit === t.root.id) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const base = e.shiftKey ? st.selection.filter((id) => id !== t.root.id) : [];
      drag.current = { kind: "marquee", sx: p.x, sy: p.y, started: false, base, clickId: e.shiftKey ? null : hit };
      return;
    }
    if (e.shiftKey) {
      st.toggleSelect(hit);
      return;
    }
    const sel = st.selection.includes(hit) ? st.selection : [hit];
    if (sel !== st.selection) st.select(sel);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const parent = findParent(t.root, hit);
    const shownParent = parent && (geo.actual.byId.get(parent.id)?.node as FrameNode | undefined);
    if (shownParent && shownParent.layout !== "free" && !geo.actual.byId.get(hit)?.node.float) {
      // Reorder the selected siblings of this stack together (others in the selection stay put).
      const ids = sel.filter((id) => findParent(t.root, id)?.id === shownParent.id);
      const origin = Object.fromEntries(ids.flatMap((id) => (geo.actual.byId.get(id) ? [[id, geo.actual.byId.get(id)!.box]] : [])));
      drag.current = { kind: "reorder", sx: p.x, sy: p.y, started: false, ids, parentId: shownParent.id, index: null, origin, target: null, pending: null, last: null };
      return;
    }
    // Everything selected in free placement moves together (a group and its own children only once).
    const infos = captureFree(topmost(t.root, sel.filter((id) => id !== t.root.id)));
    if (!infos.length) return;
    const boxes = infos.map(([id]) => geo.actual.byId.get(id)!.box);
    const union = unionOf(boxes);
    const { tx, ty } = targetsFor(infos.map(([id]) => id));
    drag.current = { kind: "move", sx: p.x, sy: p.y, started: false, infos, union, tx, ty, key: `drag:${++dragSeq}`, target: null, pending: null, last: null };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (e.buttons) return;
      const hit = hitTest(toContent(e.clientX, e.clientY));
      useEditor.getState().setHover(hit && hit !== geo.actual.root.id ? hit : null);
      return;
    }
    if (d.kind === "pan") {
      setPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy });
      return;
    }
    const p = toContent(e.clientX, e.clientY);
    let dx = p.x - d.sx, dy = p.y - d.sy;
    if (d.kind !== "resize" && !d.started) {
      if (Math.hypot(dx, dy) * S < 3) return;
      d.started = true;
      if (d.kind === "reorder" && blockedInVariant("Changing the order")) {
        drag.current = null;
        return;
      }
    }
    const st = useEditor.getState();

    if (d.kind === "marquee") {
      const r: Box = { x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(dx), h: Math.abs(dy) };
      setMarquee(r);
      st.select([...d.base, ...inMarquee(r).filter((id) => !d.base.includes(id))]);
      return;
    }

    if (d.kind === "move") {
      const g: Guide[] = [];
      if (snapping(e)) {
        const moved = { ...d.union, x: d.union.x + dx, y: d.union.y + dy };
        const sx = snapAxis(edgesOf(moved, "x"), d.tx, thr);
        const sy = snapAxis(edgesOf(moved, "y"), d.ty, thr);
        if (sx) {
          dx += sx.offset;
          g.push({ axis: "x", at: sx.line });
        } else dx = snapToDot(d.union.x + dx, view) - d.union.x;
        if (sy) {
          dy += sy.offset;
          g.push({ axis: "y", at: sy.line });
        } else dy = snapToDot(d.union.y + dy, view) - d.union.y;
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      st.setGuides(g);
      applyMove(d.infos, dx, dy, d.key);
      d.last = { ...p, alt: e.altKey };
      evaluateInto(d);
      return;
    }

    if (d.kind === "reorder") {
      // Where the items would land if they leave the row / column (follows the pointer).
      setGhosts(Object.values(d.origin).map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })));
      d.last = { ...p, alt: e.altKey };
      evaluateInto(d);
      if (d.target) return;
      const t = st.template!;
      const parentBase = findParent(t.root, d.ids[0]);
      const pa = geo.actual.byId.get(d.parentId);
      if (!pa || !parentBase) return;
      const row = (pa.node as FrameNode).layout === "row";
      const moving = new Set(d.ids);
      const shown = parentBase.children.filter((c) => !moving.has(c.id) && geo.actual.byId.has(c.id));
      const along = row ? p.x : p.y;
      let k = shown.findIndex((c) => {
        const b = geo.actual.byId.get(c.id)!.box;
        return along < (row ? b.x + b.w / 2 : b.y + b.h / 2);
      });
      if (k < 0) k = shown.length;
      const without = parentBase.children.filter((c) => !moving.has(c.id));
      d.index = k < shown.length ? without.indexOf(shown[k]) : shown.length ? without.indexOf(shown[shown.length - 1]) + 1 : 0;
      const c = contentOf(pa);
      const ref = shown[Math.min(k, shown.length - 1)];
      const rb = ref ? geo.actual.byId.get(ref.id)!.box : c;
      const at = k < shown.length ? (row ? rb.x : rb.y) : row ? rb.x + rb.w : rb.y + rb.h;
      setDrop(row ? { x: at - 0.15, y: c.y, w: 0.3, h: c.h } : { x: c.x, y: at - 0.15, w: c.w, h: 0.3 });
      return;
    }

    // resize
    const b = d.box;
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    const g: Guide[] = [];
    const edge = (v: number, axis: "x" | "y") => {
      if (!snapping(e)) return v;
      const s = snapAxis([v], axis === "x" ? d.tx : d.ty, thr);
      if (s) {
        g.push({ axis, at: s.line });
        return v + s.offset;
      }
      return snapToDot(v, view);
    };
    if (d.handle.includes("w")) x0 = edge(b.x + dx, "x");
    if (d.handle.includes("e")) x1 = edge(b.x + b.w + dx, "x");
    if (d.handle.includes("n")) y0 = edge(b.y + dy, "y");
    if (d.handle.includes("s")) y1 = edge(b.y + b.h + dy, "y");
    const min = 1 / view.dpmm;
    if (x1 - x0 < min) {
      if (d.handle.includes("w")) x0 = x1 - min;
      else x1 = x0 + min;
    }
    if (y1 - y0 < min) {
      if (d.handle.includes("n")) y0 = y1 - min;
      else y1 = y0 + min;
    }
    st.setGuides(g);
    resizeTo(d, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };

  const resizeTo = (d: Extract<Drag, { kind: "resize" }>, abs: Box) => {
    const st = useEditor.getState();
    const t = st.template!;
    const horiz = /[ew]/.test(d.handle), vert = /[ns]/.test(d.handle);
    const [info] = captureFreeAt(d);
    let patch: Record<string, unknown>;
    if (info) {
      const rel = { x: abs.x - info[1].P.x, y: abs.y - info[1].P.y, w: abs.w, h: abs.h };
      patch = freePatch(info[1], rel, { pos: true, size: true });
      if (!horiz) delete patch.w;
      if (!vert) delete patch.h;
    } else {
      patch = {};
      if (horiz) patch.w = { kind: "fixed", mm: r3(abs.w) };
      if (vert) patch.h = { kind: "fixed", mm: r3(abs.h) };
      // A stretched child ignores its cross size; stop stretching when the user sizes it.
      const parent = findParent(t.root, d.id);
      const pn = parent && (geo.actual.byId.get(parent.id)?.node as FrameNode | undefined);
      const node = effectiveNode(t, d.id, st.variantId)!;
      if (pn && pn.layout !== "free") {
        const crossTouched = pn.layout === "row" ? vert : horiz;
        const cross = pn.layout === "row" ? node.h : node.w;
        const stretched = (node.alignSelf ?? (cross.kind === "fill" ? "stretch" : (pn.align ?? "start"))) === "stretch";
        if (crossTouched && stretched) patch.alignSelf = pn.align && pn.align !== "stretch" ? pn.align : "center";
      }
    }
    st.commit((x) => writeProps(x, d.id, patch, st.variantId), d.key);
  };

  // Capture the free info once per resize drag (positions must be relative to the drag start).
  const resizeInfo = useRef<{ key: string; infos: Captured } | null>(null);
  const captureFreeAt = (d: Extract<Drag, { kind: "resize" }>) => {
    if (resizeInfo.current?.key !== d.key) resizeInfo.current = { key: d.key, infos: captureFree([d.id]) };
    return resizeInfo.current.infos;
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
    useEditor.getState().setGuides([]);
    setDrop(null);
    setMarquee(null);
    setInto(null);
    setGhosts(null);
    if (d?.kind === "move" && d.started && d.target) {
      // Into another group, keeping the on-screen place: the same undo step as the move.
      const g = geoRef.current;
      const boxes = Object.fromEntries(d.infos.flatMap(([id]) => (g.actual.byId.get(id) ? [[id, g.actual.byId.get(id)!.box]] : [])));
      dropInto(d.infos.map(([id]) => id), d.target.id, d.target.index, boxes, d.key);
    }
    if (d?.kind === "reorder" && d.started && d.target) {
      const delta = d.last ? { x: d.last.x - d.sx, y: d.last.y - d.sy } : { x: 0, y: 0 };
      const boxes = Object.fromEntries(Object.entries(d.origin).map(([id, b]) => [id, { ...b, x: b.x + delta.x, y: b.y + delta.y }]));
      dropInto(d.ids, d.target.id, d.target.index, boxes, `drag:${++dragSeq}`);
    } else if (d?.kind === "reorder" && d.started && d.index !== null) {
      moveInto(d.ids, d.parentId, d.index);
      // Reordered within its row / column: explain (once) how to place things freely instead.
      explainReorder(d.parentId, d.ids);
    }
    if (d?.kind === "marquee" && !d.started) useEditor.getState().select(d.clickId ? [d.clickId] : d.base);
  };

  /** Topmost unlocked elements whose box lies completely inside a rectangle (content mm). */
  const inMarquee = (r: Box) => {
    const t = useEditor.getState().template!;
    const ids = geo.actual.items
      .slice(1)
      .filter(({ node, box }) => !locked.has(node.id) && !isInstanceChildId(node.id) && box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h)
      .map((it) => it.node.id);
    return topmost(t.root, ids);
  };

  const startResize = (e: React.PointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    wrapRef.current!.setPointerCapture(e.pointerId);
    const it = geo.actual.byId.get(id);
    if (!it) return;
    const p = toContent(e.clientX, e.clientY);
    const { tx, ty } = targetsFor([id]);
    drag.current = { kind: "resize", sx: p.x, sy: p.y, id, handle, box: it.box, tx, ty, key: `resize:${++dragSeq}` };
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toContent(e.clientX, e.clientY);
    const hit = hitTest(p);
    const n = hit ? geo.actual.byId.get(hit)?.node : undefined;
    // Double-click an instance: edit its component.
    const own = hit ? nodeById(useEditor.getState().template!, hit) : undefined;
    if (own?.type === "component") {
      router.push(componentHref(own.ref, useEditor.getState().template!.id));
      return;
    }
    if (n && (n.type === "text" || n.type === "code" || n.type === "icon" || n.type === "image")) window.dispatchEvent(new CustomEvent("editor:focus-content"));
    if (n?.type === "table") window.dispatchEvent(new CustomEvent("editor:focus-content", { detail: tableCellAt(geo.actual.byId.get(n.id), p) }));
  };

  /* -------------------------------------------------------------- render */

  const px = (b: Box) => ({ left: (view.originX + b.x) * S, top: (view.originY + b.y) * S, width: b.w * S, height: b.h * S });
  const selectedItems = selection.map((id) => geo.actual.byId.get(id)).filter((x) => !!x);
  const single = selectedItems.length === 1 && selectedItems[0].node.id !== geo.actual.root.id && !locked.has(selectedItems[0].node.id) ? selectedItems[0] : null;
  const hover = hoverId && !selection.includes(hoverId) ? geo.actual.byId.get(hoverId) : undefined;
  const dotPx = S / view.dpmm;
  const missing = selection.filter((id) => !geo.actual.byId.has(id));

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-roledescription="label canvas"
      aria-label="Label canvas. Tab and Shift+Tab select elements, arrows move (Shift: 1 mm), Enter edits or enters a group, Escape selects the group, Delete removes. Press ? for all shortcuts."
      onKeyDown={a11y.onKeyDown}
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/50 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => !drag.current && useEditor.getState().setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute rounded-[3px] bg-white shadow-md ring-1 ring-border" style={{ left, top, width: labelW, height: labelH }}>
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{ left: band.left, top: band.top, width: band.width, height: band.height, imageRendering: usesPixelated(view.w, view.h, band.devW, band.devH) ? "pixelated" : "auto" }}
        />
        {showGrid && dotPx >= 5 && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: view.bandX * S,
              top: view.bandY * S,
              width: (view.w / view.dpmm) * S,
              height: (view.h / view.dpmm) * S,
              backgroundImage: "radial-gradient(circle at 0 0, rgb(56 132 255 / 0.55) 0.9px, transparent 1.1px)",
              backgroundSize: `${dotPx}px ${dotPx}px`,
            }}
          />
        )}
        {/* Printable band and margin. */}
        {!view.isDesign && (
          <div className="pointer-events-none absolute outline-1 outline-pink-500/50 outline-dashed" style={{ left: view.bandX * S, top: view.bandY * S, width: (view.w / view.dpmm) * S, height: (view.h / view.dpmm) * S }} />
        )}
        <div className="pointer-events-none absolute border border-dashed border-sky-500/40" style={px({ x: 0, y: 0, w: view.width, h: view.height })} />

        {hover && <div className="pointer-events-none absolute outline-1 outline-sky-400" style={px(hover.box)} />}
        {selectedItems.map((it) => (
          <div key={it.node.id} className={cn("pointer-events-none absolute outline-2 outline-sky-500", locked.has(it.node.id) && "outline-dashed")} style={px(it.box)} />
        ))}
        {single &&
          HANDLES.map((h) => {
            const b = px(single.box);
            const hx = h.includes("w") ? 0 : h.includes("e") ? b.width : b.width / 2;
            const hy = h.includes("n") ? 0 : h.includes("s") ? b.height : b.height / 2;
            return (
              <div
                key={h}
                role="presentation"
                className="absolute size-2.5 -translate-1/2 rounded-[2px] border border-sky-600 bg-white shadow-sm"
                style={{ left: b.left + hx, top: b.top + hy, cursor: CURSORS[h] }}
                title="Drag to resize (sets a fixed size)"
                onPointerDown={(e) => startResize(e, single.node.id, h)}
              />
            );
          })}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div key={i} className="pointer-events-none absolute w-px bg-fuchsia-500" style={{ left: (view.originX + g.at) * S, top: 0, height: labelH }} />
          ) : (
            <div key={i} className="pointer-events-none absolute h-px bg-fuchsia-500" style={{ top: (view.originY + g.at) * S, left: 0, width: labelW }} />
          ),
        )}
        {ghosts?.map((b, i) => <div key={i} className="pointer-events-none absolute outline-1 outline-sky-500/70 outline-dashed" style={px(b)} />)}
        {into && (
          <>
            <div className="pointer-events-none absolute rounded-[2px] bg-fuchsia-500/10 outline-2 outline-fuchsia-500" style={px(into.box)} />
            <div
              className="pointer-events-none absolute z-10 -translate-y-full rounded-sm bg-fuchsia-600 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white shadow-sm"
              style={{ left: px(into.box).left, top: px(into.box).top - 2 }}
            >
              Into {into.name} <span className="opacity-75">· hold Alt to keep it where it is</span>
            </div>
          </>
        )}
        {drop && <div className="pointer-events-none absolute rounded-full bg-fuchsia-500" style={px(drop)} />}
        {marquee && <div className="pointer-events-none absolute border border-sky-500 bg-sky-500/10" style={px(marquee)} />}
      </div>
      {template.root.children.length === 0 && (
        <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-background/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
          This label is empty. Use <b>+ Add</b> in the Layers panel to add text, a picture, an icon or a barcode.
        </p>
      )}
      <div
        className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 text-xs shadow-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button className="flex size-6 items-center justify-center rounded hover:bg-muted" title="Zoom out (Ctrl + -)" aria-label="Zoom out" onClick={() => zoomStep("out")}>
          <IconMinus className="size-3.5" />
        </button>
        <span className="w-12 text-center tabular-nums text-muted-foreground" title="Screen pixels per millimeter, as a percentage of 'fit'">
          {Math.round((S / fit) * 100)}%
        </span>
        <button className="flex size-6 items-center justify-center rounded hover:bg-muted" title="Zoom in (Ctrl + +)" aria-label="Zoom in" onClick={() => zoomStep("in")}>
          <IconPlus className="size-3.5" />
        </button>
        <button
          className={cn("flex h-6 items-center gap-1 rounded px-1.5 hover:bg-muted", zoom === null && "text-muted-foreground")}
          title="Fit the label in the window (Ctrl + 0)"
          onClick={() => zoomStep("fit")}
        >
          <IconZoomReset className="size-3.5" /> Fit
        </button>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {a11y.announce}
      </p>
      {missing.length > 0 && (
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          The selected element isn&apos;t shown at this size (hidden, or not shown on this size).
        </p>
      )}
    </div>
  );
}

const unionOf = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Ids of locked nodes and everything inside them. */
export function lockedIds(root: LabelNode) {
  const ids = new Set<string>();
  walk(root, (n, p) => {
    if (n.locked || (p && ids.has(p.id))) ids.add(n.id);
  });
  return ids;
}
