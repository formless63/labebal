"use client";
/**
 * Template-level rules: "when <field> ... then set ...", applied to every
 * label of the template wherever it is drawn (Print page, previews, mockups,
 * printing). Saved on the template document (`Template.rules`).
 */
import { useMemo } from "react";
import { matchedTemplateRules, type Library, type RuleSet } from "@labebal/core";
import { Badge } from "../../components/ui/badge";
import { Label } from "../../components/ui/label";
import { useLibraryActions } from "../labels/api";
import { isInverted, usePrintContext } from "../labels/context";
import { LabelPreview } from "../labels/LabelPreview";
import { RulesEditor } from "./RulesPanel";
import { Hint, Pick } from "./ui";

const SAMPLES = 6;

export function TemplateRulesPanel({ lib, templateId, onTemplate }: { lib: Library; templateId?: string; onTemplate: (id: string | undefined) => void }) {
  const { saveTemplate } = useLibraryActions();
  const ctx = usePrintContext();
  const t = lib.templates.find((x) => x.id === templateId);
  const fieldsAsColumns = useMemo(() => (t?.fields ?? []).map((f) => ({ id: f.key, name: f.label })), [t]);
  const samples = useMemo(() => lib.labels.filter((l) => l.templateId === t?.id).slice(0, SAMPLES), [lib.labels, t]);
  const rules: RuleSet = t?.rules ?? { mode: "first", rules: [] };
  const setRules = (r: RuleSet) => t && saveTemplate({ ...t, rules: r.rules.length ? r : undefined });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Template</Label>
        <Pick
          value={t?.id}
          onChange={onTemplate}
          placeholder="Choose a template"
          options={lib.templates.map((x) => ({ value: x.id, label: `${x.name}${x.rules?.rules.length ? ` (${x.rules.rules.length} rules)` : ""}` }))}
          className="w-full max-w-md"
        />
      </div>
      {!t && <Hint>Pick a template to give it rules of its own: they apply to all its labels, whether they come from data or were made by hand.</Hint>}
      {t && (
        <>
          <RulesEditor
            columns={fieldsAsColumns}
            rules={rules}
            onChange={setRules}
            lib={lib}
            template={t}
            allowTemplate={false}
            hint={`These rules run on every "${t.name}" label wherever it is drawn (Print page, previews, mockups, printing), after any dataset rules. Conditions test the label's fields.`}
          />
          {samples.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Labels using this template</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {samples.map((l) => {
                  const hit = matchedTemplateRules(t, l);
                  return (
                    <div key={l.id} className="space-y-2 rounded-lg border p-3">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <LabelPreview
                        template={t}
                        label={l}
                        invert={isInverted(l, t, ctx.settings.invertAll)}
                        size={ctx.size}
                        printer={ctx.printer}
                        material={ctx.settings.material}
                        ribbon={ctx.settings.ribbon}
                        marginMm={ctx.settings.marginMm}
                        scale={6}
                      />
                      <div className="flex flex-wrap gap-1">
                        {hit.length ? (
                          hit.map((id, i) => (
                            <Badge key={id} variant="secondary">
                              {rules.rules.find((r) => r.id === id)?.name || `Rule #${rules.rules.findIndex((r) => r.id === id) + 1 || i + 1}`}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No rule applied</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
