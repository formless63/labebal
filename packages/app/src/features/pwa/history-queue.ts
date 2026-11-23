"use client";
/**
 * Offline print history: printing works without a connection (Web Bluetooth
 * is local), so a history record that can't be sent is kept in this browser
 * (localStorage) and sent when the connection returns. Wraps the POST made by
 * features/labels/history-client.ts.
 */
import { useSyncExternalStore } from "react";
import { apiRoot } from "../../lib/base";

const KEY = "labebal.historyQueue";
const listeners = new Set<() => void>();

interface Pending {
  body: Record<string, unknown>;
  /** When it was printed (ISO). */
  at: string;
}

function read(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}

function write(q: Pending[]) {
  try {
    if (q.length) localStorage.setItem(KEY, JSON.stringify(q.slice(-500)));
    else localStorage.removeItem(KEY);
  } catch {}
  cachedCount = q.length;
  listeners.forEach((l) => l());
}

class OfflineError extends Error {}

async function post(body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${apiRoot()}/history`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new OfflineError(String(e));
  }
  // The service worker answers 503 for API writes it could not deliver.
  if (res.status === 503 || res.status === 502 || res.status === 504) throw new OfflineError(`${res.status}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

/** Send a history record now, or queue it when offline. */
export async function sendHistory(body: Record<string, unknown>): Promise<void> {
  const queue = () => write([...read(), { body, at: new Date().toISOString() }]);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return queue();
  try {
    await post(body);
  } catch (e) {
    if (e instanceof OfflineError) return queue();
    throw e;
  }
  void flushHistoryQueue();
}

let flushing: Promise<number> | null = null;

/** Send queued records (oldest first); returns how many were sent. */
export function flushHistoryQueue(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (;;) {
      const [next] = read();
      if (!next) break;
      // No schema field for the print time yet: note it in the client summary.
      const when = new Date(next.at).toLocaleString();
      const client = `${String(next.body.client ?? "")} (offline print, ${when})`.slice(0, 200);
      try {
        await post({ ...next.body, client });
        sent++;
      } catch (e) {
        if (e instanceof OfflineError) break;
        console.warn("queued history record rejected, dropping it", e);
      }
      // Records queued meanwhile are appended, so dropping the first is safe.
      write(read().slice(1));
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let cachedCount = -1;
const count = () => (cachedCount < 0 ? (cachedCount = typeof localStorage === "undefined" ? 0 : read().length) : cachedCount);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Number of print records waiting to be sent. */
export const usePendingHistory = () => useSyncExternalStore(subscribe, count, () => 0);
