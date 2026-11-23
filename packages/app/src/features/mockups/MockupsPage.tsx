"use client";
/**
 * Mockups: labels on real objects at true physical scale, built from the same
 * 1-bit render that is sent to the printer (ribbon ink on the chosen stock).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { IconDownload, IconLoader2, IconSearch, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  SIZES,
  labelPixels,
  materialById,
  preloadAssets,
  printerForSize,
  sizePrinterName,
  renderLabel,
  ribbonById,
  sizeById,
  type Label,
} from "@labebal/core";
import { Page } from "../../components/app-shell";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label as UiLabel } from "../../components/ui/label";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/utils";
import { useLibrary } from "../labels/api";
import { isInverted, templateOf } from "../labels/context";
import { useFontsReady } from "../labels/printer";
import { useLabelStore } from "../labels/store";
import { useSwatches } from "../labels/swatches";
import { SCENES, clearMockupCache, mockupScale, renderMockup, sceneById, type Background, type LabelArt } from "./scenes";
import { staticUrl } from "../../lib/base";

const MAX_LABELS = 8;
/** Canvas resolution on screen and for PNG export (px per mm). */
const SCREEN_K = 16;
const EXPORT_K = 24; // ~600 dpi
/** Canvas pixel budgets (a row of 8 objects at full k would be 10-20 MP). */
const SCREEN_MAX_PX = 12e6;
const EXPORT_MAX_PX = 32e6;

type InvertMode = "label" | "on" | "off";

/** Cached <img> loads for scene assets. */
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      // Bundled photos ("/mockups/...") are served from the module's static files.
      img.src = url.startsWith("/mockups/") ? staticUrl(url) : url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <UiLabel className="text-xs text-muted-foreground">{label}</UiLabel>
      {children}
    </div>
  );
}

const sizeGroups = () => {
  const groups = new Map<string, typeof SIZES>();
  for (const s of SIZES) {
    const g = `${s.printer === "N1" ? "N1 / B18" : sizePrinterName(s)} · ${s.group ?? "Other"}`;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return [...groups];
};

export function MockupsPage() {
  const { data: lib, isLoading, error } = useLibrary();
  const settings = useLabelStore((s) => s.settings);
  const selectedInWorkspace = useLabelStore((s) => s.selectedLabelId);
  const fontsReady = useFontsReady();
  const { materials, ribbons } = useSwatches();

  const [sceneId, setSceneId] = useState("drawer");
  const scene = sceneById(sceneId);
  const [labelIds, setLabelIds] = useState<string[] | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [material, setMaterial] = useState(settings.material === "white" ? "laser-gold" : settings.material);
  const [ribbon, setRibbon] = useState(settings.ribbon);
  const [invert, setInvert] = useState<InvertMode>("label");
  const [background, setBackground] = useState<Background>("mat");
  const [trueScale, setTrueScale] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [physical, setPhysical] = useState({ wMm: scene.widthMm, hMm: scene.heightMm });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Preselect from ?label=…&size=… (link from the print workspace), else the workspace selection.
  useEffect(() => {
    if (!lib || labelIds !== null) return;
    const q = new URLSearchParams(window.location.search);
    const wanted = (q.get("label") ?? "").split(",").filter((id) => lib.labels.some((l) => l.id === id));
    const fallback = selectedInWorkspace && lib.labels.some((l) => l.id === selectedInWorkspace) ? [selectedInWorkspace] : lib.labels.slice(0, 1).map((l) => l.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init once the library has loaded
    setLabelIds(wanted.length ? wanted : fallback);
    const sz = q.get("size");
    if (sz && sizeById(sz)) setSizeId(sz);
  }, [lib, labelIds, selectedInWorkspace]);

  const size = sizeById(sizeId ?? scene.sizeId) ?? SIZES[0];
  const printer = printerForSize(size);
  const chosen = useMemo(
    () => (labelIds ?? []).map((id) => lib?.labels.find((l) => l.id === id)).filter((l): l is Label => !!l),
    [labelIds, lib],
  );

  // Scene assets (photo).
  useEffect(() => {
    for (const [name, url] of Object.entries(scene.assets ?? {})) {
      if (images[name]) continue;
      loadImage(url)
        .then((img) => setImages((m) => ({ ...m, [name]: img })))
        .catch(() => toast.error(`Could not load ${url}`));
    }
  }, [scene, images]);

  const options = useMemo(
    () => ({ material: materialById(material), ribbon: ribbonById(ribbon), background, images }),
    [material, ribbon, background, images],
  );

  // Template assets (images, fonts) the chosen labels need; bumps `assetsReady` so the art re-renders once.
  const [assetsReady, setAssetsReady] = useState(0);
  useEffect(() => {
    if (!lib || !chosen.length) return;
    let cancelled = false;
    const templates = new Set(chosen.map((l) => l.templateId));
    void Promise.all(lib.templates.filter((t) => templates.has(t.id)).map((t) => preloadAssets(t, chosen))).then(() => {
      if (!cancelled) setAssetsReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lib, chosen]);

  // The 1-bit label renders: only redone when the label inputs change (not stock, ribbon or background).
  const arts = useMemo(() => {
    if (!lib) return [];
    void assetsReady;
    void fontsReady;
    return chosen.map((label): LabelArt => {
      const t = templateOf(lib, label);
      const px = labelPixels(size, printer);
      const inv = invert === "label" ? (t ? isInverted(label, t, settings.invertAll) : false) : invert === "on";
      const dots = t
        ? renderLabel(t, label, { w: px.w, h: px.h, dpmm: px.dpmm, marginMm: settings.marginMm, labelMm: { w: size.widthMm, h: size.heightMm }, invert: inv }).canvas
        : Object.assign(document.createElement("canvas"), { width: px.w, height: px.h });
      return { dots, size, printer };
    });
  }, [lib, chosen, size, printer, invert, settings.marginMm, settings.invertAll, assetsReady, fontsReady]);

  // Draw after the browser has painted (so the "Rendering…" state shows), coalescing quick changes.
  const [drawing, setDrawing] = useState(true);
  useEffect(() => {
    if (!lib || !canvasRef.current) return;
    setDrawing(true);
    const timer = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const t0 = performance.now();
      const k = mockupScale(scene, arts.length, SCREEN_K, SCREEN_MAX_PX);
      const res = renderMockup(canvas, scene, arts, options, k);
      performance.measure("mockup:draw", { start: t0, end: performance.now() });
      setPhysical((p) => (p.wMm === res.wMm && p.hMm === res.hMm ? p : res));
      setDrawing(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [lib, scene, arts, options]);

  // Free the cached scene layers when leaving the page.
  useEffect(() => clearMockupCache, []);

  function download() {
    if (!lib) return;
    const c = document.createElement("canvas");
    renderMockup(c, scene, arts, options, mockupScale(scene, arts.length, EXPORT_K, EXPORT_MAX_PX), false);
    c.toBlob((blob) => {
      c.width = c.height = 0;
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const names = chosen.map((l) => l.name).join("_").replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      a.download = `mockup-${scene.id}-${names || "label"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
    }, "image/png");
  }

  const toggle = (id: string, on: boolean) =>
    setLabelIds((ids) => {
      const cur = ids ?? [];
      if (!on) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_LABELS) {
        toast.info(`Up to ${MAX_LABELS} labels side by side`);
        return cur;
      }
      return [...cur, id];
    });

  const filtered = (lib?.labels ?? []).filter((l) => `${l.name} ${Object.values(l.values).join(" ")}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <Page
      title="Mockups"
      className="max-w-[1400px]"
      actions={
        <Button onClick={download} disabled={!chosen.length}>
          <IconDownload /> Download PNG
        </Button>
      }
    >
      {isLoading && <p className="text-muted-foreground">Loading library…</p>}
      {error && <p className="text-destructive">Could not load the library: {String(error)}</p>}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-4">
          <Field label="Object">
            <Select
              value={sceneId}
              onValueChange={(v) => {
                setSceneId(v);
                setSizeId(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{scene.description}</p>
          </Field>
          <Field label="Label size">
            <Select value={size.id} onValueChange={setSizeId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizeGroups().map(([g, list]) => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {list.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock">
              <Select value={material} onValueChange={setMaterial}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="size-3.5 rounded-sm ring-1 ring-border" style={{ background: m.css }} />
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ribbon">
              <Select value={ribbon} onValueChange={setRibbon}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ribbons.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="size-3.5 rounded-sm ring-1 ring-border" style={{ background: r.css }} />
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Colours">
              <Select value={invert} onValueChange={(v) => setInvert(v as InvertMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="label">As each label</SelectItem>
                  <SelectItem value="off">Normal</SelectItem>
                  <SelectItem value="on">Inverted</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Background">
              <Select value={background} onValueChange={(v) => setBackground(v as Background)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mat">Gray mat</SelectItem>
                  <SelectItem value="white">White</SelectItem>
                  <SelectItem value="transparent">Transparent</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={`Labels (${chosen.length} of up to ${MAX_LABELS}, shown side by side)`}>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search labels" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <ScrollArea className="h-72 rounded-md border">
              <ul className="p-1">
                {filtered.map((l) => {
                  const on = labelIds?.includes(l.id) ?? false;
                  return (
                    <li key={l.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={on} onCheckedChange={(v) => toggle(l.id, v === true)} />
                        <span className="truncate">{l.name}</span>
                      </label>
                    </li>
                  );
                })}
                {!filtered.length && <li className="p-3 text-sm text-muted-foreground">No labels match.</li>}
              </ul>
            </ScrollArea>
            {chosen.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setLabelIds(chosen.slice(0, 1).map((l) => l.id))}>
                <IconX /> Keep only the first
              </Button>
            )}
          </Field>
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="true-scale" checked={trueScale} onCheckedChange={setTrueScale} />
              <UiLabel htmlFor="true-scale" className="font-normal" title="Shows the objects at their real size (depends on your screen being set up correctly).">
                Real size
              </UiLabel>
            </div>
            {trueScale && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Zoom</span>
                <Slider className="w-32" min={1} max={4} step={0.5} value={[zoom]} onValueChange={([v]) => setZoom(v)} />
                <span className="w-8 text-sm">{zoom}×</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {size.name} on {printer.name.replace("Niimbot ", "")} · {materialById(material).name} · {ribbonById(ribbon).name} ribbon · object {Math.round(scene.widthMm)} × {Math.round(scene.heightMm)} mm
            </span>
          </div>
          <div className={cn("relative overflow-auto rounded-xl bg-muted/60 p-4", trueScale ? "max-h-[75vh]" : "")} aria-busy={drawing}>
            {drawing && (
              <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md bg-background/85 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
                <IconLoader2 className="size-3.5 animate-spin" /> Rendering…
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="mx-auto block"
              style={
                trueScale
                  ? { width: `${physical.wMm * zoom}mm`, height: `${physical.hMm * zoom}mm`, maxWidth: "none" }
                  : { width: "100%", maxWidth: physical.wMm * 9, height: "auto" }
              }
            />
          </div>
          {!chosen.length && lib && <p className="text-sm text-muted-foreground">Tick one or more labels on the left.</p>}
          <p className="text-xs text-muted-foreground">
            The label is the exact dot image the printer will print. Stock finishes (holographic, metallic) are approximations; shine moves between
            copies so a row doesn&apos;t look pasted.
          </p>
        </section>
      </div>
    </Page>
  );
}
