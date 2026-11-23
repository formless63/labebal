import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assignLabelIds,
  checkPack,
  compareVersions,
  csvRoundTrips,
  itemHash,
  itemKey,
  labelFolder,
  labelsToCsv,
  listPackEntries,
  loadPack,
  makePackBundle,
  packDocKind,
  packFiles,
  packJsonSchemas,
  parseLabelsCsv,
  parseManifest,
  parsePackBundle,
  planPackRemove,
  planPackSync,
  resolvePackPath,
  resolveSourceInput,
  setLabelFolder,
  type ExistingItem,
  type Label,
  type PackReader,
  type Template,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

const memReader = (files: Record<string, string | Uint8Array>): PackReader => ({
  async text(url) {
    const f = files[url];
    if (f === undefined) throw new Error(`404 ${url}`);
    return typeof f === "string" ? f : new TextDecoder().decode(f);
  },
  async bytes(url) {
    const f = files[url];
    if (f === undefined) throw new Error(`404 ${url}`);
    return typeof f === "string" ? new TextEncoder().encode(f) : f;
  },
});
const fsReader: PackReader = {
  text: async (u) => readFileSync(new URL(u), "utf8"),
  bytes: async (u) => new Uint8Array(readFileSync(new URL(u))),
};

const tpl = (id: string, keys = ["title"]): Template => ({
  id,
  name: id,
  schema: 2,
  design: { w: 30, h: 12 },
  fields: keys.map((key) => ({ key, label: key, type: "text" })),
  root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [] },
});

describe("manifest", () => {
  it("validates and fills defaults", () => {
    const m = parseManifest({ id: "my-pack", name: "Mine", version: "1.2.0" });
    expect(m.templates).toEqual([]);
    expect(m.labels).toEqual([]);
    expect(() => parseManifest({ id: "Bad Id", name: "x", version: "1" })).toThrow(/id.*version|version|id/);
  });

  it("refuses absolute and backslash paths", () => {
    expect(() => parseManifest({ id: "a", name: "a", version: "1.0.0", templates: ["https://evil/x.json"] })).toThrow(/relative/);
    expect(() => parseManifest({ id: "a", name: "a", version: "1.0.0", templates: ["/etc/passwd"] })).toThrow(/relative/);
    expect(() => resolvePackPath("https://h/p/labebal-pack.json", "file:///x")).toThrow();
    expect(resolvePackPath("https://h/p/labebal-pack.json", "../shared/a.json")).toBe("https://h/shared/a.json");
  });

  it("tells documents apart", () => {
    expect(packDocKind({ id: "a", version: "1.0.0" })).toBe("manifest");
    expect(packDocKind({ name: "c", packs: [] })).toBe("collection");
    expect(packDocKind({ format: "labebal.pack" })).toBe("bundle");
    expect(packDocKind({ format: "labebal.packs" })).toBe("collection-bundle");
    expect(packDocKind({ templates: [] })).toBeNull();
  });

  it("publishes JSON Schemas", () => {
    const s = packJsonSchemas() as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(s)).toEqual(["labebal-pack.schema.json", "labebal-packs.schema.json", "template.schema.json", "labels.schema.json"]);
    expect(s["labebal-pack.schema.json"].properties).toHaveProperty("templates");
  });
});

describe("label CSV", () => {
  const csv = [
    "id,name,template,folder,invert,tags,overrides,title,detail",
    'l-1,First,t-a,Bins/Small,yes,"a; b",,M3,"two\nlines"',
    ',Second,,,no,,"{""title"":{""sizePt"":6}}",M4,',
    ",Second,,,,,,M5,x",
  ].join("\n");

  it("reads reserved columns and field values", () => {
    const { labels, warnings } = parseLabelsCsv(csv, { packId: "p", template: "t-default", folder: "Pack" });
    expect(warnings).toEqual([]);
    expect(labels[0]).toMatchObject({ id: "l-1", name: "First", templateId: "t-a", invert: true, values: { title: "M3", detail: "two\nlines" } });
    expect(labels[0].tags).toEqual(["a", "b", "folder:Bins/Small"]);
    expect(labels[1]).toMatchObject({ templateId: "t-default", invert: false, overrides: { title: { sizePt: 6 } }, values: { title: "M4", detail: "" } });
    expect(labelFolder(labels[1])).toBe("Pack");
  });

  it("gives stable ids to labels without one", () => {
    const { labels } = parseLabelsCsv(csv, { packId: "p", template: "t" });
    const ids = assignLabelIds("my pack", labels).map((l) => l.id);
    expect(ids).toEqual(["l-1", "l-my-pack-second", "l-my-pack-second-2"]);
    expect(assignLabelIds("my pack", labels).map((l) => l.id)).toEqual(ids);
  });

  it("round-trips through labelsToCsv", () => {
    const ls: Label[] = [
      { id: "a", templateId: "t", name: "A", values: { title: "x", detail: "" }, tags: ["red", "folder:F"], invert: true },
      { id: "b", templateId: "t", name: "B, comma", values: { title: 'q"uote', detail: "multi\nline" }, overrides: { title: { sizePt: 5 } } },
    ];
    expect(csvRoundTrips(ls, ["title", "detail"])).toBe(true);
    const back = assignLabelIds("p", parseLabelsCsv(labelsToCsv(ls, ["title", "detail"]), { packId: "p" }).labels);
    expect(back).toEqual(ls);
    // A missing value (template default) can't be told from "" in CSV.
    expect(csvRoundTrips([...ls, { id: "c", templateId: "t", name: "C", values: { title: "y" } }], ["title", "detail"])).toBe(false);
  });
});

describe("source links", () => {
  it("resolves GitHub shorthand", () => {
    expect(resolveSourceInput("acme/label-packs")).toMatchObject({
      url: "https://raw.githubusercontent.com/acme/label-packs/HEAD/labebal-packs.json",
      fallbacks: ["https://raw.githubusercontent.com/acme/label-packs/HEAD/labebal-pack.json"],
      tokenHost: "raw.githubusercontent.com",
    });
    expect(resolveSourceInput("me/packs/drawers@v1.2").url).toBe("https://raw.githubusercontent.com/me/packs/v1.2/drawers/labebal-packs.json");
    expect(resolveSourceInput("github:me/packs/a/labebal-pack.json@main")).toMatchObject({ url: "https://raw.githubusercontent.com/me/packs/main/a/labebal-pack.json", fallbacks: [] });
    expect(resolveSourceInput("https://github.com/me/packs/tree/dev/drawers").url).toBe("https://raw.githubusercontent.com/me/packs/dev/drawers/labebal-packs.json");
    expect(resolveSourceInput("https://github.com/me/packs/blob/main/a/b.json").url).toBe("https://raw.githubusercontent.com/me/packs/main/a/b.json");
    expect(resolveSourceInput("me/packs@feature/x").github).toMatchObject({ ref: "feature/x", path: "" });
  });

  it("takes plain URLs", () => {
    expect(resolveSourceInput("https://example.com/p/labebal-pack.json")).toMatchObject({ url: "https://example.com/p/labebal-pack.json", fallbacks: [], tokenHost: "example.com" });
    expect(resolveSourceInput("http://127.0.0.1:8080/packs/")).toMatchObject({ url: "http://127.0.0.1:8080/packs/labebal-packs.json", fallbacks: ["http://127.0.0.1:8080/packs/labebal-pack.json"], tokenHost: "127.0.0.1:8080" });
    expect(() => resolveSourceInput("ftp://x/y.json")).toThrow();
    expect(() => resolveSourceInput("https://u:p@x/y.json")).toThrow(/token/);
    expect(() => resolveSourceInput("not a thing")).toThrow();
    expect(() => resolveSourceInput("")).toThrow();
  });
});

describe("loading", () => {
  const base = "https://h/repo/";
  const files: Record<string, string> = {
    [`${base}labebal-packs.json`]: JSON.stringify({ name: "Friends", packs: ["a/labebal-pack.json"] }),
    [`${base}a/labebal-pack.json`]: JSON.stringify({
      id: "a",
      name: "A",
      version: "1.0.0",
      folder: "A stuff",
      templates: ["t.json"],
      labels: [{ path: "batch.csv", template: "t-a" }, "more.json"],
      assets: [{ path: "img/logo.png", id: "logo" }],
      fonts: [{ path: "f.ttf", family: "Fancy", pixel: { pxPerEm: 8, linePx: 9 } }],
    }),
    [`${base}a/t.json`]: JSON.stringify(tpl("t-a", ["title"])),
    [`${base}a/batch.csv`]: "name,title\nOne,1\nTwo,2\n",
    [`${base}a/more.json`]: JSON.stringify([{ id: "l-x", template: "t-a", name: "X", values: { title: "x", bogus: "?" }, tags: ["folder:Own"] }]),
    [`${base}a/img/logo.png`]: "PNG",
    [`${base}a/f.ttf`]: "TTF",
  };
  const reader = memReader(files);

  it("lists a collection and loads a pack", async () => {
    const list = await listPackEntries(`${base}labebal-packs.json`, reader);
    expect(list).toMatchObject({ kind: "collection", name: "Friends", entries: [{ url: `${base}a/labebal-pack.json` }] });
    const p = await loadPack(list.entries[0].url, reader, { withAssets: true });
    expect(p.templates.map((t) => t.id)).toEqual(["t-a"]);
    expect(p.labels.map((l) => [l.id, l.templateId, labelFolder(l)])).toEqual([
      ["l-a-one", "t-a", "A stuff"],
      ["l-a-two", "t-a", "A stuff"],
      ["l-x", "t-a", "Own"],
    ]);
    expect(p.assets.map((a) => [a.id, a.kind, a.mime, a.data.length])).toEqual([
      ["logo", "image", "image/png", 3],
      ["pf-a-fancy", "font", "font/ttf", 3],
    ]);
    expect(p.files["label:l-a-one"]).toBe("batch.csv");
    const issues = checkPack(p);
    expect(issues).toEqual([{ level: "warning", file: "more.json", message: 'label "X": "bogus" not a field of t-a' }]);
  });

  it("round-trips a bundle", async () => {
    const p = await loadPack(`${base}a/labebal-pack.json`, reader, { withAssets: true });
    const b = JSON.parse(JSON.stringify(makePackBundle(p)));
    const q = parsePackBundle(b);
    expect(q.labels).toEqual(p.labels);
    expect(q.assets.map((a) => new TextDecoder().decode(a.data))).toEqual(["PNG", "TTF"]);
    // A bundle URL lists itself.
    const r = memReader({ "https://h/x.json": JSON.stringify(b) });
    const list = await listPackEntries("https://h/x.json", r);
    expect(list.kind).toBe("bundle");
    expect((await loadPack("https://h/x.json", r, {}, list.entries[0].doc)).manifest.id).toBe("a");
  });

  it("names the file that failed", async () => {
    const r = memReader({ ...files, [`${base}a/t.json`]: "{ nope" });
    await expect(loadPack(`${base}a/labebal-pack.json`, r)).rejects.toThrow(/t\.json: invalid JSON/);
    const r2 = memReader({ ...files, [`${base}a/t.json`]: JSON.stringify({ id: "x" }) });
    await expect(loadPack(`${base}a/labebal-pack.json`, r2)).rejects.toThrow(/t\.json: not a template/);
  });

  it("exports library items as pack files that load back", async () => {
    const t = tpl("t-e", ["title", "detail"]);
    const labels: Label[] = [
      { id: "l1", templateId: "t-e", name: "One", values: { title: "1", detail: "" }, tags: ["folder:Here"] },
      { id: "l2", templateId: "t-e", name: "Two", values: { title: "2", detail: "d" } },
    ];
    const asset = { id: "a-1", name: "logo.png", kind: "image" as const, mime: "image/png", meta: {}, data: new Uint8Array([1, 2]) };
    const font = { id: "a-2", name: "Pix.ttf", kind: "font" as const, mime: "font/ttf", meta: { family: "Pix", pixel: { pxPerEm: 8, linePx: 9 } }, data: new Uint8Array([3]) };
    const out = packFiles({ id: "mine", name: "Mine", version: "0.1.0" }, { templates: [t], labels, assets: [asset, font] });
    expect(out.map((f) => f.path)).toEqual(["labebal-pack.json", "templates/t-e.json", "labels/t-e.csv", "assets/logo.png", "fonts/pix.ttf"]);
    const dir = "https://x/mine/";
    const r = memReader(Object.fromEntries(out.map((f) => [dir + f.path, f.data])));
    const p = await loadPack(`${dir}labebal-pack.json`, r, { withAssets: true });
    expect(p.templates).toEqual([t]);
    expect(p.labels).toEqual(labels);
    expect(p.assets.map((a) => a.id)).toEqual(["a-1", "a-2"]);
    expect(p.assets[1].meta).toMatchObject({ family: "Pix", pixel: { pxPerEm: 8, linePx: 9 } });
  });
});

describe("hashes and versions", () => {
  it("ignores folders and key order for labels", async () => {
    const a: Label = { id: "l", templateId: "t", name: "A", values: { x: "1", y: "2" }, tags: ["red"] };
    const b = setLabelFolder({ ...a, values: { y: "2", x: "1" } }, "Somewhere");
    expect(await itemHash("label", a)).toBe(await itemHash("label", b));
    expect(await itemHash("label", { ...a, overrides: {} })).toBe(await itemHash("label", a));
    expect(await itemHash("label", { ...a, name: "B" })).not.toBe(await itemHash("label", a));
  });

  it("compares semver", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta.2", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0-beta.10", "2.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.1", "1.0.0+build")).toBeGreaterThan(0);
  });
});

describe("install / update / remove rules", () => {
  const ex = (o: Partial<ExistingItem>): ExistingItem => ({ exists: true, owner: null, ...o });

  it("plans every case", () => {
    const incoming = [
      { kind: "template" as const, id: "new", hash: "h1" },
      { kind: "template" as const, id: "same", hash: "h2" },
      { kind: "label" as const, id: "untouched", hash: "v2" },
      { kind: "label" as const, id: "edited", hash: "v2" },
      { kind: "label" as const, id: "seeded", hash: "s" },
      { kind: "label" as const, id: "seeded-edited", hash: "s" },
      { kind: "label" as const, id: "theirs", hash: "x" },
      { kind: "label" as const, id: "deleted-here", hash: "d" },
      { kind: "label" as const, id: "edited-to-match", hash: "m2" },
    ];
    const existing = new Map<string, ExistingItem>([
      [itemKey("template", "same"), ex({ hash: "h2", owner: "p", packHash: "h2" })],
      [itemKey("label", "untouched"), ex({ hash: "v1", owner: "p", packHash: "v1" })],
      [itemKey("label", "edited"), ex({ hash: "mine", owner: "p", packHash: "v1" })],
      [itemKey("label", "seeded"), ex({ hash: "s" })],
      [itemKey("label", "seeded-edited"), ex({ hash: "other" })],
      [itemKey("label", "theirs"), ex({ hash: "x", owner: "q", packHash: "x" })],
      [itemKey("label", "deleted-here"), { exists: false, owner: "p", packHash: "d" }],
      [itemKey("label", "edited-to-match"), ex({ hash: "m2", owner: "p", packHash: "m1" })],
      [itemKey("label", "gone-unchanged"), ex({ hash: "g", owner: "p", packHash: "g" })],
      [itemKey("label", "gone-changed"), ex({ hash: "g2", owner: "p", packHash: "g" })],
    ]);
    const owned = [...existing.entries()].filter(([, v]) => v.owner === "p").map(([k]) => ({ kind: k.split(":")[0] as "label", id: k.split(":")[1] }));
    const plan = planPackSync("p", incoming, existing, owned);
    expect(Object.fromEntries(plan.map((a) => [a.id, a.adopted ? `${a.op}+adopt` : a.op]))).toEqual({
      new: "insert",
      same: "unchanged",
      untouched: "overwrite",
      edited: "keep",
      seeded: "unchanged+adopt",
      "seeded-edited": "keep+adopt",
      theirs: "conflict",
      "deleted-here": "deleted",
      "edited-to-match": "unchanged",
      "gone-unchanged": "delete",
      "gone-changed": "detach",
    });
    expect(plan.find((a) => a.op === "conflict")?.owner).toBe("q");
  });

  it("removal keeps changed items and templates in use to ask about", () => {
    const plan = planPackRemove(
      [
        { kind: "template", id: "t1", hash: "a", packHash: "a", exists: true },
        { kind: "template", id: "t2", hash: "a", packHash: "a", exists: true },
        { kind: "label", id: "l1", hash: "a", packHash: "a", exists: true },
        { kind: "label", id: "l2", hash: "b", packHash: "a", exists: true },
        { kind: "label", id: "l3", exists: false },
      ],
      new Set(["t2"]),
    );
    expect(plan.remove).toEqual([
      { kind: "template", id: "t1" },
      { kind: "label", id: "l1" },
    ]);
    expect(plan.changed).toEqual([
      { kind: "template", id: "t2", reason: "used" },
      { kind: "label", id: "l2", reason: "changed" },
    ]);
  });
});

describe("packs in this repo", () => {
  for (const name of ["examples", "standards", "welcome"]) {
    it(`${name} loads and checks clean`, async () => {
      const url = pathToFileURL(resolve(repo, "packages/app/packs", name, "labebal-pack.json")).href;
      const p = await loadPack(url, fsReader, { withAssets: true });
      expect(checkPack(p).filter((i) => i.level === "error")).toEqual([]);
      expect(p.labels.length).toBeGreaterThan(0);
    });
  }
});
