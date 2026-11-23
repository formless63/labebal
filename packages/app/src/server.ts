/**
 * labebal's server side, for any host that speaks web-standard requests.
 *
 *   import { createLabebalServer } from "@labebal/app/server";
 *   const labebal = createLabebalServer({ db, user: async (req) => ..., basePath: "/labels" });
 *   // every request under /labels/api/ goes to:
 *   labebal.handler(request) // -> Promise<Response>
 *
 * The handler also serves labebal's own static files (built-in fonts, mockup
 * photos) under `${basePath}/api/static/`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleApi, apiSegments } from "./api/handler";
import { getDb, migrateDb, HOST_MIGRATIONS_TABLE, type DB } from "./db";
import * as schema from "./db/schema";
import { startBackupSchedule } from "./server/backup";
import { apiBase, assetsDir, featureOn, host, identityOfUser, migrationsFolder, rememberIdentity, setHost, type HostUser, type LabebalServerOptions } from "./server/host";
import { ensureScheduler, runJobs } from "./server/scheduler";

export type { DB, HostUser, LabebalServerOptions };
export { schema, HOST_MIGRATIONS_TABLE };
export type { Identity, Role } from "./features/auth/identity";

const TYPES: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function serveStatic(rel: string[]): Promise<Response> {
  const root = assetsDir();
  const file = path.resolve(root, ...rel);
  if (!file.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "public, max-age=86400" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/** Parts a host can turn off answer 404, as if they did not exist. */
function disabled(segments: string[]): boolean {
  if (segments[0] === "backup") return !featureOn("backups");
  if (segments[0] === "tokens") return !featureOn("apiTokens");
  return false;
}

export interface LabebalServer {
  /** Handle a request under `${basePath}/api/`. Anything else gets a 404. */
  handler: (req: Request) => Promise<Response>;
  /** Open the database and run migrations now (otherwise done on the first request). */
  ready: () => Promise<void>;
  /** Start labebal's own timers (background jobs, scheduled backups). Skipped when `jobs: "host"`. */
  start: () => void;
  /** One round of background work, for hosts with their own job runner (`jobs: "host"`), every ~30 s. */
  runJobs: () => Promise<void>;
  /** Where the API lives, e.g. "/labels/api". */
  apiBase: string;
}

export function createLabebalServer(options: LabebalServerOptions = {}): LabebalServer {
  setHost(options);
  const base = apiBase();

  async function handler(req: Request): Promise<Response> {
    const segments = apiSegments(req.url, base);
    if (!segments) return Response.json({ error: "Not found" }, { status: 404 });
    if (segments[0] === "static") return serveStatic(segments.slice(1));
    if (disabled(segments)) return Response.json({ error: "Not found" }, { status: 404 });
    const user = host().user;
    if (user) {
      const u = await user(req);
      rememberIdentity(req, identityOfUser(u, host().anonymousRole ?? "viewer"));
    }
    return handleApi(req, base);
  }

  return {
    handler,
    apiBase: base,
    ready: async () => {
      await getDb();
    },
    start: () => {
      ensureScheduler();
      startBackupSchedule();
    },
    runJobs,
  };
}

/** Run labebal's migrations on a database yourself (host option `migrate: false`). */
export async function migrateLabebal(db: DB, options: Pick<LabebalServerOptions, "filesDir"> = {}) {
  if (options.filesDir) setHost({ ...host(), filesDir: options.filesDir });
  await migrateDb(db);
}

export { migrationsFolder };
