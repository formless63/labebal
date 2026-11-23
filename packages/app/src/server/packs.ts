/**
 * Packs repository: sources (links to pack repos / files), installed packs
 * and the library items they own. Pure rules (formats, merge plans) are in
 * core `pack.ts`; this file does the fetching and the writes.
 *
 * - Remote sources are read with the SSRF-guarded `safeFetch`; a source's
 *   token goes only to its own host (`tokenHost`) and never to the browser.
 * - Built-in packs are read from disk: Examples (`packs/examples`, or
 *   LABEBAL_BUILTIN_PACKS), listed but not installed by default, and
 *   Standard formats (its sibling folder `standards`), installed once the
 *   first time it is offered (turn it off or remove it in Settings > Packs).
 * - Installed items are normal library rows; `label_pack_items` records the
 *   pack's version of each (hash + doc) so updates can tell what was
 *   changed here and "reset to pack version" can restore it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import {
  PACK_MANIFEST,
  PackError,
  checkPack,
  compareVersions,
  itemHash,
  itemKey,
  labelFolder,
  listPackEntries,
  loadPack,
  packFiles,
  planPackRemove,
  planPackSync,
  resolveSourceInput,
  sanitizeSvg,
  setLabelFolder,
  type Dataset,
  type ExistingItem,
  type IncomingItem,
  type Label,
  type PackAction,
  type PackItemKind,
  type PackReader,
  type ResolvedPack,
  type SharedAsset,
  type Template,
  zipFiles,
} from "@labebal/core";
import { getDb, type DB } from "../db";
import { assets, datasets, labels, packItems, packSourceGithub, packSources, packUpdateSkips, packs, templates, type PackListing, type PackSourceIndex } from "../db/schema";
import type { InstalledPackView, PackSourceView, PacksView, PackUpdatePreview, PackUpdateSummary, RemovePlanView, SyncResult, UpdateItemView } from "../features/packs/types";
import { getDataset, writeDataset } from "./datasets";
import { SHARE_MIME, labelRow, toLabel, usedAssets } from "./library";
import { FetchError, safeFetch } from "./safe-fetch";
import { accountById, asAccount, ghMessage, GithubError, type AccountRow } from "./github";
import { snapshotOnSave } from "./versions";
import { builtinPacksDir } from "./host";

export const BUILTIN_SOURCE_ID = "builtin-examples";
export const EXAMPLES_PACK_ID = "examples";
export const STANDARDS_PACK_ID = "standards";
export const WELCOME_PACK_ID = "welcome";

const builtinDir = builtinPacksDir;
/** Folders of the built-in packs: Examples, then Standard formats beside it. */
const builtinDirs = () => {
  const examples = path.resolve(builtinDir());
  return [examples, ...["standards", "welcome"].map((d) => path.join(/* turbopackIgnore: true */ path.dirname(examples), d))];
};
const builtinManifestUrl = () => pathToFileURL(path.join(builtinDir(), PACK_MANIFEST)).href;
const builtinManifestUrls = () => builtinDirs().map((d) => pathToFileURL(path.join(d, PACK_MANIFEST)).href);

/** Listing of every built-in pack that is there (a missing folder is skipped). */
async function builtinIndex(reader: PackReader): Promise<{ index: PackSourceIndex; loaded: ResolvedPack[] }> {
  const index: PackSourceIndex = { kind: "collection", name: "Built-in packs", packs: [], errors: [] };
  const loaded: ResolvedPack[] = [];
  for (const url of builtinManifestUrls()) {
    try {
      const pack = await loadPack(url, reader, { withAssets: false });
      loaded.push(pack);
      index.packs.push(listing(pack, url));
    } catch (e) {
      if (/ENOENT|not found/i.test(errText(e))) continue;
      index.errors.push({ url, error: errText(e) });
    }
  }
  return { index, loaded };
}

const MAX_FILE = 20 * 1024 * 1024;

type SourceRow = typeof packSources.$inferSelect;

/* ---------------------------------------------------------------- readers */

/** Built-in packs: only files under the built-in pack folders. */
function builtinReader(): PackReader {
  const roots = builtinDirs();
  const local = (u: string) => {
    const url = new URL(u);
    if (url.protocol !== "file:") throw new PackError(`built-in packs read local files only (${u})`);
    const p = path.resolve(fileURLToPath(url));
    if (!roots.some((root) => p === root || p.startsWith(root + path.sep))) throw new PackError(`${u} is outside the built-in packs folder`);
    return p;
  };
  return {
    text: async (u) => readFile(local(u), "utf8"),
    bytes: async (u) => new Uint8Array(await readFile(local(u))),
  };
}

/** Remote packs: SSRF-guarded fetch; the token only goes to `tokenHost`. */
function remoteReader(token: string | null, tokenHost: string): PackReader {
  const get = async (u: string) => {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new PackError(`only http(s) files can be read from a source (${u})`);
    const headers: Record<string, string> = {};
    if (token && url.host === tokenHost) headers.authorization = `Bearer ${token}`;
    const res = await safeFetch(u, { headers, maxBytes: MAX_FILE, timeoutMs: 20_000 });
    if (res.status === 404) throw new PackError(`not found (404)${token ? "" : ": a private repo needs an access token"}`);
    if (res.status === 401 || res.status === 403) throw new PackError(`access denied (${res.status}): check the source's access token`);
    if (res.status < 200 || res.status >= 300) throw new PackError(`HTTP ${res.status}`);
    return res;
  };
  return {
    text: async (u) => (await get(u)).text,
    bytes: async (u) => new Uint8Array((await get(u)).body),
  };
}

const readerFor = (s: Pick<SourceRow, "kind" | "token" | "tokenHost">) => (s.kind === "builtin" ? builtinReader() : remoteReader(s.token, s.tokenHost));

type GithubLink = typeof packSourceGithub.$inferSelect;

/** raw.githubusercontent.com prefix of a GitHub source (how its pack URLs are written). */
const rawPrefix = (l: Pick<GithubLink, "owner" | "repo" | "ref">) => `https://raw.githubusercontent.com/${l.owner}/${l.repo}/${encodeURIComponent(l.ref).replace(/%2F/g, "/")}/`;

/**
 * GitHub sources read with a connected account: the source's raw URLs are
 * read through the API (`/repos/{o}/{r}/contents/{path}?ref=<sha>`), pinned to
 * the commit seen at the last check, with the account's token.
 */
function githubReader(acc: AccountRow, l: GithubLink, sha: string): PackReader {
  const prefix = rawPrefix(l);
  const get = async (u: string) => {
    if (!u.startsWith(prefix)) throw new PackError(`${u} is outside ${l.owner}/${l.repo}`);
    const p = decodeURIComponent(new URL(u).pathname.slice(new URL(prefix).pathname.length));
    if (p.split("/").some((x) => x === "..")) throw new PackError(`bad path ${p}`);
    const r = await asAccount(acc, `/repos/${l.owner}/${l.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`, { accept: "application/vnd.github.raw+json", maxBytes: MAX_FILE });
    if (r.status === 404) throw new PackError(`not found (404): ${p}`);
    if (r.status === 403) throw new PackError(`access denied (403): ${l.owner}/${l.repo} (${ghMessage(r)})`);
    if (r.status !== 200) throw new PackError(`HTTP ${r.status}: ${ghMessage(r)}`);
    return r.body;
  };
  return { text: async (u) => (await get(u)).toString("utf8"), bytes: async (u) => new Uint8Array(await get(u)) };
}

async function githubLink(db: DB, sourceId: string): Promise<GithubLink | null> {
  const [l] = await db.select().from(packSourceGithub).where(eq(packSourceGithub.sourceId, sourceId));
  return l ?? null;
}

/**
 * Commit SHA of a GitHub source's ref (cheap: `Accept: application/vnd.github.sha`
 * and the last ETag, so an unchanged repo answers 304 without counting
 * against the rate limit). `changed` false when it is the same commit.
 */
async function githubHead(acc: AccountRow, l: GithubLink): Promise<{ sha: string; etag: string | null; changed: boolean }> {
  const r = await asAccount(acc, `/repos/${l.owner}/${l.repo}/commits/${encodeURIComponent(l.ref)}`, { accept: "application/vnd.github.sha", etag: l.sha ? l.etag : null });
  if (r.status === 304 && l.sha) return { sha: l.sha, etag: l.etag, changed: false };
  if (r.status === 404 || r.status === 422) throw new PackError(`${l.owner}/${l.repo}${l.ref === "HEAD" ? "" : `@${l.ref}`}: not found, or ${acc.login} can't see it`);
  if (r.status !== 200) throw new PackError(`GitHub: ${ghMessage(r)}`);
  const sha = r.text().trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new PackError("GitHub did not return a commit");
  return { sha, etag: r.headers.get("etag"), changed: sha !== l.sha };
}

/** Reader for a source: built-in, GitHub through an account (pinned to `sha`), or plain HTTP. */
async function readerForSource(db: DB, s: SourceRow, sha?: string): Promise<PackReader> {
  if (s.kind === "url") {
    const l = await githubLink(db, s.id);
    if (l?.accountId) {
      const acc = await accountById(l.accountId);
      if (!acc) throw new PackError("the GitHub account this source used was disconnected: choose another one");
      return githubReader(acc, l, sha ?? l.sha ?? (await githubHead(acc, l)).sha);
    }
  }
  return readerFor(s);
}

/* ---------------------------------------------------------------- sources */

const listing = (p: ResolvedPack, url: string): PackListing => ({
  id: p.manifest.id,
  name: p.manifest.name,
  version: p.manifest.version,
  ...(p.manifest.description ? { description: p.manifest.description } : {}),
  ...(p.manifest.author ? { author: p.manifest.author } : {}),
  ...(p.manifest.homepage ? { homepage: p.manifest.homepage } : {}),
  ...(p.manifest.folder ? { folder: p.manifest.folder } : {}),
  url,
  counts: {
    templates: p.templates.length,
    labels: p.labels.length,
    datasets: p.datasets.length,
    assets: p.assets.filter((a) => a.kind !== "font").length,
    fonts: p.assets.filter((a) => a.kind === "font").length,
  },
  templates: p.templates,
  labels: p.labels,
  warnings: checkPack(p).map((i) => `${i.level === "error" ? "Error: " : ""}${i.file ? `${i.file}: ` : ""}${i.message}`),
});

/** Read a source's listing: the first candidate URL that answers. */
async function fetchIndex(s: Pick<SourceRow, "kind" | "input" | "token" | "tokenHost">, readerIn?: PackReader): Promise<{ url: string; index: PackSourceIndex }> {
  const reader = readerIn ?? readerFor(s);
  if (s.kind === "builtin") return { url: builtinManifestUrl(), index: (await builtinIndex(reader)).index };
  const candidates = (() => {
    const r = resolveSourceInput(s.input);
    return [r.url, ...r.fallbacks];
  })();
  let lastErr: unknown = null;
  for (const url of candidates) {
    let list;
    try {
      list = await listPackEntries(url, reader);
    } catch (e) {
      lastErr = e;
      if (/not found|ENOENT/.test(String((e as Error).message))) continue;
      throw e;
    }
    const index: PackSourceIndex = { kind: list.kind, ...(list.name ? { name: list.name } : {}), ...(list.description ? { description: list.description } : {}), packs: [], errors: [] };
    for (const e of list.entries) {
      try {
        index.packs.push(listing(await loadPack(e.url, reader, { withAssets: false }, e.doc), e.url));
      } catch (err) {
        index.errors.push({ url: e.url, error: (err as Error).message ?? String(err) });
      }
    }
    return { url, index };
  }
  throw lastErr instanceof Error ? lastErr : new PackError("nothing found at this link");
}

const sourceView = (s: SourceRow, account: { id: string; login: string } | null = null): PackSourceView => ({
  id: s.id,
  kind: s.kind,
  input: s.input,
  url: s.url,
  name: s.name || s.index?.name || (s.index?.packs.length === 1 ? s.index.packs[0].name : s.input),
  hasToken: !!s.token,
  tokenHost: s.tokenHost,
  account,
  lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
  lastError: s.lastError,
  index: s.index ?? null,
});

/** Source view with its GitHub account (login only). */
async function sourceViewIn(db: DB, s: SourceRow): Promise<PackSourceView> {
  const l = await githubLink(db, s.id);
  const acc = l?.accountId ? await accountById(l.accountId) : null;
  return sourceView(s, acc ? { id: acc.id, login: acc.login } : null);
}

const errText = (e: unknown) => (e instanceof PackError || e instanceof FetchError || e instanceof GithubError ? e.message : (e as Error)?.message ?? String(e));

/**
 * Add a source. `account` (a connected GitHub account of the person adding
 * it) reads a GitHub source through the API with that account instead of a
 * pasted token.
 */
export async function addSource(input: string, token?: string | null, account?: AccountRow | null): Promise<PackSourceView> {
  const r = resolveSourceInput(input);
  const db = await getDb();
  const row = { id: `ps-${crypto.randomUUID().slice(0, 8)}`, kind: "url" as const, input: input.trim(), url: r.url, token: account ? null : token?.trim() || null, tokenHost: r.tokenHost };
  if (account && !r.github) throw new PackError("a GitHub account can only be used with GitHub sources (owner/repo or a github.com link)");
  let link: GithubLink | null = null;
  let reader: PackReader | undefined;
  if (account && r.github) {
    link = { sourceId: row.id, accountId: account.id, owner: r.github.owner, repo: r.github.repo, ref: r.github.ref, path: r.github.path, sha: null, etag: null, checkedAt: null };
    const head = await githubHead(account, link);
    link = { ...link, sha: head.sha, etag: head.etag, checkedAt: new Date() };
    reader = githubReader(account, link, head.sha);
  }
  // Fails before saving when nothing is there (wrong link / token).
  const { url, index } = await fetchIndex(row, reader);
  const saved = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(packSources)
      .values({ ...row, url, index, lastFetchedAt: new Date(), name: index.name ?? "" })
      .returning();
    if (link) await tx.insert(packSourceGithub).values(link);
    return s;
  });
  return sourceView(saved, account ? { id: account.id, login: account.login } : null);
}

/** `account`: a connected account (null = stop using one). Only GitHub sources. */
export async function updateSource(id: string, p: { token?: string | null; name?: string; account?: AccountRow | null }) {
  const db = await getDb();
  const set: Partial<typeof packSources.$inferInsert> = {};
  if (p.token !== undefined) set.token = p.token?.trim() || null;
  if (p.name !== undefined) set.name = p.name;
  if (p.account !== undefined) {
    const [s] = await db.select().from(packSources).where(and(eq(packSources.id, id), eq(packSources.kind, "url")));
    if (!s) return;
    const gh = resolveSourceInput(s.input).github;
    if (p.account) {
      if (!gh) throw new PackError("a GitHub account can only be used with GitHub sources");
      const l = { sourceId: id, accountId: p.account.id, owner: gh.owner, repo: gh.repo, ref: gh.ref, path: gh.path, sha: null, etag: null, checkedAt: null };
      await db.insert(packSourceGithub).values(l).onConflictDoUpdate({ target: packSourceGithub.sourceId, set: { accountId: p.account.id, sha: null, etag: null } });
      set.token = null;
    } else await db.delete(packSourceGithub).where(eq(packSourceGithub.sourceId, id));
  }
  if (!Object.keys(set).length) return;
  await db.update(packSources).set(set).where(and(eq(packSources.id, id), eq(packSources.kind, "url")));
}

export async function deleteSource(id: string) {
  const db = await getDb();
  await db.delete(packSources).where(and(eq(packSources.id, id), eq(packSources.kind, "url")));
}

export async function refreshSource(id: string): Promise<PackSourceView | null> {
  const db = await getDb();
  return refreshSourceIn(db, id);
}

/**
 * Re-read a source's listing. GitHub sources with an account first ask for
 * the commit SHA (304 when unchanged) and skip the re-read when the commit
 * is the one already listed (unless `force`).
 */
async function refreshSourceIn(db: DB, id: string, force = true): Promise<PackSourceView | null> {
  const [s] = await db.select().from(packSources).where(eq(packSources.id, id));
  if (!s) return null;
  try {
    let reader: PackReader | undefined;
    const l = s.kind === "url" ? await githubLink(db, id) : null;
    if (l?.accountId) {
      const acc = await accountById(l.accountId);
      if (!acc) throw new PackError("the GitHub account this source used was disconnected: choose another one");
      const head = await githubHead(acc, l);
      await db.update(packSourceGithub).set({ sha: head.sha, etag: head.etag, checkedAt: new Date() }).where(eq(packSourceGithub.sourceId, id));
      if (!head.changed && !force && s.index && !s.lastError) {
        const [row] = await db.update(packSources).set({ lastFetchedAt: new Date() }).where(eq(packSources.id, id)).returning();
        return sourceViewIn(db, row);
      }
      reader = githubReader(acc, l, head.sha);
    }
    const { url, index } = await fetchIndex(s, reader);
    const [row] = await db.update(packSources).set({ url, index, lastFetchedAt: new Date(), lastError: null }).where(eq(packSources.id, id)).returning();
    return sourceViewIn(db, row);
  } catch (e) {
    const [row] = await db.update(packSources).set({ lastError: errText(e), lastFetchedAt: new Date() }).where(eq(packSources.id, id)).returning();
    return sourceViewIn(db, row);
  }
}

/* ------------------------------------------------------------ hashing rows */

async function currentItems(db: DB, keys: { kind: PackItemKind; id: string }[]) {
  const ids = (k: PackItemKind) => [...new Set(keys.filter((x) => x.kind === k).map((x) => x.id))];
  const out = new Map<string, { hash: string; name: string; value: unknown }>();
  const tIds = ids("template");
  if (tIds.length) for (const r of await db.select().from(templates).where(inArray(templates.id, tIds))) out.set(itemKey("template", r.id), { hash: await itemHash("template", r.doc), name: r.name, value: r.doc });
  const lIds = ids("label");
  if (lIds.length)
    for (const r of await db.select().from(labels).where(inArray(labels.id, lIds))) {
      const l = toLabel(r);
      out.set(itemKey("label", r.id), { hash: await itemHash("label", l), name: r.name, value: l });
    }
  for (const id of ids("dataset")) {
    const d = await getDataset(id);
    if (d) out.set(itemKey("dataset", id), { hash: await itemHash("dataset", d), name: d.name, value: d });
  }
  const aIds = ids("asset");
  if (aIds.length)
    for (const r of await db.select().from(assets).where(inArray(assets.id, aIds)))
      out.set(itemKey("asset", r.id), { hash: await itemHash("asset", { kind: r.kind, mime: r.mime, meta: r.meta, data: new Uint8Array(r.data) }), name: r.name, value: null });
  return out;
}

/* ------------------------------------------------------------------ views */

export async function packsView(): Promise<PacksView> {
  const db = await getDb();
  const [sources, installed, links, skips] = await Promise.all([db.select().from(packSources), db.select().from(packs), db.select().from(packItems), db.select().from(packUpdateSkips)]);
  const current = await currentItems(db, links.map((l) => ({ kind: l.kind, id: l.itemId })));
  const ownedLabels = new Set(links.filter((l) => l.kind === "label").map((l) => l.itemId));
  const latest = new Map<string, string>();
  for (const s of sources) for (const p of s.index?.packs ?? []) if (!latest.has(p.id) || compareVersions(p.version, latest.get(p.id)!) > 0) latest.set(p.id, p.version);
  const view: InstalledPackView[] = [];
  for (const p of installed) {
    const mine = links.filter((l) => l.packId === p.id);
    const count = (k: string) => mine.filter((l) => l.kind === k && current.has(itemKey(l.kind, l.itemId))).length;
    const name = (l: (typeof mine)[number]) => current.get(itemKey(l.kind, l.itemId))?.name ?? (l.doc as { name?: string } | null)?.name ?? l.itemId;
    const tIds = mine.filter((l) => l.kind === "template").map((l) => l.itemId);
    const dependents = tIds.length ? (await db.select({ id: labels.id }).from(labels).where(inArray(labels.templateId, tIds))).filter((r) => !ownedLabels.has(r.id)).length : 0;
    const avail = (p.sourceId && sources.find((s) => s.id === p.sourceId)?.index?.packs.find((x) => x.id === p.id)?.version) || latest.get(p.id) || null;
    view.push({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      homepage: p.homepage,
      enabled: p.enabled,
      sourceId: p.sourceId,
      url: p.url,
      selection: p.selection,
      installedAt: p.installedAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      counts: { templates: count("template"), labels: count("label"), datasets: count("dataset"), assets: count("asset") },
      changed: mine.filter((l) => current.has(itemKey(l.kind, l.itemId)) && current.get(itemKey(l.kind, l.itemId))!.hash !== l.hash).map((l) => ({ kind: l.kind, id: l.itemId, name: name(l) })),
      deleted: mine.filter((l) => !current.has(itemKey(l.kind, l.itemId))).map((l) => ({ kind: l.kind, id: l.itemId, name: name(l) })),
      available: avail && compareVersions(avail, p.version) > 0 ? avail : null,
      skipped: skips.find((x) => x.packId === p.id)?.version ?? null,
      dependents,
    });
  }
  const sorted = sources.sort((a, b) => (a.kind === b.kind ? a.createdAt.getTime() - b.createdAt.getTime() : a.kind === "builtin" ? -1 : 1));
  return { sources: await Promise.all(sorted.map((s) => sourceViewIn(db, s))), installed: view };
}

/* ---------------------------------------------------------------- install */

/** Read a pack (with files) from its source, by id. */
async function readPack(db: DB, sourceId: string, packId: string): Promise<{ pack: ResolvedPack; url: string; source: SourceRow }> {
  const [s] = await db.select().from(packSources).where(eq(packSources.id, sourceId));
  if (!s) throw new PackError("source not found");
  const reader = await readerForSource(db, s);
  let entry = s.index?.packs.find((p) => p.id === packId);
  if (!entry) {
    await refreshSourceIn(db, sourceId);
    const [again] = await db.select().from(packSources).where(eq(packSources.id, sourceId));
    entry = again?.index?.packs.find((p) => p.id === packId);
  }
  if (!entry) throw new PackError(`pack "${packId}" is not offered by this source`);
  let doc: unknown;
  if (entry.url.includes("#")) {
    const list = await listPackEntries(entry.url.split("#")[0], reader);
    doc = list.entries.find((e) => e.url === entry.url)?.doc;
  }
  const pack = await loadPack(entry.url.split("#")[0], reader, { withAssets: true }, doc);
  if (pack.manifest.id !== packId) throw new PackError(`the source now has "${pack.manifest.id}" at this address; refresh it`);
  return { pack, url: entry.url, source: s };
}

const who = (p: ResolvedPack) => `pack:${p.manifest.id}@${p.manifest.version}`;

/**
 * Install or update a pack: apply `planPackSync` (see core) to the library.
 * `labelIds` installs only those labels (all templates); later updates then
 * bring only those (plus new labels when everything was installed).
 */
async function syncPack(db: DB, pack: ResolvedPack, o: { sourceId: string | null; url: string; labelIds?: string[] | null }): Promise<SyncResult> {
  const m = pack.manifest;
  const errors = checkPack(pack).filter((i) => i.level === "error");
  if (errors.length) throw new PackError(`${m.name} has errors: ${errors.map((e) => `${e.file ? `${e.file}: ` : ""}${e.message}`).join("; ")}`, errors);
  const [prev] = await db.select().from(packs).where(eq(packs.id, m.id));
  const owned = await db.select().from(packItems).where(eq(packItems.packId, m.id));
  const selection = o.labelIds !== undefined ? o.labelIds : (prev?.selection ?? null);
  const ownedKeys = new Set(owned.map((x) => itemKey(x.kind, x.itemId)));
  const warnings: string[] = [];

  // Labels: the picked ones (and ones installed before); skip those whose template is nowhere.
  const tplHere = new Set(pack.templates.map((t) => t.id));
  const outside = [...new Set(pack.labels.map((l) => l.templateId).filter((t) => !tplHere.has(t)))];
  const inLibrary = new Set(outside.length ? (await db.select({ id: templates.id }).from(templates).where(inArray(templates.id, outside))).map((r) => r.id) : []);
  const wanted = pack.labels.filter((l) => !selection || selection.includes(l.id) || ownedKeys.has(itemKey("label", l.id)));
  const incomingLabels = wanted.filter((l) => {
    if (tplHere.has(l.templateId) || inLibrary.has(l.templateId)) return true;
    warnings.push(`Skipped label "${l.name}": template ${l.templateId} is not in the library`);
    return false;
  });
  const assetsIn = pack.assets.filter((a) => {
    const ok = SHARE_MIME[a.kind]?.test(a.mime) && a.data.length <= 8 * 1024 * 1024;
    if (!ok) warnings.push(`Skipped file ${a.name}: unsupported type or over 8 MB`);
    return ok;
  });

  const docs = new Map<string, unknown>();
  const incoming: IncomingItem[] = [];
  const add = async (kind: PackItemKind, id: string, value: unknown, hashOf: unknown = value) => {
    docs.set(itemKey(kind, id), value);
    incoming.push({ kind, id, hash: await itemHash(kind, hashOf) });
  };
  for (const t of pack.templates) await add("template", t.id, t);
  for (const l of incomingLabels) await add("label", l.id, l);
  for (const d of pack.datasets) await add("dataset", d.id, d);
  for (const a of assetsIn) await add("asset", a.id, a);

  const keys = [...incoming.map((i) => ({ kind: i.kind, id: i.id })), ...owned.map((x) => ({ kind: x.kind, id: x.itemId }))];
  const current = await currentItems(db, keys);
  const allLinks = keys.length ? await db.select().from(packItems).where(inArray(packItems.itemId, [...new Set(keys.map((k) => k.id))])) : [];
  const existing = new Map<string, ExistingItem>();
  for (const k of keys) {
    const key = itemKey(k.kind, k.id);
    const link = allLinks.find((x) => x.kind === k.kind && x.itemId === k.id);
    const cur = current.get(key);
    existing.set(key, { exists: !!cur, hash: cur?.hash, owner: link?.packId ?? null, packHash: link?.hash });
  }
  const plan = planPackSync(m.id, incoming, existing, owned.map((x) => ({ kind: x.kind, id: x.itemId })));
  const hashOf = new Map(incoming.map((i) => [itemKey(i.kind, i.id), i.hash]));
  const res: SyncResult = { pack: { id: m.id, name: m.name, version: m.version }, inserted: 0, updated: 0, unchanged: 0, adopted: 0, kept: [], conflicts: [], removed: 0, detached: 0, warnings };
  const datasetWrites: Dataset[] = [];

  await db.transaction(async (txx) => {
    const tx = txx as unknown as DB;
    const meta = { name: m.name, version: m.version, description: m.description ?? "", author: m.author ?? "", homepage: m.homepage ?? "", sourceId: o.sourceId, url: o.url, selection, updatedAt: new Date() };
    await tx
      .insert(packs)
      .values({ id: m.id, ...meta })
      .onConflictDoUpdate({ target: packs.id, set: meta });

    const link = async (a: PackAction) => {
      const key = itemKey(a.kind, a.id);
      const doc = a.kind === "asset" ? null : docs.get(key);
      const row = { packId: m.id, kind: a.kind, itemId: a.id, hash: hashOf.get(key)!, doc, updatedAt: new Date() };
      await tx.insert(packItems).values(row).onConflictDoUpdate({ target: [packItems.kind, packItems.itemId], set: row });
    };
    const order: Record<PackItemKind, number> = { asset: 0, template: 1, dataset: 2, label: 3 };
    const writes = plan.filter((a) => a.op !== "delete" && a.op !== "detach").sort((a, b) => order[a.kind] - order[b.kind]);
    for (const a of writes) {
      const key = itemKey(a.kind, a.id);
      if (a.op === "conflict") {
        res.conflicts.push({ kind: a.kind, id: a.id, owner: a.owner! });
        continue;
      }
      if (a.op === "insert" || a.op === "overwrite") {
        await writeItem(tx, a.kind, docs.get(key), current.get(key)?.value, who(pack), datasetWrites);
        if (a.op === "insert") res.inserted++;
        else res.updated++;
      } else if (a.op === "keep") res.kept.push({ kind: a.kind, id: a.id, name: current.get(key)?.name ?? a.id });
      else if (a.op === "unchanged") res.unchanged++;
      if (a.adopted) res.adopted++;
      await link(a);
    }
    // Gone from the pack: unchanged rows go, changed ones stay as the user's own.
    const gone = plan.filter((a) => a.op === "delete" || a.op === "detach");
    for (const a of gone.sort((x, y) => order[y.kind] - order[x.kind])) {
      // A template other labels still use stays (deleting it would take them along).
      if (a.op === "delete" && a.kind === "template" && (await tx.select({ id: labels.id }).from(labels).where(eq(labels.templateId, a.id)).limit(1)).length) {
        res.detached++;
      } else if (a.op === "delete" && current.has(itemKey(a.kind, a.id))) {
        await deleteItem(tx, a.kind, a.id);
        res.removed++;
      } else if (a.op === "detach") res.detached++;
      await tx.delete(packItems).where(and(eq(packItems.kind, a.kind), eq(packItems.itemId, a.id)));
    }
  });
  for (const d of datasetWrites) await writeDataset(db, d);
  return res;
}

/** Write a pack item into the library. Labels keep the folder they were moved to here. */
async function writeItem(tx: DB, kind: PackItemKind, value: unknown, currentValue: unknown, by: string, datasetWrites: Dataset[]) {
  if (kind === "template") {
    const doc = value as Template;
    const prev = currentValue as Template | undefined;
    await tx.insert(templates).values({ id: doc.id, name: doc.name, doc }).onConflictDoUpdate({ target: templates.id, set: { name: doc.name, doc, updatedAt: new Date() } });
    await snapshotOnSave(doc, by, tx as never, prev);
  } else if (kind === "label") {
    let l = value as Label;
    const prev = currentValue as Label | undefined;
    if (prev && labelFolder(prev)) l = setLabelFolder(l, labelFolder(prev));
    const row = labelRow(l);
    await tx.insert(labels).values(row).onConflictDoUpdate({ target: labels.id, set: { ...row, updatedAt: new Date() } });
  } else if (kind === "dataset") datasetWrites.push(value as Dataset);
  else {
    const a = value as SharedAsset;
    let data = Buffer.from(a.data);
    if (a.kind === "icon" || a.mime === "image/svg+xml") {
      const clean = sanitizeSvg(data.toString("utf8"));
      if (!clean) throw new PackError(`${a.name}: no drawable shapes in this SVG`);
      data = Buffer.from(clean, "utf8");
    }
    const row = { id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: data.length, data, meta: a.meta };
    await tx.insert(assets).values(row).onConflictDoUpdate({ target: assets.id, set: row });
  }
}

async function deleteItem(tx: DB, kind: PackItemKind, id: string) {
  if (kind === "template") await tx.delete(templates).where(eq(templates.id, id));
  else if (kind === "label") await tx.delete(labels).where(eq(labels.id, id));
  else if (kind === "dataset") await tx.delete(datasets).where(eq(datasets.id, id));
  else await tx.delete(assets).where(eq(assets.id, id));
}

export async function installPack(sourceId: string, packId: string, labelIds?: string[] | null): Promise<SyncResult> {
  const db = await getDb();
  const { pack, url } = await readPack(db, sourceId, packId);
  const [prev] = await db.select({ enabled: packs.enabled }).from(packs).where(eq(packs.id, packId));
  const r = await syncPack(db, pack, { sourceId, url, labelIds: labelIds === undefined ? null : labelIds });
  // Installing (again) shows it, e.g. the Examples pack adopted as disabled.
  if (prev && !prev.enabled) await db.update(packs).set({ enabled: true }).where(eq(packs.id, packId));
  return r;
}

/** Update from the pack's source (or another source offering the same pack id). */
export async function updatePack(packId: string): Promise<SyncResult> {
  const db = await getDb();
  const [p] = await db.select().from(packs).where(eq(packs.id, packId));
  if (!p) throw new PackError("pack not installed");
  let sourceId = p.sourceId;
  if (!sourceId) {
    const all = await db.select().from(packSources);
    sourceId = all.find((s) => s.index?.packs.some((x) => x.id === packId))?.id ?? null;
  }
  if (!sourceId) throw new PackError("no source offers this pack any more: add its link again");
  await refreshSourceIn(db, sourceId);
  const { pack, url } = await readPack(db, sourceId, packId);
  return syncPack(db, pack, { sourceId, url });
}

/* ------------------------------------------------------- update prompts */

/** The newest listing of a pack among the sources (its own source first). */
function newestListing(sources: SourceRow[], p: { id: string; sourceId: string | null }) {
  let best: { listing: PackListing; source: SourceRow } | null = null;
  for (const s of sources) {
    const l = s.index?.packs.find((x) => x.id === p.id);
    if (!l) continue;
    if (!best || (s.id === p.sourceId && compareVersions(l.version, best.listing.version) >= 0) || compareVersions(l.version, best.listing.version) > 0) best = { listing: l, source: s };
  }
  return best;
}

/**
 * What updating to `listing` would do, without doing it (the same planner as
 * install / update). Only templates and labels: listings carry no datasets or
 * files, and those follow along when the update is applied.
 */
async function dryRunUpdate(db: DB, p: typeof packs.$inferSelect, listing: PackListing, withDocs: boolean) {
  const owned = (await db.select().from(packItems).where(eq(packItems.packId, p.id))).filter((x) => x.kind === "template" || x.kind === "label");
  const ownedKeys = new Set(owned.map((x) => itemKey(x.kind, x.itemId)));
  const tplHere = new Set(listing.templates.map((t) => t.id));
  const outside = [...new Set(listing.labels.map((l) => l.templateId).filter((t) => !tplHere.has(t)))];
  const inLibrary = new Set(outside.length ? (await db.select({ id: templates.id }).from(templates).where(inArray(templates.id, outside))).map((r) => r.id) : []);
  const wanted = listing.labels.filter((l) => (!p.selection || p.selection.includes(l.id) || ownedKeys.has(itemKey("label", l.id))) && (tplHere.has(l.templateId) || inLibrary.has(l.templateId)));
  const incoming: IncomingItem[] = [];
  const docs = new Map<string, Template | Label>();
  for (const t of listing.templates) {
    incoming.push({ kind: "template", id: t.id, hash: await itemHash("template", t) });
    docs.set(itemKey("template", t.id), t);
  }
  for (const l of wanted) {
    incoming.push({ kind: "label", id: l.id, hash: await itemHash("label", l) });
    docs.set(itemKey("label", l.id), l);
  }
  const keys = [...incoming.map((i) => ({ kind: i.kind, id: i.id })), ...owned.map((x) => ({ kind: x.kind, id: x.itemId }))];
  const current = await currentItems(db, keys);
  const allLinks = keys.length ? await db.select().from(packItems).where(inArray(packItems.itemId, [...new Set(keys.map((k) => k.id))])) : [];
  const existing = new Map<string, ExistingItem>();
  for (const k of keys) {
    const key = itemKey(k.kind, k.id);
    const link = allLinks.find((x) => x.kind === k.kind && x.itemId === k.id);
    const cur = current.get(key);
    existing.set(key, { exists: !!cur, hash: cur?.hash, owner: link?.packId ?? null, packHash: link?.hash });
  }
  const plan = planPackSync(p.id, incoming, existing, owned.map((x) => ({ kind: x.kind, id: x.itemId })));
  const hashIn = new Map(incoming.map((i) => [itemKey(i.kind, i.id), i.hash]));
  const out: PackUpdatePreview = { packId: p.id, name: p.name, from: p.version, to: listing.version, sourceId: null, sourceName: "", added: [], removed: [], changed: [], kept: [] };
  const item = (a: PackAction): UpdateItemView => {
    const key = itemKey(a.kind, a.id);
    const after = docs.get(key);
    const cur = current.get(key);
    const link = owned.find((x) => x.kind === a.kind && x.itemId === a.id);
    const name = (after as { name?: string } | undefined)?.name ?? cur?.name ?? (link?.doc as { name?: string } | null)?.name ?? a.id;
    return { kind: a.kind as "template" | "label", id: a.id, name, ...(withDocs ? { before: (cur?.value as Template | Label | undefined) ?? null, after: after ?? null } : {}) };
  };
  for (const a of plan) {
    const key = itemKey(a.kind, a.id);
    if (a.op === "insert") out.added.push(item(a));
    else if (a.op === "overwrite") out.changed.push(item(a));
    else if (a.op === "delete") out.removed.push(item(a));
    else if (a.op === "detach") out.kept.push({ ...item(a), reason: "removed" });
    // Changed here, and the pack changed it too: kept, the person may want to look.
    else if (a.op === "keep" && hashIn.get(key) !== existing.get(key)?.packHash) out.kept.push({ ...item(a), reason: "changed" });
  }
  if (withDocs) {
    // Templates the label previews need (new version first, then the library's).
    const tIds = new Set([...out.added, ...out.changed, ...out.removed, ...out.kept].flatMap((i) => (i.kind === "label" ? [((i.after ?? i.before) as Label | null)?.templateId].filter((x): x is string => !!x) : [])));
    const tpl: Record<string, Template> = {};
    for (const t of listing.templates) if (tIds.has(t.id)) tpl[t.id] = t;
    const missing = [...tIds].filter((id) => !tpl[id]);
    if (missing.length) for (const r of await db.select().from(templates).where(inArray(templates.id, missing))) tpl[r.id] = r.doc;
    const before: Record<string, Template> = {};
    const libT = [...tIds];
    if (libT.length) for (const r of await db.select().from(templates).where(inArray(templates.id, libT))) before[r.id] = r.doc;
    out.templates = tpl;
    out.templatesBefore = before;
  }
  return out;
}

/**
 * Update prompts: refresh sources not checked for `maxAgeMs` (GitHub sources
 * with an account: a cheap commit-SHA check first), then a dry-run summary
 * for every installed pack with a newer version (skipped versions left out).
 */
export async function checkUpdates(o: { maxAgeMs?: number; force?: boolean } = {}): Promise<PackUpdateSummary[]> {
  const db = await getDb();
  const maxAge = o.maxAgeMs ?? 10 * 60_000;
  const now = Date.now();
  const stale = (await db.select().from(packSources).where(eq(packSources.kind, "url"))).filter((s) => o.force || !s.lastFetchedAt || now - s.lastFetchedAt.getTime() > maxAge);
  await Promise.allSettled(stale.map((s) => refreshSourceIn(db, s.id, false)));
  const [sources, installed, skips] = await Promise.all([db.select().from(packSources), db.select().from(packs), db.select().from(packUpdateSkips)]);
  const out: PackUpdateSummary[] = [];
  for (const p of installed) {
    const best = newestListing(sources, p);
    if (!best || compareVersions(best.listing.version, p.version) <= 0) continue;
    if (skips.some((x) => x.packId === p.id && x.version === best.listing.version)) continue;
    const r = await dryRunUpdate(db, p, best.listing, false);
    const strip = (xs: UpdateItemView[]) => xs.map(({ kind, id, name, reason }) => ({ kind, id, name, ...(reason ? { reason } : {}) }));
    out.push({ ...r, added: strip(r.added), removed: strip(r.removed), changed: strip(r.changed), kept: strip(r.kept), sourceId: best.source.id, sourceName: sourceView(best.source).name, enabled: p.enabled });
  }
  return out;
}

/** The review dialog: the update's items with their documents (before / after) for previews. */
export async function updatePreview(packId: string): Promise<PackUpdatePreview | null> {
  const db = await getDb();
  const [p] = await db.select().from(packs).where(eq(packs.id, packId));
  if (!p) return null;
  const best = newestListing(await db.select().from(packSources), p);
  if (!best || compareVersions(best.listing.version, p.version) <= 0) return null;
  return { ...(await dryRunUpdate(db, p, best.listing, true)), sourceId: best.source.id, sourceName: sourceView(best.source).name };
}

/** "Skip this version" (null clears it). */
export async function skipUpdate(packId: string, version: string | null, by: string) {
  const db = await getDb();
  if (version === null) await db.delete(packUpdateSkips).where(eq(packUpdateSkips.packId, packId));
  else
    await db
      .insert(packUpdateSkips)
      .values({ packId, version, skippedBy: by })
      .onConflictDoUpdate({ target: packUpdateSkips.packId, set: { version, skippedBy: by, skippedAt: new Date() } });
}

export async function setPackEnabled(packId: string, enabled: boolean) {
  const db = await getDb();
  const r = await db.update(packs).set({ enabled }).where(eq(packs.id, packId)).returning({ id: packs.id });
  return r.length > 0;
}

/* ----------------------------------------------------------------- remove */

async function removePlanIn(db: DB, packId: string) {
  const [p] = await db.select().from(packs).where(eq(packs.id, packId));
  if (!p) return null;
  const owned = await db.select().from(packItems).where(eq(packItems.packId, packId));
  const current = await currentItems(db, owned.map((o) => ({ kind: o.kind, id: o.itemId })));
  const ownedLabels = new Set(owned.filter((o) => o.kind === "label").map((o) => o.itemId));
  const tIds = owned.filter((o) => o.kind === "template").map((o) => o.itemId);
  const users = tIds.length ? (await db.select({ id: labels.id, templateId: labels.templateId }).from(labels).where(inArray(labels.templateId, tIds))).filter((r) => !ownedLabels.has(r.id)) : [];
  // Templates that labels staying behind need: other labels', and changed pack labels' (kept on request).
  const keptLabelTemplates = owned
    .filter((o) => o.kind === "label")
    .map((o) => ({ o, cur: current.get(itemKey("label", o.itemId)) }))
    .filter(({ o, cur }) => cur && cur.hash !== o.hash)
    .map(({ cur }) => (cur!.value as Label).templateId);
  const plan = planPackRemove(
    owned.map((o) => {
      const cur = current.get(itemKey(o.kind, o.itemId));
      return { kind: o.kind, id: o.itemId, exists: !!cur, hash: cur?.hash, packHash: o.hash };
    }),
    new Set([...users.map((u) => u.templateId), ...keptLabelTemplates]),
  );
  return { pack: p, plan, current, dependents: users.length };
}

export async function removePlan(packId: string): Promise<RemovePlanView | null> {
  const db = await getDb();
  const r = await removePlanIn(db, packId);
  if (!r) return null;
  return {
    pack: { id: r.pack.id, name: r.pack.name },
    remove: r.plan.remove.length,
    changed: r.plan.changed.map((c) => ({ ...c, name: r.current.get(itemKey(c.kind, c.id))?.name ?? c.id })),
    dependents: r.dependents,
  };
}

/**
 * Remove a pack: unchanged items are deleted; changed ones (and templates
 * other labels use) are kept as the user's own with `keepChanged`, else
 * deleted too (a deleted template takes its labels with it).
 */
export async function removePack(packId: string, keepChanged: boolean) {
  const db = await getDb();
  const r = await removePlanIn(db, packId);
  if (!r) return null;
  const order: Record<PackItemKind, number> = { label: 0, dataset: 1, template: 2, asset: 3 };
  const doomed = [...r.plan.remove, ...(keepChanged ? [] : r.plan.changed)].sort((a, b) => order[a.kind] - order[b.kind]);
  await db.transaction(async (txx) => {
    const tx = txx as unknown as DB;
    for (const d of doomed) await deleteItem(tx, d.kind, d.id);
    await tx.delete(packs).where(eq(packs.id, packId));
  });
  return { removed: doomed.length, kept: keepChanged ? r.plan.changed.length : 0 };
}

/* ------------------------------------------------------------------ reset */

/** Put items back to the pack's version (also brings back items deleted here). All of a pack's changed / deleted items when `items` is omitted. */
export async function resetItems(sel: { packId?: string; items?: { kind: PackItemKind; id: string }[] }) {
  const db = await getDb();
  let links = sel.items?.length
    ? (await db.select().from(packItems).where(inArray(packItems.itemId, sel.items.map((i) => i.id)))).filter((l) => sel.items!.some((i) => i.kind === l.kind && i.id === l.itemId))
    : sel.packId
      ? await db.select().from(packItems).where(eq(packItems.packId, sel.packId))
      : [];
  links = links.filter((l) => l.kind !== "asset" && l.doc);
  const current = await currentItems(db, links.map((l) => ({ kind: l.kind, id: l.itemId })));
  const todo = links.filter((l) => current.get(itemKey(l.kind, l.itemId))?.hash !== l.hash);
  const order: Record<PackItemKind, number> = { asset: 0, template: 1, dataset: 2, label: 3 };
  const datasetWrites: Dataset[] = [];
  const skipped: string[] = [];
  await db.transaction(async (txx) => {
    const tx = txx as unknown as DB;
    for (const l of todo.sort((a, b) => order[a.kind] - order[b.kind])) {
      if (l.kind === "label") {
        const tid = (l.doc as Label).templateId;
        const [t] = await tx.select({ id: templates.id }).from(templates).where(eq(templates.id, tid));
        if (!t) {
          skipped.push((l.doc as Label).name);
          continue;
        }
      }
      await writeItem(tx, l.kind, l.doc, current.get(itemKey(l.kind, l.itemId))?.value, `pack:${l.packId} reset`, datasetWrites);
    }
  });
  for (const d of datasetWrites) await writeDataset(db, d);
  return { reset: todo.length - skipped.length, skipped };
}

/* ---------------------------------------------------- start-up (getDb) */

/**
 * Runs once per start (from seed.ts, with the db being opened): make sure
 * the built-in Examples source exists and is listed. The first time it is
 * created, rows that older versions seeded with the Examples' ids are
 * adopted as that pack's items, installed but disabled: they leave the
 * library view, nothing is lost, and Settings > Packs can show them again.
 */
export async function setupBuiltinPacks(db: DB) {
  const [have] = await db.select({ id: packSources.id, index: packSources.index, name: packSources.name }).from(packSources).where(eq(packSources.id, BUILTIN_SOURCE_ID));
  const reader = builtinReader();
  const { index, loaded } = await builtinIndex(reader);
  const examples = loaded.find((p) => p.manifest.id === EXAMPLES_PACK_ID);
  if (!examples) console.warn("[packs] built-in examples not available; set LABEBAL_BUILTIN_PACKS to the packs/examples folder");
  if (!loaded.length) return;
  // A new, empty library starts with something to print.
  const fresh = !have && !(await db.select({ id: templates.id }).from(templates).limit(1)).length;
  // Offered for the first time: Standard formats is installed (and can be turned off).
  const newlyOffered = !have?.index?.packs.some((p) => p.id === STANDARDS_PACK_ID) && index.packs.some((p) => p.id === STANDARDS_PACK_ID);
  if (have) await db.update(packSources).set({ index, url: builtinManifestUrl(), lastFetchedAt: new Date(), lastError: null, ...(have.name === "Built-in examples" ? { name: "Built-in packs" } : {}) }).where(eq(packSources.id, BUILTIN_SOURCE_ID));
  else {
    await db.insert(packSources).values({ id: BUILTIN_SOURCE_ID, kind: "builtin", input: "builtin:examples", url: builtinManifestUrl(), name: "Built-in packs", index, lastFetchedAt: new Date() });
    if (examples) await adoptSeeded(db, examples);
  }
  if (newlyOffered) await installBuiltin(db, reader, index, STANDARDS_PACK_ID);
  if (fresh) await installBuiltin(db, reader, index, WELCOME_PACK_ID);
  // Not awaited: this runs while the db is still opening (getDb), and updates
  // read datasets through getDb, which would wait for this function forever.
  setTimeout(() => void updateBuiltins(db, reader, index), 0);
}

/**
 * Built-in packs ship with the app: an installed one whose bundled version is
 * newer is updated on start. Items changed here are kept (same rules as a
 * manual update); a pack someone removed stays removed.
 */
async function updateBuiltins(db: DB, reader: PackReader, index: PackSourceIndex) {
  const installed = await db.select().from(packs).where(eq(packs.sourceId, BUILTIN_SOURCE_ID));
  for (const p of installed) {
    const entry = index.packs.find((x) => x.id === p.id);
    if (!entry || compareVersions(entry.version, p.version) <= 0) continue;
    try {
      const pack = await loadPack(entry.url, reader, { withAssets: true });
      const r = await syncPack(db, pack, { sourceId: BUILTIN_SOURCE_ID, url: entry.url });
      console.log(`[packs] updated built-in ${pack.manifest.name} to ${pack.manifest.version}: ${r.updated} updated, ${r.kept.length} kept (changed here)`);
    } catch (e) {
      console.warn(`[packs] could not update built-in ${p.name} (${errText(e)})`);
    }
  }
}

/** Install a built-in pack (once, when it is first offered). Never fails start-up. */
async function installBuiltin(db: DB, reader: PackReader, index: PackSourceIndex, id: string) {
  const entry = index.packs.find((p) => p.id === id);
  if (!entry) return;
  const [installed] = await db.select({ id: packs.id }).from(packs).where(eq(packs.id, id));
  if (installed) return;
  try {
    const pack = await loadPack(entry.url, reader, { withAssets: true });
    const r = await syncPack(db, pack, { sourceId: BUILTIN_SOURCE_ID, url: entry.url, labelIds: null });
    console.log(`[packs] installed ${pack.manifest.name} ${pack.manifest.version}: ${r.inserted} items`);
  } catch (e) {
    console.warn(`[packs] could not install the built-in ${id} pack (${errText(e)})`);
  }
}

/** Link library rows whose ids match the pack's items (old seeds) as a disabled install. */
export async function adoptSeeded(db: DB, pack: ResolvedPack) {
  const m = pack.manifest;
  const [already] = await db.select({ id: packs.id }).from(packs).where(eq(packs.id, m.id));
  if (already) return 0;
  const tIds = pack.templates.map((t) => t.id);
  const lIds = pack.labels.map((l) => l.id);
  const dIds = pack.datasets.map((d) => d.id);
  const haveT = new Set(tIds.length ? (await db.select({ id: templates.id }).from(templates).where(inArray(templates.id, tIds))).map((r) => r.id) : []);
  const haveL = new Set(lIds.length ? (await db.select({ id: labels.id }).from(labels).where(inArray(labels.id, lIds))).map((r) => r.id) : []);
  const haveD = new Set(dIds.length ? (await db.select({ id: datasets.id }).from(datasets).where(inArray(datasets.id, dIds))).map((r) => r.id) : []);
  if (!haveT.size && !haveL.size && !haveD.size) return 0;
  const taken = new Set((await db.select({ kind: packItems.kind, itemId: packItems.itemId }).from(packItems)).map((r) => itemKey(r.kind, r.itemId)));
  const rows: (typeof packItems.$inferInsert)[] = [];
  const push = async (kind: PackItemKind, id: string, doc: unknown) => {
    if (!taken.has(itemKey(kind, id))) rows.push({ packId: m.id, kind, itemId: id, hash: await itemHash(kind, doc), doc });
  };
  for (const t of pack.templates) if (haveT.has(t.id)) await push("template", t.id, t);
  for (const l of pack.labels) if (haveL.has(l.id)) await push("label", l.id, l);
  for (const d of pack.datasets) if (haveD.has(d.id)) await push("dataset", d.id, d);
  await db.transaction(async (tx) => {
    await tx.insert(packs).values({ id: m.id, sourceId: BUILTIN_SOURCE_ID, url: builtinManifestUrl(), name: m.name, version: m.version, description: m.description ?? "", author: m.author ?? "", homepage: m.homepage ?? "", enabled: false });
    if (rows.length) await tx.insert(packItems).values(rows);
  });
  console.log(`[packs] adopted ${rows.length} items seeded by an older version as the ${m.name} pack (installed, disabled)`);
  return rows.length;
}

/* ----------------------------------------------------------------- export */

export interface ExportRequest {
  manifest: { id: string; name: string; version: string; description?: string; author?: string; homepage?: string; folder?: string };
  templateIds: string[];
  labelIds: string[];
  datasets: boolean;
}

/** The library items an export / publish takes: the labels, their templates (+ the picked ones), linked datasets. */
export async function exportItems(req: Pick<ExportRequest, "templateIds" | "labelIds" | "datasets">) {
  const db = await getDb();
  const ls = req.labelIds.length ? (await db.select().from(labels).where(inArray(labels.id, req.labelIds))).map(toLabel) : [];
  const tIds = [...new Set([...req.templateIds, ...ls.map((l) => l.templateId)])];
  const ts = tIds.length ? (await db.select().from(templates).where(inArray(templates.id, tIds))).map((r) => r.doc) : [];
  const ds: Dataset[] = [];
  if (req.datasets)
    for (const d of await db.select({ id: datasets.id, link: datasets.link }).from(datasets)) if (d.link && tIds.includes(d.link.templateId)) ds.push((await getDataset(d.id))!);
  return {
    templates: ts.sort((a, b) => a.name.localeCompare(b.name)),
    labels: ls.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    datasets: ds,
  };
}

/** itemKey -> content hash of export items (what "changed since the last publish" compares). */
export async function exportItemHashes(items: Awaited<ReturnType<typeof exportItems>>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of items.templates) out[itemKey("template", t.id)] = await itemHash("template", t);
  for (const l of items.labels) out[itemKey("label", l.id)] = await itemHash("label", l);
  for (const d of items.datasets) out[itemKey("dataset", d.id)] = await itemHash("dataset", d);
  return out;
}

/** Pack folder files (manifest first) for library items: "Export as pack" and "Publish to GitHub". */
export async function buildPackFiles(req: ExportRequest) {
  const items = await exportItems(req);
  if (!items.templates.length) throw new PackError("nothing to export: pick templates or labels");
  const files = packFiles(req.manifest, { ...items, assets: await usedAssets(items.templates, items.labels) });
  return { files, items, counts: { templates: items.templates.length, labels: items.labels.length, datasets: items.datasets.length } };
}

/** "Export as pack": a zip with `<id>/labebal-pack.json` + files, ready to commit to a pack repo. */
export async function exportPackZip(req: ExportRequest): Promise<{ name: string; data: Uint8Array; counts: Record<string, number> }> {
  const { files, counts } = await buildPackFiles(req);
  const data = await zipFiles(files.map((f) => ({ name: `${req.manifest.id}/${f.path}`, data: f.data })));
  return { name: `${req.manifest.id}-${req.manifest.version}.zip`, data, counts };
}
