import { describe, expect, it } from "vitest";
import { SettingsSyncEngine, type PatchResult, type SettingsSnapshot } from "./engine";
import { applyOp, type ScopedOp, type SettingEntry } from "./model";

/** In-memory server applying the same rules as server/settings.ts. */
function fakeServer(role: "viewer" | "printer" | "editor" = "editor") {
  const rows: Record<string, Record<string, unknown>> = { shared: {}, user: {} };
  let online = true;
  const editorKeys = ["customSize:", "densityPreset:", "model:", "folder:", "profile:"];
  return {
    rows,
    setOnline: (v: boolean) => void (online = v),
    snapshot: (user: string | null = "user:alice"): SettingsSnapshot => {
      const entries = (m: Record<string, unknown>): SettingEntry[] => Object.entries(m).map(([key, value]) => ({ key, value, updatedAt: "", updatedBy: "" }));
      return { shared: entries(rows.shared), user: user ? entries(rows.user) : null, userScope: user };
    },
    send: async (ops: ScopedOp[]): Promise<PatchResult> => {
      if (!online) throw new Error("offline");
      const res: PatchResult = { changed: [], denied: [] };
      for (const op of ops) {
        if (op.scope === "shared" && role !== "editor" && editorKeys.some((k) => op.key.startsWith(k))) {
          res.denied.push({ scope: op.scope, key: op.key, status: 403, error: "Needs the editor role." });
          continue;
        }
        const r = applyOp(op.scope, op, rows[op.scope][op.key]);
        if (!r.ok) {
          res.denied.push({ scope: op.scope, key: op.key, status: r.status, error: r.error });
          continue;
        }
        if ("deleted" in r) {
          delete rows[op.scope][op.key];
          res.changed.push({ scope: op.scope, entry: { key: op.key, deleted: true } });
        } else {
          rows[op.scope][op.key] = r.value;
          res.changed.push({ scope: op.scope, entry: { key: op.key, value: r.value, updatedAt: "", updatedBy: "" } });
        }
      }
      return res;
    },
  };
}

/** A browser: its stores (as maps) and its localStorage. */
function browser(server: ReturnType<typeof fakeServer>, init: { shared?: Record<string, unknown>; user?: Record<string, unknown> } = {}) {
  const st = { shared: { ...init.shared }, user: { ...init.user } };
  const ls: Record<string, unknown> = {};
  const denied: PatchResult["denied"][] = [];
  const engine = new SettingsSyncEngine({
    readShared: () => ({ ...st.shared }),
    writeShared: (m) => void (st.shared = { ...m }),
    readUser: () => ({ ...st.user }),
    writeUser: (m) => void (st.user = { ...m }),
    load: (n) => (ls[n] === undefined ? null : JSON.parse(JSON.stringify(ls[n]))),
    save: (n, v) => void (ls[n] = JSON.parse(JSON.stringify(v))),
    send: server.send,
    onDenied: (d) => denied.push(d),
  });
  return {
    st,
    ls,
    denied,
    engine,
    change(fn: (s: typeof st) => void) {
      fn(st);
      engine.localChanged();
    },
  };
}

const size = (id: string, name = id) => ({ id, printer: "N1", name, widthMm: 40, heightMm: 12 });

describe("first load: uploading what a browser already has", () => {
  it("merges into the server, keeping newer server values, and marks the upload done", async () => {
    const server = fakeServer();
    server.rows.shared["customSize:a"] = size("a", "Server name");
    server.rows.shared["densityPreset:N1:white"] = 3;
    const b = browser(server, { shared: { "customSize:a": size("a", "Old name"), "customSize:b": size("b"), "densityPreset:N1:white": 1 }, user: { favourites: ["l1"] } });
    b.engine.applySnapshot(server.snapshot());
    // The browser already shows the merged result.
    expect(b.st.shared).toEqual({ "customSize:a": size("a", "Server name"), "customSize:b": size("b"), "densityPreset:N1:white": 3 });
    expect(b.engine.meta.sharedMigrated).toBe(false);
    expect(await b.engine.flush()).toBe(true);
    expect(server.rows.shared["customSize:b"]).toEqual(size("b"));
    expect(server.rows.shared["customSize:a"]).toEqual(size("a", "Server name"));
    expect(server.rows.user.favourites).toEqual(["l1"]);
    expect(b.engine.meta.sharedMigrated).toBe(true);
    expect(b.engine.meta.userMigrated).toEqual(["user:alice"]);
  });

  it("keeps the browser copy and retries while offline, uploading once", async () => {
    const server = fakeServer();
    server.rows.shared["usage:roll:1"] = { kind: "roll", barcode: "x", total: 200, usedAtStart: 0, printed: 10, firstSeen: 1 };
    server.setOnline(false);
    const local = { "usage:roll:1": { kind: "roll", barcode: "x", total: 200, usedAtStart: 0, printed: 4, firstSeen: 1 } };
    const b = browser(server, { shared: local });
    b.engine.applySnapshot(server.snapshot());
    expect(await b.engine.flush()).toBe(false);
    expect(b.engine.meta.sharedMigrated).toBe(false);
    // A later refresh while still offline must not queue the upload twice (counts would double).
    b.engine.applySnapshot(server.snapshot());
    expect(b.engine.outbox.filter((o) => o.mig).length).toBe(1);
    // Reload of the page: the queued upload survives in localStorage.
    const reloaded = new SettingsSyncEngine({
      readShared: () => ({ ...b.st.shared }),
      writeShared: (m) => void (b.st.shared = m),
      readUser: () => ({}),
      writeUser: () => {},
      load: (n) => b.ls[n],
      save: (n, v) => void (b.ls[n] = v),
      send: server.send,
    });
    server.setOnline(true);
    reloaded.applySnapshot(server.snapshot());
    expect(await reloaded.flush()).toBe(true);
    expect(server.rows.shared["usage:roll:1"]).toMatchObject({ printed: 14 });
    expect(reloaded.meta.sharedMigrated).toBe(true);
  });

  it("an empty browser is done at once and never uploads the server's copy back", async () => {
    const server = fakeServer();
    server.rows.shared["usage:roll:1"] = { kind: "roll", barcode: "x", total: 200, usedAtStart: 0, printed: 10, firstSeen: 1 };
    const b = browser(server);
    b.engine.applySnapshot(server.snapshot());
    expect(b.engine.meta.sharedMigrated).toBe(true);
    expect(b.engine.meta.userMigrated).toEqual(["user:alice"]);
    b.engine.applySnapshot(server.snapshot());
    await b.engine.flush();
    expect(server.rows.shared["usage:roll:1"]).toMatchObject({ printed: 10 });
  });

  it("does not upload again after it succeeded", async () => {
    const server = fakeServer();
    const b = browser(server, { shared: { "folder:A": true } });
    b.engine.applySnapshot(server.snapshot());
    await b.engine.flush();
    // Someone deletes the folder; this browser must not bring it back.
    delete server.rows.shared["folder:A"];
    b.engine.applySnapshot(server.snapshot());
    expect(b.engine.outbox).toEqual([]);
    expect(b.st.shared).toEqual({});
  });
});

describe("changes after the first load", () => {
  it("writes through and shows other browsers' changes", async () => {
    const server = fakeServer();
    const a = browser(server);
    const b = browser(server);
    a.engine.applySnapshot(server.snapshot());
    b.engine.applySnapshot(server.snapshot());
    a.change((s) => (s.shared["customSize:x"] = size("x")));
    b.change((s) => (s.user.favourites = ["l2"]));
    a.change((s) => (s.user.favourites = ["l1"]));
    await a.engine.flush();
    await b.engine.flush();
    a.engine.applySnapshot(server.snapshot());
    b.engine.applySnapshot(server.snapshot());
    expect(b.st.shared["customSize:x"]).toEqual(size("x"));
    expect(new Set(a.st.user.favourites as string[])).toEqual(new Set(["l1", "l2"]));
  });

  it("keeps unsent changes on top of a server refresh", () => {
    const server = fakeServer();
    server.setOnline(false);
    const b = browser(server);
    b.engine.applySnapshot(server.snapshot());
    b.change((s) => (s.shared["learnedRoll:123"] = { sizeId: "n1-14x30" }));
    b.engine.applySnapshot(server.snapshot());
    expect(b.st.shared["learnedRoll:123"]).toEqual({ sizeId: "n1-14x30" });
  });

  it("adds up roll prints from two browsers", async () => {
    const server = fakeServer();
    const u = (printed: number) => ({ kind: "roll", barcode: "x", total: 200, usedAtStart: 0, printed, firstSeen: 1 });
    server.rows.shared["usage:roll:1"] = u(0);
    const a = browser(server);
    const b = browser(server);
    a.engine.applySnapshot(server.snapshot());
    b.engine.applySnapshot(server.snapshot());
    a.change((s) => (s.shared["usage:roll:1"] = u(3)));
    b.change((s) => (s.shared["usage:roll:1"] = u(5)));
    await a.engine.flush();
    await b.engine.flush();
    expect(server.rows.shared["usage:roll:1"]).toMatchObject({ printed: 8 });
    // b gets the combined count back from its write.
    expect(b.st.shared["usage:roll:1"]).toMatchObject({ printed: 8 });
  });

  it("keeps refused team changes in this browser only", async () => {
    const server = fakeServer("printer");
    const b = browser(server);
    b.engine.applySnapshot(server.snapshot());
    b.change((s) => {
      s.shared["customSize:x"] = size("x");
      s.shared["learnedRoll:1"] = { sizeId: "n1-14x30" };
    });
    await b.engine.flush();
    expect(server.rows.shared).toEqual({ "learnedRoll:1": { sizeId: "n1-14x30" } });
    expect(b.denied.length).toBe(1);
    b.engine.applySnapshot(server.snapshot());
    expect(b.st.shared["customSize:x"]).toEqual(size("x"));
  });
});

describe("per-user settings", () => {
  it("stay in the browser when nobody is signed in", async () => {
    const server = fakeServer();
    const b = browser(server, { user: { favourites: ["a"] } });
    b.engine.applySnapshot(server.snapshot(null));
    b.change((s) => (s.user.favourites = ["a", "b"]));
    await b.engine.flush();
    expect(server.rows.user).toEqual({});
    expect(b.st.user.favourites).toEqual(["a", "b"]);
    expect(b.engine.outbox).toEqual([]);
  });

  it("replace another person's copy instead of uploading it", async () => {
    const server = fakeServer();
    const b = browser(server, { user: { favourites: ["a"] } });
    b.engine.applySnapshot(server.snapshot("user:alice"));
    await b.engine.flush();
    server.rows.user = {};
    b.engine.applySnapshot(server.snapshot("user:bob"));
    await b.engine.flush();
    expect(server.rows.user).toEqual({});
    expect(b.st.user).toEqual({});
  });

  it("are cleared from the browser on sign-out", () => {
    const server = fakeServer();
    server.rows.user.favourites = ["secret"];
    const b = browser(server);
    b.engine.applySnapshot(server.snapshot("user:alice"));
    expect(b.st.user.favourites).toEqual(["secret"]);
    b.engine.applySnapshot(server.snapshot(null));
    expect(b.st.user).toEqual({});
  });
});
