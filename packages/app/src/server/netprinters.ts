/**
 * Network label printers (ZPL over raw TCP, usually port 9100): the server
 * talks to them so any browser, phones included, can print.
 *
 * - Only printers an admin set up here are ever contacted (no arbitrary hosts
 *   from the browser). Private LAN addresses are the point, so the SSRF guard
 *   used for web fetches does not apply; the host list is the guard.
 * - Detection reads ~HI (model, resolution) and ^HH (head width, print
 *   method); status reads ~HS. Neither prints anything.
 */
import net from "node:net";
import { asc, eq } from "drizzle-orm";
import { parseHostConfig, parseHostIdentity, parseHostStatus, type ZplHostStatus } from "@labebal/core";
import { getDb } from "../db";
import { netPrinters } from "../db/schema";

export type NetThermal = "direct" | "transfer" | "both";

export interface NetPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  language: "zpl";
  model: string;
  dpi: number;
  headDots: number;
  thermal: NetThermal;
  updatedAt: string;
  updatedBy: string;
}

export interface NetPrinterDetection {
  model: string;
  firmware: string;
  dpi: number;
  headDots: number;
  printWidth?: number;
  /** How the printer is set up now (^HH PRINT METHOD). */
  method?: "direct" | "transfer";
  mediaType?: string;
  darkness?: number;
}

export interface NetPrinterStatus extends ZplHostStatus {
  reachable: true;
}

const toView = (r: typeof netPrinters.$inferSelect): NetPrinter => ({
  id: r.id,
  name: r.name,
  host: r.host,
  port: r.port,
  language: "zpl",
  model: r.model,
  dpi: r.dpi,
  headDots: r.headDots,
  thermal: (["direct", "transfer", "both"].includes(r.thermal) ? r.thermal : "both") as NetThermal,
  updatedAt: r.updatedAt.toISOString(),
  updatedBy: r.updatedBy,
});

/* ------------------------------------------------------------ raw TCP */

interface TalkOptions {
  /** Wait for a reply until this many ms pass without new data (0 = send only). */
  replyIdleMs?: number;
  /** Give up connecting after this many ms. */
  connectMs?: number;
  /** Stop reading after this many bytes. */
  maxBytes?: number;
}

/** Send bytes to host:port and collect whatever comes back. */
export function talk(host: string, port: number, data: string | Uint8Array, o: TalkOptions = {}): Promise<string> {
  const { replyIdleMs = 0, connectMs = 4000, maxBytes = 256 * 1024 } = o;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const sock = net.connect({ host, port });
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(connectTimer);
      sock.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("latin1"));
    };
    const connectTimer = setTimeout(() => finish(new Error(`No answer from ${host}:${port} (is the printer on and on the network?)`)), connectMs);
    sock.on("connect", () => {
      clearTimeout(connectTimer);
      sock.write(typeof data === "string" ? Buffer.from(data, "latin1") : data, (err) => {
        if (err) return finish(err);
        if (!replyIdleMs) {
          sock.end();
          // Some printers keep the socket open after our end; the bytes are delivered either way.
          idle = setTimeout(() => finish(), 15_000);
          return;
        }
        idle = setTimeout(() => finish(), replyIdleMs * 3);
      });
    });
    sock.on("data", (d: Buffer) => {
      chunks.push(d);
      size += d.length;
      if (size >= maxBytes) return finish();
      clearTimeout(idle);
      idle = setTimeout(() => finish(), replyIdleMs || 200);
    });
    sock.on("close", () => finish());
    sock.on("error", (e: NodeJS.ErrnoException) =>
      finish(new Error(e.code === "ECONNREFUSED" ? `${host}:${port} refused the connection` : e.code === "EHOSTUNREACH" || e.code === "ETIMEDOUT" ? `Can't reach ${host}:${port}` : e.message)),
    );
  });
}

/* ------------------------------------------------------------ printer talk */

export async function detectZpl(host: string, port: number): Promise<NetPrinterDetection> {
  const hi = parseHostIdentity(await talk(host, port, "~HI", { replyIdleMs: 400 }));
  if (!hi) throw new Error(`${host}:${port} answered, but not like a ZPL printer.`);
  const cfg = parseHostConfig(await talk(host, port, "^XA^HH^XZ", { replyIdleMs: 600 }));
  const dpmm = cfg.dpmm ?? hi.dpmm;
  const dpi = dpmm === 8 ? 203 : dpmm === 12 ? 300 : dpmm === 24 ? 600 : dpmm === 6 ? 152 : Math.round(dpmm * 25.4);
  return {
    model: hi.model,
    firmware: hi.firmware,
    dpi,
    // Desktop 4" printers: 832 dots at 203 dpi, 1248-1280 at 300 dpi.
    headDots: cfg.headDots ?? cfg.printWidth ?? Math.round(104 * dpmm),
    printWidth: cfg.printWidth,
    method: cfg.method,
    mediaType: cfg.mediaType,
    darkness: cfg.darkness,
  };
}

export async function zplStatus(p: Pick<NetPrinter, "host" | "port">): Promise<NetPrinterStatus> {
  const s = parseHostStatus(await talk(p.host, p.port, "~HS", { replyIdleMs: 300 }));
  if (!s) throw new Error(`${p.host}:${p.port} didn't send a status.`);
  return { ...s, reachable: true };
}

/** Send a ZPL job (one or more formats). Resolves once the printer has the bytes. */
export async function zplSend(p: Pick<NetPrinter, "host" | "port">, zpl: string) {
  await talk(p.host, p.port, zpl, { connectMs: 6000 });
}

/** Clear everything waiting in the printer (~JA: cancel all). */
export async function zplCancelAll(p: Pick<NetPrinter, "host" | "port">) {
  await talk(p.host, p.port, "~JA");
}

/* ------------------------------------------------------------ storage */

export async function listNetPrinters(): Promise<NetPrinter[]> {
  const db = await getDb();
  return (await db.select().from(netPrinters).orderBy(asc(netPrinters.name))).map(toView);
}

export async function getNetPrinter(id: string): Promise<NetPrinter | null> {
  const db = await getDb();
  const [r] = await db.select().from(netPrinters).where(eq(netPrinters.id, id));
  return r ? toView(r) : null;
}

export interface NetPrinterInput {
  name: string;
  host: string;
  port: number;
  dpi: number;
  headDots: number;
  model?: string;
  thermal: NetThermal;
}

export async function saveNetPrinter(id: string, p: NetPrinterInput, who: string): Promise<NetPrinter> {
  const db = await getDb();
  const row = { id, name: p.name, host: p.host, port: p.port, language: "zpl", model: p.model ?? "", dpi: p.dpi, headDots: p.headDots, thermal: p.thermal, updatedAt: new Date(), updatedBy: who };
  const [r] = await db.insert(netPrinters).values(row).onConflictDoUpdate({ target: netPrinters.id, set: row }).returning();
  return toView(r);
}

export async function deleteNetPrinter(id: string) {
  const db = await getDb();
  await db.delete(netPrinters).where(eq(netPrinters.id, id));
}
