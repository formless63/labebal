/**
 * GitHub integration against an in-memory database and the mock GitHub
 * (src/test/mock-github.ts): device flow, token accounts, repos, publishing
 * (one commit, version bump, collection), following a repo through an
 * account (SHA / ETag checks) and update prompts (dry-run summaries, skip).
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Template } from "@labebal/core";
import * as schema from "../db/schema";
import type { DB } from "../db";
import { MockGithub } from "../test/mock-github";

const web = path.resolve(__dirname, "../..");
process.env.LABEBAL_BUILTIN_PACKS = path.resolve(web, "packs/examples");

let db: DB;
vi.mock("../db", () => ({ getDb: async () => db }));

const gh = new MockGithub({ autoApproveAfter: 1 });
const SCOPE = "instance";
const PAT = "github_pat_mock_octo_000000000000";
let clock = Date.now();
const realNow = Date.now.bind(Date);

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(web, "drizzle") });
  const url = await gh.start();
  process.env.LABEBAL_GITHUB_API_URL = url;
  process.env.LABEBAL_GITHUB_URL = url;
  process.env.LABEBAL_GITHUB_CLIENT_ID = "mock-client";
  process.env.LABEBAL_GITHUB_APP_SLUG = "labebal-mock";
  // Library: the cable flag template and two labels.
  const t = JSON.parse(readFileSync(path.resolve(web, "packs/examples/templates/cable-flag.json"), "utf8")) as Template;
  await db.insert(schema.templates).values({ id: t.id, name: t.name, doc: t });
  await db.insert(schema.labels).values([
    { id: "l-a", templateId: t.id, name: "HDMI", values: { title: "HDMI", detail: "TV" }, tags: ["folder:Cables"] },
    { id: "l-b", templateId: t.id, name: "USB", values: { title: "USB", detail: "PC" }, tags: ["folder:Cables"] },
  ]);
  gh.addRepo("friend", "label-packs", {
    "labebal-packs.json": JSON.stringify({ name: "Friend's packs", packs: ["shelf/labebal-pack.json"] }),
    "shelf/labebal-pack.json": JSON.stringify({ id: "friend-shelf", name: "Shelf labels", version: "1.0.0", templates: ["templates/flag.json"], labels: ["labels/shelf.csv"] }),
    "shelf/templates/flag.json": JSON.stringify({ ...t, id: "t-friend", name: "Friend flag" }),
    "shelf/labels/shelf.csv": "id,name,template,title,detail\nl-shelf-a,Shelf A,t-friend,A,a\nl-shelf-b,Shelf B,t-friend,B,b\n",
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await gh.stop();
});

/** Move time forward (device-flow intervals) without waiting. */
function advance(ms: number) {
  clock = Math.max(clock, realNow()) + ms;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
}

describe("accounts", () => {
  it("connects with the device flow (pending, then done) and stores the account", async () => {
    const g = await import("./github");
    const start = await g.startDeviceFlow(SCOPE);
    expect(start.userCode).toMatch(/^WIIM-/);
    expect(start.verificationUri).toBe(`${gh.url}/login/device`);
    // Not due yet: nobody asks GitHub.
    const polls = () => gh.log.filter((l) => l.includes("/login/oauth/access_token")).length;
    expect((await g.deviceStatus(SCOPE, start.id))!.status).toBe("pending");
    expect(polls()).toBe(0);
    advance(1100);
    expect((await g.deviceStatus(SCOPE, start.id))!.status).toBe("pending");
    expect(polls()).toBe(1);
    // Another person can't read this session.
    expect(await g.deviceStatus("user:someone", start.id)).toBeNull();
    advance(1100);
    const done = await g.deviceStatus(SCOPE, start.id);
    expect(done).toMatchObject({ status: "done", account: { login: "octo", kind: "app", commitEmail: "1001+octo@users.noreply.github.com" } });
    vi.restoreAllMocks();
    const accounts = await g.listAccounts(SCOPE);
    expect(accounts).toHaveLength(1);
    expect(JSON.stringify(accounts)).not.toContain("ghu_mock");
    expect(JSON.stringify(done)).not.toContain("ghu_mock");
  });

  it("adds a personal token after checking it (and the repo)", async () => {
    const g = await import("./github");
    await expect(g.addTokenAccount(SCOPE, "github_pat_wrong_000000000000000")).rejects.toThrow(/did not accept/);
    await expect(g.addTokenAccount(SCOPE, PAT, { owner: "friend", repo: "nope" })).rejects.toThrow(/can't see/);
    const r = await g.addTokenAccount(SCOPE, PAT, { owner: "friend", repo: "label-packs" });
    expect(r.account).toMatchObject({ login: "octo", kind: "token" });
    expect(r.repo).toMatchObject({ fullName: "friend/label-packs", canWrite: false });
    expect(JSON.stringify(r)).not.toContain(PAT);
    expect(await g.listAccounts(SCOPE)).toHaveLength(2);
  });

  it("sends tokens only to GitHub hosts", async () => {
    const g = await import("./github");
    await expect(g.ghFetch("https://example.com/user", { token: "x" })).rejects.toThrow(/not a GitHub host/);
  });
});

const app = async () => (await import("./github")).listAccounts(SCOPE).then((a) => a.find((x) => x.kind === "app")!);
const row = async (id: string) => (await (await import("./github")).accountRow(SCOPE, id))!;

describe("repos", () => {
  it("creates a repo for packs, or explains what to do when it can't", async () => {
    const g = await import("./github");
    const acc = await row((await app()).id);
    const made = await g.createRepo(acc, { name: "labebal-packs", private: true, description: "Label packs" });
    expect(made).toMatchObject({ created: true, repo: { fullName: "octo/labebal-packs", private: true, canWrite: true } });
    await expect(g.createRepo(acc, { name: "labebal-packs", private: true, description: "" })).rejects.toThrow(/already have/);
    // App installed on selected repos only: the new repo needs adding.
    gh.opts.installationRepos = ["octo/labebal-packs"];
    expect(await g.createRepo(acc, { name: "more-packs", private: false, description: "" })).toMatchObject({ created: true, needsInstall: true, installUrl: `${gh.url}/apps/labebal-mock/installations/new` });
    gh.opts.installationRepos = null;
    // App without Administration permission: prefilled github.com/new.
    gh.opts.appCannotCreateRepos = true;
    const fb = await g.createRepo(acc, { name: "x-packs", private: true, description: "d" });
    expect(fb.created).toBe(false);
    expect(fb.newRepoUrl).toBe(`${gh.url}/new?name=x-packs&visibility=private&description=d`);
    gh.opts.appCannotCreateRepos = false;
    const list = await g.listRepos(acc);
    expect(list.installations).toBe(1);
    expect(list.repos.map((r) => r.fullName)).toContain("octo/labebal-packs");
  });
});

describe("publishing", () => {
  const req = (over: Partial<import("./github-publish").PublishRequest> = {}) => ({
    accountId: "",
    owner: "octo",
    repo: "labebal-packs",
    dir: "cables",
    manifest: { id: "my-cables", name: "My cables", description: "Flags" },
    bump: "patch" as const,
    templateIds: [],
    labelIds: ["l-a", "l-b"],
    datasets: false,
    ...over,
  });

  it("publishes a pack in one commit with the collection", async () => {
    const { publishPack, listPublished } = await import("./github-publish");
    const acc = await app();
    const before = gh.headCommit("octo/labebal-packs")!.sha;
    const r = await publishPack(SCOPE, "Tester", req({ accountId: acc.id }));
    expect(r).toMatchObject({ unchanged: false, version: "1.0.0", summary: { first: true, added: 3 } });
    const head = gh.headCommit("octo/labebal-packs")!;
    expect(head.parents).toEqual([before]);
    expect(head.message.split("\n")[0]).toBe("Publish My cables 1.0.0");
    expect(head.author).toMatchObject({ name: "Octo Cat", email: "1001+octo@users.noreply.github.com" });
    const files = gh.files("octo/labebal-packs");
    expect(JSON.parse(files["cables/labebal-pack.json"])).toMatchObject({ id: "my-cables", version: "1.0.0" });
    expect(JSON.parse(files["labebal-packs.json"]).packs).toEqual(["cables/labebal-pack.json"]);
    expect(files["README.md"]).toBeDefined();
    expect(Object.keys(files).filter((p) => p.startsWith("cables/labels/"))).toHaveLength(1);
    const pub = await listPublished();
    expect(pub).toMatchObject([{ packId: "my-cables", version: "1.0.0", changedSince: 0, accountLogin: "octo" }]);
    await expect((await import("./github")).listAccounts(SCOPE).then((a) => a.find((x) => x.id === acc.id)?.defaultRepo)).resolves.toBe("octo/labebal-packs");
  });

  it("does nothing when nothing changed, bumps and summarizes when something did", async () => {
    const { publishPack, listPublished } = await import("./github-publish");
    const acc = await app();
    const head = gh.headCommit("octo/labebal-packs")!.sha;
    expect(await publishPack(SCOPE, "Tester", req({ accountId: acc.id }))).toMatchObject({ unchanged: true, version: "1.0.0" });
    expect(gh.headCommit("octo/labebal-packs")!.sha).toBe(head);
    await db.update(schema.labels).set({ values: { title: "HDMI 2", detail: "TV" } }).where(eq(schema.labels.id, "l-a"));
    expect((await listPublished())[0].changedSince).toBe(1);
    const r = await publishPack(SCOPE, "Tester", req({ accountId: acc.id, bump: "minor" }));
    expect(r).toMatchObject({ unchanged: false, version: "1.1.0", summary: { added: 0, removed: 0, changed: 1, first: false }, files: { added: 0, removed: 0, changed: 2 } });
    expect(gh.headCommit("octo/labebal-packs")!.message.split("\n")[0]).toBe("My cables 1.1.0: 1 changed");
    // A pack with another id can't take the folder.
    await expect(publishPack(SCOPE, "T", req({ accountId: acc.id, manifest: { id: "other", name: "Other" } }))).rejects.toThrow(/holds another pack/);
  });

  it("starts an empty repo with a first commit", async () => {
    const { publishPack } = await import("./github-publish");
    gh.addRepo("octo", "empty-packs", null);
    const r = await publishPack(SCOPE, "T", req({ accountId: (await app()).id, repo: "empty-packs", dir: "" }));
    expect(r.version).toBe("1.0.0");
    const files = gh.files("octo/empty-packs");
    expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(["README.md", "labebal-pack.json"]));
    expect(files["labebal-packs.json"]).toBeUndefined();
  });

  it("removes a published pack (folder + collection entry) in one commit", async () => {
    const { listPublished, unpublishPack } = await import("./github-publish");
    const rec = (await listPublished()).find((p) => p.repo === "labebal-packs")!;
    const r = await unpublishPack(SCOPE, rec.id);
    expect(r.removed).toBeGreaterThan(1);
    const files = gh.files("octo/labebal-packs");
    expect(Object.keys(files).some((p) => p.startsWith("cables/"))).toBe(false);
    expect(JSON.parse(files["labebal-packs.json"]).packs).toEqual([]);
    expect((await listPublished()).find((p) => p.id === rec.id)).toBeUndefined();
  });
});

describe("following a repo through an account, update prompts", () => {
  it("adds a source with an account, checks by commit SHA, summarizes updates", async () => {
    const packs = await import("./packs");
    const acc = await row((await app()).id);
    const s = await packs.addSource("friend/label-packs", null, acc);
    expect(s).toMatchObject({ account: { login: "octo" }, hasToken: false });
    expect(s.index?.packs.map((p) => p.id)).toEqual(["friend-shelf"]);
    await packs.installPack(s.id, "friend-shelf");

    // Unchanged repo: one SHA request answered 304, no file reads.
    gh.log.length = 0;
    expect(await packs.checkUpdates({ force: true })).toEqual([]);
    expect(gh.log.filter((l) => l.includes("/commits/"))).toHaveLength(1);
    expect(gh.log.some((l) => l.includes("/contents/"))).toBe(false);

    // Changed here, then the friend publishes 1.1.0.
    await db.update(schema.labels).set({ values: { title: "A mine", detail: "a" } }).where(eq(schema.labels.id, "l-shelf-a"));
    gh.push("friend/label-packs", {
      "shelf/labebal-pack.json": JSON.stringify({ id: "friend-shelf", name: "Shelf labels", version: "1.1.0", templates: ["templates/flag.json"], labels: ["labels/shelf.csv"] }),
      "shelf/labels/shelf.csv": "id,name,template,title,detail\nl-shelf-a,Shelf A,t-friend,A1,a\nl-shelf-c,Shelf C,t-friend,C,c\nl-shelf-d,Shelf D,t-friend,D,d\n",
    });
    const ups = await packs.checkUpdates({ force: true });
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ packId: "friend-shelf", from: "1.0.0", to: "1.1.0" });
    expect(ups[0].added.map((i) => i.id).sort()).toEqual(["l-shelf-c", "l-shelf-d"]);
    expect(ups[0].removed.map((i) => i.id)).toEqual(["l-shelf-b"]);
    expect(ups[0].changed).toEqual([]);
    expect(ups[0].kept).toEqual([{ kind: "label", id: "l-shelf-a", name: "Shelf A", reason: "changed" }]);

    const pv = await packs.updatePreview("friend-shelf");
    expect(pv?.added[0].after).toMatchObject({ templateId: "t-friend" });
    expect(pv?.kept[0].before).toMatchObject({ values: { title: "A mine" } });
    expect(pv?.templates?.["t-friend"]).toBeDefined();

    await packs.skipUpdate("friend-shelf", "1.1.0", "T");
    expect(await packs.checkUpdates({})).toEqual([]);
    expect((await packs.packsView()).installed.find((p) => p.id === "friend-shelf")).toMatchObject({ skipped: "1.1.0", available: "1.1.0" });
    await packs.skipUpdate("friend-shelf", null, "T");
    expect(await packs.checkUpdates({})).toHaveLength(1);

    const res = await packs.updatePack("friend-shelf");
    expect(res).toMatchObject({ inserted: 2, removed: 1 });
    expect(res.kept.map((k) => k.id)).toEqual(["l-shelf-a"]);
    expect(await packs.checkUpdates({})).toEqual([]);
    // Views never carry tokens.
    expect(JSON.stringify(await packs.packsView())).not.toMatch(/ghu_mock|github_pat_mock/);
  });

  it("marks an account for reconnecting when GitHub answers 401", async () => {
    const g = await import("./github");
    const acc = await row((await app()).id);
    gh.tokens.delete("ghu_mock_octo");
    await expect(g.listRepos(acc)).rejects.toThrow(/Reconnect/);
    expect((await g.listAccounts(SCOPE)).find((a) => a.id === acc.id)?.status).toBe("reconnect");
    // Sources using it report the problem instead of failing silently.
    const packs = await import("./packs");
    await packs.checkUpdates({ force: true });
    const src = (await packs.packsView()).sources.find((s) => s.account);
    expect(src?.lastError).toMatch(/Reconnect/);
  });
});
