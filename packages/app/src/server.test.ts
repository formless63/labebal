/**
 * The module as a host app uses it: its own Drizzle database, its own
 * signed-in user, mounted at /labels.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createLabebalServer, type DB, type HostUser } from "./server";
import { matchRoute } from "./api/handler";

const client = new PGlite();
const db = drizzle(client) as unknown as DB;
let who: HostUser | null = null;

const labebal = createLabebalServer({
  db,
  basePath: "/labels/",
  user: () => who,
  env: { LABEBAL_SCHEDULER: "off" },
  features: { backups: false },
});

const call = (path: string, init?: RequestInit) => labebal.handler(new Request(`http://host.test${path}`, init));

beforeAll(() => labebal.ready(), 60_000);
afterAll(() => client.close());

describe("createLabebalServer", () => {
  it("migrates the host database into its own migration table", async () => {
    const r = await db.execute(sql`select count(*)::int as n from drizzle.__labebal_migrations`);
    const rows = (r as unknown as { rows: { n: number }[] }).rows;
    expect(rows[0].n).toBeGreaterThan(5);
    const t = await db.execute(sql`select to_regclass('public.label_templates') as t`);
    expect((t as unknown as { rows: { t: string | null }[] }).rows[0].t).toBe("label_templates");
  });

  it("serves the API under the base path only", async () => {
    expect(labebal.apiBase).toBe("/labels/api");
    expect((await call("/labels/api/library")).status).toBe(200);
    expect((await call("/api/library")).status).toBe(404);
    expect((await call("/labels/api/nope")).status).toBe(404);
    expect((await call("/labels/api/library", { method: "DELETE" })).status).toBe(405);
  });

  it("takes the signed-in user and role from the host", async () => {
    who = null;
    expect(await (await call("/labels/api/me")).json()).toMatchObject({ signedIn: false, role: "viewer" });
    // A viewer can't save a template.
    const t = { ...JSON.parse(readFileSync(path.resolve(__dirname, "../packs/examples/templates/cable-flag.json"), "utf8")), id: "t-host" };
    const put = (u: HostUser | null) => {
      who = u;
      return call("/labels/api/templates/t-host", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
    };
    expect((await put(null)).status).toBe(403);
    expect((await put({ id: "u1", name: "Pat", role: "printer" })).status).toBe(403);
    const ok = await put({ id: "u1", name: "Pat", role: "editor" });
    expect(ok.status).toBeLessThan(300);
    who = { id: "u1", name: "Pat", email: "pat@example.com", role: "admin" };
    expect(await (await call("/labels/api/me")).json()).toMatchObject({ signedIn: true, user: "u1", display: "Pat", role: "admin" });
  });

  it("hides parts the host turned off", async () => {
    who = { id: "a", role: "admin" };
    expect((await call("/labels/api/backup")).status).toBe(404);
  });

  it("serves its own static files", async () => {
    const r = await call("/labels/api/static/fonts/JetBrainsMono.ttf");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("font/ttf");
    expect((await call("/labels/api/static/../package.json")).status).toBe(404);
    expect((await call("/labels/api/static/%2e%2e/package.json")).status).toBe(404);
  });

  it("matches static segments before parameters", () => {
    expect(matchRoute(["counters", "reserve"])?.params).toEqual({});
    expect(matchRoute(["counters", "c1"])?.params).toEqual({ id: "c1" });
  });
});
