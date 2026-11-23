/**
 * Packs against a real (in-memory PGlite) database: adoption of rows seeded
 * by older versions, install / disable / update rules, reset and removal.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { loadPack, type PackReader, type ResolvedPack } from "@labebal/core";
import * as schema from "../db/schema";
import type { DB } from "../db";

const web = path.resolve(__dirname, "../..");
const examplesDir = path.resolve(web, "packs/examples");
process.env.LABEBAL_BUILTIN_PACKS = examplesDir;

let db: DB;
vi.mock("../db", () => ({ getDb: async () => db }));

const fsReader: PackReader = { text: async (u) => readFileSync(new URL(u), "utf8"), bytes: async (u) => new Uint8Array(readFileSync(new URL(u))) };
let examples: ResolvedPack;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(web, "drizzle") });
  examples = await loadPack(pathToFileURL(path.join(examplesDir, "labebal-pack.json")).href, fsReader);
  // An older version seeded these rows (no folders), and someone edited one label.
  for (const t of examples.templates) await db.insert(schema.templates).values({ id: t.id, name: t.name, doc: t });
  for (const l of examples.labels) {
    const tags = (l.tags ?? []).filter((x) => !x.startsWith("folder:"));
    const values = l.id === "l-cable-flag-hdmi" ? { ...l.values, title: "HDMI 2" } : l.values;
    await db.insert(schema.labels).values({ id: l.id, templateId: l.templateId, name: l.name, values, overrides: l.overrides ?? null, invert: l.invert ?? null, tags });
  }
  // Someone's own label on a pack template.
  await db.insert(schema.labels).values({ id: "l-mine", templateId: "t-cable-flag", name: "Mine", values: { title: "X", detail: "Y" }, tags: [] });
}, 60_000);

const isStd = (id: string) => /^[tl]-std-/.test(id);

describe("packs on a database", () => {
  it("adopts old seeded rows as the Examples pack, installed but disabled", async () => {
    const { setupBuiltinPacks } = await import("./packs");
    const { getLibrary } = await import("./library");
    await setupBuiltinPacks(db);
    const [p] = await db.select().from(schema.packs).where(eq(schema.packs.id, "examples"));
    expect(p).toMatchObject({ enabled: false, sourceId: "builtin-examples", version: examples.manifest.version });
    const all = await db.select().from(schema.packItems);
    const items = all.filter((i) => i.packId === "examples");
    expect(items.filter((i) => i.kind === "template")).toHaveLength(examples.templates.length);
    expect(items.filter((i) => i.kind === "label")).toHaveLength(examples.labels.length);
    // Standard formats is installed (and shown) the first time it is offered.
    const [std] = await db.select().from(schema.packs).where(eq(schema.packs.id, "standards"));
    expect(std).toMatchObject({ enabled: true, sourceId: "builtin-examples" });
    const lib = await getLibrary();
    expect(lib.templates.filter((t) => !isStd(t.id))).toHaveLength(0);
    expect(lib.templates.filter((t) => isStd(t.id)).length).toBeGreaterThan(5);
    expect(lib.labels.filter((l) => !isStd(l.id))).toHaveLength(0); // incl. l-mine: its template is hidden
    // Running again (next start) adopts and installs nothing new, even after Standard formats is removed.
    const { removePack } = await import("./packs");
    await removePack("standards", false);
    await setupBuiltinPacks(db);
    expect(await db.select().from(schema.packItems)).toHaveLength(items.length);
    expect(await db.select().from(schema.packs).where(eq(schema.packs.id, "standards"))).toHaveLength(0);
  });

  it("install shows it again and keeps the edited label", async () => {
    const { installPack, packsView } = await import("./packs");
    const { getLibrary } = await import("./library");
    const r = await installPack("builtin-examples", "examples");
    expect(r.inserted).toBe(1); // the sample dataset, which this old DB lacked
    expect(r.kept.map((k) => k.id)).toEqual(["l-cable-flag-hdmi"]);
    const lib = await getLibrary();
    expect(lib.templates).toHaveLength(examples.templates.length);
    expect(lib.labels.find((l) => l.id === "l-cable-flag-hdmi")?.values.title).toBe("HDMI 2");
    expect(lib.packs?.items["label:l-cable-flag-hdmi"]).toEqual({ pack: "examples", changed: true });
    expect(lib.packs?.items["label:l-cable-flag-psu"]).toEqual({ pack: "examples", changed: false });
    // Adopted rows had no folder; moving labels isn't a change, and the folder is kept.
    expect(lib.labels.find((l) => l.id === "l-cable-flag-psu")?.tags).toEqual(["cable"]);
    const view = await packsView();
    const ex = view.installed.find((p) => p.id === "examples")!;
    expect(ex).toMatchObject({ id: "examples", enabled: true, dependents: 1 });
    expect(ex.changed.map((c) => c.id)).toEqual(["l-cable-flag-hdmi"]);
    expect(view.sources.map((s) => s.id)).toEqual(["builtin-examples"]);
  });

  it("disable hides, reset restores the pack version", async () => {
    const { setPackEnabled, resetItems } = await import("./packs");
    const { getLibrary } = await import("./library");
    await setPackEnabled("examples", false);
    expect((await getLibrary()).labels.some((l) => l.id === "l-cable-flag-psu")).toBe(false);
    await setPackEnabled("examples", true);
    const r = await resetItems({ items: [{ kind: "label", id: "l-cable-flag-hdmi" }] });
    expect(r.reset).toBe(1);
    const lib = await getLibrary();
    expect(lib.labels.find((l) => l.id === "l-cable-flag-hdmi")?.values.title).toBe("HDMI 1");
    expect(lib.packs?.items["label:l-cable-flag-hdmi"].changed).toBe(false);
  });

  it("remove keeps what was changed or is used when asked", async () => {
    const { removePlan, removePack } = await import("./packs");
    const { getLibrary } = await import("./library");
    await db.update(schema.labels).set({ name: "Edited" }).where(eq(schema.labels.id, "l-demo-qr"));
    const plan = await removePlan("examples");
    expect(plan?.changed.map((c) => `${c.id}:${c.reason}`).sort()).toEqual(["l-demo-qr:changed", "t-cable-flag:used", "t-demo-elements:used"]);
    expect(plan?.dependents).toBe(1);
    await removePack("examples", true);
    const lib = await getLibrary();
    expect(lib.templates.map((t) => t.id).sort()).toEqual(["t-cable-flag", "t-demo-elements"]);
    expect(lib.labels.map((l) => l.id).sort()).toEqual(["l-demo-qr", "l-mine"]);
    expect(lib.packs).toBeUndefined();
    expect(await db.select().from(schema.packItems)).toHaveLength(0);
  });
});
