"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { findParent, type Template } from "@labebal/core";
import { useLibrary, useLibraryActions } from "../labels/api";
import { templateToComponent } from "./library";
import { isTyping } from "./Canvas";
import { getGeo } from "./geometry";
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  nodeById,
  nudge,
  paste,
  selectFirstChild,
  selectParent,
  unwrapSelection,
  wrapSelection,
} from "./ops";
import { openShortcuts } from "./Shortcuts";
import { useEditor } from "./store";

/** Keyboard shortcuts (ignored while typing in a field). */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return;
      // Leave keys alone while a menu / dialog has focus.
      if ((e.target as HTMLElement | null)?.closest?.("[role=menu],[role=dialog],[role=listbox]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const st = useEditor.getState();
      const t = st.template;
      if (!t) return;
      const handled = () => e.preventDefault();

      if (mod && (k === "0" || k === "=" || k === "+" || k === "-")) {
        handled();
        window.dispatchEvent(new CustomEvent("editor:zoom", { detail: k === "0" ? "fit" : k === "-" ? "out" : "in" }));
        return;
      }
      if (!mod && e.key === "?") return handled(), openShortcuts();
      if (mod && k === "z") return handled(), e.shiftKey ? st.redo() : st.undo();
      if (mod && k === "y") return handled(), st.redo();
      if (mod && k === "c") {
        if (copySelection()) handled();
        return;
      }
      if (mod && k === "x") {
        if (copySelection()) {
          handled();
          deleteSelection();
        }
        return;
      }
      if (mod && k === "v") {
        if (paste()) handled();
        return;
      }
      if (mod && k === "d") return handled(), duplicateSelection();
      if (mod && k === "g") {
        handled();
        if (e.shiftKey) unwrapSelection();
        else {
          const first = st.selection.find((id) => id !== t.root.id);
          const parent = first ? findParent(t.root, first) : null;
          if (!wrapSelection(parent?.layout === "free" ? "free" : "row")) toast.error("Select elements in the same group to group them.");
        }
        return;
      }
      if (mod && k === "a") {
        handled();
        const first = st.selection[0];
        const parent = first && first !== t.root.id ? findParent(t.root, first) : t.root;
        st.select((parent ?? t.root).children.map((c) => c.id));
        return;
      }
      if (k === "delete" || k === "backspace") return handled(), deleteSelection();
      if (k === "escape") return handled(), selectParent();
      if (k === "enter") {
        const n = st.selection[0] ? nodeById(t, st.selection[0]) : undefined;
        if (n?.type === "frame") return handled(), selectFirstChild();
        if (n) return handled(), window.dispatchEvent(new CustomEvent("editor:focus-content"));
        return;
      }
      if (k.startsWith("arrow") && st.selection.length) {
        handled();
        const dot = 1 / (getGeo()?.view.dpmm ?? 8);
        const step = e.shiftKey ? 1 : dot;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        nudge(dx, dy);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export type SaveStatus = "saved" | "pending" | "saving" | "error";

/** Debounced autosave of the edited template; returns a status for the indicator. */
export function useAutosave(delayMs = 800): SaveStatus {
  const actions = useLibraryActions();
  const { data: lib } = useLibrary();
  const ref = useRef({ actions, lib });
  useEffect(() => {
    ref.current = { actions, lib };
  });
  /** Save the template, or (component mode) the component it stands for. */
  const actionsRef = useRef({
    saveTemplate: (t: Template, o: { immediate: true }): Promise<boolean> | undefined => {
      const mode = useEditor.getState().mode;
      if (mode.kind !== "component") return ref.current.actions.saveTemplate(t, o);
      const c = ref.current.lib?.components?.find((x) => x.id === mode.id);
      return c ? ref.current.actions.saveComponent(templateToComponent(t, c), o) : Promise.resolve(false);
    },
  });
  const revision = useEditor((s) => s.revision);
  const [saved, setSaved] = useState({ rev: 0, ok: true });
  const [saving, setSaving] = useState(false);
  const pendingRev = useRef(0);

  useEffect(() => {
    if (revision === 0) return;
    pendingRev.current = revision;
    const id = setTimeout(async () => {
      const t = useEditor.getState().template;
      if (!t) return;
      setSaving(true);
      const ok = (await actionsRef.current.saveTemplate(t, { immediate: true })) ?? true;
      setSaving(false);
      setSaved({ rev: revision, ok });
      if (pendingRev.current === revision) pendingRev.current = 0;
      if (!ok) toast.error("Couldn't save the template. Your changes are kept here; they'll be retried with the next change.");
    }, delayMs);
    return () => clearTimeout(id);
  }, [revision, delayMs]);

  // Flush unsaved work when leaving the page or the editor.
  useEffect(() => {
    const flush = () => {
      const t = useEditor.getState().template;
      if (pendingRev.current && t) {
        pendingRev.current = 0;
        void actionsRef.current.saveTemplate(t, { immediate: true });
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!pendingRev.current) return;
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flush();
    };
  }, []);

  if (saving) return "saving";
  if (revision !== saved.rev && revision !== 0) return "pending";
  return saved.ok ? "saved" : "error";
}
