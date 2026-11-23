"use client";
import { Link } from "../../lib/router";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconComponents,
  IconCheck,
  IconGridDots,
  IconKeyboard,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconLoader2,
  IconMagnet,
} from "@tabler/icons-react";
import { SIZES, type Label } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { IconBtn, Tip } from "./controls";
import type { SaveStatus } from "./hooks";
import { alignSelection, canAlign, canDistribute, distributeSelection } from "./ops";
import { openShortcuts } from "./Shortcuts";
import { backHref } from "./library";
import { useEditor, useEditorView } from "./store";

export function EditorToolbar({ status, labels }: { status: SaveStatus; labels: Label[] }) {
  const t = useEditor((s) => s.template)!;
  const mode = useEditor((s) => s.mode);
  const isComponent = mode.kind === "component";
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const sampleId = useEditor((s) => s.sampleLabelId);
  // Re-render when the selection changes so align buttons enable/disable.
  useEditor((s) => s.selection);
  useEditor((s) => s.revision);
  const view = useEditorView();
  const align = canAlign();
  const distribute = canDistribute();

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-card px-2 py-1.5">
      <Tip tip={isComponent ? (mode.from ? "Back to where you came from" : "Back to the components") : "Back to all templates"}>
        <Link
          href={isComponent ? backHref(mode.from) : "/templates"}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={isComponent ? "Back" : "Back to templates"}
        >
          <IconArrowLeft className="size-4" />
        </Link>
      </Tip>
      {isComponent && (
        <span className="flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:text-violet-200">
          <IconComponents className="size-3.5" /> Component
        </span>
      )}
      <Input
        className="h-7 w-52 border-transparent bg-transparent text-sm font-semibold shadow-none hover:border-input focus-visible:border-input"
        value={t.name}
        onChange={(e) => useEditor.getState().commit((x) => ({ ...x, name: e.target.value }), "tname")}
        aria-label={isComponent ? "Component name" : "Template name"}
      />
      <SaveIndicator status={status} />
      <Separator orientation="vertical" className="mx-1 h-5" />

      <IconBtn tip="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
        <IconArrowBackUp />
      </IconBtn>
      <IconBtn tip="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
        <IconArrowForwardUp />
      </IconBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />

      <Tip tip="Label size shown on the canvas">
        <div>
          <Select value={view.sizeId} onValueChange={(sizeId) => view.set({ sizeId })}>
            <SelectTrigger size="sm" className="h-7 w-44 text-xs" aria-label="Label size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="design" className="text-xs">
                Design size ({t.design.w} × {t.design.h} mm)
              </SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Niimbot N1 / B18</SelectLabel>
                {SIZES.filter((s) => s.printer === "N1").map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    N1 {s.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Niimbot M2</SelectLabel>
                {SIZES.filter((s) => s.printer !== "N1").map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    M2 {s.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </Tip>
      <IconBtn tip={view.showGrid ? "Hide dot grid" : "Show dot grid (when zoomed in)"} active={view.showGrid} onClick={() => view.set({ showGrid: !view.showGrid })}>
        <IconGridDots />
      </IconBtn>
      <IconBtn tip={view.snap ? "Snapping on (hold Alt to move freely)" : "Snapping off"} active={view.snap} onClick={() => view.set({ snap: !view.snap })}>
        <IconMagnet />
      </IconBtn>
      <Separator orientation="vertical" className="mx-1 h-5" />

      <div className="flex items-center" aria-label="Align">
        <IconBtn tip="Align left edges (one element: to its group)" disabled={!align} onClick={() => alignSelection("left")}>
          <IconLayoutAlignLeft />
        </IconBtn>
        <IconBtn tip="Center horizontally" disabled={!align} onClick={() => alignSelection("hcenter")}>
          <IconLayoutAlignCenter />
        </IconBtn>
        <IconBtn tip="Align right edges" disabled={!align} onClick={() => alignSelection("right")}>
          <IconLayoutAlignRight />
        </IconBtn>
        <IconBtn tip="Align top edges" disabled={!align} onClick={() => alignSelection("top")}>
          <IconLayoutAlignTop />
        </IconBtn>
        <IconBtn tip="Center vertically" disabled={!align} onClick={() => alignSelection("vcenter")}>
          <IconLayoutAlignMiddle />
        </IconBtn>
        <IconBtn tip="Align bottom edges" disabled={!align} onClick={() => alignSelection("bottom")}>
          <IconLayoutAlignBottom />
        </IconBtn>
        <IconBtn tip="Space evenly left to right (3 or more)" disabled={!distribute} onClick={() => distributeSelection("h")}>
          <IconLayoutDistributeHorizontal />
        </IconBtn>
        <IconBtn tip="Space evenly top to bottom (3 or more)" disabled={!distribute} onClick={() => distributeSelection("v")}>
          <IconLayoutDistributeVertical />
        </IconBtn>
      </div>

      <span className="flex-1" />
      <IconBtn tip="Keyboard and mouse help (?)" onClick={openShortcuts}>
        <IconKeyboard />
      </IconBtn>
      {!isComponent && <Tip tip="Preview with the data of an existing label, or the fields' example values">
        <div>
          <Select value={sampleId ?? "__defaults"} onValueChange={(v) => useEditor.getState().setSample(v === "__defaults" ? null : v)}>
            <SelectTrigger size="sm" className="h-7 w-48 text-xs" aria-label="Preview data">
              <span className="text-muted-foreground">Preview:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__defaults" className="text-xs">
                Example values
              </SelectItem>
              {labels.length > 0 && <SelectSeparator />}
              {labels.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Tip>}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…", error: "Not saved" }[status];
  return (
    <span
      className={cn("flex items-center gap-1 text-xs", status === "error" ? "text-destructive" : "text-muted-foreground")}
      role="status"
      aria-live="polite"
      title="Changes save automatically"
    >
      {status === "saved" && <IconCheck className="size-3.5" />}
      {status === "saving" && <IconLoader2 className="size-3.5 animate-spin" />}
      {status === "pending" && <span className="size-1.5 rounded-full bg-amber-500" />}
      {status === "error" && <IconAlertTriangle className="size-3.5" />}
      {text}
    </span>
  );
}
