"use client";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { RULE_OPS, ruleProblem, walk, type DataColumn, type DatasetLink, type LabelNode, type Library, type Rule, type RuleOp, type RuleSet, type Template } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { IconPicker } from "../icons/IconPicker";
import { Hint, Pick } from "./ui";

const PAINTS = [
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
  { value: "invert", label: "Invert" },
  { value: "none", label: "None" },
];

/** Style properties a rule can change, by node type (plain names for non-technical users). */
const PROPS: { prop: string; label: string; types: LabelNode["type"][]; values: { value: string; label: string }[] }[] = [
  { prop: "fill", label: "Fill", types: ["frame", "rect", "ellipse"], values: PAINTS },
  { prop: "stroke", label: "Outline", types: ["frame", "rect", "ellipse", "text"], values: PAINTS },
  { prop: "color", label: "Color", types: ["text", "icon", "code", "line", "image"], values: PAINTS },
  { prop: "hidden", label: "Visibility", types: ["frame", "rect", "ellipse", "text", "icon", "code", "line", "image"], values: [{ value: "false", label: "Shown" }, { value: "true", label: "Hidden" }] },
];

/** Read as "When <column> does / does not <verb> <value>". */
const VERBS: Record<RuleOp, string> = { equals: "equal", contains: "contain", startsWith: "start with", endsWith: "end with", regex: "match pattern", isEmpty: "be empty" };

const nodesOf =(t: Template | undefined) => {
  const out: LabelNode[] = [];
  if (t) walk(t.root, (n) => n.id !== t.root.id && out.push(n));
  return out;
};

const newRule = (column: string): Rule => ({ id: `rule-${crypto.randomUUID().slice(0, 8)}`, when: { column, op: "equals", value: "" }, then: {} });

function RuleCard({
  rule,
  index,
  count,
  columns,
  lib,
  template,
  allowTemplate,
  onChange,
  onMove,
  onDelete,
}: {
  rule: Rule;
  index: number;
  count: number;
  columns: DataColumn[];
  lib: Library;
  template: Template | undefined;
  allowTemplate: boolean;
  onChange: (r: Rule) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const op = RULE_OPS.find((o) => o.op === rule.when.op)!;
  const problem = ruleProblem(rule.when);
  const effTemplate = lib.templates.find((t) => t.id === rule.then.templateId) ?? template;
  const fields = effTemplate?.fields ?? [];
  const nodes = nodesOf(effTemplate);
  const values = Object.entries(rule.then.values ?? {});
  // Fields shown by an icon element get an icon picker next to the text box.
  const iconFields = new Set(["icon", ...nodes.flatMap((n) => (n.type === "icon" ? [...n.icon.matchAll(/\{\{\s*([\w.-]+)/g)].map((m) => m[1]) : []))]);
  const overrides = Object.entries(rule.then.overrides ?? {}).flatMap(([nodeId, patch]) => Object.entries(patch).map(([prop, v]) => ({ nodeId, prop, value: String(v) })));
  const setThen = (p: Partial<Rule["then"]>) => onChange({ ...rule, then: { ...rule.then, ...p } });
  const setWhen = (p: Partial<Rule["when"]>) => onChange({ ...rule, when: { ...rule.when, ...p } });

  const setValues = (entries: [string, string][]) => setThen({ values: entries.length ? Object.fromEntries(entries) : undefined });
  const setOverrides = (list: { nodeId: string; prop: string; value: string }[]) => {
    const o: Record<string, Record<string, unknown>> = {};
    for (const x of list) (o[x.nodeId] ??= {})[x.prop] = x.prop === "hidden" ? x.value === "true" : x.value;
    setThen({ overrides: list.length ? (o as Record<string, Partial<LabelNode>>) : undefined });
  };

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${rule.disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
        <Input className="h-8 w-56" placeholder="Rule name (optional)" value={rule.name ?? ""} onChange={(e) => onChange({ ...rule, name: e.target.value || undefined })} />
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <Switch checked={!rule.disabled} onCheckedChange={(v) => onChange({ ...rule, disabled: !v || undefined })} /> On
        </label>
        <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">
          <IconArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down">
          <IconArrowDown />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Delete rule">
          <IconTrash />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-10 font-medium">When</span>
        <Pick value={rule.when.column || undefined} onChange={(v) => setWhen({ column: v ?? "" })} placeholder="column" options={columns.map((c) => ({ value: c.id, label: c.name }))} aria-label="Column" />
        <Pick value={rule.when.not ? "not" : "is"} onChange={(v) => setWhen({ not: v === "not" || undefined })} options={[{ value: "is", label: "does" }, { value: "not", label: "does not" }]} className="min-w-20" aria-label="Negate" />
        <Pick value={rule.when.op} onChange={(v) => setWhen({ op: (v ?? "equals") as RuleOp })} options={RULE_OPS.map((o) => ({ value: o.op, label: VERBS[o.op] }))} aria-label="Comparison" />
        {op.needsValue && <Input className="h-8 w-48" value={rule.when.value ?? ""} onChange={(e) => setWhen({ value: e.target.value })} placeholder={rule.when.op === "regex" ? "e.g. ^M[0-9]" : "value"} />}
        {problem && <span className="text-xs text-destructive">{problem}</span>}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-start gap-2">
          <span className="w-10 pt-1.5 font-medium">Then</span>
          <div className="flex-1 space-y-2">
            {values.map(([k, v], i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">set</span>
                <Pick value={k} onChange={(nk) => setValues(values.map((e, j) => (j === i ? [nk ?? k, e[1]] : e)))} options={fields.map((f) => ({ value: f.key, label: f.label }))} aria-label="Field" />
                <span className="text-muted-foreground">to</span>
                {iconFields.has(k) && <IconPicker compact value={v} onChange={(id) => setValues(values.map((x, j) => (j === i ? [x[0], id] : x)))} />}
                <Input className="h-8 w-56" value={v} onChange={(e) => setValues(values.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} placeholder={iconFields.has(k) ? "icon, e.g. mdi:screw-flat-top" : "text, or {{column}}"} />
                <Button size="icon-sm" variant="ghost" onClick={() => setValues(values.filter((_, j) => j !== i))} title="Remove">
                  <IconX />
                </Button>
              </div>
            ))}
            {overrides.map((o, i) => {
              const node = nodes.find((n) => n.id === o.nodeId);
              const props = PROPS.filter((p) => !node || p.types.includes(node.type));
              const def = PROPS.find((p) => p.prop === o.prop);
              return (
                <div key={`o${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">make</span>
                  <Pick value={o.nodeId} onChange={(id) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, nodeId: id ?? x.nodeId } : x)))} options={nodes.map((n) => ({ value: n.id, label: n.name ?? n.id }))} aria-label="Element" />
                  <Pick value={o.prop} onChange={(p) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, prop: p ?? x.prop } : x)))} options={props.map((p) => ({ value: p.prop, label: p.label }))} aria-label="Property" />
                  <Pick value={o.value} onChange={(v) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, value: v ?? x.value } : x)))} options={def?.values ?? PAINTS} aria-label="Value" />
                  <Button size="icon-sm" variant="ghost" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))} title="Remove">
                    <IconX />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">label colors</span>
              <Pick
                value={rule.then.invert === undefined ? undefined : rule.then.invert ? "inv" : "norm"}
                onChange={(v) => setThen({ invert: v === undefined ? undefined : v === "inv" })}
                none="No change"
                options={[{ value: "norm", label: "Normal" }, { value: "inv", label: "Inverted (white on black)" }]}
              />
              {allowTemplate && (
                <>
                  <span className="text-muted-foreground">template</span>
                  <Pick value={rule.then.templateId} onChange={(v) => setThen({ templateId: v })} none="No change" options={lib.templates.map((t) => ({ value: t.id, label: t.name }))} />
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" disabled={!fields.length} onClick={() => setValues([...values, [fields.find((f) => f.key === "icon")?.key ?? fields[0].key, ""]])}>
                <IconPlus /> Set a field
              </Button>
              <Button size="xs" variant="outline" disabled={!nodes.length} onClick={() => setOverrides([...overrides, { nodeId: nodes[0].id, prop: PROPS.find((p) => p.types.includes(nodes[0].type))?.prop ?? "hidden", value: "black" }])}>
                <IconPlus /> Change a style
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ordered category -> style rules for a linked dataset. */
export function RulesPanel({ dataset, lib, onChange }: { dataset: { columns: DataColumn[]; link?: DatasetLink }; lib: Library; onChange: (link: DatasetLink) => void }) {
  const link = dataset.link;
  if (!link) return <Hint>Choose a label design on the &quot;Label design&quot; tab first.</Hint>;
  const template = lib.templates.find((t) => t.id === link.templateId);
  const own = template?.rules?.rules.length ?? 0;
  return (
    <div className="space-y-3">
      {own > 0 && (
        <Hint>
          The template &quot;{template!.name}&quot; also has {own} rule{own === 1 ? "" : "s"} of its own (Data &gt; Template rules). They run when the label is drawn, after
          these.
        </Hint>
      )}
      <RulesEditor columns={dataset.columns} rules={link.rules} onChange={(rules) => onChange({ ...link, rules })} lib={lib} template={template} />
    </div>
  );
}

/**
 * Ordered "when <column> ... then set ..." rules. Used for dataset links
 * (conditions test columns) and template-level rules (conditions test the
 * template's fields; no template switching).
 */
export function RulesEditor({
  columns,
  rules: set,
  onChange,
  lib,
  template,
  allowTemplate = true,
  hint,
}: {
  columns: DataColumn[];
  rules: RuleSet;
  onChange: (r: RuleSet) => void;
  lib: Library;
  template: Template | undefined;
  /** Rules may switch the template (dataset links only). */
  allowTemplate?: boolean;
  hint?: React.ReactNode;
}) {
  const { rules, mode } = set;
  const update = (i: number, r: Rule) => onChange({ mode, rules: rules.map((x, j) => (j === i ? r : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange({ mode, rules: next });
  };
  const defaultColumn = columns.find((c) => /categ|type|group|kind/i.test(c.name))?.id ?? columns[0]?.id ?? "";

  return (
    <div className="space-y-4">
      <Hint>
        {hint ?? "Rules change labels based on the data, top to bottom."} Example: when <em>Category</em> is &quot;Nuts&quot;, set <em>Icon</em> to &quot;mdi:nut&quot; (use the icon button to pick one). Type <code>{"{{name}}"}</code> in a value to copy that {allowTemplate ? "column" : "field"}.
      </Hint>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">When several rules match:</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && onChange({ mode: v as RuleSet["mode"], rules })}>
          <ToggleGroupItem value="first">Use only the first</ToggleGroupItem>
          <ToggleGroupItem value="all">Apply all (later ones win)</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {rules.map((r, i) => (
        <RuleCard
          key={r.id}
          rule={r}
          index={i}
          count={rules.length}
          columns={columns}
          lib={lib}
          template={template}
          allowTemplate={allowTemplate}
          onChange={(x) => update(i, x)}
          onMove={(d) => move(i, d)}
          onDelete={() => onChange({ mode, rules: rules.filter((_, j) => j !== i) })}
        />
      ))}
      <Button variant="outline" onClick={() => onChange({ mode, rules: [...rules, newRule(defaultColumn)] })}>
        <IconPlus /> Add rule
      </Button>
    </div>
  );
}
