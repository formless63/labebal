/**
 * Roles and per-user scope of the GitHub / pack-update endpoints, through the
 * route handlers with proxy identity headers (identity turned on below).
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { MockGithub } from "../../test/mock-github";

process.env.LABEBAL_AUTH_HEADERS = "true";
process.env.LABEBAL_ROLE_ADMIN = "admins";
process.env.LABEBAL_ROLE_EDITOR = "editors";
process.env.LABEBAL_DEFAULT_ROLE = "viewer";
process.env.LABEBAL_ANONYMOUS_ROLE = "viewer";

let db: DB;
vi.mock("../../db", () => ({ getDb: async () => db }));

const gh = new MockGithub();
const pkg = path.resolve(__dirname, "../../..");

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(pkg, "drizzle") });
  const url = await gh.start();
  process.env.LABEBAL_GITHUB_API_URL = url;
  process.env.LABEBAL_GITHUB_URL = url;
  process.env.LABEBAL_GITHUB_CLIENT_ID = "mock-client";
}, 60_000);
afterAll(() => gh.stop());

const as = (user: string | null, groups = "") => ({ ...(user ? { "remote-user": user } : {}), ...(groups ? { "remote-groups": groups } : {}), "content-type": "application/json" });
const req = (url: string, method: string, headers: Record<string, string>, body?: unknown) => {
  return new Request(`http://app${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};
const ctx = <T,>(params: T) => ({ params: Promise.resolve(params) }) as never;

describe("GitHub endpoints: roles and scope", () => {
  it("needs a signed-in user to connect", async () => {
    const device = await import("./device/route");
    expect((await device.POST(req("/api/github/device", "POST", as(null)))).status).toBe(401);
    const r = await device.POST(req("/api/github/device", "POST", as("viewer1")));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ userCode: expect.stringMatching(/^WIIM-/) });
  });

  it("keeps accounts per person and never returns tokens", async () => {
    const accounts = await import("./accounts/route");
    const one = await import("./accounts/[id]/route");
    const root = await import("./route");
    const r = await accounts.POST(req("/api/github/accounts", "POST", as("alice", "editors"), { token: "github_pat_mock_octo_000000000000" }));
    expect(r.status).toBe(201);
    const text = await r.text();
    expect(text).not.toContain("github_pat_mock");
    const id = JSON.parse(text).account.id as string;
    const mine = await (await root.GET(req("/api/github", "GET", as("alice", "editors")))).json();
    expect(mine.accounts.map((a: { id: string }) => a.id)).toEqual([id]);
    expect(JSON.stringify(mine)).not.toContain("github_pat_mock");
    const theirs = await (await root.GET(req("/api/github", "GET", as("bob", "admins")))).json();
    expect(theirs.accounts).toEqual([]);
    expect((await one.DELETE(req(`/api/github/accounts/${id}`, "DELETE", as("bob", "admins")), ctx({ id }))).status).toBe(404);
    // An admin can't add a source with someone else's account either.
    const sources = await import("../packs/sources/route");
    expect((await sources.POST(req("/api/packs/sources", "POST", as("bob", "admins"), { input: "friend/label-packs", accountId: id }))).status).toBe(404);
  });

  it("publishing needs the editor role", async () => {
    const publish = await import("./publish/route");
    const body = { accountId: "gh-none", owner: "octo", repo: "x", manifest: { id: "p", name: "P" } };
    expect((await publish.POST(req("/api/github/publish", "POST", as("viewer1"), body))).status).toBe(403);
    expect((await publish.POST(req("/api/github/publish", "POST", as("alice", "editors"), body))).status).toBe(404);
    const published = await import("./published/route");
    expect((await published.GET(req("/api/github/published", "GET", as("viewer1")))).status).toBe(403);
  });

  it("update prompts, previews and skips need the admin role", async () => {
    const check = await import("../packs/check-updates/route");
    const skip = await import("../packs/installed/[id]/skip/route");
    expect((await check.POST(req("/api/packs/check-updates", "POST", as("alice", "editors"), {}))).status).toBe(403);
    const ok = await check.POST(req("/api/packs/check-updates", "POST", as("bob", "admins"), {}));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
    expect((await skip.POST(req("/api/packs/installed/x/skip", "POST", as("alice", "editors"), { version: "1.0.0" }), ctx({ id: "x" }))).status).toBe(403);
  });
});
