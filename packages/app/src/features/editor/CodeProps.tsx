"use client";
/** Code element extras: grouped format picker, per-format error correction and a live "can this be encoded" check. */
import { useEffect, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { CODE_FORMATS, CODE_FORMAT_IDS, codeEncoderReady, codeProblem, loadCodeEncoder, placeholdersIn, type CodeFormat, type CodeNode } from "@labebal/core";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Field } from "./controls";

const GROUPS = [...new Set(CODE_FORMAT_IDS.map((f) => CODE_FORMATS[f].group))];

const ECC_LABELS = { L: "Low (7%)", M: "Medium (15%)", Q: "High (25%)", H: "Highest (30%)" } as const;

/** Error-correction choices the node's format supports (empty: the format picks its own). */
export const eccOptions = (f: CodeFormat) => (CODE_FORMATS[f]?.ecc ?? []).map((v) => ({ value: v, label: ECC_LABELS[v] }));

export function CodeFormatField({ value, onChange }: { value: CodeFormat; onChange: (f: CodeFormat) => void }) {
  return (
    <Field label="Kind" hint={CODE_FORMATS[value] ? `Holds ${CODE_FORMATS[value].holds}.` : undefined}>
      <Select value={value} onValueChange={(v) => onChange(v as CodeFormat)}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label="Kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUPS.map((g) => (
            <SelectGroup key={g}>
              <SelectLabel className="text-[11px]">{g}</SelectLabel>
              {CODE_FORMAT_IDS.filter((f) => CODE_FORMATS[f].group === g).map((f) => (
                <SelectItem key={f} value={f} className="text-xs">
                  {CODE_FORMATS[f].label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Says what's wrong when the typed value can't be encoded in this format.
 * Values from fields are checked per label by preflight instead.
 */
export function CodeValueCheck({ node }: { node: CodeNode }) {
  const [ready, setReady] = useState(codeEncoderReady);
  useEffect(() => {
    if (!ready) void loadCodeEncoder().then(() => setReady(true));
  }, [ready]);
  if (!ready || placeholdersIn(node.value).length) return null;
  const problem = codeProblem(node.format, node.value, node.ecc);
  if (!problem) return null;
  return (
    <p className="flex gap-1 text-[11px] text-amber-700 dark:text-amber-300">
      <IconAlertTriangle className="mt-0.5 size-3 shrink-0" /> {problem}
    </p>
  );
}
