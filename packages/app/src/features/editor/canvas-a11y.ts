"use client";
/**
 * Keyboard and screen-reader support for the editor canvas: Tab / Shift+Tab
 * walk through the elements in paint order (then leave the canvas, so focus is
 * never trapped), and a live region announces what is selected. Arrows,
 * Enter, Escape, Delete... are handled by the global shortcuts (hooks.ts).
 */
import { useMemo } from "react";
import { cellAt, findNode, isInstanceChildId, tableGrid, type LaidOut, type TableNode } from "@labebal/core";
import type { Geo } from "./geometry";
import { TYPE_NAMES, nodeLabel } from "./nodes";
import { useEditor } from "./store";

const mm = (v: number) => v.toFixed(1);

/** Elements that can be selected from the keyboard (paint order, no root, not locked, not inside a component instance or a mirrored copy). */
const selectable = (geo: Geo, locked: Set<string>) => geo.actual.items.slice(1).filter((it) => !locked.has(it.node.id) && !isInstanceChildId(it.node.id) && !it.copyOf);

export function useCanvasA11y(geo: Geo, locked: Set<string>) {
  const selection = useEditor((s) => s.selection);

  const announce = useMemo(() => {
    const items = selectable(geo, locked);
    if (!selection.length) return "Nothing selected.";
    if (selection.length > 1) return `${selection.length} elements selected.`;
    const id = selection[0];
    if (id === geo.actual.root.id) return `Whole label selected, ${items.length} element${items.length === 1 ? "" : "s"}. Press Tab to select the first one.`;
    const it = geo.actual.byId.get(id);
    if (!it) return "Selected element is not shown at this size.";
    const i = items.findIndex((x) => x.node.id === id);
    const base = useEditor.getState().template;
    const own = base && findNode(base.root, id);
    const what = TYPE_NAMES[own ? own.type : it.node.type];
    const name = nodeLabel(own || it.node);
    const text = it.text && it.node.type !== "text" ? `, ${it.text.slice(0, 40)}` : "";
    return `${name}${name === what ? "" : `, ${what}`}${text}. ${mm(it.box.w)} by ${mm(it.box.h)} millimeters at ${mm(it.box.x)}, ${mm(it.box.y)}.${i >= 0 ? ` ${i + 1} of ${items.length}.` : ""}`;
  }, [geo, locked, selection]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || e.target !== e.currentTarget) return;
    const items = selectable(geo, locked);
    if (!items.length) return;
    const cur = useEditor.getState().selection;
    const i = cur.length === 1 ? items.findIndex((x) => x.node.id === cur[0]) : -1;
    const next = e.shiftKey ? (i < 0 ? items.length - 1 : i - 1) : i + 1;
    // Past either end: let the browser move focus out of the canvas.
    if (next < 0 || next >= items.length) return;
    e.preventDefault();
    useEditor.getState().select([items[next].node.id]);
  };

  return { announce, onKeyDown };
}

/** Table cell under a content-space point, for double-click editing. */
export function tableCellAt(it: LaidOut | undefined, p: { x: number; y: number }) {
  if (!it || it.node.type !== "table" || !it.table) return null;
  const g = tableGrid(it.node as TableNode, it.box.w, it.box.h, it.table.natural);
  return cellAt(g, p.x - it.box.x, p.y - it.box.y);
}
