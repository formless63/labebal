/**
 * GitHub integration: pure rules shared by the server, the browser and the
 * tests (no server or browser APIs). The server side is server/github*.ts.
 *
 * - Device flow ("Connect GitHub"): a small state machine over GitHub's
 *   documented answers (authorization_pending, slow_down, expired_token,
 *   access_denied). The browser polls our status endpoint; each status call
 *   polls GitHub at most once per `interval`.
 * - Publishing: which files a commit adds / changes / removes in a pack
 *   folder, the collection file, version bumps and the commit message.
 */
import { compareVersions, PACK_COLLECTION, PACK_MANIFEST, PACK_SCHEMA_BASE } from "@labebal/core";

/* ------------------------------------------------------------ views (API) */

export interface GithubAccountView {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
  kind: "app" | "token";
  githubId: number;
  /** Commit author e-mail (override or the GitHub noreply address). */
  commitEmail: string;
  commitEmailOverride: string | null;
  defaultRepo: string | null;
  status: "ok" | "reconnect";
  lastError: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface GithubRepoView {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canWrite: boolean;
  htmlUrl: string;
  description: string;
}

export interface GithubConfigView {
  /** "Connect GitHub" (device flow) is available. */
  app: boolean;
  /** github.com/apps/<slug>/installations/new, when the slug is known. */
  installUrl: string | null;
  /** Fine-grained token page, prefilled (write: publishing; read: following). */
  tokenUrl: string;
  readTokenUrl: string;
  /** Classic token page (fallback). */
  classicTokenUrl: string;
  /** Where accounts are kept: "user" (signed in), "instance" (no identity), null (sign in first). */
  scope: "user" | "instance" | null;
  /** Talking to a test / dev GitHub (LABEBAL_GITHUB_API_URL), not github.com. */
  mock: boolean;
}

export interface DeviceStartView {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
}

export interface DeviceStatusView {
  status: DeviceStatus;
  error?: string;
  account?: GithubAccountView;
}

export interface PublishedPackView {
  id: string;
  packId: string;
  accountId: string | null;
  accountLogin: string | null;
  owner: string;
  repo: string;
  branch: string;
  dir: string;
  name: string;
  description: string;
  author: string;
  folder: string;
  version: string;
  templateIds: string[];
  labelIds: string[];
  datasets: boolean;
  commitUrl: string;
  publishedBy: string;
  publishedAt: string;
  /** Items changed / added / gone here since the last publish. */
  changedSince: number;
  htmlUrl: string;
}

export interface PublishResult {
  unchanged: boolean;
  version: string;
  commitSha: string;
  commitUrl: string;
  htmlUrl: string;
  summary: ItemSummary;
  files: { added: number; changed: number; removed: number };
  message: string;
}

/* ------------------------------------------------------------ device flow */

export type DeviceStatus = "pending" | "done" | "denied" | "expired" | "error";

export interface DeviceSession {
  id: string;
  scope: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between polls (grows on slow_down). */
  interval: number;
  expiresAt: number;
  nextPollAt: number;
  status: DeviceStatus;
  error?: string;
  accountId?: string;
}

/** POST github.com/login/device/code answer. */
export interface DeviceCodeAnswer {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

/** POST github.com/login/oauth/access_token answer while polling. */
export interface DeviceTokenAnswer {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export function startDevice(id: string, scope: string, a: DeviceCodeAnswer, now: number): DeviceSession {
  const interval = Math.max(1, a.interval ?? 5);
  return {
    id,
    scope,
    deviceCode: a.device_code,
    userCode: a.user_code,
    verificationUri: a.verification_uri,
    interval,
    expiresAt: now + Math.max(60, a.expires_in) * 1000,
    nextPollAt: now + interval * 1000,
    status: "pending",
  };
}

/** Pending sessions that ran out of time become "expired". */
export function expireDevice(s: DeviceSession, now: number): DeviceSession {
  return s.status === "pending" && now >= s.expiresAt ? { ...s, status: "expired", error: "The code expired. Start again." } : s;
}

/** Time to ask GitHub again (never earlier than `interval` after the last ask). */
export const devicePollDue = (s: DeviceSession, now: number) => s.status === "pending" && now >= s.nextPollAt && now < s.expiresAt;

/** Apply one token-poll answer. `token` is set (and status "done") on success. */
export function afterDevicePoll(s: DeviceSession, a: DeviceTokenAnswer, now: number): { session: DeviceSession; token?: string } {
  if (a.access_token) return { session: { ...s, status: "done" }, token: a.access_token };
  switch (a.error) {
    case "authorization_pending":
      return { session: { ...s, nextPollAt: now + s.interval * 1000 } };
    case "slow_down": {
      // GitHub sends the new minimum interval; otherwise add 5 s (RFC 8628).
      const interval = Math.max(s.interval + 5, a.interval ?? 0);
      return { session: { ...s, interval, nextPollAt: now + interval * 1000 } };
    }
    case "expired_token":
      return { session: { ...s, status: "expired", error: "The code expired. Start again." } };
    case "access_denied":
      return { session: { ...s, status: "denied", error: "Cancelled on GitHub." } };
    default:
      return { session: { ...s, status: "error", error: a.error_description || a.error || "GitHub did not answer as expected" } };
  }
}

/* ------------------------------------------------------------ accounts */

export const noreplyEmail = (id: number, login: string) => `${id}+${login}@users.noreply.github.com`;

/** owner / repo names GitHub accepts. */
export const GH_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/** "owner/repo" or a github.com URL -> parts. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const [owner, repo, ...rest] = s.split("/");
  if (!owner || !repo || rest.length || !GH_NAME.test(owner) || !GH_NAME.test(repo)) return null;
  return { owner, repo };
}

/** Folder inside a repo: "" (root) or a/b/c without dots-only or empty parts. */
export function cleanDir(dir: string): string | null {
  const parts = dir
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || !/^[\w.@ -]{1,100}$/.test(p))) return null;
  return parts.join("/");
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

/**
 * Fine-grained token page prefilled with URL parameters (GitHub, Aug 2025:
 * name <= 40 chars, description, expires_in 1-366 | none, <permission>=read|write).
 * GitHub can't preselect repositories by URL: the person picks them on the page.
 */
export function tokenCreateUrl(web: string, mode: "write" | "read" = "write") {
  return `${web}/settings/personal-access-tokens/new?${q({
    name: mode === "write" ? "labebal packs" : "labebal packs (read)",
    description: mode === "write" ? "Lets labebal publish label packs to the repositories you pick." : "Lets labebal read label packs from the repositories you pick.",
    expires_in: "none",
    contents: mode,
    metadata: "read",
  })}`;
}

export const classicTokenUrl = (web: string) => `${web}/settings/tokens/new?${q({ scopes: "repo", description: "labebal" })}`;

export const newRepoUrl = (web: string, name: string, priv: boolean, description: string) => `${web}/new?${q({ name, visibility: priv ? "private" : "public", description })}`;

/* ------------------------------------------------------------ publishing */

export type Bump = "patch" | "minor" | "major";

/** Next version: the highest of the known versions, bumped. No version yet: 1.0.0. */
export function nextVersion(known: (string | null | undefined)[], bump: Bump): string {
  const vs = known.filter((v): v is string => !!v && /^\d+\.\d+\.\d+/.test(v));
  if (!vs.length) return "1.0.0";
  const top = vs.sort(compareVersions).at(-1)!;
  const [maj, min, pat] = top
    .replace(/^v/, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pre = /-/.test(top.split("+")[0]);
  // 1.2.0-beta -> patch: 1.2.0 (the release of that pre-release).
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
}

/** Sub-folders a pack folder's files live in (what publishing manages; anything else is left alone). */
export const PACK_DIRS = ["templates", "labels", "datasets", "assets", "fonts"];

const join = (dir: string, p: string) => (dir ? `${dir}/${p}` : p);

/** Paths in a pack folder that publishing owns: the manifest and the item sub-folders. */
export function ownedByPack(dir: string, path: string): boolean {
  const rel = dir ? (path.startsWith(dir + "/") ? path.slice(dir.length + 1) : null) : path;
  if (rel === null) return false;
  return rel === PACK_MANIFEST || PACK_DIRS.some((d) => rel.startsWith(d + "/"));
}

export interface TreeChange {
  path: string;
  /** Blob sha (new / changed) or null (delete). */
  sha: string | null;
}

/**
 * Tree changes for one commit: `files` (paths relative to `dir`, with their
 * git blob sha) replace what the pack folder held; other files there
 * (README, ...) are kept. `extra` adds files elsewhere (the collection).
 */
export function planPublishTree(o: { dir: string; existing: { path: string; sha: string; type?: string }[]; files: { path: string; sha: string }[]; extra?: { path: string; sha: string }[] }) {
  const have = new Map(o.existing.filter((e) => !e.type || e.type === "blob").map((e) => [e.path, e.sha]));
  const changes: TreeChange[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const next = new Set<string>();
  for (const f of [...o.files.map((f) => ({ path: join(o.dir, f.path), sha: f.sha })), ...(o.extra ?? [])]) {
    next.add(f.path);
    const old = have.get(f.path);
    if (old === f.sha) continue;
    changes.push({ path: f.path, sha: f.sha });
    (old ? changed : added).push(f.path);
  }
  for (const [p] of have) {
    if (next.has(p) || !ownedByPack(o.dir, p)) continue;
    changes.push({ path: p, sha: null });
    removed.push(p);
  }
  return { changes, added, changed, removed };
}

/** Tree changes that delete a pack folder's files (and update `extra`). */
export function planRemoveTree(o: { dir: string; existing: { path: string; sha: string; type?: string }[]; extra?: { path: string; sha: string | null }[] }): TreeChange[] {
  const out: TreeChange[] = o.existing.filter((e) => (!e.type || e.type === "blob") && ownedByPack(o.dir, e.path)).map((e) => ({ path: e.path, sha: null }));
  return [...out, ...(o.extra ?? [])];
}

/** The collection file with `entry` (a manifest path) listed. `changed` false when it was already. */
export function withCollectionEntry(doc: unknown, entry: string, name: string): { doc: Record<string, unknown>; changed: boolean } {
  const base = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
  const packs = Array.isArray(base?.packs) ? (base!.packs as unknown[]).filter((p): p is string => typeof p === "string") : [];
  const norm = (p: string) => p.replace(/^\.\//, "");
  if (base && packs.some((p) => norm(p) === norm(entry))) return { doc: base, changed: false };
  return {
    doc: { $schema: `${PACK_SCHEMA_BASE}labebal-packs.schema.json`, name, ...(base ?? {}), packs: [...packs, entry].sort() },
    changed: true,
  };
}

/** The collection without `entry`. */
export function withoutCollectionEntry(doc: unknown, entry: string): { doc: Record<string, unknown>; changed: boolean } | null {
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { packs?: unknown }).packs)) return null;
  const norm = (p: string) => p.replace(/^\.\//, "");
  const packs = ((doc as { packs: unknown[] }).packs as string[]).filter((p) => norm(String(p)) !== norm(entry));
  return { doc: { ...(doc as object), packs }, changed: packs.length !== (doc as { packs: unknown[] }).packs.length };
}

export const manifestPath = (dir: string) => join(dir, PACK_MANIFEST);
export const COLLECTION_PATH = PACK_COLLECTION;

export interface ItemSummary {
  added: number;
  removed: number;
  changed: number;
  /** No record of an earlier publish (first time, or published elsewhere). */
  first: boolean;
}

/** Compare item hashes (itemKey -> hash) of the last publish and now. */
export function summarizeItems(prev: Record<string, string> | null, next: Record<string, string>): ItemSummary {
  if (!prev) return { added: Object.keys(next).length, removed: 0, changed: 0, first: true };
  let added = 0;
  let changed = 0;
  for (const [k, h] of Object.entries(next)) {
    if (!(k in prev)) added++;
    else if (prev[k] !== h) changed++;
  }
  const removed = Object.keys(prev).filter((k) => !(k in next)).length;
  return { added, removed, changed, first: false };
}

const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

export function summaryText(s: Pick<ItemSummary, "added" | "removed" | "changed">) {
  return [s.added && `${s.added} added`, s.removed && `${s.removed} removed`, s.changed && `${s.changed} changed`].filter(Boolean).join(", ") || "no item changes";
}

export function commitMessage(name: string, version: string, s: ItemSummary, files: { added: number; changed: number; removed: number }) {
  const head = s.first ? `Publish ${name} ${version}` : `${name} ${version}: ${summaryText(s)}`;
  const body = `${n(files.added, "file")} added, ${n(files.changed, "file")} changed, ${n(files.removed, "file")} removed.\n\nPublished from labebal.`;
  return `${head}\n\n${body}`;
}

/* ------------------------------------------------------------ git blobs */

/** Git object header for a blob of `size` bytes ("blob <size>\0"), hashed with SHA-1 to get the blob sha. */
export const blobHeader = (size: number) => `blob ${size}\u0000`;
