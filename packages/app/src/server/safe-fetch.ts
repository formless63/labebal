/**
 * Server-side HTTP for data sources and webhooks, with an SSRF guard:
 *
 * - http / https only, no credentials in the URL, no local host names;
 * - every DNS answer is checked at connect time (custom `lookup`), so a name
 *   that resolves (or re-resolves) to a private / loopback / link-local
 *   address is refused, which also defeats DNS rebinding;
 * - redirects are followed by hand (max 5), each hop checked again;
 * - a timeout and a response size cap.
 *
 * Hosts on `LABEBAL_FETCH_ALLOW` (comma list of host names, IPs, IPv4 CIDRs,
 * or `*`) skip the private-address check, for LAN services such as n8n.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { checkFetchUrl, isAllowListed, isPrivateAddress } from "@labebal/core/integrations";
import { env } from "./host";

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  url: string;
  text: string;
  /** Raw body (binary downloads, e.g. pack fonts). */
  body: Buffer;
}

export class FetchError extends Error {}

const allowList = () => env().LABEBAL_FETCH_ALLOW;

/** DNS lookup that refuses private answers unless the host is allow-listed. */
function guardedLookup(host: string): LookupFunction {
  return (hostname, options, cb) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addrs: LookupAddress[]) => {
      if (err) return cb(err, "", 0);
      const bad = addrs.find((a) => isPrivateAddress(a.address) && !isAllowListed(allowList(), host, a.address));
      if (bad) return cb(new FetchError(`${host} resolves to a private address (${bad.address}); add it to LABEBAL_FETCH_ALLOW to allow`), "", 0);
      if (options.all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

/** Validate a URL for server fetches (no DNS). Throws FetchError. */
export function assertFetchableUrl(input: string): URL {
  const c = checkFetchUrl(input);
  if (c.ok) return c.url;
  let url: URL | undefined;
  try {
    url = new URL(input);
  } catch {}
  // Allow-listed hosts may be local names or private literals; scheme rules still apply.
  if (url && (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && isAllowListed(allowList(), url.hostname)) return url;
  throw new FetchError(`URL not allowed: ${c.error}`);
}

function once(url: URL, o: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes">> & SafeFetchOptions): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // Literal IPs never reach `lookup`; check them here.
    if ((/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) && isPrivateAddress(host) && !isAllowListed(allowList(), host, host))
      return reject(new FetchError(`${host} is a private address`));
    const req = mod.request(
      url,
      {
        method: o.method ?? "GET",
        headers: { "user-agent": "labebal", accept: "*/*", ...o.headers, ...(o.body !== undefined ? { "content-length": Buffer.byteLength(o.body).toString() } : {}) },
        lookup: guardedLookup(host),
        timeout: o.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            req.destroy(new FetchError(`response larger than ${Math.round(o.maxBytes / 1024 / 1024)} MB`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, url: url.toString(), text: body.toString("utf8"), body });
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new FetchError(`timed out after ${o.timeoutMs / 1000} s`)), o.timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new FetchError(`timed out after ${o.timeoutMs / 1000} s`)));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError(e.message)));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/** Fetch with the SSRF guard. Non-2xx responses are returned, not thrown. */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const o = { timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024, maxRedirects: 5, ...opts };
  let url = assertFetchableUrl(input);
  for (let hop = 0; ; hop++) {
    const res = await once(url, o);
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= o.maxRedirects) throw new FetchError(`too many redirects`);
      const next = new URL(loc, url);
      // Don't carry auth headers to another origin.
      if (next.origin !== url.origin && o.headers) o.headers = Object.fromEntries(Object.entries(o.headers).filter(([k]) => k.toLowerCase() === "content-type"));
      url = assertFetchableUrl(next.toString());
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && o.method === "POST")) {
        o.method = "GET";
        o.body = undefined;
      }
      continue;
    }
    return res;
  }
}
