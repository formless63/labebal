"use client";
/** Settings section: upload / rename / delete custom SVG icons; lists the bundled libraries. */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconLoader2, IconTrash, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  customIconId,
  customIconTitle,
  deleteCustomIcon,
  invalidateIcons,
  renameCustomIcon,
  uploadCustomIcon,
  useCustomIcons,
  type CustomIconAsset,
} from "../icons/custom-icons";
import { IconThumb } from "../icons/IconThumb";
import { forgetIcon } from "../icons/prefs";
import { fetchIconSets } from "../labels/icons-client";

function CustomIconRow({ asset }: { asset: CustomIconAsset }) {
  const qc = useQueryClient();
  const title = customIconTitle(asset);
  const [name, setName] = useState(title);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = customIconId(asset.id);

  const save = async () => {
    const t = name.trim();
    if (!t || t === title) return setName(title);
    setBusy(true);
    try {
      await renameCustomIcon(asset, t);
      await invalidateIcons(qc);
    } catch (e) {
      toast.error(`Rename failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteCustomIcon(asset.id);
      forgetIcon(id);
      await invalidateIcons(qc);
      toast.success(`Deleted ${title}`);
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border p-2">
      <div className="flex gap-1">
        <IconThumb id={id} size={40} px={64} className="rounded border" />
        <IconThumb id={id} size={20} px={20} className="self-end rounded border" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          className="h-8"
          value={name}
          aria-label="Icon name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(title);
          }}
        />
        <p className="truncate font-mono text-[11px] text-muted-foreground" title="Use this id in icon fields and data rules">
          {id}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Labels using it show a crossed box.</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)} title="Delete icon">
          <IconTrash />
        </Button>
      )}
    </li>
  );
}

export function IconsSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useCustomIcons();
  const sets = useQuery({ queryKey: ["icon-sets"], queryFn: fetchIconSets, staleTime: 5 * 60_000 });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const f of [...files]) {
      try {
        await uploadCustomIcon(f);
        ok++;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (ok) toast.success(ok > 1 ? `Added ${ok} icons` : "Icon added");
    await invalidateIcons(qc);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div id="icons" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <IconLoader2 className="animate-spin" /> : <IconUpload />} Upload SVG icons
        </Button>
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        <p className="text-xs text-muted-foreground">
          Simple black shapes print best. Scripts, embedded pictures and styles are removed on upload; white parts print as paper.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">Couldn&apos;t load custom icons.</p>}
      {data && !data.length && <p className="text-sm text-muted-foreground">No custom icons yet: upload your own connector drawings or logos.</p>}
      {!!data?.length && (
        <ul className="grid gap-2 md:grid-cols-2">
          {data.map((a) => (
            <CustomIconRow key={a.id} asset={a} />
          ))}
        </ul>
      )}

      {sets.data && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Bundled libraries (offline)</p>
          <ul className="flex flex-wrap gap-1.5">
            {sets.data
              .filter((s) => s.id !== "custom")
              .map((s) => (
                <li key={s.id}>
                  <Badge variant="outline" title={s.note}>
                    <IconCheck className="size-3" /> {s.title}: {s.count.toLocaleString()} icons,{" "}
                    {s.license.url ? (
                      <a href={s.license.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        {s.license.title}
                      </a>
                    ) : (
                      s.license.title
                    )}
                  </Badge>
                </li>
              ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">Brand logos (Simple Icons) are trademarks of their owners; use them only to identify what a part is for.</p>
        </div>
      )}
    </div>
  );
}
