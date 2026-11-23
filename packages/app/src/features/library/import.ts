"use client";
/**
 * One "Import" entry point for every design file labebal understands:
 *   .lbx                    Brother P-touch (core lbx.ts)
 *   .labebal.json / .zip    a shared labebal template with its assets (server)
 *   .json                   NiimBlue label export, or a labebal library export
 *   .zpl / .prn / .txt      Zebra ZPL (core zpl.ts)
 */
import { importLbxFiles, importNiimBlue, importZpl, isNiimBlue, isZpl, SHARE_FORMAT, type Library } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { whoHeader } from "../labels/history-client";
import { apiRoot } from "../../lib/base";

export interface ImportSummary {
  templates: number;
  labels: number;
  /** Label to select afterwards. */
  firstLabelId?: string;
  firstTemplateId?: string;
  warnings: string[];
}

type ImportLibrary = (lib: Pick<Library, "templates" | "labels" | "styles" | "components">) => Promise<{ templates: number; labels: number }>;

const base = (name: string) => name.replace(/\.(labebal\.json|json|zpl|prn|txt|zip|lbx)$/i, "");

/** POST a template file; asks what to do when the template already exists. Null when cancelled. */
export async function importTemplateFile(file: Blob): Promise<{ templateId: string; labels: number; assets: number } | null> {
  const post = (mode?: string) => fetch(`${apiRoot()}/import/template${mode ? `?mode=${mode}` : ""}`, { method: "POST", body: file, headers: whoHeader() });
  let res = await post();
  if (res.status === 409) {
    const c = (await res.json()) as { name: string };
    const replace = await confirmDialog({
      title: `"${c.name}" is already in the library`,
      description: "Replace it with the imported file (its version history keeps the old design), or keep both?",
      confirmLabel: "Replace",
      cancelLabel: "Keep both",
    });
    res = await post(replace ? "replace" : "copy");
  }
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${res.status}`);
  const r = (await res.json()) as { template: { id: string }; labels: number; assets: number };
  return { templateId: r.template.id, labels: r.labels, assets: r.assets };
}

export async function importDesignFiles(files: File[], importLibrary: ImportLibrary, opts: { zplDpmm?: number } = {}): Promise<ImportSummary> {
  const out: ImportSummary = { templates: 0, labels: 0, warnings: [] };
  const lbx = files.filter((f) => /\.lbx$/i.test(f.name));
  if (lbx.length) {
    const r = await importLbxFiles(lbx);
    const n = await importLibrary(r);
    out.templates += n.templates;
    out.labels += n.labels;
    out.firstLabelId ??= r.labels[0]?.id;
    out.warnings.push(...r.warnings);
  }
  for (const f of files.filter((x) => !/\.lbx$/i.test(x.name))) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const shared = async () => {
      const r = await importTemplateFile(f);
      if (!r) return;
      out.templates++;
      out.labels += r.labels;
      out.firstTemplateId ??= r.templateId;
    };
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      await shared();
      continue;
    }
    const text = new TextDecoder().decode(bytes);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (json === undefined) {
      if (!isZpl(text)) throw new Error(`${f.name}: not a file labebal can import`);
      const r = importZpl(text, { name: base(f.name), dpmm: opts.zplDpmm });
      const n = await importLibrary(r);
      out.templates += n.templates;
      out.labels += n.labels;
      out.firstLabelId ??= r.labels[0]?.id;
      out.warnings.push(...r.warnings);
    } else if ((json as { format?: string })?.format === SHARE_FORMAT) {
      await shared();
    } else if (isNiimBlue(json)) {
      const r = importNiimBlue(json, { name: base(f.name) });
      const n = await importLibrary(r);
      out.templates += n.templates;
      out.labels += n.labels;
      out.firstLabelId ??= r.labels[0]?.id;
      out.warnings.push(...r.warnings);
    } else {
      const lib = json as Partial<Library>;
      if (!Array.isArray(lib.templates) && !Array.isArray(lib.labels) && !Array.isArray(lib.components) && !Array.isArray(lib.styles))
        throw new Error(`${f.name}: not a labebal, NiimBlue or library file`);
      // Library exports carry their text styles and components.
      const n = await importLibrary({ templates: lib.templates ?? [], labels: lib.labels ?? [], styles: lib.styles, components: lib.components });
      out.templates += n.templates;
      out.labels += n.labels;
    }
  }
  return out;
}

export const IMPORT_ACCEPT = ".lbx,.json,.zip,.zpl,.prn,.txt";
