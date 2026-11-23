"use client";
/**
 * Promise-based replacements for `confirm()` / `prompt()` / `alert()`, drawn
 * with shadcn dialogs. Mount `<DialogHost />` once (app/providers.tsx), then:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete?", destructive: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: "New column", label: "Name" }); // null when cancelled
 *
 * The functions also work outside React (`confirmDialog`, `promptDialog`, `alertDialog`).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  /** Text of the OK button (default "OK"; e.g. "Delete"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red OK button for destructive actions. */
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: React.ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return a message to block submitting (e.g. "Name is taken"). */
  validate?: (value: string) => string | undefined;
}

type Req =
  | { kind: "confirm"; id: number; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "alert"; id: number; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; id: number; opts: PromptOptions; resolve: (v: string | null) => void };

let queue: Req[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const push = (r: Req) => ((queue = [...queue, r]), emit());
const settle = (id: number) => ((queue = queue.filter((r) => r.id !== id)), emit());

export const confirmDialog = (opts: ConfirmOptions) => new Promise<boolean>((resolve) => push({ kind: "confirm", id: nextId++, opts, resolve }));
export const alertDialog = (opts: ConfirmOptions) => new Promise<void>((resolve) => push({ kind: "alert", id: nextId++, opts, resolve: () => resolve() }));
export const promptDialog = (opts: PromptOptions) => new Promise<string | null>((resolve) => push({ kind: "prompt", id: nextId++, opts, resolve }));

export const useConfirm = () => confirmDialog;
export const usePrompt = () => promptDialog;
export const useAlert = () => alertDialog;

function PromptBody({ req }: { req: Extract<Req, { kind: "prompt" }> }) {
  const { opts } = req;
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const problem = opts.validate?.(value);
  useEffect(() => input.current?.select(), []);
  const done = (v: string | null) => {
    req.resolve(v);
    settle(req.id);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && done(null)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!problem) done(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>{opts.title}</DialogTitle>
            {opts.description && <DialogDescription>{opts.description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-1.5">
            {opts.label && <Label htmlFor={`prompt-${req.id}`}>{opts.label}</Label>}
            <Input
              id={`prompt-${req.id}`}
              ref={input}
              autoFocus
              value={value}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={touched && !!problem}
            />
            {touched && problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => done(null)}>
              Cancel
            </Button>
            <Button type="submit">{opts.confirmLabel ?? "OK"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({ req }: { req: Extract<Req, { kind: "confirm" | "alert" }> }) {
  const { opts } = req;
  const done = (v: boolean) => {
    req.resolve(v);
    settle(req.id);
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && done(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {req.kind === "confirm" && <AlertDialogCancel onClick={() => done(false)}>{opts.cancelLabel ?? "Cancel"}</AlertDialogCancel>}
          <AlertDialogAction variant={opts.destructive ? "destructive" : "default"} onClick={() => done(true)}>
            {opts.confirmLabel ?? "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const empty: Req[] = [];

/** Renders the open dialog (one at a time, first come first served). */
export function DialogHost() {
  const list = useSyncExternalStore(subscribe, () => queue, () => empty);
  const req = list[0];
  if (!req) return null;
  return req.kind === "prompt" ? <PromptBody key={req.id} req={req} /> : <ConfirmBody key={req.id} req={req} />;
}
