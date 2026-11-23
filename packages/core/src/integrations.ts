/**
 * Pure helpers for data in / out: live data sources (CSV URLs, Google
 * Sheets, JSON APIs), webhook signing and the address checks behind the
 * server's SSRF guard. No Node or DOM APIs except Web Crypto (`crypto.subtle`,
 * available in browsers and Node 20+). Import as `@labebal/core/integrations`.
 */
import { labelIdFromUrl } from "./tokens";

/* ------------------------------------------------------------ data sources */

export type SourceKind = "csv" | "json";

/** One output column of a JSON source: column name <- path inside each row object. */
export interface SourceField {
  column: string;
  path: string;
}

/**
 * Turn a Google Sheets link into its CSV download URL. Accepts a normal
 * editing link (`/spreadsheets/d/<id>/edit#gid=123`, the sheet must be shared
 * as "anyone with the link" or published) or a "Publish to the web" link
 * (`/spreadsheets/d/e/<pubid>/pubhtml`). Other URLs come back unchanged.
 */
export function normalizeSheetUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  if (u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) return u.toString();
  const gid = /gid=(\d+)/.exec(u.hash)?.[1] ?? u.searchParams.get("gid") ?? undefined;
  const pub = /^\/spreadsheets\/d\/e\/([^/]+)\/(pubhtml|pub)/.exec(u.pathname);
  if (pub) {
    const out = new URL(`https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub`);
    if (gid) out.searchParams.set("gid", gid);
    if (u.searchParams.get("single")) out.searchParams.set("single", u.searchParams.get("single")!);
    out.searchParams.set("output", "csv");
    return out.toString();
  }
  const m = /^\/spreadsheets\/d\/([^/]+)/.exec(u.pathname);
  if (!m || u.searchParams.get("format") === "csv" || u.searchParams.get("tqx")?.includes("csv")) return u.toString();
  const out = new URL(`https://docs.google.com/spreadsheets/d/${m[1]}/export`);
  out.searchParams.set("format", "csv");
  if (gid) out.searchParams.set("gid", gid);
  return out.toString();
}

type Seg = { key: string } | { index: number } | { all: true };

/**
 * Parse a JSONPath-ish selector: `$.data.items[*]`, `data.items`, `items[0].sku`,
 * `["odd key"].x`, `$` or "" (the value itself). `[*]` / `*` spread arrays (and
 * object values).
 */
export function parsePath(path: string): Seg[] {
  const s = path.trim().replace(/^\$/, "");
  const out: Seg[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) throw new Error(`Unclosed [ in path "${path}"`);
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === "*") out.push({ all: true });
      else if (/^-?\d+$/.test(inner)) out.push({ index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) out.push({ key: inner.slice(1, -1) });
      else throw new Error(`Bad [${inner}] in path "${path}"`);
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    const key = s.slice(i, j);
    out.push(key === "*" ? { all: true } : { key });
    i = j;
  }
  return out;
}

/** Every value a path selects (spreads produce several). */
export function selectPath(value: unknown, path: string | Seg[]): unknown[] {
  let cur: unknown[] = [value];
  for (const seg of typeof path === "string" ? parsePath(path) : path) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (v === null || v === undefined) continue;
      if ("all" in seg) {
        if (Array.isArray(v)) next.push(...v);
        else if (typeof v === "object") next.push(...Object.values(v));
      } else if ("index" in seg) {
        if (Array.isArray(v)) next.push(v[seg.index < 0 ? v.length + seg.index : seg.index]);
      } else if (typeof v === "object" && seg.key in (v as object)) next.push((v as Record<string, unknown>)[seg.key]);
    }
    cur = next;
  }
  return cur.filter((v) => v !== undefined);
}

/** Text for a cell: primitives as text, arrays joined with ", ", objects as JSON. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object") ? v.map(cellText).join(", ") : JSON.stringify(v);
  return JSON.stringify(v);
}

/** Flatten an object into `a.b.c` keys (arrays of primitives become one cell). */
export function flattenObject(v: unknown, prefix = "", out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && depth < 6) {
    for (const [k, x] of Object.entries(v)) flattenObject(x, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  } else out[prefix || "value"] = cellText(v);
  return out;
}

/**
 * Rows of a JSON API response: `rowsPath` selects the row objects (default:
 * the response itself if it is an array, else the first array property);
 * `fields` maps column names to paths inside each row (default: every field,
 * flattened). Returns records keyed by column name, ready for `addRows`.
 */
export function jsonToRecords(data: unknown, opts: { rowsPath?: string; fields?: SourceField[] } = {}): Record<string, string>[] {
  let rows: unknown[];
  if (opts.rowsPath?.trim()) {
    const sel = selectPath(data, opts.rowsPath);
    rows = sel.length === 1 && Array.isArray(sel[0]) ? (sel[0] as unknown[]) : sel;
  } else if (Array.isArray(data)) rows = data;
  else if (data && typeof data === "object") {
    const arr = Object.values(data).find(Array.isArray);
    rows = arr ?? [data];
  } else rows = [];
  const fields = (opts.fields ?? []).filter((f) => f.column.trim() && f.path.trim());
  const parsed = fields.map((f) => ({ column: f.column.trim(), segs: parsePath(f.path) }));
  return rows
    .filter((r) => r !== null && r !== undefined)
    .map((r) => {
      if (!parsed.length) return typeof r === "object" ? flattenObject(r) : { value: cellText(r) };
      return Object.fromEntries(parsed.map((f) => [f.column, cellText(f.segs.length ? (selectPath(r, f.segs)[0] ?? "") : r)]));
    });
}

/* ------------------------------------------------------------ SSRF checks */

/** IPv4 dotted quad -> 32-bit number, or undefined. */
function v4(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return undefined;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return undefined;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/** IPv6 text -> 8 groups, or undefined (handles `::` and a trailing IPv4). */
function v6(ip: string): number[] | undefined {
  let s = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4(tail[1]);
    if (n === undefined) return undefined;
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const parse = (h: string) => (h ? h.split(":") : []);
  const a = parse(halves[0]);
  const b = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  if (fill < 0 || (halves.length === 1 && a.length !== 8)) return undefined;
  const groups = [...a, ...Array(fill).fill("0"), ...b];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16));
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4Blocked(n: number) {
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4(base)! & mask) >>> 0);
  });
}

/**
 * True for addresses a server-side fetch must not reach: loopback, private
 * (RFC 1918, ULA), link-local (incl. 169.254.169.254 metadata), CGNAT,
 * multicast, reserved, and IPv4-mapped / NAT64 forms of those. Anything that
 * isn't a valid IP literal counts as blocked.
 */
export function isPrivateAddress(ip: string): boolean {
  const n4 = v4(ip);
  if (n4 !== undefined) return v4Blocked(n4);
  const g = v6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  const embedded = (g[6] << 16) + g[7];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Blocked(embedded >>> 0); // ::ffff:a.b.c.d, ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Blocked(embedded >>> 0); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return v4Blocked(((g[1] << 16) + g[2]) >>> 0); // 6to4
  return false;
}

/** Problems with a URL before any DNS lookup (scheme, credentials, literal private IPs, local names). */
export function checkFetchUrl(input: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "only http and https URLs are allowed" };
  if (url.username || url.password) return { ok: false, error: "credentials in the URL are not allowed (use the header field)" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { ok: false, error: "URL has no host" };
  const literal = v4(host) !== undefined || host.includes(":");
  if (literal && isPrivateAddress(host)) return { ok: false, error: `${host} is a private or local address` };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (!literal && !host.includes(".")))
    return { ok: false, error: `${host} is a local host name` };
  return { ok: true, url };
}

/**
 * Whether `host` (and its resolved address) is on an allow list such as
 * `LABEBAL_FETCH_ALLOW="n8n.lan,192.168.1.20,10.0.0.0/8"` (`*` = everything).
 */
export function isAllowListed(allow: string | undefined, host: string, address?: string): boolean {
  if (!allow?.trim()) return false;
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  for (const raw of allow.split(",")) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e === "*" || e === h || (address && e === address.toLowerCase())) return true;
    const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(e);
    if (cidr) {
      const bits = Number(cidr[2]);
      const base = v4(cidr[1]);
      const n = v4(address ?? h);
      if (base === undefined || n === undefined || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if (((n & mask) >>> 0) === ((base & mask) >>> 0)) return true;
    }
  }
  return false;
}

/* --------------------------------------------------------- webhook signing */

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Signature for an outgoing webhook: hex HMAC-SHA256 over `<timestamp>.<body>`
 * with the webhook's secret. Sent as `X-Labebal-Signature: sha256=<hex>` next
 * to `X-Labebal-Timestamp` (Unix seconds).
 */
export async function signWebhook(secret: string, timestamp: number | string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)));
}

/** Receiver-side check (constant time over the hex text). `toleranceSec` rejects old timestamps. */
export async function verifyWebhook(secret: string, timestamp: string, body: string, signature: string, opts: { now?: number; toleranceSec?: number } = {}): Promise<boolean> {
  const tol = opts.toleranceSec ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > tol) return false;
  const want = `sha256=${await signWebhook(secret, timestamp, body)}`;
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Delay before retry number `attempt` (1 = first retry): 30 s, 2 min, 10 min, 1 h, 6 h. */
export const WEBHOOK_BACKOFF_SEC = [30, 120, 600, 3600, 21600];
export const webhookRetryDelay = (attempt: number) => (attempt >= 1 && attempt <= WEBHOOK_BACKOFF_SEC.length ? WEBHOOK_BACKOFF_SEC[attempt - 1] * 1000 : undefined);

/* ------------------------------------------------------------------ scan */

/**
 * Clean a scanned code: trims, drops control characters some scanners add
 * (prefix/suffix, GS separators) and a `labebal:` / URL wrapper around a label id
 * (`?label=<id>`, or a label page link `https://host/l/<id>` from `{{labelUrl}}`).
 */
export function normalizeScan(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const m = /^labebal:(?:label:)?(.+)$/i.exec(s);
  if (m) s = m[1].trim();
  try {
    const u = new URL(s);
    const id = u.searchParams.get("label");
    if (id) s = id;
    // A label page link from a `{{labelUrl}}` QR code: https://host/l/<id>
    else s = labelIdFromUrl(s) ?? s;
  } catch {}
  return s;
}
