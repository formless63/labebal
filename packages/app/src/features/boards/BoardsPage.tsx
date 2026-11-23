"use client";
/**
 * Quick print boards: a saved set of labels, each at its own size, that print
 * with one tap (packing orders, restocking a parts cabinet...). The tile goes
 * to the connected printer that takes its size; taps while a printer is busy
 * wait their turn. Routes: /boards and /boards/<id> (bookmarkable on a packing station).
 */
import { useMemo, useState } from "react";
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconCheck, IconFolder, IconLayoutDashboard, IconLetterCase, IconLoader2, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { allSizes, findPrinter, sizeById, type Label, type LabelSize, type Library } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Link, useParams, useRouter, useSearchParams } from "../../lib/router";
import { useLibrary } from "../labels/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../components/ui/select";
import { confirmDialog } from "../../components/dialogs";
import { useCan } from "../auth/me-client";
import { isInverted, templateOf, usePrintContext } from "../labels/context";
import { LabelPreview } from "../labels/LabelPreview";
import { PrintStoppedError, printLabels, type PrintContext } from "../labels/print";
import { usePrinterTargets, type PrinterTarget } from "../printers/targets";
import { buildTree, inFolder, type TreeFolder } from "../library/folders";
import { newBoardId, useBoardActions, useBoards, type Board, type BoardTile } from "./api";
import { pickTarget, printerNeeded, printerTakes, previewPrinterFor } from "./route-tile";

/* ------------------------------------------------------------ print queue */

/** One print at a time per printer: taps while it is busy wait their turn. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(printerId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(printerId) ?? Promise.resolve()).then(job);
  const tail = next.catch(() => undefined);
  queues.set(printerId, tail);
  void tail.then(() => {
    if (queues.get(printerId) === tail) queues.delete(printerId);
  });
  return next;
}

/** Print settings for a tile on a printer: the printer's own setup (stock, offsets...) with the tile's size. */
function tileContext(target: PrinterTarget, size: LabelSize): PrintContext {
  if (target.ctx.size.id === size.id) return target.ctx;
  return { ...target.ctx, size, settings: { ...target.ctx.settings, sizeId: size.id } };
}

type TileState = "queued" | "printing" | "done" | "error";

/* ----------------------------------------------------------------- boards */

/** Routes: /boards (all boards) and /boards/[id] (one board; ?edit opens the editor). */
export function BoardsPage() {
  const { id: rawId } = useParams<{ id?: string }>();
  const openId = rawId ? decodeURIComponent(rawId) : null;
  const params = useSearchParams();
  const router = useRouter();
  const { data: lib, error } = useLibrary();
  const { data: boards, isLoading } = useBoards();
  const { create } = useBoardActions();
  const canEdit = useCan("editor");
  const board = boards?.find((b) => b.id === openId);
  const editing = canEdit && params.has("edit");
  const href = (id: string, edit = false) => `/boards/${encodeURIComponent(id)}${edit ? "?edit" : ""}`;

  let body: React.ReactNode;
  if (isLoading || (!lib && !error)) body = <p className="text-muted-foreground">Loading…</p>;
  else if (!lib) body = <p className="text-destructive">Could not load labels: {String(error)}</p>;
  else if (openId && !board) body = <p className="p-4 text-center text-muted-foreground">This board no longer exists.</p>;
  else if (board)
    body = editing ? (
      <div className="mx-auto max-w-3xl">
        <BoardEditor key={board.id} lib={lib} board={board} onDone={() => router.replace(href(board.id))} onDeleted={() => router.replace("/boards")} />
      </div>
    ) : (
      <BoardView lib={lib} board={board} onBack={() => router.push("/boards")} onEdit={canEdit ? () => router.push(href(board.id, true)) : undefined} />
    );
  else {
    const add = async () => {
      const b: Board = { id: newBoardId(), name: "New board", notes: "", tiles: [] };
      try {
        await create.mutateAsync(b);
        router.push(href(b.id, true));
      } catch (e) {
        toast.error(String(e));
      }
    };
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Boards</h1>
          {canEdit && (
            <Button onClick={() => void add()} disabled={create.isPending}>
              <IconPlus /> New board
            </Button>
          )}
        </div>
        {!boards?.length && (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            A board is a set of labels you print often, each at its own size. Open it and tap a label to print it straight away: handy while packing orders or restocking drawers.
          </p>
        )}
        <ul className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))" }}>
          {boards?.map((b) => (
            <li key={b.id}>
              <Link
                href={href(b.id)}
                className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card p-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <IconLayoutDashboard className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {b.tiles.length} label{b.tiles.length === 1 ? "" : "s"}
                    {b.notes ? ` · ${b.notes}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1800px] p-3 sm:p-4">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------- the board */

function BoardView({ lib, board, onBack, onEdit }: { lib: Library; board: Board; onBack: () => void; onEdit?: () => void }) {
  const targets = usePrinterTargets();
  const canPrint = useCan("printer");
  const [state, setState] = useState<Record<number, TileState>>({});
  const set = (i: number, s: TileState | null) =>
    setState((m) => {
      const n = { ...m };
      if (s) n[i] = s;
      else delete n[i];
      return n;
    });

  const print = (i: number, tile: BoardTile, label: Label, size: LabelSize) => {
    const at = pickTarget(
      size.id,
      targets.map((t) => ({ model: t.snapshot.model, sizeId: t.ctx.size.id, primary: t.primary })),
    );
    if (at < 0) {
      toast.error(`${label.name} is ${size.name}: connect ${printerNeeded(size)} first.`);
      return;
    }
    const target = targets[at];
    set(i, target.snapshot.busy || queues.has(target.id) ? "queued" : "printing");
    enqueue(target.id, async () => {
      set(i, "printing");
      return printLabels(lib, [{ label, qty: tile.qty }], tileContext(target, size), { connection: target.connection, source: `board:${board.id}` });
    })
      .then(() => {
        set(i, "done");
        setTimeout(() => set(i, null), 1500);
      })
      .catch((e) => {
        set(i, "error");
        setTimeout(() => set(i, null), 3000);
        if (!(e instanceof PrintStoppedError && e.outcome.status === "cancelled")) toast.error(`${label.name}: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const [tileSize, setTileSize] = useTileSize();
  const [names, setNames] = useShowNames();
  const px = TILE_PX[tileSize];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="All boards" onClick={onBack}>
          <IconArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold">{board.name}</h1>
          {board.notes && <p className="truncate text-xs text-muted-foreground">{board.notes}</p>}
        </div>
        <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Tile size">
          {(["s", "m", "l"] as const).map((s) => (
            <Button key={s} size="sm" variant={tileSize === s ? "secondary" : "ghost"} className="h-7 w-8 px-0 uppercase" aria-pressed={tileSize === s} onClick={() => setTileSize(s)}>
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" variant={names ? "secondary" : "ghost"} aria-pressed={names} onClick={() => setNames(!names)} title="Show label names">
          <IconLetterCase /> Names
        </Button>
        {onEdit && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <IconPencil /> Edit
          </Button>
        )}
      </div>
      {!canPrint && <p className="text-sm text-muted-foreground">Your role can&apos;t print. Ask an admin for the printer role.</p>}
      {!targets.length && <p className="text-sm text-muted-foreground">Connect a printer (top right), then tap a label to print it.</p>}
      {!board.tiles.length && <p className="rounded-xl border border-dashed p-4 text-center text-muted-foreground">No labels on this board yet.{onEdit ? " Press Edit to add some." : ""}</p>}
      <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${px}px, 45%), 1fr))` }}>
        {board.tiles.map((tile, i) => {
          const label = lib.labels.find((l) => l.id === tile.labelId);
          const size = sizeById(tile.sizeId);
          const ready = !!size && targets.some((t) => printerTakes(t.snapshot.model, tile.sizeId));
          const s = state[i];
          return (
            <li key={`${tile.labelId}-${i}`}>
              <button
                type="button"
                disabled={!label || !size || !canPrint}
                onClick={() => label && size && print(i, tile, label, size)}
                aria-label={`Print ${label?.name ?? "label"}${tile.qty > 1 ? ` ×${tile.qty}` : ""}`}
                className={cn(
                  "relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border bg-card p-2 transition active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none enabled:hover:border-foreground/30 enabled:hover:bg-muted disabled:opacity-50",
                  s === "done" && "border-emerald-500 ring-2 ring-emerald-500",
                  s === "error" && "border-destructive ring-2 ring-destructive",
                  (s === "printing" || s === "queued") && "border-primary ring-2 ring-primary",
                  !ready && "border-dashed",
                )}
                title={`${label?.name ?? "Label deleted"} · ${size?.name ?? "unknown size"}${!ready && size ? ` · connect ${printerNeeded(size)}` : ""}`}
              >
                <TilePreview lib={lib} label={label} size={size} box={{ w: px - 18, h: Math.round(px * 0.55) }} />
                {names && <span className="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">{label?.name ?? "Label deleted"}</span>}
                {tile.qty > 1 && <span className="absolute top-1 left-1 rounded bg-background/90 px-1 text-[10px] font-semibold">×{tile.qty}</span>}
                {s && (
                  <span className="absolute top-1 right-1 flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px]" role="status">
                    {s === "done" ? <IconCheck className="size-3 text-emerald-600" /> : s === "error" ? <IconX className="size-3 text-destructive" /> : <IconLoader2 className="size-3 animate-spin" />}
                    {s === "queued" ? "Waiting" : s === "printing" ? "Printing" : s === "done" ? "Printed" : "Failed"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type TileSize = "s" | "m" | "l";
/** Minimum tile width, px. */
const TILE_PX: Record<TileSize, number> = { s: 150, m: 210, l: 300 };

/** A small per-browser preference (tile size, names); falls back quietly when storage is unavailable. */
function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      return s && allowed.includes(s) ? s : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (n: T) => {
      setV(n);
      try {
        localStorage.setItem(key, n);
      } catch {
        /* private mode: keep it for this visit */
      }
    },
  ];
}
const useTileSize = () => useStored<TileSize>("labebal.board.tile", "m", ["s", "m", "l"]);
function useShowNames(): [boolean, (v: boolean) => void] {
  const [v, set] = useStored("labebal.board.names", "on", ["on", "off"] as const);
  return [v === "on", (b) => set(b ? "on" : "off")];
}

function TilePreview({ lib, label, size, box }: { lib: Library; label?: Label; size?: LabelSize; box: { w: number; h: number } }) {
  const ctx = usePrintContext();
  const targets = usePrinterTargets();
  const template = templateOf(lib, label);
  const holder = <div style={{ height: box.h }} />;
  if (!label || !template || !size) return holder;
  const printer = targets.find((t) => printerTakes(t.snapshot.model, size.id))?.ctx.printer ?? previewPrinterFor(size.id);
  if (!printer) return holder;
  return (
    <div className="flex w-full items-center justify-center" style={{ height: box.h }}>
      <LabelPreview
        template={template}
        label={label}
        invert={isInverted(label, template, ctx.settings.invertAll)}
        size={size}
        printer={printer}
        material={ctx.settings.material}
        ribbon={ctx.settings.ribbon}
        marginMm={ctx.settings.marginMm}
        scale={Math.min(12, box.w / size.widthMm, box.h / size.heightMm)}
        snap={0.6}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- editing */

const printerShort = (model: string) => (model === "zpl" ? "Network label printer" : model === "M2_H" ? "M2" : (findPrinter(model)?.name ?? model));

function SizeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, LabelSize[]>();
    for (const s of allSizes()) {
      const k = printerShort(s.printer);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m];
  }, []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full" aria-label="Size">
        <SelectValue placeholder="Size" />
      </SelectTrigger>
      <SelectContent>
        {groups.map(([name, sizes]) => (
          <SelectGroup key={name}>
            <SelectLabel>{name}</SelectLabel>
            {sizes.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const flatFolders = (n: TreeFolder): TreeFolder[] => n.folders.flatMap((f) => [f, ...flatFolders(f)]);

function BoardEditor({ lib, board, onDone, onDeleted }: { lib: Library; board: Board; onDone: () => void; onDeleted: () => void }) {
  const ctx = usePrintContext();
  const { save, remove } = useBoardActions();
  const [draft, setDraft] = useState<Board>(board);
  const [q, setQ] = useState("");
  const folders = useMemo(() => flatFolders(buildTree(lib.labels)), [lib.labels]);
  const nextSize = draft.tiles.at(-1)?.sizeId ?? ctx.size.id;

  const setTiles = (tiles: BoardTile[]) => setDraft((d) => ({ ...d, tiles }));
  const addLabels = (labels: Label[]) => setTiles([...draft.tiles, ...labels.map((l) => ({ labelId: l.id, sizeId: nextSize, qty: 1 }))]);
  const move = (i: number, by: number) => {
    const t = [...draft.tiles];
    const [x] = t.splice(i, 1);
    t.splice(i + by, 0, x);
    setTiles(t);
  };
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return lib.labels.filter((l) => `${l.name} ${Object.values(l.values).join(" ")}`.toLowerCase().includes(needle)).slice(0, 20);
  }, [lib.labels, q]);

  const done = async () => {
    try {
      await save.mutateAsync({ ...draft, name: draft.name.trim() || "Board" });
      onDone();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: `Delete "${board.name}"?`, description: "The board goes away for everyone. The labels themselves stay.", confirmLabel: "Delete board", destructive: true }))) return;
    await remove.mutateAsync(board.id);
    onDeleted();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Input className="h-12 text-base font-semibold" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Board name" placeholder="Board name" />
        <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} aria-label="Notes" placeholder="Notes (optional), e.g. Shipping station" />
      </div>

      <ul className="space-y-2">
        {draft.tiles.map((tile, i) => {
          const label = lib.labels.find((l) => l.id === tile.labelId);
          return (
            <li key={`${tile.labelId}-${i}`} className="space-y-2 rounded-xl border bg-card p-2">
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-medium">{label?.name ?? "Label deleted"}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <IconArrowUp />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === draft.tiles.length - 1} onClick={() => move(i, 1)}>
                  <IconArrowDown />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove from board" onClick={() => setTiles(draft.tiles.filter((_, j) => j !== i))}>
                  <IconTrash />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SizeSelect value={tile.sizeId} onChange={(sizeId) => setTiles(draft.tiles.map((t, j) => (j === i ? { ...t, sizeId } : t)))} />
                </div>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  className="h-8 w-16"
                  aria-label="Labels per tap"
                  title="Labels per tap"
                  value={tile.qty}
                  onChange={(e) => setTiles(draft.tiles.map((t, j) => (j === i ? { ...t, qty: Math.min(999, Math.max(1, e.target.valueAsNumber || 1)) } : t)))}
                />
              </div>
              {!sizeById(tile.sizeId) && <p className="text-xs text-destructive">This size no longer exists; pick another.</p>}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-xl border border-dashed p-3">
        <p className="text-sm font-medium">Add labels</p>
        <Input type="search" placeholder="Search labels" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search labels to add" />
        {matches.length > 0 && (
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {matches.map((l) => (
              <li key={l.id}>
                <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => addLabels([l])}>
                  <IconPlus className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{templateOf(lib, l)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {folders.length > 0 && (
          <Select value="" onValueChange={(path) => addLabels(lib.labels.filter((l) => inFolder(l, path)))}>
            <SelectTrigger size="sm" className="w-full" aria-label="Add a whole folder">
              <IconFolder /> <SelectValue placeholder="Add a whole folder" />
            </SelectTrigger>
            <SelectContent>
              {folders.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  {"  ".repeat(f.depth)}
                  {f.name} ({f.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">New labels get the size of the last one on the board ({sizeById(nextSize)?.name ?? "current size"}); change each one above.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="h-12 flex-1" onClick={() => void done()} disabled={save.isPending}>
          <IconCheck /> Save board
        </Button>
        <Button variant="outline" className="h-12" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="ghost" className="h-12 text-destructive" onClick={() => void del()}>
          <IconTrash /> Delete
        </Button>
      </div>
    </div>
  );
}
