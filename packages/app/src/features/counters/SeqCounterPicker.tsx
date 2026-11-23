"use client";
/** Template editor: which persistent counter numbers {{seq}}; lists the counters the template uses. */
import { Link } from "../../lib/router";
import { countersUsed, usesSequence } from "@labebal/core";
import { ChoiceField } from "../editor/controls";
import { useEditor } from "../editor/store";
import { useCounters } from "./api";

const NONE = "__none";

export function SeqCounterPicker() {
  const t = useEditor((s) => s.template)!;
  const counters = useCounters();
  const used = [...countersUsed(t)];
  const seq = usesSequence(t);
  if (!seq && !used.length && !t.seqCounter) return null;
  const known = new Set(counters.data?.map((c) => c.id));
  const options = [{ value: NONE, label: "None: start at 1 / Start #" }, ...(counters.data ?? []).map((c) => ({ value: c.id, label: c.name === c.id ? c.id : `${c.name} (${c.id})` }))];
  if (t.seqCounter && !known.has(t.seqCounter)) options.push({ value: t.seqCounter, label: `${t.seqCounter} (created on first print)` });
  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2">
      {(seq || t.seqCounter) && (
        <ChoiceField
          label="{{seq}} numbers from"
          hint="A persistent counter keeps counting between prints (and can reset daily, monthly or per lot). A Start # typed when printing still overrides it."
          value={t.seqCounter ?? NONE}
          onChange={(v) => useEditor.getState().commit((x) => ({ ...x, seqCounter: v === NONE ? undefined : v }))}
          options={options}
        />
      )}
      {used.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Counters used: {used.map((id) => (known.has(id) ? id : `${id} (new)`)).join(", ")}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Manage counters in{" "}
        <Link className="underline" href="/settings#counters">
          Settings &gt; Counters
        </Link>
        .
      </p>
    </div>
  );
}
