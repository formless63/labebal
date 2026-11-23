/**
 * What every printer driver shares, whatever the brand or link:
 *
 * - `LabelPrinter`: the interface the app talks to (state for React, connect /
 *   disconnect, print a run with pause / resume / cancel).
 * - `ChunkedPrinter`: base class that runs a print in chunks (runChunks) and
 *   keeps the snapshot; a driver only implements `printChunk`.
 *
 * Drivers: Niimbot (printer.ts, niimbluelib), Brother P-touch (brother.ts, Web
 * Serial), ZPL printers (zpl-print.ts, bytes handed to a transport the app
 * provides, e.g. the server's network relay).
 */
import type { MediaKind, PrinterFamily, RollInfo, ThermalKind } from "./media";
import { RunControl, chunkJobs, countLabels, runChunks, skipLabels, type RunProgress, type RunResult } from "./print-plan";

export interface PrintJob {
  canvas: HTMLCanvasElement;
  qty: number;
  name: string;
}

export interface PrintRunProgress {
  /** Labels printed so far. */
  done: number;
  total: number;
  /** Name of the label being printed. */
  current: string;
  chunk?: number;
  chunks?: number;
}

export interface PrinterSnapshot {
  /** Registry id of this connection. */
  id?: string;
  connected: boolean;
  busy: boolean;
  /** A run is paused (waiting between labels). */
  paused?: boolean;
  /** Printer model id (see PrinterProfile.model), e.g. "N1", "M2_H", "PT-D610BT", "zpl:<id>". */
  model: string | null;
  status: string;
  error: string | null;
  progress: PrintRunProgress | null;
  /** Loaded roll from its RFID tag; null when absent / unreadable / no RFID support. */
  roll: RollInfo | null;
  /** What the printer reports about itself (serial, firmware, battery...). */
  device: DeviceInfo | null;
  /** Live status (lid, paper, ribbon, battery). */
  live: LiveStatus | null;
  /** Print task version niimbluelib picked for this model / firmware (Niimbot only; null = unknown). */
  printTask?: string | null;
  /** What is loaded, as reported by printers that know (Brother TZe: tape width, colours). */
  media?: LoadedMedia | null;
}

/** Tape / media a printer reports (Brother status block). */
export interface LoadedMedia {
  /** Tape width, mm (across the head). */
  widthMm: number;
  /** e.g. "Laminated tape", "Heat-shrink tube". */
  type?: string;
  /** Stock id (MATERIALS) matching the tape colour, when known. */
  materialId?: string;
  /** Ribbon id (RIBBONS) matching the text colour, when known. */
  ribbonId?: string;
  /** Raw colour names as the printer reports them. */
  tapeColour?: string;
  textColour?: string;
}

export interface DeviceInfo {
  name: string;
  modelId?: number;
  serial?: string;
  mac?: string;
  firmware?: string;
  hardware?: string;
  protocol?: number;
  batteryPercents?: number;
  printheadPixels?: number;
  dpi?: number;
  autoShutdown?: string;
  sounds?: { power: boolean; connection: boolean };
  /** Network printers: host:port. */
  address?: string;
}

export interface LiveStatus {
  lidClosed?: boolean;
  paperInserted?: boolean;
  ribbonInserted?: boolean;
  batteryPercents?: number;
  /** Printhead temperature where reported. */
  temp?: number;
  /** How the printer is set up right now, for printers that do both (Zebra ~HS). */
  thermal?: ThermalKind;
  /** Printer is paused (Zebra pause button) or reports another problem. */
  paused?: boolean;
  /** Plain words for a problem the printer reports, if any. */
  problem?: string;
  at: number;
}

export interface PrintRunOptions {
  density: number;
  direction: "left" | "top";
  /** niimbluelib LabelType (gap / black mark / continuous / transparent). Default: with gaps. */
  labelType?: number;
  /** Force a print task version instead of niimbluelib's auto-detection (Niimbot). */
  printTask?: string;
  /** Labels per printer task (default 10): pause / cancel take effect between tasks at the latest. */
  chunkSize?: number;
  /** Skip the first N labels of `jobs` (continue after a failure). */
  skip?: number;
  /** Cancels the run when aborted. */
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
  /** The label as cut: for printers that need its physical size (ZPL label length, Brother tape). */
  label?: { widthMm: number; heightMm: number; gapMm?: number };
  /** How labels are found on the media. */
  mediaKind?: MediaKind;
  /** Direct thermal or thermal transfer (printers that do both). */
  thermal?: ThermalKind;
}

export type Transport = "bluetooth" | "serial";

/** A printer the app can print on (any brand / link). */
export interface LabelPrinter {
  readonly id: string;
  readonly family: PrinterFamily;
  subscribe(fn: () => void): () => void;
  getSnapshot(): PrinterSnapshot;
  /** Open the link (browser pickers for Bluetooth / serial). Network printers connect on creation. */
  connect(transport?: Transport): Promise<void>;
  disconnect(): Promise<void>;
  /** Re-read what the printer reports. */
  refresh(): Promise<void>;
  /** Re-read the loaded roll (RFID printers); others resolve with what they know. */
  refreshRoll(): Promise<RollInfo | null>;
  pause(): void;
  resume(): void;
  cancel(): void;
  /**
   * Print a run. Canvases are 1-bit, printer resolution, reading orientation.
   * Never throws for print errors: the result says how many labels were printed
   * and why it stopped.
   */
  print(jobs: PrintJob[], opts: PrintRunOptions): Promise<RunResult>;
}

export const emptySnapshot = (id?: string): PrinterSnapshot => ({ id, connected: false, busy: false, paused: false, model: null, status: "Not connected", error: null, progress: null, roll: null, device: null, live: null, printTask: null, media: null });

/** Resolve `p`, or reject as soon as `signal` aborts. */
export function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Canceled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Canceled"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * State, listeners and the chunked print loop. Drivers implement `printChunk`
 * (send these labels, call `report(n)` as they come out, stop early when
 * `control.cancelled`).
 */
export abstract class ChunkedPrinter implements LabelPrinter {
  protected state: PrinterSnapshot;
  private listeners = new Set<() => void>();
  protected run: RunControl | null = null;
  /** Labels per chunk when the caller doesn't say. */
  protected defaultChunk = 10;

  constructor(
    readonly id: string,
    readonly family: PrinterFamily,
  ) {
    this.state = emptySnapshot(id);
  }

  /** For React's useSyncExternalStore. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  protected set(patch: Partial<PrinterSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  abstract connect(transport?: Transport): Promise<void>;
  abstract disconnect(): Promise<void>;
  async refresh() {}
  async refreshRoll(): Promise<RollInfo | null> {
    return this.state.roll;
  }

  /** Pause the current run after the label being printed (and its batch) is done. */
  pause() {
    this.run?.pause();
  }
  resume() {
    this.run?.resume();
  }
  /** Stop the current run as soon as possible. */
  cancel() {
    this.run?.cancel();
  }

  /** Throw (with a plain message) when printing can't start, e.g. not connected. */
  protected checkReady() {
    if (!this.state.connected) throw new Error("Printer not connected");
  }

  protected abstract printChunk(chunk: PrintJob[], opts: PrintRunOptions, report: (doneInChunk: number) => void, control: RunControl, setCurrent: (name: string) => void): Promise<void>;

  async print(jobs: PrintJob[], opts: PrintRunOptions): Promise<RunResult> {
    this.checkReady();
    if (this.run) throw new Error("This printer is already printing");
    const todo = skipLabels(jobs, opts.skip ?? 0);
    const total = countLabels(todo);
    if (!total) return { status: "done", printed: 0, total: 0 };
    const control = new RunControl(opts.signal);
    this.run = control;
    let current = "";
    const setCurrent = (n: string) => {
      current = n;
    };
    this.set({ busy: true, paused: false, error: null, progress: { done: 0, total, current } });
    try {
      const result = await runChunks(
        chunkJobs(todo, opts.chunkSize ?? this.defaultChunk),
        (chunk, _i, report) => this.printChunk(chunk, opts, report, control, setCurrent),
        control,
        (p) => {
          this.set({ paused: p.paused, progress: { done: p.done, total: p.total, current, chunk: p.chunk, chunks: p.chunks } });
          opts.onProgress?.(p);
        },
      );
      this.set({
        error: result.status === "failed" ? (result.error ?? "Print failed") : null,
        progress: { done: result.printed, total, current: result.status === "done" ? "Done" : result.status === "cancelled" ? "Canceled" : "Stopped" },
      });
      return result;
    } finally {
      this.run = null;
      this.set({ busy: false, paused: false });
    }
  }
}
