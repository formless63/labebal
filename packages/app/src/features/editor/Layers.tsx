"use client";
/** Layers tree: select, rename, hide/lock, drag to reorder or nest, group/ungroup. */
import { useState } from "react";
import {
  IconChevronRight,
  IconColumns,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLayoutBoard,
  IconLayoutRows,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconStack2,
  IconTrash,
  IconUnlink,
} from "@tabler/icons-react";
import { effectiveNode, findParent, isInside, topmost, variantsShowing, type LabelNode, type Template } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { toast } from "sonner";
import { LayerIssueBadge } from "../preflight";
import { IconBtn, Tip } from "./controls";
import { ADD_ITEMS, NodeIcon, nodeLabel } from "./nodes";
import { addNode, blockedInVariant, deleteSelection, duplicateSelection, moveInto, nodeById, unwrapSelection, wrapSelection } from "./ops";
import { updateProps, useEditor, visibilityPatch, writeProps } from "./store";
import { ComponentMenuItems, MakeComponentButton } from "./PartsProps";

type DropPos = "before" | "after" | "inside";

export function Layers() {
  const t = useEditor((s) => s.template)!;
  const selection = useEditor((s) => s.selection);
  const variantId = useEditor((s) => s.variantId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const sel = selection.filter((id) => id !== t.root.id);
  const selNode = sel.length === 1 ? nodeById(t, sel[0]) : undefined;

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const onDrop = () => {
    if (!dragId || !drop) return;
    const target = nodeById(t, drop.id);
    if (!target) return;
    // Dragging a selected row drags the whole selection (in tree order).
    const moving = sel.includes(dragId) ? topmost(t.root, sel) : [dragId];
    if (moving.some((id) => isInside(t.root, id, target.id) && (drop.pos === "inside" || id !== target.id))) return;
    if (drop.pos === "inside") moveInto(moving, target.id, -1);
    else {
      const parent = findParent(t.root, target.id);
      if (!parent) return;
      const without = parent.children.filter((c) => !moving.includes(c.id));
      let i = without.findIndex((c) => c.id === target.id);
      if (i < 0) {
        // Dropped next to one of the moved rows: keep the block where that row was.
        const all = parent.children.map((c) => c.id);
        i = all.slice(0, all.indexOf(target.id)).filter((id) => !moving.includes(id)).length;
        moveInto(moving, parent.id, i);
      } else moveInto(moving, parent.id, drop.pos === "before" ? i : i + 1);
    }
    setDragId(null);
    setDrop(null);
  };

  const wrap = (layout: "row" | "column" | "free") => {
    if (!wrapSelection(layout)) toast.error("Select elements that sit in the same group to group them.");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-0.5 border-b px-2 py-1.5">
        <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Layers</span>
        <DropdownMenu>
          <Tip tip="Add an element">
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="outline">
                <IconPlus /> Add
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
            {ADD_ITEMS.map((it) => (
              <DropdownMenuItem key={it.kind} onSelect={() => addNode(it.kind)}>
                <it.icon />
                <div>
                  <div>{it.label}</div>
                  <div className="text-[11px] text-muted-foreground">{it.hint}</div>
                </div>
              </DropdownMenuItem>
            ))}
            <ComponentMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tip tip="Put the selected elements in a group">
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={!sel.length} aria-label="Group selection">
                <IconStack2 />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => wrap("row")}>
              <IconColumns /> Group side by side (row)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => wrap("column")}>
              <IconLayoutRows /> Group top to bottom (column)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => wrap("free")}>
              <IconLayoutBoard /> Group, free placement
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconBtn tip="Ungroup: replace the group by its contents" disabled={selNode?.type !== "frame"} onClick={() => unwrapSelection()}>
          <IconUnlink />
        </IconBtn>
        <MakeComponentButton disabled={!sel.length} />
        <IconBtn tip="Duplicate (Ctrl+D)" disabled={!sel.length} onClick={duplicateSelection}>
          <IconCopy />
        </IconBtn>
        <IconBtn tip={variantId ? "Remove from this variant's sizes (Del)" : "Delete (Del)"} disabled={!sel.length} onClick={deleteSelection}>
          <IconTrash />
        </IconBtn>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" onDragEnd={() => (setDragId(null), setDrop(null))}>
        <LayerRow
          t={t}
          node={t.root}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          dragId={dragId}
          setDragId={setDragId}
          drop={drop}
          setDrop={setDrop}
          onDrop={onDrop}
        />
      </div>
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Drag to reorder; drop onto a group to put it inside (on the label too: drag onto a group, or out of a row / column). Double-click a name to rename.
      </p>
    </div>
  );
}

interface RowProps {
  t: Template;
  node: LabelNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  drop: { id: string; pos: DropPos } | null;
  setDrop: (d: { id: string; pos: DropPos } | null) => void;
  onDrop: () => void;
}

function LayerRow(p: RowProps) {
  const { t, node, depth } = p;
  const selected = useEditor((s) => s.selection.includes(node.id));
  const hovered = useEditor((s) => s.hoverId === node.id);
  const variantId = useEditor((s) => s.variantId);
  const [editing, setEditing] = useState(false);
  const eff = effectiveNode(t, node.id, variantId) ?? node;
  const isRoot = node.id === t.root.id;
  const isFrame = node.type === "frame";
  const open = isFrame && !p.collapsed.has(node.id);
  const patched = !!(variantId && t.variants?.find((v) => v.id === variantId)?.patches[node.id]);
  const dropHere = p.drop?.id === node.id ? p.drop.pos : null;
  const showing = variantsShowing(t, node.id);
  const onlyIn = showing.map((v) => t.variants?.find((x) => x.id === v)?.name ?? v);

  const onClick = (e: React.MouseEvent) => {
    const st = useEditor.getState();
    if (e.shiftKey || e.ctrlKey || e.metaKey) st.toggleSelect(node.id);
    else st.select([node.id]);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!p.dragId || p.dragId === node.id || isInside(t.root, p.dragId, node.id)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const pos: DropPos = isRoot ? "inside" : isFrame && f > 0.25 && f < 0.75 ? "inside" : f < 0.5 ? "before" : "after";
    if (p.drop?.id !== node.id || p.drop.pos !== pos) p.setDrop({ id: node.id, pos });
  };

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={isFrame ? open : undefined}
        draggable={!isRoot && !editing}
        onDragStart={(e) => {
          if (blockedInVariant("Changing the order or grouping")) return e.preventDefault();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          p.setDragId(node.id);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => p.drop?.id === node.id && p.setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          p.onDrop();
        }}
        onClick={onClick}
        onMouseEnter={() => useEditor.getState().setHover(node.id)}
        onMouseLeave={() => useEditor.getState().setHover(null)}
        className={cn(
          "group relative flex h-7 cursor-default items-center gap-1 pr-1 text-sm",
          selected ? "bg-sky-500/15" : hovered ? "bg-muted" : "",
          eff.hidden && "text-muted-foreground/60",
          dropHere === "inside" && "ring-2 ring-fuchsia-500 ring-inset",
          p.dragId === node.id && "opacity-50",
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {dropHere === "before" && <div className="absolute inset-x-1 top-0 h-0.5 rounded bg-fuchsia-500" />}
        {dropHere === "after" && <div className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-fuchsia-500" />}
        <button
          className={cn("flex size-4 items-center justify-center text-muted-foreground", !isFrame && "invisible")}
          onClick={(e) => {
            e.stopPropagation();
            p.toggle(node.id);
          }}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <NodeIcon node={eff} className={cn("size-3.5 shrink-0 text-muted-foreground", node.type === "component" && "text-violet-600")} />
        {editing ? (
          <input
            autoFocus
            className="h-6 min-w-0 flex-1 rounded border bg-background px-1 text-sm"
            defaultValue={node.name ?? nodeLabel(node)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setEditing(false);
              const name = e.target.value.trim();
              useEditor.getState().commit((x) => writeProps(x, node.id, { name: name || undefined }, null));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setEditing(true)}>
            {isRoot ? (node.name ?? "Label") : nodeLabel(node)}
          </span>
        )}
        <LayerIssueBadge nodeId={node.id} />
        {eff.float && (
          <Tip tip="Floating: placed freely, not lined up with the rest of its group">
            <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[10px] text-sky-800 dark:text-sky-300">float</span>
          </Tip>
        )}
        {onlyIn.length > 0 && (
          <Tip tip={`Only shown by ${onlyIn.map((v) => `“${v}”`).join(", ")}`}>
            <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-800 dark:text-amber-300">{variantId && showing.includes(variantId) ? "only here" : "variant"}</span>
          </Tip>
        )}
        {patched && !onlyIn.length && (
          <Tip tip="Changed in the variant you're editing">
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          </Tip>
        )}
        {!isRoot && (
          <span className={cn("flex shrink-0 items-center", !(eff.hidden || eff.locked) && "opacity-0 group-hover:opacity-100")}>
            <button
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title={eff.hidden ? "Show" : variantId ? "Hide on this variant's sizes" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                updateProps(node.id, visibilityPatch(t, node.id, !eff.hidden, variantId));
              }}
            >
              {eff.hidden ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
            </button>
            <button
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title={node.locked ? "Unlock" : "Lock: can't be picked or moved on the label"}
              onClick={(e) => {
                e.stopPropagation();
                useEditor.getState().commit((x) => writeProps(x, node.id, { locked: node.locked ? undefined : true }, null));
              }}
            >
              {node.locked ? <IconLock className="size-3.5" /> : <IconLockOpen className="size-3.5" />}
            </button>
          </span>
        )}
      </div>
      {open && node.type === "frame" && node.children.map((c) => <LayerRow key={c.id} {...p} node={c} depth={depth + 1} />)}
    </>
  );
}
