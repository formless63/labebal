"use client";
/** Keyboard and mouse help for the editor (opens with "?" or the toolbar button). */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Select",
    items: [
      ["Click", "Select an element"],
      ["Shift + click", "Add to / remove from the selection"],
      ["Drag on empty space", "Select everything inside the rectangle (Shift: add)"],
      ["Ctrl + A", "Select everything in the same group"],
      ["Tab / Shift+Tab", "On the canvas: select the next / previous element"],
      ["Esc", "Select the group around it"],
      ["Enter", "Go inside a group, or edit the text"],
    ],
  },
  {
    title: "Move and change",
    items: [
      ["Drag", "Move (all selected elements together)"],
      ["Shift while dragging", "Move straight across or down"],
      ["Alt while dragging", "Don't snap"],
      ["Arrow keys", "Nudge one dot (Shift: 1 mm); in a row or column: change the order"],
      ["Ctrl + G / Ctrl + Shift + G", "Group / ungroup"],
      ["Ctrl + C, X, V, D", "Copy, cut, paste, duplicate"],
      ["Delete", "Delete (in a variant: hide on its sizes)"],
      ["Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"],
    ],
  },
  {
    title: "View",
    items: [
      ["Scroll, or Space + drag", "Pan"],
      ["Ctrl + scroll", "Zoom at the mouse"],
      ["Ctrl + + / Ctrl + -", "Zoom in / out"],
      ["Ctrl + 0", "Fit the label in the window"],
      ["?", "Show this help"],
    ],
  },
];

export const openShortcuts = () => window.dispatchEvent(new CustomEvent("editor:shortcuts"));

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("editor:shortcuts", on);
    return () => window.removeEventListener("editor:shortcuts", on);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard and mouse</DialogTitle>
          <DialogDescription>On a Mac, use Cmd instead of Ctrl.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1">
                {g.items.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>
                      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[11px]">{k}</kbd>
                    </dt>
                    <dd className="text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
