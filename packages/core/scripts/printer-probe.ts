/**
 * Desktop printer probe: connects to a Niimbot printer through the PowerShell
 * bridge (tools/ble-bridge/bridge.ps1) and dumps everything niimbluelib can read.
 *
 *   pnpm --filter @labebal/core printer-probe -- --com COM3         (classic Bluetooth serial / USB)
 *   pnpm --filter @labebal/core printer-probe -- --name N1          (Bluetooth LE by name)
 *   pnpm --filter @labebal/core printer-probe -- --com COM3 --json probe.json --debug
 *
 * The protocol work is niimbluelib's own (same code the web app uses); the
 * bridge only moves bytes, so this needs no native Node modules.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  ConnectEvent,
  ConnectResult,
  DisconnectEvent,
  NiimbotAbstractClient,
  RawPacketSentEvent,
  Utils,
  type ConnectionInfo,
  type NiimbotClientType,
} from "@mmote/niimbluelib";

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(here, "../../../tools/ble-bridge/bridge.ps1");

/** niimbluelib client whose transport is the PowerShell bridge (hex lines over stdio). */
export class BridgeClient extends NiimbotAbstractClient {
  private proc?: ChildProcessWithoutNullStreams;
  private open = false;
  public deviceName = "";
  /** Pause after the link opens, before talking to the printer. */
  public warmupMs = Number(process.env.PROBE_WARMUP_MS ?? 2000);
  /**
   * Minimum wait for a response. niimbluelib waits 1 s, but over a Windows
   * Bluetooth serial (RFCOMM) link the N1's replies can take longer.
   */
  public minResponseMs = Number(process.env.PROBE_MIN_RESPONSE_MS ?? 4000);

  override sendPacketWaitResponse(...args: Parameters<NiimbotAbstractClient["sendPacketWaitResponse"]>) {
    const [packet, timeoutMs] = args;
    return super.sendPacketWaitResponse(packet, Math.max(timeoutMs ?? 1000, this.minResponseMs));
  }

  override waitForPacket(...args: Parameters<NiimbotAbstractClient["waitForPacket"]>) {
    const [ids, catchErrors, timeoutMs] = args;
    return super.waitForPacket(ids, catchErrors, Math.max(timeoutMs ?? 1000, this.minResponseMs));
  }

  constructor(private bridgeArgs: string[], private log: (s: string) => void = () => {}) {
    super();
  }

  async connect(): Promise<ConnectionInfo> {
    await this.disconnect();
    const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BRIDGE, ...this.bridgeArgs], { windowsHide: true });
    this.proc = proc;
    const ready = new Promise<void>((res, rej) => {
      const rl = createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        if (process.env.PROBE_TRACE) console.error(`  << ${line}`);
        if (line.startsWith("RX ")) this.processRawPacket(Utils.hexToBuf(line.slice(3).trim()));
        else if (line.startsWith("READY ")) {
          this.deviceName = line.slice(6).trim();
          this.open = true;
          res();
        } else if (line.startsWith("ERR ")) {
          this.log(line);
          rej(new Error(line.slice(4)));
        } else if (line.trim()) this.log(line);
      });
      proc.stderr.on("data", (d) => this.log(`stderr: ${String(d).trim()}`));
      proc.on("exit", (code) => {
        if (this.open) this.emit("disconnect", new DisconnectEvent());
        this.open = false;
        rej(new Error(`bridge exited (${code})`));
      });
    });
    await ready;
    // A freshly opened Bluetooth serial (RFCOMM) link answers the first packets
    // with a delay of over a second; let it settle before niimbluelib's handshake
    // (which waits ~1 s for each response).
    await Utils.sleep(this.warmupMs);
    await this.negotiateAndGetPrinterInfo(() => void this.disconnect());
    const result: ConnectionInfo = { deviceName: this.deviceName, result: this.printerInfo.connectResult ?? ConnectResult.FirmwareErrors };
    this.emit("connect", new ConnectEvent(result));
    return result;
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.proc) {
      try {
        this.proc.stdin.write("QUIT\n");
        this.proc.stdin.end();
      } catch {
        /* gone */
      }
      const p = this.proc;
      setTimeout(() => p.kill(), 1500);
    }
    this.proc = undefined;
    this.open = false;
  }

  isConnected(): boolean {
    return this.open;
  }

  async sendRaw(data: Uint8Array, force?: boolean): Promise<void> {
    const send = async () => {
      if (!this.proc || !this.open) throw new Error("bridge not connected");
      await Utils.sleep(this.packetIntervalMs);
      this.proc.stdin.write(`TX ${Utils.bufToHex(data, "")}\n`);
      this.emit("rawpacketsent", new RawPacketSentEvent(data));
    };
    if (force) await send();
    else await this.mutex.runExclusive(send);
  }

  getType(): NiimbotClientType {
    return "serial";
  }
}

/* ------------------------------------------------------------------ CLI */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const com = arg("com");
  const name = arg("name");
  const address = arg("address");
  const out = arg("json");
  const debug = process.argv.includes("--debug");
  const bridgeArgs = com ? ["-Com", com] : address ? ["-Address", address] : ["-Name", name ?? "N1", "-Seconds", "15"];

  const client = new BridgeClient(bridgeArgs, (s) => console.error(`  [bridge] ${s}`));
  client.setDebug(debug);
  client.setHeartbeatAutoStart(false);

  const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Utils.bufToHex(v) : v);
  try {
    console.error(`connecting via bridge ${bridgeArgs.join(" ")} ...`);
    const conn = await client.connect();
    const report: Record<string, unknown> = {
      at: new Date().toISOString(),
      transport: bridgeArgs.join(" "),
      connection: conn,
      model: client.getModelMetadata() ?? null,
      printTask: client.getPrintTaskType() ?? null,
      printerInfo: client.getPrinterInfo(),
    };
    try {
      report.rfid = await client.fetchRfidInfo();
    } catch (e) {
      report.rfid = { error: String(e) };
    }
    try {
      report.heartbeat = await client.fetchHeartbeatData();
    } catch (e) {
      report.heartbeat = { error: String(e) };
    }
    const json = JSON.stringify(report, replacer, 2);
    console.log(json);
    if (out) writeFileSync(join(process.cwd(), out), json + "\n");
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
    setTimeout(() => process.exit(), 2000);
  }
}
