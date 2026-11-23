"use client";
import { IconWand } from "@tabler/icons-react";
import { autoMapFields, createLink, type DataColumn, type DatasetLink, type Library } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { fetchRows } from "./api";
import { Hint, Pick } from "./ui";

/** Rows looked at to guess the key column when linking. */
const SAMPLE = 1000;

/** Which template the rows print with, and which column fills which field. */
export function LinkPanel({ dataset, lib, onChange }: { dataset: { id: string; columns: DataColumn[]; link?: DatasetLink }; lib: Library; onChange: (link: DatasetLink) => void }) {
  const link = dataset.link;
  const template = lib.templates.find((t) => t.id === link?.templateId);
  const colOptions = dataset.columns.map((c) => ({ value: c.id, label: c.name }));
  const setLink = (p: Partial<DatasetLink>) => link && onChange({ ...link, ...p });

  async function pickTemplate(id: string | undefined) {
    const t = lib.templates.find((x) => x.id === id);
    if (!t) return;
    if (!link) {
      const sample = await fetchRows(dataset.id, { limit: SAMPLE }).catch(() => ({ rows: [] }));
      return onChange(createLink({ columns: dataset.columns, rows: sample.rows }, t));
    }
    // Keep the label id prefix (so existing labels keep updating) and rules; re-match fields.
    onChange({ ...link, templateId: t.id, fields: { ...autoMapFields(t.fields, dataset.columns), ...pickKnown(link.fields, t.fields.map((f) => f.key)) } });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Label design (template)</Label>
          <Pick value={link?.templateId} onChange={(v) => void pickTemplate(v)} placeholder="Choose a template" options={lib.templates.map((t) => ({ value: t.id, label: t.name }))} className="w-full" />
        </div>
        {link && (
          <>
            <div className="space-y-1.5">
              <Label>Key column (unique per row)</Label>
              <Pick value={link.keyColumn} onChange={(v) => setLink({ keyColumn: v })} none="None (labels follow row order)" options={colOptions} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label>Label name in lists</Label>
              <Pick value={link.nameColumn} onChange={(v) => setLink({ nameColumn: v })} none="Same as key" options={colOptions} className="w-full" />
            </div>
          </>
        )}
      </div>
      {link && (
        <Hint>
          The key (e.g. SKU or part number) keeps each label tied to its row: importing the data again updates the same labels instead of making copies.
        </Hint>
      )}
      {link && template && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Fill the label&apos;s fields from columns</h3>
            <Button size="sm" variant="outline" onClick={() => setLink({ fields: autoMapFields(template.fields, dataset.columns) })}>
              <IconWand /> Match by name
            </Button>
          </div>
          <div className="divide-y rounded-lg border">
            {template.fields.map((f) => (
              <div key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-40 flex-1 text-sm">
                  {f.label} <span className="text-xs text-muted-foreground">({f.key})</span>
                </span>
                <Pick
                  value={link.fields[f.key]}
                  onChange={(v) => {
                    const fields = { ...link.fields };
                    if (v) fields[f.key] = v;
                    else delete fields[f.key];
                    setLink({ fields });
                  }}
                  none={f.default ? `Not from data (default "${f.default}")` : "Not from data"}
                  options={colOptions}
                  className="w-64"
                  aria-label={`Column for ${f.label}`}
                />
              </div>
            ))}
          </div>
          <Hint>Fields not filled from a column can still be set by rules (next tab), e.g. an icon chosen by category.</Hint>
        </div>
      )}
      {link && !template && <p className="text-sm text-destructive">The linked template no longer exists. Choose another one.</p>}
    </div>
  );
}

const pickKnown = (fields: Record<string, string>, keys: string[]) => Object.fromEntries(Object.entries(fields).filter(([k]) => keys.includes(k)));
