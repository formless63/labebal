import { describe, expect, it } from "vitest";
import {
  afterDevicePoll,
  cleanDir,
  commitMessage,
  devicePollDue,
  expireDevice,
  nextVersion,
  noreplyEmail,
  ownedByPack,
  parseRepo,
  planPublishTree,
  planRemoveTree,
  startDevice,
  summarizeItems,
  tokenCreateUrl,
  withCollectionEntry,
  withoutCollectionEntry,
} from "./model";

describe("device flow state machine", () => {
  const t0 = 1_000_000;
  const s0 = startDevice("d1", "instance", { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }, t0);

  it("waits the interval before the first poll", () => {
    expect(s0.status).toBe("pending");
    expect(devicePollDue(s0, t0 + 4_999)).toBe(false);
    expect(devicePollDue(s0, t0 + 5_000)).toBe(true);
  });

  it("authorization_pending schedules the next poll one interval later", () => {
    const { session } = afterDevicePoll(s0, { error: "authorization_pending" }, t0 + 5_000);
    expect(session.status).toBe("pending");
    expect(session.nextPollAt).toBe(t0 + 10_000);
  });

  it("slow_down raises the interval (GitHub's value, else +5 s)", () => {
    expect(afterDevicePoll(s0, { error: "slow_down", interval: 12 }, t0).session.interval).toBe(12);
    const s = afterDevicePoll(s0, { error: "slow_down" }, t0).session;
    expect(s.interval).toBe(10);
    expect(s.nextPollAt).toBe(t0 + 10_000);
  });

  it("success, denial, expiry and errors end the session", () => {
    const ok = afterDevicePoll(s0, { access_token: "ghu_x" }, t0);
    expect(ok.session.status).toBe("done");
    expect(ok.token).toBe("ghu_x");
    expect(JSON.stringify(ok.session)).not.toContain("ghu_x");
    expect(afterDevicePoll(s0, { error: "access_denied" }, t0).session.status).toBe("denied");
    expect(afterDevicePoll(s0, { error: "expired_token" }, t0).session.status).toBe("expired");
    const bad = afterDevicePoll(s0, { error: "device_flow_disabled", error_description: "Device flow is disabled" }, t0).session;
    expect(bad).toMatchObject({ status: "error", error: "Device flow is disabled" });
  });

  it("expires by time and stops polling", () => {
    const s = expireDevice(s0, t0 + 900_000);
    expect(s.status).toBe("expired");
    expect(devicePollDue(s, t0 + 900_000)).toBe(false);
    expect(expireDevice(s0, t0 + 1000).status).toBe("pending");
  });
});

describe("versions", () => {
  it("bumps the highest known version", () => {
    expect(nextVersion([], "patch")).toBe("1.0.0");
    expect(nextVersion([null, "1.2.3"], "patch")).toBe("1.2.4");
    expect(nextVersion(["1.2.3", "1.10.0"], "minor")).toBe("1.11.0");
    expect(nextVersion(["1.2.3"], "major")).toBe("2.0.0");
    expect(nextVersion(["2.0.0-beta.1"], "patch")).toBe("2.0.0");
  });
});

describe("publish tree", () => {
  const existing = [
    { path: "README.md", sha: "r" },
    { path: "labebal-packs.json", sha: "c1" },
    { path: "shelf/labebal-pack.json", sha: "m1" },
    { path: "shelf/README.md", sha: "keep" },
    { path: "shelf/templates/a.json", sha: "a1" },
    { path: "shelf/labels/old.csv", sha: "o1" },
    { path: "other/labebal-pack.json", sha: "x" },
  ];

  it("adds, changes and removes only the pack's own files", () => {
    const p = planPublishTree({
      dir: "shelf",
      existing,
      files: [
        { path: "labebal-pack.json", sha: "m2" },
        { path: "templates/a.json", sha: "a1" },
        { path: "labels/new.csv", sha: "n1" },
      ],
      extra: [{ path: "labebal-packs.json", sha: "c2" }],
    });
    expect(p.added).toEqual(["shelf/labels/new.csv"]);
    expect(p.changed).toEqual(["shelf/labebal-pack.json", "labebal-packs.json"]);
    expect(p.removed).toEqual(["shelf/labels/old.csv"]);
    expect(p.changes).toContainEqual({ path: "shelf/labels/old.csv", sha: null });
    expect(p.changes.find((c) => c.path.includes("README"))).toBeUndefined();
    expect(p.changes.find((c) => c.path.startsWith("other/"))).toBeUndefined();
  });

  it("no changes when everything matches", () => {
    const p = planPublishTree({ dir: "shelf", existing, files: [{ path: "labebal-pack.json", sha: "m1" }, { path: "templates/a.json", sha: "a1" }, { path: "labels/old.csv", sha: "o1" }] });
    expect(p.changes).toEqual([]);
  });

  it("root packs keep unrelated files", () => {
    expect(ownedByPack("", "templates/x.json")).toBe(true);
    expect(ownedByPack("", "README.md")).toBe(false);
    expect(ownedByPack("", "shelf/labebal-pack.json")).toBe(false);
    expect(ownedByPack("shelf", "shelfie/templates/x.json")).toBe(false);
  });

  it("removing a pack deletes its files and updates the collection", () => {
    const ch = planRemoveTree({ dir: "shelf", existing, extra: [{ path: "labebal-packs.json", sha: "c3" }] });
    expect(ch.filter((c) => !c.sha).map((c) => c.path)).toEqual(["shelf/labebal-pack.json", "shelf/templates/a.json", "shelf/labels/old.csv"]);
    expect(ch).toContainEqual({ path: "labebal-packs.json", sha: "c3" });
  });
});

describe("collection file", () => {
  it("adds an entry once, creating the file when missing", () => {
    const a = withCollectionEntry(null, "shelf/labebal-pack.json", "My packs");
    expect(a.changed).toBe(true);
    expect(a.doc).toMatchObject({ name: "My packs", packs: ["shelf/labebal-pack.json"] });
    const b = withCollectionEntry({ name: "Mine", packs: ["./shelf/labebal-pack.json"] }, "shelf/labebal-pack.json", "x");
    expect(b.changed).toBe(false);
    const c = withCollectionEntry({ name: "Mine", description: "d", packs: ["b/labebal-pack.json"] }, "a/labebal-pack.json", "x");
    expect(c.doc).toMatchObject({ name: "Mine", description: "d", packs: ["a/labebal-pack.json", "b/labebal-pack.json"] });
  });
  it("removes an entry", () => {
    expect(withoutCollectionEntry({ packs: ["a/labebal-pack.json", "b/labebal-pack.json"] }, "a/labebal-pack.json")).toMatchObject({ changed: true, doc: { packs: ["b/labebal-pack.json"] } });
    expect(withoutCollectionEntry(null, "a")).toBeNull();
  });
});

describe("summaries and helpers", () => {
  it("counts item changes since the last publish", () => {
    expect(summarizeItems({ "label:a": "1", "label:b": "2", "template:t": "3" }, { "label:a": "1", "label:b": "9", "label:c": "4", "template:t": "3" })).toEqual({ added: 1, removed: 0, changed: 1, first: false });
    expect(summarizeItems({ "label:a": "1" }, {})).toMatchObject({ removed: 1 });
    expect(summarizeItems(null, { "label:a": "1" })).toMatchObject({ added: 1, first: true });
  });
  it("writes a commit message with counts", () => {
    const m = commitMessage("Shelf", "1.2.0", { added: 2, removed: 1, changed: 3, first: false }, { added: 1, changed: 2, removed: 0 });
    expect(m.split("\n")[0]).toBe("Shelf 1.2.0: 2 added, 1 removed, 3 changed");
    expect(commitMessage("Shelf", "1.0.0", { added: 4, removed: 0, changed: 0, first: true }, { added: 4, changed: 0, removed: 0 }).split("\n")[0]).toBe("Publish Shelf 1.0.0");
  });
  it("noreply e-mail, repo and folder parsing, token URL", () => {
    expect(noreplyEmail(1001, "octo")).toBe("1001+octo@users.noreply.github.com");
    expect(parseRepo("https://github.com/octo/labebal-packs.git")).toEqual({ owner: "octo", repo: "labebal-packs" });
    expect(parseRepo("octo/x/y")).toBeNull();
    expect(cleanDir("/a//b/")).toBe("a/b");
    expect(cleanDir("a/../b")).toBeNull();
    const u = new URL(tokenCreateUrl("https://github.com"));
    expect(u.pathname).toBe("/settings/personal-access-tokens/new");
    expect(u.searchParams.get("contents")).toBe("write");
    expect(u.searchParams.get("metadata")).toBe("read");
    expect(u.searchParams.get("name")!.length).toBeLessThanOrEqual(40);
  });
});
