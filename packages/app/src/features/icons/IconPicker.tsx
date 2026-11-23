"use client";
/**
 * Icon picker: library tabs (All / Tabler / Material / Lucide / Game / Brands /
 * Custom), search across sets, favourites + recent (per browser), curated
 * quick-pick collections. Keyboard: type to search, ArrowDown into the grid,
 * arrows to move, Enter to choose, F to (un)favourite, Escape to close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "../../lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLoader2, IconSearch, IconStar, IconStarFilled, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { parseIconId } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { fetchIconSets, searchIcons, type IconSetInfo } from "../labels/icons-client";
import { ICON_COLLECTIONS } from "./collections";
import { customIconId, customIconTitle, invalidateIcons, uploadCustomIcon, useCustomIcons } from "./custom-icons";
import { IconThumb } from "./IconThumb";
import { addRecent, toggleFavourite, useIconPrefs } from "./prefs";

const COLS = 6;

/** Fallback tabs while /api/icons/sets loads (or if it fails). */
const DEFAULT_TABS: Pick<IconSetInfo, "id" | "label">[] = [
  { id: "tabler", label: "Tabler" },
  { id: "mdi", label: "Material" },
  { id: "lucide", label: "Lucide" },
  { id: "game-icons", label: "Game" },
  { id: "simple-icons", label: "Brands" },
  { id: "custom", label: "Custom" },
];

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

type Section = { title: string; ids: string[]; empty?: string };

export function IconPicker({
  value,
  filled,
  onChange,
  compact,
}: {
  value: string;
  filled?: boolean;
  onChange: (id: string) => void;
  /** Small square trigger (for inline use, e.g. the rule editor). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon-sm" title={value ? `Icon: ${value} (click to change)` : "Choose an icon"} aria-label="Choose an icon">
            <IconThumb id={value} filled={filled} size={20} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2">
            <IconThumb id={value} filled={filled} size={20} />
            <span className="truncate">{value || "Choose an icon…"}</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(27rem,calc(100vw-1rem))] p-3" align="start">
        {open && (
          <PickerBody
            value={value}
            filled={filled}
            onPick={(id) => {
              addRecent(id);
              onChange(id);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({ value, filled, onPick }: { value: string; filled?: boolean; onPick: (id: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [collection, setCollection] = useState(ICON_COLLECTIONS[0].id);
  const [focusRaw, setFocusId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const dq = useDebounced(q.trim());
  const prefs = useIconPrefs();
  const grid = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sets = useQuery({ queryKey: ["icon-sets"], queryFn: fetchIconSets, staleTime: 5 * 60_000, retry: false });
  const custom = useCustomIcons();
  const browsing = !dq && tab !== "all";
  const results = useQuery({
    queryKey: ["icons", tab, dq],
    queryFn: () => searchIcons(dq, { set: tab, limit: dq ? 180 : 120 }),
    enabled: !!dq || (tab !== "all" && tab !== "custom"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const tabs = sets.data ?? DEFAULT_TABS;
  const setInfo = sets.data?.find((s) => s.id === tab);
  const titles = useMemo(() => new Map((custom.data ?? []).map((a) => [customIconId(a.id), customIconTitle(a)])), [custom.data]);
  const labelOf = (id: string) => titles.get(id) ?? id;

  const sections: Section[] = useMemo(() => {
    if (dq) return [{ title: "", ids: (results.data ?? []).map((h) => h.id), empty: results.isFetching ? undefined : "No icons match. Try another word, or another library." }];
    if (tab === "custom")
      return [{ title: "", ids: (custom.data ?? []).map((a) => customIconId(a.id)), empty: custom.isLoading ? undefined : "No custom icons yet. Upload SVG files here or in Settings → Icons." }];
    if (browsing) return [{ title: "", ids: (results.data ?? []).map((h) => h.id) }];
    const inTab = (ids: string[]) => ids.filter((id) => !!parseIconId(id));
    const out: Section[] = [];
    if (prefs.favourites.length) out.push({ title: "Favorites", ids: inTab(prefs.favourites) });
    if (prefs.recent.length) out.push({ title: "Recent", ids: inTab(prefs.recent).slice(0, COLS * 2) });
    const c = ICON_COLLECTIONS.find((x) => x.id === collection) ?? ICON_COLLECTIONS[0];
    out.push({ title: c.label, ids: c.icons });
    return out;
  }, [dq, tab, browsing, results.data, results.isFetching, custom.data, custom.isLoading, prefs, collection]);

  const flat = sections.flatMap((s) => s.ids);

  // If the focused icon disappeared (new results), keep the keyboard in the picker.
  useEffect(() => {
    if (document.activeElement === document.body) document.getElementById("icon-picker-search")?.focus();
  }, [sections]);
  const unavailable = results.isError || (tab === "custom" && custom.isError);

  // The focused icon only counts while it's still listed.
  const focusId = focusRaw && flat.includes(focusRaw) ? focusRaw : null;

  const focusCell = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    grid.current?.querySelector<HTMLButtonElement>(`[data-icon="${CSS.escape(id)}"]`)?.focus();
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = focusId ? flat.indexOf(focusId) : -1;
    const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    if (e.key in move) {
      e.preventDefault();
      const j = i + move[e.key];
      if (j < 0 && e.key === "ArrowUp") document.getElementById("icon-picker-search")?.focus();
      else focusCell(flat[Math.max(0, Math.min(flat.length - 1, j))]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusCell(flat[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      focusCell(flat[flat.length - 1]);
    } else if ((e.key === "f" || e.key === "F") && focusId) {
      e.preventDefault();
      toggleFavourite(focusId);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing anywhere goes back to the search box.
      document.getElementById("icon-picker-search")?.focus();
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of [...files]) await uploadCustomIcon(f);
      await invalidateIcons(qc);
      toast.success(files.length > 1 ? `Added ${files.length} icons` : "Icon added");
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const shown = focusId ?? (value && flat.includes(value) ? value : null);
  const fav = shown ? prefs.favourites.includes(shown) : false;
  const brandNote = tabs.find((s) => s.id === "simple-icons") as IconSetInfo | undefined;
  const showBrandNote = tab === "simple-icons" || (tab === "all" && flat.some((id) => id.startsWith("simple-icons:")));

  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="icon-picker-search"
          autoFocus
          className="h-8 pl-7 text-sm"
          placeholder="Search, e.g. screw, plug, chip, cookie"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusCell(flat[0]);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (flat[0]) onPick(flat[0]);
              else if (parseIconId(q)) onPick(q.trim());
            }
          }}
          aria-label="Search icons"
        />
      </div>

      <div role="tablist" aria-label="Icon library" className="flex flex-wrap gap-1">
        {[{ id: "all", label: "All" }, ...tabs].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
            title={"count" in t ? `${(t as IconSetInfo).title}: ${(t as IconSetInfo).count} icons, ${(t as IconSetInfo).license.title}` : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!dq && tab === "all" && (
        <div className="flex flex-wrap gap-1" aria-label="Collections">
          {ICON_COLLECTIONS.map((c) => (
            <button
              key={c.id}
              className={cn("rounded-full border px-2 py-0.5 text-xs", collection === c.id ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setCollection(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {tab === "custom" && (
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <IconLoader2 className="animate-spin" /> : <IconUpload />} Upload SVG
          </Button>
          <Link href="/settings#icons" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Manage in Settings
          </Link>
          <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple hidden onChange={(e) => void onUpload(e.target.files)} />
        </div>
      )}

      {unavailable ? (
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>Icon search isn&apos;t available right now. Type an icon id instead, e.g. nut or mdi:screw-flat-top.</p>
          <Input
            className="h-8 text-sm"
            placeholder="icon id"
            defaultValue={value}
            onKeyDown={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (e.key === "Enter" && v) onPick(v);
            }}
          />
        </div>
      ) : (
        <div ref={grid} className="max-h-[min(20rem,45vh)] space-y-2 overflow-y-auto pr-1" onKeyDown={onGridKey}>
          {results.isFetching && !results.data && (dq || browsing) && <p className="text-xs text-muted-foreground">Searching…</p>}
          {sections.map((s) => (
            <div key={s.title || "results"} className="space-y-1">
              {s.title && <p className="text-xs font-medium text-muted-foreground">{s.title}</p>}
              {s.ids.length ? (
                <div className="grid grid-cols-6 gap-1" role="listbox" aria-label={s.title || "Icons"}>
                  {s.ids.map((id) => (
                    <button
                      key={`${s.title}:${id}`}
                      data-icon={id}
                      role="option"
                      aria-selected={id === value}
                      aria-label={labelOf(id)}
                      title={labelOf(id)}
                      tabIndex={id === (focusId ?? flat[0]) ? 0 : -1}
                      className={cn(
                        "relative flex aspect-square items-center justify-center rounded-md border bg-white outline-none hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring",
                        id === value && "ring-2 ring-primary",
                      )}
                      onFocus={() => setFocusId(id)}
                      onMouseEnter={() => setFocusId(id)}
                      onClick={() => onPick(id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(id);
                        }
                      }}
                    >
                      <IconThumb id={id} filled={filled} size={44} px={56} />
                      {prefs.favourites.includes(id) && <IconStarFilled className="absolute top-0.5 right-0.5 size-2.5 text-amber-500" />}
                    </button>
                  ))}
                </div>
              ) : (
                s.empty && <p className="text-xs text-muted-foreground">{s.empty}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {(showBrandNote || setInfo?.note) && (
        <p className="text-[11px] leading-snug text-muted-foreground">{showBrandNote ? brandNote?.note ?? "Brand logos are trademarks of their owners." : setInfo?.note}</p>
      )}

      <div className="flex min-h-7 items-center gap-2 border-t pt-2 text-xs">
        {shown ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono" title={shown}>
              {labelOf(shown)}
            </span>
            <Button size="xs" variant="ghost" onClick={() => toggleFavourite(shown)} title="Favorite (F)">
              {fav ? <IconStarFilled className="text-amber-500" /> : <IconStar />} {fav ? "Favorite" : "Add to favorites"}
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Arrows to move, Enter to choose, F to favorite.</span>
        )}
      </div>
    </div>
  );
}
