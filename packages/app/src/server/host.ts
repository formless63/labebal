/**
 * What the app hosting labebal provides (the "host connector"). The
 * standalone app sets none of it and gets the defaults: its own database
 * (PGlite or DATABASE_URL), identity from proxy headers, settings from
 * environment variables, its own background timer.
 *
 * A host app calls `createLabebalServer(options)` (./index.ts), which stores
 * the options here for the rest of the server code to read.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "../db";
import type { Identity, Role } from "../features/auth/identity";

export type { DB, Identity, Role };

/** The signed-in person as the host knows them. `role` uses labebal's roles: viewer < printer < editor < admin. */
export interface HostUser {
  /** Stable id (used to scope per-person settings and GitHub accounts). */
  id: string;
  name?: string;
  email?: string;
  role: Role;
  groups?: string[];
}

export interface LabebalServerOptions {
  /**
   * A Drizzle Postgres database (any driver: postgres-js, node-postgres,
   * Neon, PGlite). labebal runs its own migrations on it; every table is
   * prefixed `label_`. Without it: DATABASE_URL, else embedded PGlite.
   */
  db?: DB | (() => DB | Promise<DB>);
  /** Run labebal's migrations on start (default true). Turn off if the host runs them itself (see `migrationsFolder`). */
  migrate?: boolean;
  /** Who is making this request. null = not signed in. Without it: proxy headers (LABEBAL_AUTH_HEADERS), else everyone is admin. */
  user?: (req: Request) => HostUser | null | Promise<HostUser | null>;
  /** Role for requests without a user (default "viewer" when `user` is set). */
  anonymousRole?: Role;
  /** Where the module is mounted, e.g. "/labels" (default ""). The API lives at `${basePath}/api`. */
  basePath?: string;
  /** Public URL of the mount, e.g. "https://example.com/labels" (QR codes on labels point at its label pages). */
  publicUrl?: string;
  /** Settings normally read from LABEBAL_* environment variables, e.g. { LABEBAL_GITHUB_CLIENT_ID: "..." }. Wins over process.env. */
  env?: Record<string, string | undefined>;
  /**
   * Background work (data-source syncs, webhook retries, backups). "timer"
   * (default) starts labebal's own timer; "host" leaves it to the host, which
   * calls `runJobs()` every 30 s or so from its own job runner.
   */
  jobs?: "timer" | "host";
  /** Turn parts off when the host already has them. */
  features?: {
    /** Scheduled and manual backups of the label_* tables (default true). */
    backups?: boolean;
    /** labebal's own API tokens for /api/v1 (default true). With false, `apiAuth` decides. */
    apiTokens?: boolean;
  };
  /** Checks a bearer token for /api/v1 when the host has its own API keys. Return a user or null. */
  apiAuth?: (req: Request) => HostUser | null | Promise<HostUser | null>;
  /**
   * Folder holding labebal's runtime files (drizzle/, assets/, packs/).
   * Default: the installed package folder. Set it when a bundler moves the
   * server code away from the package (the standalone Next build does).
   */
  filesDir?: string;
}

type HostState = LabebalServerOptions & { basePath: string };

const g = globalThis as unknown as { __labebalHost?: HostState };

export function setHost(options: LabebalServerOptions) {
  g.__labebalHost = { ...options, basePath: normalizeBase(options.basePath) };
}

export function host(): HostState {
  return (g.__labebalHost ??= { basePath: "" });
}

export const normalizeBase = (b: string | undefined) => {
  const s = (b ?? "").trim().replace(/\/+$/, "");
  return !s ? "" : s.startsWith("/") ? s : `/${s}`;
};

export const apiBase = () => `${host().basePath}/api`;

/** LABEBAL_* settings: host options win over the environment. */
export function env(): Record<string, string | undefined> {
  const h = host().env;
  return h ? { ...process.env, ...h } : process.env;
}

export const featureOn = (name: keyof NonNullable<LabebalServerOptions["features"]>) => host().features?.[name] !== false;

/** Root of labebal's runtime files. */
export function filesDir(): string {
  const set = host().filesDir ?? env().LABEBAL_FILES_DIR;
  if (set) return path.resolve(set);
  return (found ??= findFiles());
}

let found: string | undefined;

/** The package folder, or (when a bundler moved this code) the installed package under the working directory. */
function findFiles(): string {
  const candidates: string[] = [];
  try {
    // src/server/host.ts or dist/server/host.js -> package root.
    candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  } catch {
    // A bundler gave this module a URL that isn't a file.
  }
  candidates.push(path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "@labebal", "app"));
  return candidates.find((d) => existsSync(path.join(d, "drizzle", "meta"))) ?? candidates[0];
}

export const migrationsFolder = () => path.join(filesDir(), "drizzle");
export const assetsDir = () => path.join(filesDir(), "assets");
export const builtinPacksDir = () => env().LABEBAL_BUILTIN_PACKS ?? path.join(filesDir(), "packs", "examples");

/* ---- per-request identity, resolved once by the handler ---------------- */

const resolved = new WeakMap<Request, Identity>();

export function rememberIdentity(req: Request, id: Identity) {
  resolved.set(req, id);
}

export function resolvedIdentity(req: unknown): Identity | undefined {
  return typeof req === "object" && req ? resolved.get(req as Request) : undefined;
}

export function identityOfUser(u: HostUser | null, anonymousRole: Role): Identity {
  if (!u) return { enabled: true, signedIn: false, user: "", email: "", name: "", groups: [], role: anonymousRole, display: "" };
  const name = u.name ?? "";
  const email = u.email ?? "";
  return { enabled: true, signedIn: true, user: u.id, email, name, groups: u.groups ?? [], role: u.role, display: name || u.id || email };
}
