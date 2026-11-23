"use client";
/** "Export as pack": manifest details for selected templates / labels, downloads a zip to commit to a pack repo. */
import { useState } from "react";
import { IconBrandGithub, IconPackageExport } from "@tabler/icons-react";
import { useCan } from "../auth/me-client";
import { PublishDialog } from "../github/PublishDialog";
import { toast } from "sonner";
import { slugify } from "@labebal/core";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { downloadPack } from "./api";

export interface ExportPackTarget {
  title: string;
  templateIds: string[];
  labelIds: string[];
  /** Suggested name (folder / template name). */
  name?: string;
}

export function ExportPackDialog({ target, onClose }: { target: ExportPackTarget; onClose: () => void }) {
  const [name, setName] = useState(target.name ?? "My pack");
  const [id, setId] = useState(slugify(target.name ?? "my-pack") || "my-pack");
  const [touchedId, setTouchedId] = useState(false);
  const [version, setVersion] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState("");
  const [datasets, setDatasets] = useState(false);
  const [busy, setBusy] = useState(false);
  const canPublish = useCan("editor");
  const [publishing, setPublishing] = useState(false);

  if (publishing) return <PublishDialog target={{ title: target.title, templateIds: target.templateIds, labelIds: target.labelIds, name }} onClose={onClose} />;

  async function go() {
    setBusy(true);
    try {
      const c = await downloadPack({ manifest: { id, name, version, ...(author ? { author } : {}), ...(description ? { description } : {}), ...(folder ? { folder } : {}) }, templateIds: target.templateIds, labelIds: target.labelIds, datasets });
      toast.success(`Exported ${name}`, { description: `${c.templates ?? 0} templates, ${c.labels ?? 0} labels. Unzip into your pack repo, check with "pnpm packs check", commit.` });
      onClose();
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder = "") => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export as pack</DialogTitle>
          <DialogDescription>
            {target.title}: {target.templateIds.length ? `${target.templateIds.length} template${target.templateIds.length === 1 ? "" : "s"}` : "the templates they use"}
            {target.labelIds.length ? ` and ${target.labelIds.length} label${target.labelIds.length === 1 ? "" : "s"}` : ""}, with the images and fonts they use. Keep the id the same for every version so friends get updates.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Name", name, (v) => (setName(v), !touchedId && setId(slugify(v) || "my-pack")))}
          {field("Id (never change it)", id, (v) => (setId(v), setTouchedId(true)))}
          {field("Version", version, setVersion, "1.0.0")}
          {field("Author", author, setAuthor)}
          <div className="sm:col-span-2">{field("Description", description, setDescription)}</div>
          <div className="sm:col-span-2">{field("Default folder for labels without one (optional)", folder, setFolder)}</div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={datasets} onCheckedChange={(v) => setDatasets(v === true)} /> Include datasets linked to these templates
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {canPublish && (
            <Button variant="outline" onClick={() => setPublishing(true)} disabled={!name.trim() || !id.trim()}>
              <IconBrandGithub /> Publish to GitHub…
            </Button>
          )}
          <Button onClick={() => void go()} disabled={busy || !name.trim() || !id.trim()}>
            <IconPackageExport /> {busy ? "Exporting…" : "Download zip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
