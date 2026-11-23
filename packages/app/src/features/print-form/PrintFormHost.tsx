"use client";
/** The print-time form dialog; mount once (app/providers.tsx). See ask.ts. */
import { useState, useSyncExternalStore } from "react";
import { IconPrinter } from "@tabler/icons-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { askQueue, rememberAnswers, settleAsk, subscribeAsk, type AskRequest } from "./ask";

const EMPTY: AskRequest[] = [];

export function PrintFormHost() {
  const queue = useSyncExternalStore(subscribeAsk, askQueue, () => EMPTY);
  const req = queue[0];
  return req ? <PrintForm key={req.id} req={req} /> : null;
}

function PrintForm({ req }: { req: AskRequest }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries(req.groups.map((g) => [g.template.id, { ...g.initial }])));
  const [tried, setTried] = useState(false);
  const missing = req.groups.flatMap((g) => g.fields.filter((f) => f.required && !answers[g.template.id][f.key]?.trim()).map((f) => `${g.template.id}:${f.key}`));
  const set = (tid: string, key: string, v: string) => setAnswers((a) => ({ ...a, [tid]: { ...a[tid], [key]: v } }));

  const finish = (ok: boolean) => {
    if (ok) {
      if (missing.length) return setTried(true);
      for (const g of req.groups) rememberAnswers(g.template.id, answers[g.template.id]);
    }
    req.resolve(ok ? answers : null);
    settleAsk(req.id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && finish(false)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            finish(true);
          }}
        >
          <DialogHeader>
            <DialogTitle>Before printing</DialogTitle>
            <DialogDescription>These values go on the labels for this print only; they are not saved to the labels but are kept in the print history.</DialogDescription>
          </DialogHeader>
          {req.groups.map((g) => (
            <fieldset key={g.template.id} className="space-y-3">
              {req.groups.length > 1 && (
                <legend className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {g.template.name} · {g.copies} label{g.copies === 1 ? "" : "s"}
                </legend>
              )}
              {g.fields.map((f, i) => {
                const id = `pf-${g.template.id}-${f.key}`;
                const value = answers[g.template.id][f.key] ?? "";
                const bad = tried && missing.includes(`${g.template.id}:${f.key}`);
                const common = {
                  id,
                  value,
                  autoFocus: i === 0 && g === req.groups[0],
                  "aria-invalid": bad || undefined,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(g.template.id, f.key, e.target.value),
                };
                return (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={id}>
                      {f.prompt || f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {f.askType === "date" ? (
                      <Input type="date" {...common} />
                    ) : f.askType === "number" ? (
                      <Input type="number" inputMode="decimal" step="any" {...common} />
                    ) : f.type === "multiline" ? (
                      <Textarea rows={2} className="min-h-0" {...common} />
                    ) : (
                      <Input {...common} />
                    )}
                    {(f.help || bad) && <p className={`text-xs ${bad ? "text-destructive" : "text-muted-foreground"}`}>{bad ? "Required" : f.help}</p>}
                  </div>
                );
              })}
            </fieldset>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <IconPrinter /> Print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
