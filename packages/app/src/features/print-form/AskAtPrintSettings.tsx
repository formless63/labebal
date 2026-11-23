"use client";
/** "Ask when printing" options for one field (template editor > Fields). */
import type { FieldDef } from "@labebal/core";
import { Input } from "../../components/ui/input";
import { ChoiceField, Field, Row, SwitchField } from "../editor/controls";

export function AskAtPrintSettings({ field, update }: { field: FieldDef; update: (p: Partial<FieldDef>, key?: string) => void }) {
  return (
    <div className="space-y-1.5">
      <SwitchField
        label="Ask when printing"
        hint="Asked in a form each time labels of this template are printed (lot, best before, batch...). The answer goes on that print only and is kept in history."
        checked={!!field.askAtPrint}
        onChange={(v) => update({ askAtPrint: v || undefined })}
      />
      {field.askAtPrint && (
        <>
          <Row>
            <ChoiceField
              label="Answer type"
              value={field.askType ?? "text"}
              onChange={(v) => update({ askType: v === "text" ? undefined : v })}
              options={[
                { value: "text", label: "Text" },
                { value: "number", label: "Number" },
                { value: "date", label: "Date" },
              ]}
            />
            <SwitchField label="Required" checked={!!field.required} onChange={(v) => update({ required: v || undefined })} />
          </Row>
          <Field label="Question" hint="Shown in the print form instead of the field name.">
            <Input className="h-7 text-sm" placeholder={field.label} value={field.prompt ?? ""} onChange={(e) => update({ prompt: e.target.value || undefined }, `fprompt:${field.key}`)} />
          </Field>
          <Field label="Help text">
            <Input className="h-7 text-sm" value={field.help ?? ""} onChange={(e) => update({ help: e.target.value || undefined }, `fhelp:${field.key}`)} />
          </Field>
          {field.askType === "date" && (
            <p className="text-[11px] text-muted-foreground">
              Default value may be <code>today</code> or an offset such as <code>+30d</code>. Dates arrive as <code>2026-11-19</code>; format them with{" "}
              <code>{`{{${field.key}|date:DD MMM YYYY}}`}</code> or shift them with <code>{`{{${field.key}|date:+30d}}`}</code>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
