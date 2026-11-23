"use client";
/** Group extras for cable flags: a mirrored copy of another group and a blank wrap zone sized by cable diameter. */
import { cableWrapMm, walk, type FrameNode, type MirrorSpec } from "@labebal/core";
import { ChoiceField, NumField, Section } from "./controls";
import { nodeLabel } from "./nodes";
import { useEditor } from "./store";

const NONE = "__none";

type SetFn = (patch: Record<string, unknown>, key?: string) => void;

const MODES: { value: MirrorSpec["mode"]; label: string }[] = [
  { value: "reflect", label: "Back to back (folded around the cable)" },
  { value: "rotate", label: "Upside down (hangs from the cable)" },
  { value: "repeat", label: "Same again (repeat)" },
];

export function CableSection({ node, set, isRoot }: { node: FrameNode; set: SetFn; isRoot: boolean }) {
  const t = useEditor((s) => s.template)!;
  if (isRoot) return null;
  const frames: { value: string; label: string }[] = [{ value: NONE, label: "None: a normal group" }];
  walk(t.root, (n) => {
    if (n.type === "frame" && n.id !== node.id && n.id !== t.root.id && !n.mirror) frames.push({ value: n.id, label: nodeLabel(n) });
  });
  const mirror = node.mirror;
  return (
    <Section title="Cable flag" defaultOpen={!!mirror || node.wrapDiameterMm !== undefined}>
      <NumField
        label="Wrap zone for a cable of"
        hint="Makes this group a blank strip as long as the cable's circumference (π × diameter), so the label wraps once around it. Leave empty for a normal group."
        unit="mm"
        step={0.5}
        min={0}
        allowEmpty
        placeholder="off"
        value={node.wrapDiameterMm}
        onChange={(v) => set({ wrapDiameterMm: v && v > 0 ? v : undefined }, `wrapd:${node.id}`)}
      />
      {node.wrapDiameterMm ? <p className="text-[11px] text-muted-foreground">Wrap length {Math.round(cableWrapMm(node.wrapDiameterMm) * 10) / 10} mm.</p> : null}
      <ChoiceField
        label="Copy of another group"
        hint="Shows a live copy of another group here (this group's own contents are not shown), so a flag reads the same on both sides."
        value={mirror?.of ?? NONE}
        onChange={(of) => set({ mirror: of !== NONE ? { of, mode: mirror?.mode ?? "reflect" } : undefined })}
        options={frames}
      />
      {mirror && <ChoiceField label="Copy as" value={mirror.mode} onChange={(mode) => set({ mirror: { ...mirror, mode } })} options={MODES} />}
    </Section>
  );
}
