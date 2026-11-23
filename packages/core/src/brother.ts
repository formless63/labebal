/**
 * Brother P-touch (PT-D610BT and relatives: 180 dpi, 128-pin head, TZe tape)
 * over a serial link: the printer's Bluetooth serial port (Web Serial in
 * Chrome / Edge; on Windows it shows up as "Standard Serial over Bluetooth link").
 *
 * Command sequence per label (Brother raster command reference, and the
 * open-source ptouch-print driver for the D460BT / D610BT specifics):
 *   100 x NUL, ESC @                 invalidate + initialize (once per connection)
 *   ESC i S                          status request -> 32 bytes
 *   ESC i a 01                       raster mode (the printer answers with a status block)
 *   ESC i z ... (13 bytes)           print info: tape width, raster line count, 0x02
 *   ESC i d 01 00 4D 00              D460BT / D610BT: required, else the print is garbled
 *   G 10 00 + 16 bytes, per line     one raster line per dot along the tape, uncompressed
 *   1A                               print and feed (cut per the printer's own setting)
 *
 * Raster lines: the label image's columns, left to right; pin i takes image
 * row (height - 1 - i), the image centred on the head; pin p is bit (p % 8) of
 * byte 15 - p / 8.
 */
import { ChunkedPrinter, type LoadedMedia, type PrintJob, type PrintRunOptions, type Transport } from "./printer-base";
import type { RunControl } from "./print-plan";
import { countLabels } from "./print-plan";
import type { Bitmap1 } from "./zpl-print";
import { canvasBits } from "./zpl-print";

export const BROTHER_PINS = 128;
const LINE_BYTES = BROTHER_PINS / 8;

const cmd = (...b: number[]) => Uint8Array.from(b);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const BROTHER_INIT = concat([new Uint8Array(100), cmd(0x1b, 0x40)]);
export const BROTHER_STATUS_REQUEST = cmd(0x1b, 0x69, 0x53);
export const BROTHER_RASTER_MODE = cmd(0x1b, 0x69, 0x61, 0x01);
/** D460BT / D610BT: must follow the print info command. */
export const BROTHER_D610_MAGIC = cmd(0x1b, 0x69, 0x64, 0x01, 0x00, 0x4d, 0x00);
export const BROTHER_PRINT_FEED = cmd(0x1a);

/** ESC i z: tape width (mm) and number of raster lines; n9 = 0x02 makes the D610BT feed and stop properly. */
export function brotherPrintInfo(tapeMm: number, lines: number) {
  return cmd(0x1b, 0x69, 0x7a, 0x00, 0x00, tapeMm & 0xff, 0x00, lines & 0xff, (lines >> 8) & 0xff, (lines >> 16) & 0xff, (lines >>> 24) & 0xff, 0x02, 0x00);
}

/** Raster lines for a label bitmap in reading orientation (length along the tape = width). */
export function brotherRasterLines(b: Bitmap1): Uint8Array {
  const out = new Uint8Array(b.width * (3 + LINE_BYTES));
  const offset = Math.floor(BROTHER_PINS / 2) - Math.floor(b.height / 2);
  for (let x = 0; x < b.width; x++) {
    const o = x * (3 + LINE_BYTES);
    out[o] = 0x47; // G
    out[o + 1] = LINE_BYTES;
    out[o + 2] = 0;
    for (let i = 0; i < b.height; i++) {
      const y = b.height - 1 - i;
      if (!(b.data[y * b.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7)))) continue;
      const pin = offset + i;
      if (pin < 0 || pin >= BROTHER_PINS) continue;
      out[o + 3 + (LINE_BYTES - 1 - (pin >> 3))] |= 1 << (pin & 7);
    }
  }
  return out;
}

/** Everything after the status request for one label. */
export function brotherLabelJob(b: Bitmap1, tapeMm: number): Uint8Array {
  return concat([BROTHER_RASTER_MODE, brotherPrintInfo(tapeMm, b.width), BROTHER_D610_MAGIC, brotherRasterLines(b), BROTHER_PRINT_FEED]);
}

/* ------------------------------------------------------------ status */

const MEDIA_TYPES: Record<number, string> = {
  0x00: "No tape",
  0x01: "Laminated tape",
  0x03: "Non-laminated tape",
  0x04: "Fabric tape",
  0x11: "Heat-shrink tube",
  0x13: "Flexi tape",
  0x14: "Flexible ID tape",
  0x15: "Satin tape",
  0x17: "Heat-shrink tube",
  0xff: "Incompatible tape",
};

/** Tape colour code -> [name, stock id]. */
const TAPE_COLOURS: Record<number, [string, string | undefined]> = {
  0x01: ["White", "white"],
  0x02: ["Other", undefined],
  0x03: ["Clear", "transparent"],
  0x04: ["Red", "red"],
  0x05: ["Blue", "blue"],
  0x06: ["Yellow", "yellow"],
  0x07: ["Green", "green"],
  0x08: ["Black", "black"],
  0x09: ["Clear", "transparent"],
  0x20: ["Matte white", "white-matte"],
  0x21: ["Matte clear", "transparent"],
  0x22: ["Matte silver", "matte-silver"],
  0x23: ["Satin gold", "gold"],
  0x24: ["Satin silver", "silver"],
  0x30: ["Blue", "blue"],
  0x31: ["Red", "red"],
  0x40: ["Fluorescent orange", "orange"],
  0x41: ["Fluorescent yellow", "yellow"],
  0x50: ["Berry pink", "pink"],
  0x51: ["Light grey", undefined],
  0x52: ["Lime green", "fluo-green"],
  0x60: ["Yellow", "yellow"],
  0x61: ["Pink", "pink"],
  0x62: ["Blue", "light-blue"],
  0x70: ["Heat-shrink tube", "black"],
  0x71: ["Heat-shrink tube (white)", "white"],
  0x90: ["White (flexible ID)", "white"],
  0x91: ["Yellow (flexible ID)", "yellow"],
};

/** Text colour code -> [name, ribbon id]. */
const TEXT_COLOURS: Record<number, [string, string | undefined]> = {
  0x01: ["White", "white"],
  0x02: ["Other", undefined],
  0x04: ["Red", "red"],
  0x05: ["Blue", "blue"],
  0x08: ["Black", "black"],
  0x0a: ["Gold", "gold"],
  0x62: ["Blue", "blue"],
};

export interface BrotherStatus {
  model: number;
  /** Error bits (bytes 8 and 9). */
  error1: number;
  error2: number;
  /** 0 = reply, 1 = printing completed, 2 = error, 4 = turned off, 5 = notification, 6 = phase change. */
  statusType: number;
  media: LoadedMedia | null;
  /** Plain words for an error, if any. */
  problem?: string;
}

function errorText(e1: number, e2: number): string | undefined {
  if (e1 & 0x01) return "No tape cassette.";
  if (e1 & 0x04) return "The cutter is jammed.";
  if (e1 & 0x08) return "The batteries are weak.";
  if (e1 & 0x40) return "Wrong power adapter (voltage too high).";
  if (e2 & 0x01) return "Replace the tape cassette (wrong or used up).";
  if (e2 & 0x10) return "The cover is open.";
  if (e2 & 0x20) return "The printer is too hot. Let it cool down.";
  if (e1 || e2) return `The printer reports an error (${e1.toString(16)}/${e2.toString(16)}).`;
  return undefined;
}

/** Parse a 32-byte status block; null when it isn't one. */
export function parseBrotherStatus(b: Uint8Array): BrotherStatus | null {
  if (b.length < 32 || b[0] !== 0x80 || b[1] !== 0x20) return null;
  const width = b[10];
  const tape = TAPE_COLOURS[b[24]];
  const text = TEXT_COLOURS[b[25]];
  const media: LoadedMedia | null =
    b[11] === 0x00 || !width
      ? null
      : {
          widthMm: width === 4 ? 3.5 : width,
          type: MEDIA_TYPES[b[11]] ?? `Tape type ${b[11]}`,
          tapeColour: tape?.[0],
          textColour: text?.[0],
          materialId: tape?.[1],
          ribbonId: text?.[1],
        };
  return { model: b[4], error1: b[8], error2: b[9], statusType: b[18], media, problem: errorText(b[8], b[9]) };
}

/* ------------------------------------------------------------ the link */

/** Bytes in and out (a serial port, or a fake in tests). */
export interface ByteLink {
  write(bytes: Uint8Array): Promise<void>;
  /** Next `n` bytes, or what arrived when `timeoutMs` passes (possibly fewer). */
  read(n: number, timeoutMs: number): Promise<Uint8Array>;
  /** Drop anything received but not read yet. */
  drain(): void;
  close(): Promise<void>;
}

/* Minimal Web Serial types (not in every TS DOM lib). */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: number | string };
}
interface SerialLike {
  requestPort(o?: unknown): Promise<SerialPortLike>;
}

/** A Web Serial port as a ByteLink. */
export async function openSerialLink(port: SerialPortLike): Promise<ByteLink> {
  await port.open({ baudRate: 9600 });
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  let buf = new Uint8Array(0);
  let waiters: (() => void)[] = [];
  let closed = false;
  void (async () => {
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) {
          const next = new Uint8Array(buf.length + value.length);
          next.set(buf);
          next.set(value, buf.length);
          buf = next;
          const w = waiters;
          waiters = [];
          w.forEach((f) => f());
        }
      }
    } catch {
      /* port closed */
    }
  })();
  return {
    async write(bytes) {
      // Bluetooth serial links choke on huge writes; send in pieces.
      for (let i = 0; i < bytes.length; i += 4096) await writer.write(bytes.subarray(i, i + 4096));
    },
    async read(n, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (buf.length < n && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, Math.max(1, deadline - Date.now()));
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      const out = buf.slice(0, n);
      buf = buf.slice(out.length);
      return out;
    },
    drain() {
      buf = new Uint8Array(0);
    },
    async close() {
      closed = true;
      try {
        await reader.cancel();
      } catch {}
      reader.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
}

/* ------------------------------------------------------------ printer */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A Brother P-touch printer (PT-D610BT) as a LabelPrinter. */
export class BrotherPtPrinter extends ChunkedPrinter {
  private link: ByteLink | null = null;

  constructor(
    id: string,
    readonly model = "PT-D610BT",
  ) {
    super(id, "brother-pt");
    this.defaultChunk = 1;
  }

  /** Use an already-open link (tests, other transports). */
  async attachLink(link: ByteLink) {
    this.link = link;
    await this.hello();
  }

  async connect(_transport?: Transport) {
    await this.disconnect();
    const serial = (globalThis.navigator as unknown as { serial?: SerialLike } | undefined)?.serial;
    if (!serial) {
      this.set({ error: "This browser can't use serial ports. Use Chrome or Edge on a computer.", status: "Not connected" });
      return;
    }
    this.set({ status: "Connecting…", error: null });
    try {
      const port = await serial.requestPort();
      this.link = await openSerialLink(port);
      await this.hello();
    } catch (e) {
      await this.link?.close().catch(() => {});
      this.link = null;
      this.set({ connected: false, status: "Not connected", error: String(e instanceof Error ? e.message : e) });
    }
  }

  /** Initialize and read the status; fails when nothing Brother-like answers. */
  private async hello() {
    const link = this.link!;
    await link.write(BROTHER_INIT);
    const s = await this.status(3000);
    if (!s) throw new Error("No answer from a Brother P-touch printer on that port. Is it switched on and paired?");
    this.set({
      connected: true,
      model: this.model,
      status: `Connected: ${this.model}`,
      device: { name: this.model, dpi: 180, printheadPixels: BROTHER_PINS },
      media: s.media,
      live: { at: Date.now(), paperInserted: !!s.media, lidClosed: !(s.error2 & 0x10), problem: s.problem },
    });
  }

  private async status(timeoutMs = 2000) {
    const link = this.link;
    if (!link) return null;
    link.drain();
    await link.write(BROTHER_STATUS_REQUEST);
    return parseBrotherStatus(await link.read(32, timeoutMs));
  }

  async disconnect() {
    this.run?.cancel();
    const l = this.link;
    this.link = null;
    if (l) await l.close().catch(() => {});
    if (this.state.connected) this.set({ connected: false, model: null, status: "Disconnected", device: null, live: null, media: null });
  }

  async refresh() {
    const s = await this.status();
    if (s) this.set({ media: s.media, live: { at: Date.now(), paperInserted: !!s.media, lidClosed: !(s.error2 & 0x10), problem: s.problem } });
  }

  protected checkReady() {
    if (!this.link || !this.state.connected) throw new Error("Printer not connected");
  }

  /** One label (all its copies): raster job per copy, then wait until the printer says it is done. */
  protected async printChunk(chunk: PrintJob[], opts: PrintRunOptions, report: (n: number) => void, control: RunControl, setCurrent: (name: string) => void) {
    const link = this.link;
    if (!link) throw new Error("Printer not connected");
    const before = await this.status();
    if (!before) throw new Error("The printer stopped answering.");
    if (before.problem) throw new Error(before.problem);
    if (!before.media) throw new Error("No tape cassette.");
    const tapeMm = Math.round(before.media.widthMm);
    let done = 0;
    for (const job of chunk) {
      setCurrent(job.name);
      // Tape labels are drawn in reading orientation with the length across the canvas.
      const bits = canvasBits(job.canvas, opts.direction === "top");
      const bytes = brotherLabelJob(bits, tapeMm);
      for (let c = 0; c < job.qty; c++) {
        if (control.cancelled) return;
        link.drain();
        await link.write(bytes);
        // Printing takes about 20 mm per second; then the printer sends "printing completed" (or an error).
        const lengthMm = bits.width / (180 / 25.4);
        const until = Date.now() + 8000 + lengthMm * 120;
        let finished = false;
        while (Date.now() < until) {
          const s = parseBrotherStatus(await link.read(32, Math.max(1, until - Date.now())));
          if (!s) break;
          if (s.statusType === 2 || s.problem) throw new Error(s.problem ?? "The printer reported an error.");
          if (s.statusType === 1) {
            finished = true;
            break;
          }
        }
        if (!finished) await sleep(300);
        done++;
        report(Math.min(done, countLabels(chunk)));
      }
    }
  }
}
