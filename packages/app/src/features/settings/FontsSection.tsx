"use client";
/** Settings section: built-in + uploaded label fonts. */
import { useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { BUILTIN_FONTS, isBuiltinFont, type PixelFont } from "@labebal/core";
import { confirmDialog } from "../../components/dialogs";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import {
  FONTS_KEY,
  deleteFontAsset,
  familyOf,
  fontDefOf,
  inspectFontFile,
  saveFontMeta,
  uploadFont,
  useFontAssets,
  type FontAsset,
} from "../fonts/fonts-client";
import { useFontsReady } from "../labels/printer";

const DEFAULT_SAMPLE = "Label maker 0123 ABC xyz";

function Sample({ family, pixel, text }: { family: string; pixel?: PixelFont; text: string }) {
  // Pixel fonts look right at whole multiples of their grid.
  const size = pixel ? pixel.pxPerEm * Math.max(1, Math.round(22 / pixel.pxPerEm)) : 22;
  return (
    <p
      className="truncate leading-tight"
      style={{ fontFamily: `"${family}"`, fontSize: size, WebkitFontSmoothing: pixel ? "none" : undefined }}
      title={text}
    >
      {text}
    </p>
  );
}

const pixelBadge = (p?: PixelFont) =>
  p ? (
    <Badge variant="secondary">
      pixel {p.pxPerEm} px/em, line {p.linePx}
    </Badge>
  ) : (
    <Badge variant="outline">vector</Badge>
  );

function UploadedFont({ asset, sample }: { asset: FontAsset; sample: string }) {
  const qc = useQueryClient();
  const def = fontDefOf(asset);
  const [pixel, setPixel] = useState<PixelFont | undefined>(def.pixel);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(pixel ?? null) !== JSON.stringify(def.pixel ?? null);

  const save = async () => {
    setBusy(true);
    try {
      await saveFontMeta(asset.id, { ...asset.meta, family: familyOf(asset), pixel });
      await qc.invalidateQueries({ queryKey: FONTS_KEY });
      toast.success(`Saved ${def.family}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete the font "${def.family}"?`, description: "Labels using it fall back to the browser default.", confirmLabel: "Delete", destructive: true }))) return;
    try {
      await deleteFontAsset(asset.id);
      await qc.invalidateQueries({ queryKey: FONTS_KEY });
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Same name as a built-in font: listed as "<name> (uploaded)" unless the user replaces the built-in.
  const clash = isBuiltinFont(familyOf(asset));
  const setReplace = async (replaceBuiltin: boolean) => {
    try {
      await saveFontMeta(asset.id, { ...asset.meta, family: familyOf(asset), replaceBuiltin: replaceBuiltin || undefined });
      await qc.invalidateQueries({ queryKey: FONTS_KEY });
    } catch (e) {
      toast.error(String(e));
    }
  };

  const num = (v: number, fallback: number) => (Number.isFinite(v) && v > 0 ? Math.round(v) : fallback);

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{def.family}</span>
        {pixelBadge(def.pixel)}
        <span className="text-xs text-muted-foreground">
          {asset.name}, {Math.round(asset.size / 1024)} kB
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}>
          <IconTrash /> Delete
        </Button>
      </div>
      <Sample family={def.family} pixel={def.pixel} text={sample} />
      {clash && (
        <label className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          <Switch checked={!!asset.meta?.replaceBuiltin} onCheckedChange={(on) => void setReplace(on)} />
          <span>
            A built-in font is also called &ldquo;{familyOf(asset)}&rdquo;.{" "}
            {asset.meta?.replaceBuiltin
              ? "This file is used instead of the built-in font, on every label that uses it."
              : `The built-in font is kept; this file is listed as “${def.family}”. Switch on to use this file instead of the built-in font.`}
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch checked={!!pixel} onCheckedChange={(on) => setPixel(on ? (def.pixel ?? { pxPerEm: 8, linePx: 10 }) : undefined)} />
          Pixel font
        </label>
        {pixel && (
          <>
            <label className="flex items-center gap-1.5" title="Font pixels per em: the size at which one font pixel is one dot">
              px/em
              <Input type="number" className="h-8 w-20" min={1} max={128} value={pixel.pxPerEm} onChange={(e) => setPixel({ ...pixel, pxPerEm: num(e.target.valueAsNumber, pixel.pxPerEm) })} />
            </label>
            <label className="flex items-center gap-1.5" title="Baseline-to-baseline distance in font pixels">
              line
              <Input type="number" className="h-8 w-20" min={1} max={256} value={pixel.linePx} onChange={(e) => setPixel({ ...pixel, linePx: num(e.target.valueAsNumber, pixel.linePx) })} />
            </label>
          </>
        )}
        {dirty && (
          <Button size="sm" disabled={busy} onClick={save}>
            Save
          </Button>
        )}
      </div>
    </li>
  );
}

const noopSubscribe = () => () => {};

export function FontsSection() {
  useFontsReady();
  const qc = useQueryClient();
  const query = useFontAssets();
  // The font list is cached client-side (FontsProvider), so render it only after hydration
  // to keep the server and first client render identical.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const uploaded = mounted ? query.data : undefined;
  const isLoading = !mounted || query.isLoading;
  const error = mounted ? query.error : null;
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of [...files]) {
        const meta = await inspectFontFile(file);
        await uploadFont(file, meta);
        toast.success(`Added ${meta.family}${meta.pixel ? ` (pixel font, ${meta.pixel.pxPerEm} px/em)` : ""}`);
      }
      await qc.invalidateQueries({ queryKey: FONTS_KEY });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-sm" value={sample} placeholder={DEFAULT_SAMPLE} onChange={(e) => setSample(e.target.value)} aria-label="Sample text" />
        <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
          <IconUpload /> {uploading ? "Uploading…" : "Upload font"}
        </Button>
        <span className="text-xs text-muted-foreground">TTF, OTF or WOFF. Pixel fonts are detected from their outlines; adjust the grid if needed.</span>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Uploaded</h3>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Could not load fonts: {String(error)}</p>}
        {uploaded && !uploaded.length && <p className="text-sm text-muted-foreground">No uploaded fonts yet.</p>}
        <ul className="space-y-2">
          {uploaded?.map((a) => (
            <UploadedFont key={`${a.id}:${JSON.stringify(a.meta)}`} asset={a} sample={sample || DEFAULT_SAMPLE} />
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Built in</h3>
        <ul className="space-y-2">
          {BUILTIN_FONTS.map((f) => (
            <li key={f.family} className="space-y-1 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{f.family}</span>
                {pixelBadge(f.pixel)}
              </div>
              <Sample family={f.family} pixel={f.pixel} text={sample || DEFAULT_SAMPLE} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
