"use client";
/**
 * Installable app / offline support: registers the service worker (when the
 * host serves one: `<LabebalApp serviceWorker="/sw.js">`, the standalone app does),
 * hands it the files this page already loaded, refetches data the worker
 * reports as updated, and sends print history queued while offline.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRoot } from "../../lib/base";
import { flushHistoryQueue } from "./history-queue";

/** API path (after the API root) -> TanStack Query key prefix refreshed when the worker has newer data. */
const QUERY_KEYS: Record<string, string> = {
  "/library": "library",
  "/runs": "runs",
  "/me": "me",
  "/history": "history",
};

/** Service worker in production builds; in `next dev` only when localStorage "labebal.sw" = "1". */
const swWanted = () => {
  if (!("serviceWorker" in navigator)) return false;
  if (process.env.NODE_ENV === "production") return true;
  try {
    return localStorage.getItem("labebal.sw") === "1";
  } catch {
    return false;
  }
};

export function PwaSetup({ serviceWorker }: { serviceWorker?: string }) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!serviceWorker || !swWanted()) return;
    let cancelled = false;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; url?: string } | null;
      if (msg?.type !== "data-updated" || !msg.url) return;
      const key = QUERY_KEYS[new URL(msg.url).pathname.slice(apiRoot().length)];
      if (key) void qc.invalidateQueries({ queryKey: [key] });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void navigator.serviceWorker
      .register(serviceWorker, { updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled) return;
        const urls = performance.getEntriesByType("resource").map((r) => r.name);
        reg.active?.postMessage({ type: "cache-urls", urls: [...urls, location.href] });
      })
      .catch((e) => console.warn("service worker not registered", e));
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [qc, serviceWorker]);

  useEffect(() => {
    const flush = () =>
      void flushHistoryQueue().then((n) => {
        if (n) {
          toast.success(`Sent ${n} print record${n > 1 ? "s" : ""} made while offline`);
          void qc.invalidateQueries({ queryKey: ["history"] });
        }
      });
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [qc]);

  return null;
}

const subscribeOnline = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};

/** Browser connectivity (true on the server). */
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
