"use client";
/**
 * A network ZPL printer as a `LabelPrinter`: labels are rendered here like for
 * any printer, turned into ZPL (core canvasToZpl) and sent through the server
 * (POST /api/netprinters/<id>/print), which passes them to the printer.
 *
 * Progress: a chunk counts as printed once the printer reports nothing left in
 * its buffer and batch (~HS). A problem it reports (head open, out of labels
 * or ribbon) stops the run with that message; cancelling also clears what the
 * printer still holds (~JA).
 */
import { ChunkedPrinter, canvasToZpl, countLabels, type PrintJob, type PrintRunOptions, type RunControl } from "@labebal/core";
import { apiRoot } from "../../lib/base";
import { fetchNetStatus, netModel, type NetPrinter, type NetPrinterStatus } from "./api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NetworkZplPrinter extends ChunkedPrinter {
  constructor(
    id: string,
    private readonly np: NetPrinter,
  ) {
    super(id, "zpl");
    this.defaultChunk = 5;
  }

  get netId() {
    return this.np.id;
  }

  private applyStatus(s: NetPrinterStatus) {
    this.set({
      live: s.reachable
        ? { at: Date.now(), thermal: s.thermalTransfer ? "transfer" : "direct", lidClosed: !s.headOpen, paperInserted: !s.paperOut, ribbonInserted: s.thermalTransfer ? !s.ribbonOut : undefined, paused: s.paused, problem: s.problem }
        : { at: Date.now(), problem: s.error ?? "Not reachable" },
    });
  }

  async connect() {
    this.set({ status: "Connecting…", error: null });
    const s = await fetchNetStatus(this.np.id).catch((e) => ({ reachable: false, error: String(e) }) as NetPrinterStatus);
    if (!s.reachable) {
      this.set({ connected: false, status: "Not connected", error: s.error ?? `Can't reach ${this.np.name}` });
      return;
    }
    this.set({
      connected: true,
      model: netModel(this.np.id),
      status: `Connected: ${this.np.name}`,
      device: {
        name: this.np.name,
        // Keys calibration and saved settings to this printer (see printerKey).
        serial: `net-${this.np.id}`,
        dpi: this.np.dpi,
        printheadPixels: this.np.headDots,
        firmware: this.np.model || undefined,
        address: `${this.np.host}:${this.np.port}`,
      },
    });
    this.applyStatus(s);
  }

  async disconnect() {
    this.run?.cancel();
    this.set({ connected: false, model: null, status: "Disconnected", device: null, live: null });
  }

  async refresh() {
    if (!this.state.connected) return;
    this.applyStatus(await fetchNetStatus(this.np.id));
  }

  private async cancelOnPrinter() {
    await fetch(`${apiRoot()}/netprinters/${encodeURIComponent(this.np.id)}/cancel`, { method: "POST" }).catch(() => {});
  }

  protected async printChunk(chunk: PrintJob[], opts: PrintRunOptions, report: (n: number) => void, control: RunControl, setCurrent: (name: string) => void) {
    const dpmm = this.np.dpi / 25.4;
    const parts: string[] = [];
    for (const job of chunk) {
      setCurrent(job.name);
      const turned = opts.direction === "left";
      // Label length along the feed: the label as cut (gap media finds the gap itself).
      const lengthDots = opts.label ? Math.round((turned ? opts.label.widthMm : opts.label.heightMm) * dpmm) : undefined;
      parts.push(canvasToZpl(job.canvas, { qty: job.qty, direction: opts.direction, lengthDots, mediaKind: opts.mediaKind, thermal: opts.thermal, darkness: opts.density }));
    }
    if (control.cancelled) return;
    const res = await fetch(`${apiRoot()}/netprinters/${encodeURIComponent(this.np.id)}/print`, { method: "POST", headers: { "content-type": "text/plain" }, body: parts.join("\n") });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {}
      throw new Error(msg);
    }
    // Wait until the printer has printed everything it holds (or reports a problem).
    const n = countLabels(chunk);
    const deadline = Date.now() + 20_000 + n * 8_000;
    while (Date.now() < deadline) {
      if (control.cancelled) {
        await this.cancelOnPrinter();
        return;
      }
      await sleep(800);
      const s = await fetchNetStatus(this.np.id).catch(() => null);
      if (!s) continue;
      this.applyStatus(s);
      if (!s.reachable) throw new Error(s.error ?? "Lost the printer");
      if (s.problem && (s.headOpen || s.paperOut || s.ribbonOut || s.overTemp)) throw new Error(s.problem);
      if (!s.remaining && !s.queued) {
        report(n);
        return;
      }
    }
    // The printer never said it was done; it has the job, so count it.
    report(n);
  }
}
