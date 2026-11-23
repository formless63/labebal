"use client";
/**
 * Label page (`/l/<id>`): what a label's `{{labelUrl}}` QR code opens on a
 * phone. Preview, field values (links tappable), the dataset row it came
 * from, notes (editors), last prints, and Print again / Edit / Open in inventory.
 */
import { useState } from "react";
import { Link } from "../../lib/router";
import { useParams, useRouter } from "../../lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCopy, IconEdit, IconExternalLink, IconFolder, IconHistory, IconNotes, IconPrinter, IconTable } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useCan } from "../auth/me-client";
import { json } from "../data/api";
import { isInverted, usePrintContext } from "../labels/context";
import { whoHeader } from "../labels/history-client";
import { LabelPreview } from "../labels/LabelPreview";
import { useLabelStore } from "../labels/store";
import type { FieldRow, LabelPageData } from "./model";
import { apiRoot } from "../../lib/base";

export const labelPageKey = (id: string) => ["label-page", id] as const;

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Section({ title, icon, children, actions }: { title: string; icon?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {icon}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Name / value list; links open in a new tab. */
function ValueList({ rows }: { rows: Pick<FieldRow, "label" | "value" | "href">[] }) {
  return (
    <dl className="divide-y rounded-lg border">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(6rem,35%)_1fr] gap-3 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 font-medium break-words">
            {r.href ? (
              <a href={r.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {r.value}
              </a>
            ) : (
              r.value || <span className="text-muted-foreground">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Notes({ id, notes }: { id: string; notes: LabelPageData["notes"] }) {
  const canEdit = useCan("editor");
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes?.text ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`${apiRoot()}/labels/${encodeURIComponent(id)}/notes`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...whoHeader() },
        body: JSON.stringify({ notes: text }),
      }).then((x) => json<NonNullable<LabelPageData["notes"]>>(x));
      qc.setQueryData<LabelPageData>(labelPageKey(id), (d) => (d ? { ...d, notes: r.text ? r : null } : d));
      setEditing(false);
      toast.success("Notes saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Notes"
      icon={<IconNotes className="size-3.5" />}
      actions={
        canEdit && !editing ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setText(notes?.text ?? "");
              setEditing(true);
            }}
          >
            <IconEdit /> {notes?.text ? "Edit" : "Add"}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <div className="space-y-2">
          <Textarea rows={5} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What's in it, where it goes, supplier notes…" aria-label="Notes" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : notes?.text ? (
        <div className="space-y-1">
          <p className="rounded-lg border px-3 py-2.5 text-sm whitespace-pre-wrap">{notes.text}</p>
          <p className="text-xs text-muted-foreground">
            {notes.updatedBy ? `${notes.updatedBy}, ` : ""}
            {fmtWhen(notes.updatedAt)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
    </Section>
  );
}

export function LabelPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = decodeURIComponent(raw);
  const router = useRouter();
  const ctx = usePrintContext();
  const canPrint = useCan("printer");
  const canEdit = useCan("editor");
  const enqueue = useLabelStore((s) => s.enqueue);
  const select = useLabelStore((s) => s.select);
  const q = useQuery({
    queryKey: labelPageKey(id),
    // null = no such label (404), not an error to retry.
    queryFn: () => fetch(`${apiRoot()}/labels/${encodeURIComponent(id)}`).then((r) => (r.status === 404 ? null : json<LabelPageData>(r))),
  });

  if (q.isPending) return <p className="m-auto p-6 text-muted-foreground">Loading…</p>;
  if (q.isError || !q.data) {
    const missing = q.data === null;
    return (
      <div className="m-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="text-lg font-semibold">{missing ? "Label not found" : "Could not load this label"}</h1>
        <p className="text-sm text-muted-foreground">{missing ? `There is no label "${id}" any more. It may have been deleted or re-imported under another key.` : q.error?.message}</p>
        <Button asChild variant="outline">
          <Link href="/">Open labebal</Link>
        </Button>
      </div>
    );
  }

  const d = q.data;
  const { label, template } = d;
  const last = d.prints[0];
  const scale = Math.min(12, 300 / ctx.size.widthMm, 150 / ctx.size.heightMm);

  const printAgain = () => {
    enqueue(label.id, 1);
    toast.success(`Added ${label.name} to the print queue`);
    router.push("/");
  };
  const edit = () => {
    select(label.id);
    router.push("/");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(d.url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-6 px-4 py-5 sm:px-6">
        <header className="space-y-3">
          <div className="flex justify-center rounded-xl bg-muted/50 p-4">
            <LabelPreview
              template={template}
              label={label}
              invert={isInverted(label, template, ctx.settings.invertAll)}
              size={ctx.size}
              printer={ctx.printer}
              material={ctx.settings.material}
              ribbon={ctx.settings.ribbon}
              marginMm={ctx.settings.marginMm}
              scale={scale}
              snap={0.8}
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl leading-tight font-semibold break-words">{label.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {d.folder && (
                <span className="flex items-center gap-1">
                  <IconFolder className="size-4" /> {d.folder.split("/").join(" / ")}
                </span>
              )}
              <span>{template.name}</span>
            </p>
          </div>
          {d.recordUrl && (
            <Button asChild size="lg" className="w-full">
              <a href={d.recordUrl} target="_blank" rel="noopener noreferrer">
                <IconExternalLink /> Open in inventory
              </a>
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {canPrint && (
              <Button size="lg" variant={d.recordUrl ? "outline" : "default"} onClick={printAgain}>
                <IconPrinter /> Print again
              </Button>
            )}
            {canEdit && (
              <Button size="lg" variant="outline" onClick={edit}>
                <IconEdit /> Edit
              </Button>
            )}
          </div>
        </header>

        <Section title="Details">
          <ValueList rows={d.fields} />
        </Section>

        <Notes id={label.id} notes={d.notes} />

        {d.source && (
          <Section
            title={`From ${d.source.datasetName}`}
            icon={<IconTable className="size-3.5" />}
            actions={
              <Button asChild size="xs" variant="ghost">
                <Link href={`/data?dataset=${encodeURIComponent(d.source.datasetId)}&q=${encodeURIComponent(label.name)}`}>Open row</Link>
              </Button>
            }
          >
            <ValueList rows={d.source.cells.map((c) => ({ label: c.name, value: c.value, href: c.href }))} />
          </Section>
        )}

        <Section title="Printed" icon={<IconHistory className="size-3.5" />}>
          {last ? (
            <ul className="divide-y rounded-lg border text-sm">
              {d.prints.map((p) => (
                <li key={p.historyId} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                  <span className="font-medium">{fmtWhen(p.printedAt)}</span>
                  <span className="text-muted-foreground">
                    {p.qty} × {p.sizeName}
                    {p.who ? ` · ${p.who}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not printed yet.</p>
          )}
        </Section>

        <footer className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono" title={d.url}>
            {d.url}
          </span>
          <Button size="xs" variant="ghost" onClick={() => void copyLink()}>
            <IconCopy /> Copy link
          </Button>
        </footer>
      </div>
    </div>
  );
}
