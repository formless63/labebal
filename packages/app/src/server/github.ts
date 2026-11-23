/**
 * GitHub: HTTP client (host allow-list), connected accounts and the device
 * flow ("Connect GitHub"). Pure rules: features/github/model.ts. Publishing:
 * github-publish.ts. Pack sources read through an account: packs.ts.
 *
 * Security:
 * - Tokens are only read here and in github-publish.ts; views never carry them.
 * - Requests with a token go only to the GitHub hosts (api.github.com,
 *   github.com, raw.githubusercontent.com) over HTTPS. `LABEBAL_GITHUB_API_URL`
 *   / `LABEBAL_GITHUB_URL` point them at a test server instead, and are
 *   ignored in production builds (NODE_ENV=production).
 * - A 401 marks the account "reconnect" (token revoked or expired).
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { githubAccounts } from "../db/schema";
import type { Identity } from "../features/auth/identity";
import { GITHUB_APP_CLIENT_ID_DEFAULT, GITHUB_APP_SLUG_DEFAULT } from "../features/github/app-config";
import {
  afterDevicePoll,
  classicTokenUrl,
  devicePollDue,
  expireDevice,
  newRepoUrl,
  noreplyEmail,
  startDevice,
  tokenCreateUrl,
  type DeviceCodeAnswer,
  type DeviceSession,
  type DeviceStartView,
  type DeviceStatusView,
  type DeviceTokenAnswer,
  type GithubAccountView,
  type GithubConfigView,
  type GithubRepoView,
} from "../features/github/model";
import { scopeOfUser } from "./settings";
import { env } from "./host";

export type AccountRow = typeof githubAccounts.$inferSelect;

export class GithubError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------ config */

let warned = false;

/** GitHub endpoints and App ids. Test URLs only outside production builds. */
export function githubEnv() {
  const prod = process.env.NODE_ENV === "production";
  const apiOverride = env().LABEBAL_GITHUB_API_URL?.trim();
  const webOverride = env().LABEBAL_GITHUB_URL?.trim();
  if (prod && (apiOverride || webOverride) && !warned) {
    warned = true;
    console.warn("[github] LABEBAL_GITHUB_API_URL / LABEBAL_GITHUB_URL are ignored in production builds");
  }
  const mock = !prod && !!(apiOverride || webOverride);
  const api = (mock && apiOverride ? apiOverride : "https://api.github.com").replace(/\/+$/, "");
  const web = (mock && webOverride ? webOverride : "https://github.com").replace(/\/+$/, "");
  return {
    api,
    web,
    mock,
    clientId: (env().LABEBAL_GITHUB_CLIENT_ID ?? GITHUB_APP_CLIENT_ID_DEFAULT).trim(),
    slug: (env().LABEBAL_GITHUB_APP_SLUG ?? GITHUB_APP_SLUG_DEFAULT).trim(),
  };
}

/** Hosts a token may be sent to. */
function allowedOrigins() {
  const e = githubEnv();
  const set = new Set(["https://api.github.com", "https://github.com", "https://raw.githubusercontent.com"]);
  if (e.mock) {
    set.add(new URL(e.api).origin);
    set.add(new URL(e.web).origin);
  }
  return set;
}

export function githubConfigView(me: Identity): GithubConfigView {
  const e = githubEnv();
  const scope = ownScope(me);
  return {
    app: !!e.clientId,
    installUrl: e.slug ? `${e.web}/apps/${encodeURIComponent(e.slug)}/installations/new` : null,
    tokenUrl: tokenCreateUrl(e.web, "write"),
    readTokenUrl: tokenCreateUrl(e.web, "read"),
    classicTokenUrl: classicTokenUrl(e.web),
    scope: scope === null ? null : scope === "instance" ? "instance" : "user",
    mock: e.mock,
  };
}

export const installUrl = () => {
  const e = githubEnv();
  return e.slug ? `${e.web}/apps/${encodeURIComponent(e.slug)}/installations/new` : null;
};

/* ------------------------------------------------------------ HTTP */

export interface GhResponse {
  status: number;
  headers: Headers;
  body: Buffer;
  text: () => string;
  json: <T = unknown>() => T;
}

export interface GhOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string | null;
  /** JSON body. */
  json?: unknown;
  /** Form body (github.com OAuth endpoints). */
  form?: Record<string, string>;
  accept?: string;
  etag?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
}

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * One request to GitHub. `url` is a path on the API ("/user") or an absolute
 * URL on an allowed GitHub host. Redirects are followed only to allowed
 * hosts, and the token only to the same origin. Non-2xx answers are returned.
 */
export async function ghFetch(url: string, o: GhOptions = {}): Promise<GhResponse> {
  const e = githubEnv();
  let target = new URL(url.startsWith("/") ? `${e.api}${url}` : url);
  const allowed = allowedOrigins();
  const origin0 = target.origin;
  for (let hop = 0; hop < 4; hop++) {
    if (!allowed.has(target.origin)) throw new GithubError(`refusing to contact ${target.host}: not a GitHub host`);
    if (target.protocol !== "https:" && !e.mock) throw new GithubError("GitHub is only contacted over HTTPS");
    const headers: Record<string, string> = {
      "user-agent": "labebal",
      accept: o.accept ?? "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
    if (o.token && target.origin === origin0) headers.authorization = `Bearer ${o.token}`;
    if (o.etag) headers["if-none-match"] = o.etag;
    let body: string | undefined;
    if (o.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.json);
    } else if (o.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(o.form).toString();
    }
    let res: Response;
    try {
      res = await fetch(target, { method: o.method ?? "GET", headers, body, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
    } catch (err) {
      throw new GithubError(`could not reach GitHub (${(err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message})`, 502);
    }
    const loc = res.headers.get("location");
    if ([301, 302, 307, 308].includes(res.status) && loc) {
      target = new URL(loc, target);
      continue;
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    const max = o.maxBytes ?? MAX_BYTES;
    if (len > max) throw new GithubError(`GitHub answer too large (${Math.round(len / 1024 / 1024)} MB)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new GithubError("GitHub answer too large");
    return {
      status: res.status,
      headers: res.headers,
      body: buf,
      text: () => buf.toString("utf8"),
      json: <T,>() => (buf.length ? JSON.parse(buf.toString("utf8")) : null) as T,
    };
  }
  throw new GithubError("too many redirects from GitHub");
}

/** GitHub's error text from an answer. */
export function ghMessage(r: GhResponse): string {
  try {
    const j = r.json<{ message?: string; errors?: { message?: string }[] }>();
    const extra = j?.errors?.map((x) => x.message).filter(Boolean).join("; ");
    return `${j?.message ?? `HTTP ${r.status}`}${extra ? ` (${extra})` : ""}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

/* ------------------------------------------------------------ accounts */

/** Where this person's accounts live: their user scope, "instance" with identity off, null when anonymous. */
export function ownScope(me: Identity): string | null {
  return scopeOfUser(me) ?? (me.enabled ? null : "instance");
}

export function accountView(r: AccountRow): GithubAccountView {
  return {
    id: r.id,
    login: r.login,
    name: r.name,
    avatarUrl: r.avatarUrl,
    kind: r.kind,
    githubId: r.githubId,
    commitEmail: r.commitEmail || noreplyEmail(r.githubId, r.login),
    commitEmailOverride: r.commitEmail,
    defaultRepo: r.defaultRepo,
    status: r.status,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  };
}

export async function listAccounts(scope: string): Promise<GithubAccountView[]> {
  const db = await getDb();
  return (await db.select().from(githubAccounts).where(eq(githubAccounts.scope, scope)).orderBy(asc(githubAccounts.createdAt))).map(accountView);
}

/** An account of this scope (null when it isn't theirs). */
export async function accountRow(scope: string, id: string): Promise<AccountRow | null> {
  const db = await getDb();
  const [r] = await db
    .select()
    .from(githubAccounts)
    .where(and(eq(githubAccounts.scope, scope), eq(githubAccounts.id, id)));
  return r ?? null;
}

/** Any account by id (server-side reads for pack sources). */
export async function accountById(id: string): Promise<AccountRow | null> {
  const db = await getDb();
  const [r] = await db.select().from(githubAccounts).where(eq(githubAccounts.id, id));
  return r ?? null;
}

interface GhUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string;
}

async function fetchUser(token: string): Promise<GhUser> {
  const r = await ghFetch("/user", { token });
  if (r.status === 401) throw new GithubError("GitHub did not accept this token (it may be mistyped, expired or revoked)", 400);
  if (r.status !== 200) throw new GithubError(`GitHub: ${ghMessage(r)}`, 502);
  const u = r.json<GhUser>();
  if (!u?.login || typeof u.id !== "number") throw new GithubError("GitHub did not say who this token belongs to", 502);
  return u;
}

/** Save (or refresh) an account: one row per scope + GitHub user + kind. */
async function saveAccount(scope: string, kind: "app" | "token", token: string, u: GhUser): Promise<AccountRow> {
  const db = await getDb();
  const values = { scope, githubId: u.id, login: u.login, name: u.name ?? "", avatarUrl: u.avatar_url ?? "", kind, token, status: "ok" as const, lastError: null, lastUsedAt: new Date() };
  const [row] = await db
    .insert(githubAccounts)
    .values({ id: `gh-${crypto.randomUUID().slice(0, 8)}`, ...values })
    .onConflictDoUpdate({ target: [githubAccounts.scope, githubAccounts.githubId, githubAccounts.kind], set: values })
    .returning();
  return row;
}

/** "Use a token instead": check it with GitHub (and the repo, when given) before saving. */
export async function addTokenAccount(scope: string, token: string, repo?: { owner: string; repo: string } | null): Promise<{ account: GithubAccountView; repo?: GithubRepoView }> {
  const t = token.trim();
  if (!/^[\w-]{20,255}$/.test(t)) throw new GithubError("That doesn't look like a GitHub token (they start with github_pat_ or ghp_)");
  const u = await fetchUser(t);
  let rv: GithubRepoView | undefined;
  if (repo) {
    const r = await ghFetch(`/repos/${repo.owner}/${repo.repo}`, { token: t });
    if (r.status === 404 || r.status === 403) throw new GithubError(`This token can't see ${repo.owner}/${repo.repo}. On GitHub, add that repository to the token ("Repository access").`);
    if (r.status !== 200) throw new GithubError(`GitHub: ${ghMessage(r)}`, 502);
    rv = repoView(r.json());
  }
  const row = await saveAccount(scope, "token", t, u);
  return { account: accountView(row), ...(rv ? { repo: rv } : {}) };
}

export async function deleteAccount(scope: string, id: string) {
  const db = await getDb();
  const r = await db
    .delete(githubAccounts)
    .where(and(eq(githubAccounts.scope, scope), eq(githubAccounts.id, id)))
    .returning({ id: githubAccounts.id });
  return r.length > 0;
}

export async function patchAccount(scope: string, id: string, p: { commitEmail?: string | null; defaultRepo?: string | null }) {
  const db = await getDb();
  const set: Partial<AccountRow> = {};
  if (p.commitEmail !== undefined) set.commitEmail = p.commitEmail?.trim() || null;
  if (p.defaultRepo !== undefined) set.defaultRepo = p.defaultRepo?.trim() || null;
  if (!Object.keys(set).length) return accountRow(scope, id).then((r) => (r ? accountView(r) : null));
  const [r] = await db
    .update(githubAccounts)
    .set(set)
    .where(and(eq(githubAccounts.scope, scope), eq(githubAccounts.id, id)))
    .returning();
  return r ? accountView(r) : null;
}

/**
 * Call GitHub as an account: notes when it was last used; a 401 marks the
 * account "reconnect" and throws a plain-language error.
 */
export async function asAccount(acc: AccountRow, url: string, o: Omit<GhOptions, "token"> = {}): Promise<GhResponse> {
  if (acc.status === "reconnect") throw new GithubError(`GitHub no longer accepts the sign-in for ${acc.login}. Reconnect it in Settings > Packs.`, 401);
  const r = await ghFetch(url, { ...o, token: acc.token });
  const db = await getDb();
  if (r.status === 401) {
    await db.update(githubAccounts).set({ status: "reconnect", lastError: "GitHub answered 401 (token revoked or expired)" }).where(eq(githubAccounts.id, acc.id));
    acc.status = "reconnect";
    throw new GithubError(`GitHub no longer accepts the sign-in for ${acc.login}. Reconnect it in Settings > Packs.`, 401);
  }
  // Cheap bookkeeping: at most once a minute.
  if (!acc.lastUsedAt || Date.now() - acc.lastUsedAt.getTime() > 60_000) {
    acc.lastUsedAt = new Date();
    await db.update(githubAccounts).set({ lastUsedAt: acc.lastUsedAt }).where(eq(githubAccounts.id, acc.id));
  }
  return r;
}

/** Throw a GithubError for non-2xx answers (with GitHub's message). */
export function ok(r: GhResponse, what: string): GhResponse {
  if (r.status >= 200 && r.status < 300) return r;
  if (r.status === 404) throw new GithubError(`${what}: not found (or this account can't see it)`, 404);
  if (r.status === 403) throw new GithubError(`${what}: GitHub refused (${ghMessage(r)})`, 403);
  throw new GithubError(`${what}: ${ghMessage(r)}`, r.status === 409 || r.status === 422 ? 409 : 502);
}

/* ------------------------------------------------------------ device flow */

const g = globalThis as unknown as { __labebalDevice?: Map<string, DeviceSession & { polling?: boolean }> };
const sessions = () => (g.__labebalDevice ??= new Map());

function sweep(now: number) {
  for (const [id, s] of sessions()) if (now > s.expiresAt + 10 * 60_000) sessions().delete(id);
}

/** "Connect GitHub": ask GitHub for a device code; the browser shows the user code. */
export async function startDeviceFlow(scope: string): Promise<DeviceStartView> {
  const e = githubEnv();
  if (!e.clientId) throw new GithubError("Connect GitHub isn't set up on this server: use a token instead");
  const now = Date.now();
  sweep(now);
  const r = await ghFetch(`${e.web}/login/device/code`, { method: "POST", form: { client_id: e.clientId }, accept: "application/json" });
  const a = r.json<DeviceCodeAnswer & { error?: string; error_description?: string }>();
  if (r.status !== 200 || !a?.device_code) throw new GithubError(`GitHub: ${a?.error_description ?? a?.error ?? ghMessage(r)}`, 502);
  const s = startDevice(`dv-${crypto.randomUUID()}`, scope, a, now);
  sessions().set(s.id, s);
  return { id: s.id, userCode: s.userCode, verificationUri: s.verificationUri, expiresAt: new Date(s.expiresAt).toISOString(), interval: s.interval };
}

/**
 * Status of a device-flow session, polling GitHub once when due (never more
 * often than GitHub's interval). On success the account is saved.
 */
export async function deviceStatus(scope: string, id: string): Promise<DeviceStatusView | null> {
  const now = Date.now();
  let s = sessions().get(id);
  if (!s || s.scope !== scope) return null;
  s = { ...expireDevice(s, now), polling: s.polling };
  sessions().set(id, s);
  if (devicePollDue(s, now) && !s.polling) {
    const e = githubEnv();
    sessions().set(id, { ...s, polling: true });
    try {
      const r = await ghFetch(`${e.web}/login/oauth/access_token`, {
        method: "POST",
        form: { client_id: e.clientId, device_code: s.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
        accept: "application/json",
      });
      const a = r.json<DeviceTokenAnswer>() ?? {};
      const next = afterDevicePoll(s, r.status === 200 || a.error ? a : { error: "http", error_description: `GitHub answered ${r.status}` }, Date.now());
      s = next.session;
      if (next.token) {
        const u = await fetchUser(next.token);
        const row = await saveAccount(scope, "app", next.token, u);
        s = { ...s, accountId: row.id };
      }
    } catch (err) {
      // Network trouble: try again at the next interval.
      s = { ...s, nextPollAt: Date.now() + s.interval * 1000, ...(err instanceof GithubError && err.status !== 502 ? { status: "error" as const, error: err.message } : {}) };
    }
    sessions().set(id, { ...s, polling: false });
  }
  const view: DeviceStatusView = { status: s.status, ...(s.error ? { error: s.error } : {}) };
  if (s.accountId) {
    const row = await accountRow(scope, s.accountId);
    if (row) view.account = accountView(row);
  }
  return view;
}

export function cancelDevice(scope: string, id: string) {
  const s = sessions().get(id);
  if (s && s.scope === scope) sessions().delete(id);
}

/** Test hook: drop all device sessions. */
export const resetDeviceSessions = () => sessions().clear();

/* ------------------------------------------------------------ repos */

interface GhRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch?: string;
  permissions?: { push?: boolean; admin?: boolean };
  html_url: string;
  description?: string | null;
  size?: number;
}

export const repoView = (r: GhRepo): GithubRepoView => ({
  owner: r.owner.login,
  name: r.name,
  fullName: r.full_name,
  private: r.private,
  defaultBranch: r.default_branch || "main",
  canWrite: !!(r.permissions?.push || r.permissions?.admin),
  htmlUrl: r.html_url,
  description: r.description ?? "",
});

/**
 * Repositories an account can reach. App accounts: the repos of the App's
 * installations the person can access (the App only sees repos it is
 * installed on). Tokens: their repos.
 */
export async function listRepos(acc: AccountRow): Promise<{ repos: GithubRepoView[]; installations: number }> {
  const out: GithubRepoView[] = [];
  if (acc.kind === "app") {
    const inst = ok(await asAccount(acc, "/user/installations?per_page=100"), "Installations").json<{ installations: { id: number }[] }>();
    for (const i of inst.installations ?? []) {
      for (let page = 1; page <= 10; page++) {
        const r = ok(await asAccount(acc, `/user/installations/${i.id}/repositories?per_page=100&page=${page}`), "Repositories").json<{ repositories: GhRepo[] }>();
        out.push(...(r.repositories ?? []).map(repoView));
        if ((r.repositories ?? []).length < 100) break;
      }
    }
    return { repos: dedupe(out), installations: inst.installations?.length ?? 0 };
  }
  for (let page = 1; page <= 5; page++) {
    const r = ok(await asAccount(acc, `/user/repos?per_page=100&sort=pushed&page=${page}`), "Repositories").json<GhRepo[]>();
    out.push(...r.map(repoView));
    if (r.length < 100) break;
  }
  return { repos: dedupe(out), installations: 0 };
}

const dedupe = (rs: GithubRepoView[]) => [...new Map(rs.map((r) => [r.fullName.toLowerCase(), r])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));

export async function getRepo(acc: AccountRow, owner: string, repo: string): Promise<GithubRepoView & { empty: boolean }> {
  const r = ok(await asAccount(acc, `/repos/${owner}/${repo}`), `${owner}/${repo}`).json<GhRepo>();
  return { ...repoView(r), empty: r.size === 0 };
}

export interface CreateRepoResult {
  created: boolean;
  repo?: GithubRepoView;
  /** Created, but the App can't reach it yet: add it on the App's install page. */
  needsInstall?: boolean;
  installUrl?: string | null;
  /** GitHub refused to let us create it: create it on github.com (prefilled), then come back. */
  newRepoUrl?: string;
  reason?: string;
}

/**
 * "Create a repo for my packs". GitHub App user tokens can create repos when
 * the App has "Administration: write"; a fine-grained token needs the same
 * on "All repositories". Otherwise we hand over a prefilled github.com/new.
 */
export async function createRepo(acc: AccountRow, p: { name: string; private: boolean; description: string }): Promise<CreateRepoResult> {
  const e = githubEnv();
  const fallback = newRepoUrl(e.web, p.name, p.private, p.description);
  const r = await asAccount(acc, "/user/repos", { method: "POST", json: { name: p.name, private: p.private, description: p.description, auto_init: true, has_issues: true, has_wiki: false } });
  if (r.status === 422) {
    const msg = ghMessage(r);
    if (/already exists/i.test(msg)) throw new GithubError(`You already have a repository called ${p.name}. Pick it from the list, or choose another name.`, 409);
    throw new GithubError(`GitHub: ${msg}`, 400);
  }
  if (r.status === 403 || r.status === 404) return { created: false, newRepoUrl: fallback, reason: ghMessage(r) };
  ok(r, "Create repository");
  const repo = repoView(r.json<GhRepo>());
  // An App installed on "only select repositories" doesn't see the new repo until it is added.
  const check = await asAccount(acc, `/repos/${repo.owner}/${repo.name}`);
  if (check.status === 404 || check.status === 403) return { created: true, repo, needsInstall: true, installUrl: installUrl() };
  return { created: true, repo };
}
