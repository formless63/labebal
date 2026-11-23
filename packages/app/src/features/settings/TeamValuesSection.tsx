"use client";
/**
 * Settings > Team values: text set once for the whole team (company name,
 * address, website, phone) that any template shows with `{{team:name}}`.
 * Stored as team settings (`team:<name>`), so every browser gets them.
 */
import { useState } from "react";
import { IconCopy, IconPlus, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { TEAM_VALUE_NAME } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCan } from "../auth/me-client";
import { useLabelStore } from "../labels/store";

/** Suggested names (the Standard formats templates use these). */
const SUGGESTED = ["company", "address", "phone", "website", "email"];

const cleanName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);

export function TeamValuesSection() {
  const values = useLabelStore((s) => s.settings.teamValues) ?? {};
  const setSettings = useLabelStore((s) => s.setSettings);
  const canEdit = useCan("editor");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const write = (next: Record<string, string>) => setSettings({ teamValues: next });
  const setOne = (k: string, v: string) => write({ ...values, [k]: v });
  const remove = (k: string) => {
    const { [k]: _gone, ...rest } = values;
    void _gone;
    write(rest);
  };
  const add = () => {
    const k = cleanName(name);
    if (!TEAM_VALUE_NAME.test(k)) return toast.error("Names start with a letter: letters, digits, - and _ only.");
    if (k in values) return toast.error(`"${k}" already exists.`);
    write({ ...values, [k]: value });
    setName("");
    setValue("");
  };
  const copy = (k: string) => {
    void navigator.clipboard?.writeText(`{{team:${k}}}`);
    toast.success(`Copied {{team:${k}}}`);
  };
  const names = Object.keys(values).sort();
  const missing = SUGGESTED.filter((s) => !(s in values));

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Text that is the same on many labels: your company name, address, website. Type it once here and use it in any template as{" "}
        <code>{"{{team:company}}"}</code>. Changing it here changes every label that uses it.
      </p>
      {names.length > 0 && (
        <div className="divide-y rounded-md border">
          {names.map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-2 p-2">
              <button type="button" onClick={() => copy(k)} className="flex w-44 shrink-0 items-center gap-1 text-left font-mono text-xs text-muted-foreground hover:text-foreground" title="Copy the placeholder">
                {`{{team:${k}}}`} <IconCopy className="size-3" />
              </button>
              <Input className="h-8 min-w-48 flex-1" value={values[k]} disabled={!canEdit} onChange={(e) => setOne(k, e.target.value)} aria-label={`Value of ${k}`} />
              {canEdit && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => remove(k)} aria-label={`Remove ${k}`}>
                  <IconTrash className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-44" placeholder="Name, e.g. company" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New value name" />
            <Input className="h-8 min-w-48 flex-1" placeholder="Text" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New value text" />
            <Button size="sm" onClick={add} disabled={!name.trim()}>
              <IconPlus className="size-4" /> Add
            </Button>
          </div>
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Common:{" "}
              {missing.map((s) => (
                <button key={s} type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => setName(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        !names.length && <p className="text-xs text-muted-foreground">No team values yet. An editor can add them.</p>
      )}
    </div>
  );
}
