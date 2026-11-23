import { describe, expect, it } from "vitest";
import type { ConsumableUsage } from "@labebal/core";
import { applyOp, applyOps, diffOps, familyOf, mapToShared, mapToUser, mergeMaps, mergeUsage, opSchema, patchBodySchema, queueOp, roleNeeded, sharedToMap, userScope, userToMap, type ScopedOp } from "./model";

const size = { id: "c-12x40", printer: "N1", name: "12 x 40 mm", widthMm: 40, heightMm: 12 };
const usage = (printed: number, extra: Partial<ConsumableUsage> = {}): ConsumableUsage => ({ kind: "roll", barcode: "08062224", total: 228, usedAtStart: 10, printed, firstSeen: 1000, ...extra });

describe("settings keys and validation", () => {
  it("knows each key family and rejects unknown keys", () => {
    expect(familyOf("shared", "customSize:c-12x40")?.role).toBe("editor");
    expect(familyOf("shared", "learnedRoll:08062224")?.role).toBe("printer");
    expect(familyOf("shared", "usage:roll:ABC123")?.role).toBe("printer");
    expect(familyOf("shared", "densityPreset:N1:white")).toBeDefined();
    expect(familyOf("shared", "favourites")).toBeUndefined();
    expect(familyOf("user", "favourites")).toBeDefined();
    expect(familyOf("user", "customSize:x")).toBeUndefined();
    expect(familyOf("shared", "learnedRoll:bad barcode!")).toBeUndefined();
    expect(applyOp("shared", { op: "set", key: "nonsense", value: 1 }, undefined)).toMatchObject({ ok: false, status: 400 });
  });

  it("validates values per key", () => {
    expect(applyOp("shared", { op: "set", key: "customSize:c-12x40", value: size }, undefined)).toMatchObject({ ok: true, value: size });
    expect(applyOp("shared", { op: "set", key: "customSize:c-12x40", value: { ...size, widthMm: -1 } }, undefined).ok).toBe(false);
    expect(applyOp("shared", { op: "set", key: "learnedRoll:1", value: { sizeId: "" } }, undefined).ok).toBe(false);
    expect(applyOp("shared", { op: "set", key: "densityPreset:N1:white", value: 2.5 }, undefined).ok).toBe(false);
    expect(applyOp("shared", { op: "set", key: "model:N1", value: { mediaKind: "glitter" } }, undefined).ok).toBe(false);
    expect(applyOp("user", { op: "set", key: "favourites", value: [1, 2] }, undefined).ok).toBe(false);
    expect(applyOp("shared", { op: "set", key: "folder:Drawers", value: true }, undefined).ok).toBe(true);
    // Unknown fields are dropped, not stored.
    expect(applyOp("shared", { op: "set", key: "learnedRoll:1", value: { sizeId: "n1-14x30", evil: "x" } }, undefined)).toEqual({ ok: true, value: { sizeId: "n1-14x30" } });
  });

  it("parses request bodies", () => {
    expect(patchBodySchema.safeParse({ ops: [{ scope: "shared", op: "delete", key: "folder:A" }] }).success).toBe(true);
    expect(patchBodySchema.safeParse({ ops: [{ scope: "team", op: "delete", key: "folder:A" }] }).success).toBe(false);
    expect(patchBodySchema.safeParse({ ops: [] }).success).toBe(false);
    expect(opSchema.safeParse({ op: "usage", key: "usage:roll:1", info: { kind: "roll", barcode: "1", total: 1, used: 0 }, n: -1 }).success).toBe(false);
  });

  it("lower-cases the user scope", () => {
    expect(userScope(" Alice@Example.com ")).toBe("user:alice@example.com");
  });
});

describe("roles", () => {
  const profile = familyOf("shared", "profile:sn:1")!;
  it("lets printers record rolls and use a roll, editors change the rest", () => {
    expect(roleNeeded(familyOf("shared", "learnedRoll:1")!, { op: "set", key: "learnedRoll:1", value: {} }, undefined)).toBe("printer");
    expect(roleNeeded(familyOf("shared", "customSize:x")!, { op: "set", key: "customSize:x", value: size }, undefined)).toBe("editor");
    const cur = { key: "sn:1", name: "Desk", model: "N1", sizeId: "n1-14x30" };
    // "Use this roll" on a second printer only changes the loaded size / stock.
    expect(roleNeeded(profile, { op: "set", key: "profile:sn:1", value: { ...cur, sizeId: "n1-14x50", material: "white" } }, cur)).toBe("printer");
    // A printer seen for the first time.
    expect(roleNeeded(profile, { op: "set", key: "profile:sn:2", value: { key: "sn:2", name: "", model: "N1" } }, undefined)).toBe("printer");
    // Renaming or overrides need an editor.
    expect(roleNeeded(profile, { op: "set", key: "profile:sn:1", value: { ...cur, name: "Shelf" } }, cur)).toBe("editor");
    expect(roleNeeded(profile, { op: "set", key: "profile:sn:1", value: { ...cur, printTask: "B1" } }, cur)).toBe("editor");
    expect(roleNeeded(profile, { op: "delete", key: "profile:sn:1" }, cur)).toBe("editor");
  });
});

describe("merge (first upload from a browser)", () => {
  it("never overwrites server values", () => {
    const server = { "learnedRoll:1": { sizeId: "n1-14x30" }, "densityPreset:N1:white": 3 };
    const local = { "learnedRoll:1": { sizeId: "n1-14x50" }, "densityPreset:N1:white": 1, "learnedRoll:2": { sizeId: "n1-14x40" } };
    expect(mergeMaps("shared", server, local)).toEqual({ "learnedRoll:1": { sizeId: "n1-14x30" }, "densityPreset:N1:white": 3, "learnedRoll:2": { sizeId: "n1-14x40" } });
  });

  it("fills missing fields of objects", () => {
    const r = applyOp("shared", { op: "merge", key: "profile:sn:1", value: { key: "sn:1", name: "Old", model: "N1", printTask: "B1" } }, { key: "sn:1", name: "Desk", model: "N1" });
    expect(r).toEqual({ ok: true, value: { key: "sn:1", name: "Desk", model: "N1", printTask: "B1" } });
  });

  it("unions lists, server order first", () => {
    expect(mergeMaps("user", { favourites: ["a", "b"] }, { favourites: ["c", "a"], pinned: ["x"] })).toEqual({ favourites: ["a", "b", "c"], pinned: ["x"] });
    const recent = Array.from({ length: 24 }, (_, i) => `s${i}`);
    expect((mergeMaps("user", { iconRecent: recent }, { iconRecent: ["new"] }).iconRecent as string[]).length).toBe(24);
  });

  it("adds roll counts from both browsers", () => {
    expect(mergeUsage(usage(5, { lastUsed: 2000 }), usage(7, { usedAtStart: 4, firstSeen: 500, lastUsed: 3000 }))).toEqual(usage(12, { usedAtStart: 4, firstSeen: 500, lastUsed: 3000 }));
    expect(mergeMaps("shared", { "usage:roll:1": usage(5) }, { "usage:roll:1": usage(3) })["usage:roll:1"]).toMatchObject({ printed: 8 });
  });

  it("drops invalid browser values instead of storing them", () => {
    expect(applyOp("shared", { op: "merge", key: "customSize:x", value: { id: "x" } }, undefined).ok).toBe(false);
  });
});

describe("list and usage operations", () => {
  it("adds and removes members", () => {
    expect(applyOp("user", { op: "add", key: "favourites", items: ["b", "a"] }, ["a"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(applyOp("user", { op: "add", key: "iconFavourites", items: ["z"], front: true }, ["a", "z"])).toEqual({ ok: true, value: ["z", "a"] });
    expect(applyOp("user", { op: "remove", key: "pinned", items: ["a"] }, ["a", "b"])).toEqual({ ok: true, value: ["b"] });
    expect(applyOp("shared", { op: "add", key: "customSize:x", items: ["a"] }, undefined).ok).toBe(false);
  });

  it("counts prints on the shared roll record", () => {
    const info = { kind: "roll" as const, barcode: "08062224", total: 228, used: 10 };
    const first = applyOp("shared", { op: "usage", key: "usage:roll:ABC", info, n: 3, at: 1000 }, undefined);
    expect(first).toEqual({ ok: true, value: { kind: "roll", barcode: "08062224", total: 228, usedAtStart: 10, printed: 3, firstSeen: 1000, lastUsed: 1000 } });
    const again = applyOp("shared", { op: "usage", key: "usage:roll:ABC", info: { ...info, used: 13 }, n: 2, at: 2000 }, (first as { value: unknown }).value);
    expect(again).toMatchObject({ ok: true, value: { usedAtStart: 10, printed: 5, lastUsed: 2000 } });
  });
});

describe("diffOps", () => {
  it("turns list changes into add / remove, so both browsers' toggles survive", () => {
    expect(diffOps("user", { favourites: ["a", "b"] }, { favourites: ["b", "c"] })).toEqual([
      { op: "add", key: "favourites", items: ["c"], front: false },
      { op: "remove", key: "favourites", items: ["a"] },
    ]);
    // Two browsers: server applies both browsers' changes.
    const server = applyOps("user", { favourites: ["a"] }, [...diffOps("user", { favourites: ["a"] }, { favourites: ["a", "x"] }), ...diffOps("user", { favourites: ["a"] }, { favourites: [] })]);
    expect(server).toEqual({ favourites: ["x"] });
  });

  it("turns new prints into a usage increment", () => {
    const ops = diffOps("shared", { "usage:roll:1": usage(5) }, { "usage:roll:1": usage(8, { lastUsed: 5000 }) });
    expect(ops).toEqual([{ op: "usage", key: "usage:roll:1", info: { kind: "roll", barcode: "08062224", total: 228, used: 10 }, n: 3, at: 5000 }]);
    // Another browser printed 4 meanwhile: the increments add up.
    const server = applyOps("shared", { "usage:roll:1": usage(9) }, ops);
    expect(server["usage:roll:1"]).toMatchObject({ printed: 12 });
  });

  it("sets, deletes and ignores unknown keys", () => {
    expect(diffOps("shared", { "folder:A": true, x: 1 }, { "learnedRoll:1": { sizeId: "a" }, y: 2 })).toEqual([
      { op: "set", key: "learnedRoll:1", value: { sizeId: "a" } },
      { op: "delete", key: "folder:A" },
    ]);
  });

  it("queueOp replaces earlier writes of the same key, keeps increments", () => {
    let q: ScopedOp[] = [];
    q = queueOp(q, { scope: "shared", op: "set", key: "folder:A", value: true });
    q = queueOp(q, { scope: "shared", op: "delete", key: "folder:A" });
    q = queueOp(q, { scope: "user", op: "add", key: "favourites", items: ["a"] });
    q = queueOp(q, { scope: "user", op: "add", key: "favourites", items: ["b"] });
    expect(q.map((o) => o.op)).toEqual(["delete", "add", "add"]);
  });
});

describe("store slices <-> settings map", () => {
  it("round-trips the shared slices and keeps lastSeen local", () => {
    const slices = {
      customSizes: [{ ...size, custom: true }],
      customMaterials: [{ id: "c-freezer", name: "Freezer film", css: "#eef", rgb: [238, 238, 255] as [number, number, number], thermal: "transfer" as const, tags: ["freezer"], custom: true }],
      customRibbons: [{ id: "c-wax", name: "Wax black", css: "#000", rgb: [0, 0, 0] as [number, number, number], custom: true }],
      learnedRolls: { "08062224": { sizeId: "n1-14x30", materialId: "laser-gold" } },
      densityPresets: { "N1:white": 2 },
      models: { N1: { printTask: "B1" }, M2_H: {} },
      profiles: { "sn:1": { key: "sn:1", name: "Desk", model: "N1", lastSeen: 99 } },
      usage: { "roll:1": usage(1) },
      newFolders: ["Drawers"],
      teamValues: { company: "Acme Ltd" },
    };
    const m = sharedToMap(slices);
    expect(m["customSize:c-12x40"]).toEqual(size);
    expect(m["profile:sn:1"]).toEqual({ key: "sn:1", name: "Desk", model: "N1" });
    expect("model:M2_H" in m).toBe(false);
    const back = mapToShared(m, { "sn:1": 99 });
    expect(back.profiles["sn:1"].lastSeen).toBe(99);
    expect(back.customSizes).toEqual([size]);
    expect(m["customStock:c-freezer"]).toEqual({ id: "c-freezer", name: "Freezer film", css: "#eef", rgb: [238, 238, 255], thermal: "transfer", tags: ["freezer"] });
    expect(back.customMaterials.map((x) => x.id)).toEqual(["c-freezer"]);
    expect(back.customRibbons.map((x) => x.id)).toEqual(["c-wax"]);
    expect(back.newFolders).toEqual(["Drawers"]);
    expect(m["team:company"]).toBe("Acme Ltd");
    expect(back.teamValues).toEqual({ company: "Acme Ltd" });
    expect(back.models).toEqual({ N1: { printTask: "B1" } });
  });

  it("round-trips the user slices", () => {
    const u = { favourites: ["a"], pinned: [], openFolders: ["X"], iconFavourites: ["tabler:home"], iconRecent: [] };
    expect(mapToUser(userToMap(u))).toEqual(u);
  });
});
