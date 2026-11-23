/**
 * "Publish to GitHub": write a pack folder (built like "Export as pack") into
 * a repo as ONE commit with the Git Data API (blobs, tree, commit, ref), add
 * it to the repo's collection file, bump the version, and remember what was
 * published (label_github_published) so "Publish update" can rebuild it and
 * the app can tell when local items changed since.
 *
 * An empty repo (no commits) gets a README first through the Contents API
 * (the Git Data API can't write to an empty repo).
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { compareVersions, PACK_MANIFEST, type PackFile } from "@labebal/core";
import { getDb } from "../db";
import { githubAccounts, githubPublished } from "../db/schema";
import {
  blobHeader,
  cleanDir,
  commitMessage,
  COLLECTION_PATH,
  manifestPath,
  nextVersion,
  noreplyEmail,
  planPublishTree,
  planRemoveTree,
  summarizeItems,
  withCollectionEntry,
  withoutCollectionEntry,
  type Bump,
  type PublishedPackView,
  type PublishResult,
  type TreeChange,
} from "../features/github/model";
import { accountRow, asAccount, getRepo, githubEnv, GithubError, ok, type AccountRow } from "./github";
import { buildPackFiles, exportItemHashes, exportItems } from "./packs";

/** Git blob sha of some content (what GitHub stores it under). */
export function gitBlobSha(data: string | Uint8Array): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return createHash("sha1").update(blobHeader(buf.length)).update(buf).digest("hex");
}

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

interface TreeEntry {
  path: string;
  sha: string;
  type: string;
  mode?: string;
}

interface RepoState {
  branch: string;
  head: string;
  tree: string;
  entries: TreeEntry[];
}

/** Head commit + full tree of a branch. Empty repos get a first commit (README). */
async function repoState(acc: AccountRow, owner: string, repo: string, branch: string, defaultBranch: string, init: boolean): Promise<RepoState> {
  const base = `/repos/${owner}/${repo}`;
  let ref = await asAccount(acc, `${base}/git/ref/heads/${enc(branch)}`);
  if ((ref.status === 409 || ref.status === 404) && init) {
    // 409 "Git Repository is empty"; 404 on an empty repo's default branch.
    if (ref.status === 404 && branch !== defaultBranch) throw new GithubError(`${owner}/${repo} has no branch "${branch}"`, 404);
    const readme = `# ${repo}\n\nLabel packs for [labebal](https://github.com/formless63/labebal). Add this repository in labebal under Settings > Packs to use them.\n`;
    ok(await asAccount(acc, `${base}/contents/README.md`, { method: "PUT", json: { message: "Start labebal packs", content: Buffer.from(readme).toString("base64"), branch } }), "Create first commit");
    ref = await asAccount(acc, `${base}/git/ref/heads/${enc(branch)}`);
  }
  const head = ok(ref, `Branch ${branch}`).json<{ object: { sha: string } }>().object.sha;
  const commit = ok(await asAccount(acc, `${base}/git/commits/${head}`), "Last commit").json<{ tree: { sha: string } }>();
  const tree = ok(await asAccount(acc, `${base}/git/trees/${commit.tree.sha}?recursive=1`), "Files").json<{ tree: TreeEntry[]; truncated?: boolean }>();
  if (tree.truncated) throw new GithubError(`${owner}/${repo} has too many files to list; publish into a smaller repo`, 400);
  return { branch, head, tree: commit.tree.sha, entries: tree.tree };
}

async function readBlob(acc: AccountRow, owner: string, repo: string, sha: string): Promise<string> {
  const b = ok(await asAccount(acc, `/repos/${owner}/${repo}/git/blobs/${sha}`), "Read file").json<{ content: string; encoding: string }>();
  return b.encoding === "base64" ? Buffer.from(b.content, "base64").toString("utf8") : b.content;
}

async function readJsonAt(acc: AccountRow, owner: string, repo: string, st: RepoState, path: string): Promise<unknown | null> {
  const e = st.entries.find((x) => x.path === path && x.type === "blob");
  if (!e) return null;
  try {
    return JSON.parse(await readBlob(acc, owner, repo, e.sha));
  } catch {
    throw new GithubError(`${path} in ${owner}/${repo} is not valid JSON; fix or remove it on GitHub first`);
  }
}

/** Write tree changes as one commit on the branch. */
async function commitChanges(acc: AccountRow, owner: string, repo: string, st: RepoState, changes: TreeChange[], contents: Map<string, string | Uint8Array>, message: string) {
  const base = `/repos/${owner}/${repo}`;
  for (const c of changes) {
    if (!c.sha) continue;
    const data = contents.get(c.sha);
    if (data === undefined) throw new Error(`missing content for ${c.path}`);
    const b = ok(
      await asAccount(acc, `${base}/git/blobs`, { method: "POST", json: { content: Buffer.from(typeof data === "string" ? Buffer.from(data, "utf8") : data).toString("base64"), encoding: "base64" } }),
      `Upload ${c.path}`,
    ).json<{ sha: string }>();
    if (b.sha !== c.sha) throw new GithubError(`GitHub stored ${c.path} differently than expected`, 502);
  }
  const tree = ok(
    await asAccount(acc, `${base}/git/trees`, { method: "POST", json: { base_tree: st.tree, tree: changes.map((c) => ({ path: c.path, mode: "100644", type: "blob", sha: c.sha })) } }),
    "Write files",
  ).json<{ sha: string }>();
  const email = acc.commitEmail || noreplyEmail(acc.githubId, acc.login);
  const commit = ok(
    await asAccount(acc, `${base}/git/commits`, { method: "POST", json: { message, tree: tree.sha, parents: [st.head], author: { name: acc.name || acc.login, email, date: new Date().toISOString() } } }),
    "Commit",
  ).json<{ sha: string; html_url?: string }>();
  const upd = await asAccount(acc, `${base}/git/refs/heads/${enc(st.branch)}`, { method: "PATCH", json: { sha: commit.sha, force: false } });
  if (upd.status === 422 || upd.status === 409) throw new GithubError(`${owner}/${repo} changed on GitHub while publishing; try again`, 409);
  ok(upd, "Update branch");
  return commit;
}

export interface PublishRequest {
  accountId: string;
  owner: string;
  repo: string;
  branch?: string;
  dir: string;
  manifest: { id: string; name: string; description?: string; author?: string; homepage?: string; folder?: string };
  bump: Bump;
  /** Exact version instead of a bump. */
  version?: string;
  templateIds: string[];
  labelIds: string[];
  datasets: boolean;
}

/** Publish (or update) a pack folder in a repo. */
export async function publishPack(scope: string, who: string, req: PublishRequest): Promise<PublishResult> {
  const acc = await accountRow(scope, req.accountId);
  if (!acc) throw new GithubError("GitHub account not found", 404);
  const dir = cleanDir(req.dir);
  if (dir === null) throw new GithubError("Folder: letters, digits, - _ . and / only");
  const { owner, repo } = req;
  const info = await getRepo(acc, owner, repo);
  if (!info.canWrite) throw new GithubError(`${acc.login} can't write to ${owner}/${repo}`, 403);
  const branch = req.branch?.trim() || info.defaultBranch;
  const st = await repoState(acc, owner, repo, branch, info.defaultBranch, true);
  const db = await getDb();

  // What's there now: the pack's manifest (same id?), our record of the last publish.
  const remote = (await readJsonAt(acc, owner, repo, st, manifestPath(dir))) as { id?: string; version?: string } | null;
  if (remote?.id && remote.id !== req.manifest.id) throw new GithubError(`The folder "${dir || "(root)"}" in ${owner}/${repo} holds another pack (${remote.id}). Choose another folder.`, 409);
  const [record] = await db
    .select()
    .from(githubPublished)
    .where(and(eq(githubPublished.owner, owner), eq(githubPublished.repo, repo), eq(githubPublished.dir, dir)));
  const prevVersion = remote?.version ?? record?.version ?? null;

  // Collection: list this pack (a root single-pack repo keeps its root manifest listed).
  let collection: { path: string; data: string } | null = null;
  if (dir) {
    const doc = await readJsonAt(acc, owner, repo, st, COLLECTION_PATH);
    const rootManifest = st.entries.some((e) => e.path === PACK_MANIFEST);
    const c = withCollectionEntry(doc ?? (rootManifest ? { packs: [PACK_MANIFEST] } : null), manifestPath(dir), `${acc.name || acc.login}'s label packs`);
    if (c.changed || !doc) collection = { path: COLLECTION_PATH, data: JSON.stringify(c.doc, null, 2) + "\n" };
  }

  const build = async (version: string) => {
    const b = await buildPackFiles({ manifest: { ...req.manifest, version }, templateIds: req.templateIds, labelIds: req.labelIds, datasets: req.datasets });
    const contents = new Map<string, string | Uint8Array>();
    const files = b.files.map((f: PackFile) => {
      const sha = gitBlobSha(f.data);
      contents.set(sha, f.data);
      return { path: f.path, sha };
    });
    const extra = collection ? [{ path: collection.path, sha: gitBlobSha(collection.data) }] : [];
    if (collection) contents.set(extra[0].sha, collection.data);
    return { b, contents, plan: planPublishTree({ dir, existing: st.entries, files, extra }) };
  };

  // Nothing changed (same files at the current version): no commit, no bump.
  if (prevVersion && !req.version) {
    const same = await build(prevVersion);
    if (!same.plan.changes.length) {
      return { unchanged: true, version: prevVersion, commitSha: st.head, commitUrl: "", htmlUrl: treeUrl(owner, repo, branch, dir), summary: { added: 0, removed: 0, changed: 0, first: false }, files: { added: 0, changed: 0, removed: 0 }, message: "" };
    }
  }
  const version = req.version ?? nextVersion([prevVersion], req.bump);
  if (req.version && prevVersion && compareVersions(req.version, prevVersion) <= 0) throw new GithubError(`Version ${req.version} is not newer than the published ${prevVersion}`);
  const { b, contents, plan } = await build(version);
  const hashes = await exportItemHashes(b.items);
  const summary = summarizeItems(record?.items ?? null, hashes);
  const files = { added: plan.added.length, changed: plan.changed.length, removed: plan.removed.length };
  const message = commitMessage(req.manifest.name, version, summary, files);
  const commit = await commitChanges(acc, owner, repo, st, plan.changes, contents, message);
  const e = githubEnv();
  const commitUrl = `${e.web}/${owner}/${repo}/commit/${commit.sha}`;

  const row = {
    packId: req.manifest.id,
    accountId: acc.id,
    owner,
    repo,
    branch,
    dir,
    name: req.manifest.name,
    description: req.manifest.description ?? "",
    author: req.manifest.author ?? "",
    folder: req.manifest.folder ?? "",
    version,
    templateIds: req.templateIds,
    labelIds: req.labelIds,
    datasets: req.datasets,
    items: hashes,
    commitSha: commit.sha,
    commitUrl,
    publishedBy: who,
    publishedAt: new Date(),
  };
  await db
    .insert(githubPublished)
    .values({ id: `gp-${crypto.randomUUID().slice(0, 8)}`, ...row })
    .onConflictDoUpdate({ target: [githubPublished.owner, githubPublished.repo, githubPublished.dir], set: row });
  // First publish to a repo: remember it as this account's packs repo.
  if (!acc.defaultRepo) await db.update(githubAccounts).set({ defaultRepo: `${owner}/${repo}` }).where(eq(githubAccounts.id, acc.id));
  return { unchanged: false, version, commitSha: commit.sha, commitUrl, htmlUrl: treeUrl(owner, repo, branch, dir), summary, files, message };
}

const treeUrl = (owner: string, repo: string, branch: string, dir: string) => `${githubEnv().web}/${owner}/${repo}/tree/${enc(branch)}${dir ? `/${enc(dir)}` : ""}`;

/** Delete a pack folder from its repo (and the collection entry) in one commit, and forget the record. */
export async function unpublishPack(scope: string, id: string, accountId?: string | null) {
  const db = await getDb();
  const [rec] = await db.select().from(githubPublished).where(eq(githubPublished.id, id));
  if (!rec) throw new GithubError("published pack not found", 404);
  const acc = await accountRow(scope, accountId || rec.accountId || "");
  if (!acc) throw new GithubError("Pick one of your connected GitHub accounts that can write to this repo", 400);
  const info = await getRepo(acc, rec.owner, rec.repo);
  if (!info.canWrite) throw new GithubError(`${acc.login} can't write to ${rec.owner}/${rec.repo}`, 403);
  const st = await repoState(acc, rec.owner, rec.repo, rec.branch, info.defaultBranch, false);
  const contents = new Map<string, string | Uint8Array>();
  const extra: TreeChange[] = [];
  if (rec.dir) {
    const doc = await readJsonAt(acc, rec.owner, rec.repo, st, COLLECTION_PATH);
    const c = withoutCollectionEntry(doc, manifestPath(rec.dir));
    if (c?.changed) {
      const data = JSON.stringify(c.doc, null, 2) + "\n";
      const sha = gitBlobSha(data);
      contents.set(sha, data);
      extra.push({ path: COLLECTION_PATH, sha });
    }
  }
  const changes = planRemoveTree({ dir: rec.dir, existing: st.entries, extra });
  let commitUrl = "";
  if (changes.length) {
    const commit = await commitChanges(acc, rec.owner, rec.repo, st, changes, contents, `Remove ${rec.name}\n\nRemoved from labebal.`);
    commitUrl = `${githubEnv().web}/${rec.owner}/${rec.repo}/commit/${commit.sha}`;
  }
  await db.delete(githubPublished).where(eq(githubPublished.id, id));
  return { removed: changes.filter((c) => !c.sha).length, commitUrl };
}

/** Packs published from this app, with "changed here since the last publish" counts. */
export async function listPublished(): Promise<PublishedPackView[]> {
  const db = await getDb();
  const rows = await db.select().from(githubPublished).orderBy(asc(githubPublished.name));
  const accIds = [...new Set(rows.map((r) => r.accountId).filter((x): x is string => !!x))];
  const accs = accIds.length ? await db.select({ id: githubAccounts.id, login: githubAccounts.login }).from(githubAccounts).where(inArray(githubAccounts.id, accIds)) : [];
  const out: PublishedPackView[] = [];
  for (const r of rows) {
    const now = await exportItemHashes(await exportItems({ templateIds: r.templateIds, labelIds: r.labelIds, datasets: r.datasets }));
    const s = summarizeItems(r.items, now);
    out.push({
      id: r.id,
      packId: r.packId,
      accountId: r.accountId,
      accountLogin: accs.find((a) => a.id === r.accountId)?.login ?? null,
      owner: r.owner,
      repo: r.repo,
      branch: r.branch,
      dir: r.dir,
      name: r.name,
      description: r.description,
      author: r.author,
      folder: r.folder,
      version: r.version,
      templateIds: r.templateIds,
      labelIds: r.labelIds,
      datasets: r.datasets,
      commitUrl: r.commitUrl,
      publishedBy: r.publishedBy,
      publishedAt: r.publishedAt.toISOString(),
      changedSince: s.added + s.removed + s.changed,
      htmlUrl: treeUrl(r.owner, r.repo, r.branch, r.dir),
    });
  }
  return out;
}

/** Packs already in a repo (to update one of them): folder, id, name, version. */
export async function repoPacks(scope: string, accountId: string, owner: string, repo: string) {
  const acc = await accountRow(scope, accountId);
  if (!acc) throw new GithubError("GitHub account not found", 404);
  const info = await getRepo(acc, owner, repo);
  if (info.empty) return { packs: [], defaultBranch: info.defaultBranch, canWrite: info.canWrite };
  let st: RepoState;
  try {
    st = await repoState(acc, owner, repo, info.defaultBranch, info.defaultBranch, false);
  } catch (e) {
    if (e instanceof GithubError && (e.status === 404 || e.status === 409)) return { packs: [], defaultBranch: info.defaultBranch, canWrite: info.canWrite };
    throw e;
  }
  const manifests = st.entries.filter((e) => e.type === "blob" && (e.path === PACK_MANIFEST || e.path.endsWith(`/${PACK_MANIFEST}`))).slice(0, 50);
  const packs: { dir: string; id: string; name: string; version: string; description: string }[] = [];
  for (const m of manifests) {
    try {
      const j = JSON.parse(await readBlob(acc, owner, repo, m.sha)) as { id?: string; name?: string; version?: string; description?: string };
      if (j.id) packs.push({ dir: m.path === PACK_MANIFEST ? "" : m.path.slice(0, -PACK_MANIFEST.length - 1), id: j.id, name: j.name ?? j.id, version: j.version ?? "", description: j.description ?? "" });
    } catch {}
  }
  return { packs, defaultBranch: info.defaultBranch, canWrite: info.canWrite };
}
