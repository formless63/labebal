// The host's server: plain node:http. /labels/api/* goes to labebal's fetch
// handler; everything else is the Vite dev server (the host's own front end).
// Vite also loads labebal's server module (TypeScript source) for us.
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5180);

const vite = await createVite({ root: here, plugins: [react()], server: { middlewareMode: true }, appType: "spa" });
const { createLabebalServer } = await vite.ssrLoadModule("@labebal/app/server");
const { PGlite } = await import("@electric-sql/pglite");
const { drizzle } = await import("drizzle-orm/pglite");

// The host's own database connection (here PGlite in a folder; any Drizzle Postgres works).
const dataDir = path.join(here, ".data", "pglite");
mkdirSync(dataDir, { recursive: true });
const db = drizzle(new PGlite(dataDir));

// The host decides who is signed in. A real app reads its session cookie here.
const labebal = createLabebalServer({
  db,
  basePath: "/labels",
  user: () => ({ id: "pat", name: "Pat", email: "pat@example.test", role: "admin" }),
  features: { backups: false },
});
labebal.start();

/** node:http request -> fetch Request (the adapter any Node framework needs). */
function toRequest(req) {
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, { method: req.method, headers, body, duplex: "half" });
}

http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/labels/api/")) {
      try {
        const r = await labebal.handler(toRequest(req));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        if (r.body) Readable.fromWeb(r.body).pipe(res);
        else res.end();
      } catch (e) {
        console.error(e);
        res.writeHead(500).end("error");
      }
      return;
    }
    vite.middlewares(req, res);
  })
  .listen(port, () => console.log(`example host on http://localhost:${port} (labebal at /labels)`));
