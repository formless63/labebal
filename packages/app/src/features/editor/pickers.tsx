"use client";
/** Image (asset library + upload) and icon (re-exported from features/icons) pickers. */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLoader2, IconPhotoUp } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { assetUrl } from "@labebal/core";
import { apiRoot } from "../../lib/base";

interface AssetInfo {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
}

const ASSETS_KEY = ["assets", "image"] as const;

export function ImagePicker({ value, onChange }: { value: string; onChange: (src: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assets = useQuery({
    queryKey: ASSETS_KEY,
    queryFn: async () => {
      const r = await fetch(`${apiRoot()}/assets?kind=image`);
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as AssetInfo[];
    },
    enabled: open,
  });

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "image");
      const r = await fetch(`${apiRoot()}/assets`, { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? r.statusText);
      await qc.invalidateQueries({ queryKey: ASSETS_KEY });
      onChange((body as AssetInfo).url);
      setOpen(false);
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const current = assets.data?.find((a) => a.url === value);
  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 overflow-hidden">
            {value && !value.includes("{{") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(value)} alt="" className="size-5 rounded-sm object-contain" />
            ) : (
              <IconPhotoUp />
            )}
            <span className="truncate">{current?.name ?? (value ? (value.includes("{{") ? value : "Picture chosen") : "Choose a picture…")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2" align="start">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Pictures</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <IconLoader2 className="animate-spin" /> : <IconPhotoUp />} Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </div>
          {assets.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {assets.error && <p className="text-xs text-destructive">Couldn&apos;t load pictures.</p>}
          {assets.data && !assets.data.length && <p className="text-xs text-muted-foreground">No pictures yet. Upload a PNG, JPG or SVG.</p>}
          <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto">
            {assets.data?.map((a) => (
              <button
                key={a.id}
                title={a.name}
                className={cn("aspect-square overflow-hidden rounded-md border bg-white p-0.5 hover:ring-2 hover:ring-ring", a.url === value && "ring-2 ring-primary")}
                onClick={() => {
                  onChange(a.url);
                  setOpen(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(a.url)} alt={a.name} className="size-full object-contain" loading="lazy" />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ---------------------------------------------------------------- icons */

// Owned by the icons feature (library tabs, favourites, custom icons).
export { IconPicker } from "../icons/IconPicker";
