/**
 * Printer connections (Web Bluetooth / Web Serial) and printing via niimbluelib.
 * Framework-free: UI layers subscribe to state changes.
 *
 * - `PrinterConnection`: one printer. `print()` sends a run in small chunks
 *   (one niimbluelib print task each), reports progress per label, and can be
 *   paused / resumed / cancelled between labels.
 * - `PrinterRegistry`: several printers connected at once (e.g. N1 + M2).
 */
import {
  ImageEncoder,
  LabelType,
  PageColorType,
  instantiateClient,
  printTaskNames,
  type CombinedRfidInfo,
  type HeartbeatData,
  type NiimbotAbstractClient,
  type PrintProgressEvent,
  type PrintTaskName,
  type PrinterInfo,
} from "@mmote/niimbluelib";
import type { RollInfo } from "./media";
import { countLabels, type RunControl } from "./print-plan";
import { ChunkedPrinter, emptySnapshot, untilAborted, type DeviceInfo, type LabelPrinter, type LiveStatus, type PrintJob, type PrintRunOptions, type PrinterSnapshot, type Transport } from "./printer-base";

export * from "./printer-base";
export type { PrintTaskName };
/** niimbluelib print task versions (different firmware generations speak different print protocols). */
export const PRINT_TASK_NAMES: readonly PrintTaskName[] = printTaskNames;

export const transportsSupported = () => ({
  bluetooth: typeof navigator !== "undefined" && "bluetooth" in navigator,
  serial: typeof navigator !== "undefined" && "serial" in navigator,
});

export const disconnectedSnapshot = emptySnapshot;

/** Labels done according to a niimbluelib progress event (a page counts once printed and fed). */
export const pagesDone = (e: Pick<PrintProgressEvent, "page" | "pagePrintProgress" | "pageFeedProgress">) =>
  Math.max(0, e.pagePrintProgress >= 100 && e.pageFeedProgress >= 100 ? e.page : e.page - 1);

/** A Niimbot printer over Web Bluetooth / Web Serial (niimbluelib). */
export class PrinterConnection extends ChunkedPrinter {
  private client: NiimbotAbstractClient | null = null;

  constructor(id = "p1") {
    super(id, "niimbot");
  }

  /** Use an already-connected client (tests with a mocked / virtual client, custom transports). */
  attachClient(client: NiimbotAbstractClient) {
    this.client = client;
    const meta = client.getModelMetadata();
    this.set({ connected: true, error: null, model: meta?.model ?? null, status: meta ? `Connected: ${meta.model}` : "Connected", printTask: client.getPrintTaskType() ?? null });
  }

  private gone() {
    this.set({ connected: false, model: null, status: "Disconnected", roll: null, device: null, live: null, printTask: null });
  }

  async connect(transport: Transport = "bluetooth") {
    await this.disconnect();
    this.set({ error: null, status: "Connecting…" });
    const client = instantiateClient(transport);
    this.client = client;
    let deviceName = "";
    client.on("disconnect", () => this.gone());
    client.on("heartbeat", (e) => this.set({ live: liveFromHeartbeat(e.data, client.getModelMetadata()?.model) }));
    // niimbluelib re-reads the tag on connect, after printing and when the lid / roll changes.
    client.on("rfidinfofetched", (e) => this.set({ roll: rollFromRfid(e.info) }));
    client.on("printerinfofetched", () => {
      const meta = client.getModelMetadata();
      this.set({
        model: meta?.model ?? null,
        status: meta ? `Connected: ${meta.model}` : "Connected (unknown model)",
        device: deviceFromInfo(client.getPrinterInfo(), deviceName),
        printTask: client.getPrintTaskType() ?? null,
      });
    });
    try {
      const conn = await client.connect();
      deviceName = conn.deviceName ?? "";
      const meta = client.getModelMetadata();
      this.set({
        connected: true,
        model: meta?.model ?? null,
        status: meta ? `Connected: ${meta.model}` : "Connected",
        roll: rollFromRfid(client.getRfidInfo()),
        device: deviceFromInfo(client.getPrinterInfo(), deviceName, meta?.dpi, meta?.printheadPixels),
        printTask: client.getPrintTaskType() ?? null,
      });
      // Heartbeats keep the live status (lid, paper, battery) current.
      try {
        this.set({ live: liveFromHeartbeat(await client.fetchHeartbeatData(), client.getModelMetadata()?.model) });
      } catch {
        /* older firmware: no heartbeat data */
      }
    } catch (e) {
      this.client = null;
      this.set({ connected: false, status: "Not connected", error: String(e) });
    }
  }

  async disconnect() {
    this.run?.cancel();
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.disconnect();
      } catch {
        /* already gone */
      }
    }
    if (this.state.connected) this.gone();
  }

  /** Re-read everything the printer reports: device info, roll/ribbon RFID, live status. */
  async refresh() {
    const c = this.client;
    if (!c || !this.state.connected) return;
    const meta = c.getModelMetadata();
    const patch: Partial<PrinterSnapshot> = {};
    try {
      patch.device = deviceFromInfo(await c.fetchPrinterInfo(), this.state.device?.name ?? "", meta?.dpi, meta?.printheadPixels);
    } catch (e) {
      console.warn("printer info", e);
    }
    try {
      patch.roll = rollFromRfid(await c.fetchRfidInfo());
    } catch (e) {
      console.warn("rfid", e);
    }
    try {
      patch.live = liveFromHeartbeat(await c.fetchHeartbeatData(), c.getModelMetadata()?.model);
    } catch (e) {
      console.warn("heartbeat", e);
    }
    this.set(patch);
  }

  /** Re-read the loaded roll's RFID tag (no-op without a connection). */
  async refreshRoll() {
    const c = this.client;
    if (!c || !this.state.connected) return null;
    const info = await c.fetchRfidInfo();
    const roll = rollFromRfid(info);
    this.set({ roll });
    return roll;
  }

  protected checkReady() {
    if (!this.client || !this.state.connected) throw new Error("Printer not connected");
  }

  /** One niimbluelib print task per chunk; progress per label from "printprogress". */
  protected async printChunk(chunk: PrintJob[], opts: PrintRunOptions, report: (n: number) => void, control: RunControl, setCurrent: (name: string) => void) {
    const client = this.client;
    if (!client) throw new Error("Printer not connected");
    const taskName = (opts.printTask as PrintTaskName | undefined) ?? client.getPrintTaskType() ?? "B1";
    const labelType = (opts.labelType ?? LabelType.WithGaps) as LabelType;
    const n = countLabels(chunk);
    const task = client.protocol.newPrintTask(taskName, { totalPages: n, density: opts.density, labelType, statusPollIntervalMs: 100, statusTimeoutMs: 8_000 });
    const onProgress = (e: PrintProgressEvent) => report(Math.min(n, pagesDone(e)));
    client.on("printprogress", onProgress);
    try {
      await task.printInit();
      for (const job of chunk) {
        if (control.cancelled) break;
        setCurrent(job.name);
        await task.printPage(ImageEncoder.encodeCanvas(job.canvas, PageColorType.SingleColor, opts.direction), job.qty);
        await task.waitForPageFinished();
      }
      if (!control.cancelled) {
        const finished = task.waitForFinished();
        finished.catch(() => {}); // may reject after a cancel
        await untilAborted(finished, control.signal);
      }
    } finally {
      client.off("printprogress", onProgress);
      if (control.cancelled) client.protocol.cancelStatusPoll();
      try {
        await task.printEnd();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Several printers at once. The first slot always exists (single-printer UX);
 * it is a Niimbot connection until another kind of printer takes it (`use`).
 */
export class PrinterRegistry {
  private conns: LabelPrinter[] = [];
  private unsubs = new Map<string, () => void>();
  private listeners = new Set<() => void>();
  private snap: PrinterSnapshot[] = [];
  private seq = 0;

  constructor() {
    this.add();
  }

  /** The first printer (what single-printer screens use). */
  get primary() {
    return this.conns[0];
  }
  list() {
    return this.conns;
  }
  get(id: string | undefined) {
    return this.conns.find((c) => c.id === id);
  }

  /** A fresh id for a printer created outside the registry (pass it to the driver's constructor). */
  nextId() {
    return `p${++this.seq}`;
  }

  /** Add an (unconnected) Niimbot slot; call `connect()` on it. */
  add() {
    const c = new PrinterConnection(this.nextId());
    this.attach(c);
    return c;
  }

  /**
   * Use another printer (Brother, network...): it takes the first slot when
   * that is free (not connected), else it is added.
   */
  use(p: LabelPrinter) {
    const first = this.conns[0];
    if (first && !first.getSnapshot().connected && !first.getSnapshot().busy) this.replace(first, p);
    else this.attach(p);
    return p;
  }

  private attach(c: LabelPrinter) {
    this.conns = [...this.conns, c];
    this.unsubs.set(c.id, c.subscribe(() => this.changed()));
    this.changed();
  }

  private replace(old: LabelPrinter, c: LabelPrinter) {
    this.unsubs.get(old.id)?.();
    this.unsubs.delete(old.id);
    this.conns = this.conns.map((x) => (x === old ? c : x));
    this.unsubs.set(c.id, c.subscribe(() => this.changed()));
    this.changed();
  }

  /**
   * Disconnect and forget a printer. The first slot stays: a Niimbot one is
   * only disconnected, another kind is replaced by a fresh Niimbot slot.
   */
  async remove(id: string) {
    const c = this.get(id);
    if (!c) return;
    await c.disconnect();
    if (c === this.primary) {
      if (c.family !== "niimbot") this.replace(c, new PrinterConnection(this.nextId()));
      return;
    }
    this.unsubs.get(id)?.();
    this.unsubs.delete(id);
    this.conns = this.conns.filter((x) => x !== c);
    this.changed();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  /** Snapshots of all printers (stable array until something changes). */
  getSnapshot = () => this.snap;

  private changed() {
    this.snap = this.conns.map((c) => c.getSnapshot());
    this.listeners.forEach((l) => l());
  }
}

/** niimbluelib PrinterInfo -> DeviceInfo. */
export function deviceFromInfo(info: PrinterInfo | undefined, name: string, dpi?: number, printheadPixels?: number): DeviceInfo | null {
  if (!info) return null;
  return {
    name,
    modelId: info.modelId,
    serial: info.serial,
    mac: info.mac,
    firmware: info.softwareVersion,
    hardware: info.hardwareVersion,
    protocol: info.protocolVersion,
    batteryPercents: info.batteryPercents,
    printheadPixels: info.printheadWidth ?? printheadPixels,
    dpi,
    autoShutdown: info.settings?.autoShutdownTime !== undefined ? String(info.settings.autoShutdownTime) : undefined,
    sounds: info.settings ? { power: info.settings.powerSound, connection: info.settings.connectionSound } : undefined,
  };
}

/**
 * Models whose heartbeat reports the lid flag reversed. Verified on a real N1
 * (firmware 4.08): lid shut -> lidClosed false, lid open -> true.
 */
export const LID_FLAG_INVERTED = new Set(["N1"]);

/** niimbluelib HeartbeatData -> LiveStatus (null when nothing was reported). */
export function liveFromHeartbeat(h: HeartbeatData | undefined | null, model?: string | null): LiveStatus | null {
  if (!h) return null;
  const lidClosed = h.lidClosed === undefined ? undefined : model && LID_FLAG_INVERTED.has(model) ? !h.lidClosed : h.lidClosed;
  return { lidClosed, paperInserted: h.paperInserted, ribbonInserted: h.ribbonInserted, batteryPercents: h.batteryPercents, temp: h.temp, at: Date.now() };
}

/** niimbluelib RFID info -> RollInfo (null when no tag was read). */
export function rollFromRfid(info: CombinedRfidInfo | undefined | null): RollInfo | null {
  const tag = info?.labelRfidInfo;
  if (!tag || !tag.tagPresent) return null;
  const rib = info?.ribbonRfidInfo;
  const paper = info?.paperInfo;
  return {
    barcode: tag.barCode,
    serial: tag.serialNumber,
    total: tag.allPaper,
    used: tag.usedPaper,
    type: tag.consumablesType,
    totalDots: paper?.valid ? paper.totalHeightPixel : undefined,
    gapDots: paper?.valid ? paper.gapHeightPixel : undefined,
    ribbon: rib?.tagPresent ? { barcode: rib.barCode, serial: rib.serialNumber || undefined, total: rib.allPaper, used: rib.usedPaper } : null,
  };
}
