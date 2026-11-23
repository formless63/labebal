import { BUILTIN_FONTS } from "@labebal/core";

/**
 * Service worker (served at /sw.js so its scope is the whole app).
 *
 * - Pages and RSC payloads: network first, cached copy when offline.
 * - Build assets (/_next/static), fonts, icon SVGs, uploaded assets: cache first.
 * - Library, stock runs, recent history, /api/me, asset lists: stale-while-revalidate.
 * - Writes are never cached; offline they fail and the app queues what it must
 *   (print history, see features/pwa/history-queue.ts).
 *
 * The version changes with every build (this route is prerendered), which
 * drops the previous build's caches. Plain JS on purpose: it is served as is.
 */
const VERSION = `v${Date.now().toString(36)}`;

const PRECACHE = ["/", "/quick", "/manifest.webmanifest", "/pwa/icon-192.png", ...BUILTIN_FONTS.map((f) => `/api/static${f.url}`)];

const SOURCE = String.raw`
const SHELL = "labebal-shell-" + VERSION;
const STATIC = "labebal-static-" + VERSION;
const DATA = "labebal-data";

const isStatic = (u) =>
  u.pathname.startsWith("/_next/static/") ||
  u.pathname.startsWith("/api/static/") ||
  u.pathname.startsWith("/pwa/") ||
  (u.pathname.startsWith("/api/icons/") && u.pathname !== "/api/icons/sets") ||
  /^\/api\/assets\/[^/]+$/.test(u.pathname);
const DATA_PATHS = ["/api/library", "/api/runs", "/api/boards", "/api/me", "/api/assets", "/api/icons/sets", "/api/history"];
const isData = (u) => DATA_PATHS.includes(u.pathname);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(PRECACHE.map((url) => c.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("labebal-") && k !== SHELL && k !== STATIC && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the URLs it loaded before the worker took control, so they work offline too.
self.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "cache-urls" || !Array.isArray(msg.urls)) return;
  e.waitUntil(
    caches.open(STATIC).then(async (c) => {
      for (const url of msg.urls) {
        const u = new URL(url, self.location.origin);
        if (u.origin !== self.location.origin || !isStatic(u) || (await c.match(u))) continue;
        await c.add(u).catch(() => undefined);
      }
    }),
  );
});

async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreVary: true })) || (fallback ? await caches.match(fallback, { ignoreVary: true }) : undefined);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(STATIC).then((c) => c.put(req, copy));
  }
  return res;
}

// Serve the cached copy at once, refresh it in the background, and tell the
// pages when the refreshed copy differs (they refetch: see PwaSetup).
async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req, { ignoreVary: true });
  const fresh = fetch(req).then(async (res) => {
    if (res.ok) {
      const copy = res.clone();
      if (hit) {
        const [a, b] = await Promise.all([hit.clone().text(), copy.clone().text()]);
        if (a !== b) notify(req.url);
      }
      await cache.put(req, copy);
    }
    return res;
  });
  if (hit) {
    e.waitUntil(fresh.then(() => undefined, () => undefined));
    return hit;
  }
  return fresh.catch(() => Response.json({ error: "offline" }, { status: 503 }));
}

async function notify(url) {
  const all = await self.clients.matchAll({ type: "window" });
  for (const c of all) c.postMessage({ type: "data-updated", url });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== "GET") {
    // A successful change through the API makes cached data stale: drop it so the
    // next read goes to the server. Offline, answer 503 (the app queues history).
    if (u.origin === self.location.origin && u.pathname.startsWith("/api/"))
      e.respondWith(
        fetch(req).then(
          async (res) => {
            if (res.ok) await caches.delete(DATA);
            return res;
          },
          () => Response.json({ error: "offline" }, { status: 503 }),
        ),
      );
    return;
  }
  if (u.origin !== self.location.origin || u.pathname === "/sw.js") return;
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, SHELL, u.pathname.startsWith("/quick") ? "/quick" : "/"));
  if (isStatic(u)) return e.respondWith(cacheFirst(req));
  if (isData(u)) return e.respondWith(staleWhileRevalidate(req, e));
  // RSC payloads for client-side navigations between pages.
  if (req.headers.get("RSC") === "1" || u.searchParams.has("_rsc")) return e.respondWith(networkFirst(req, SHELL));
});
`;

export async function GET() {
  const body = `const VERSION = ${JSON.stringify(VERSION)};\nconst PRECACHE = ${JSON.stringify(PRECACHE)};\n${SOURCE}`;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
