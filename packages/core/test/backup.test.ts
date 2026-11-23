import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  BACKUP_FORMAT,
  backupFileName,
  backupsToPrune,
  bundleToJson,
  bytesToHex,
  crc32,
  encodePng1,
  hexToBytes,
  layoutProof,
  makeBundle,
  parseBundle,
  planRestore,
  proofSheetPdf,
  readBackupZip,
  renameBundle,
  restoreOrder,
  templateAssetRefs,
  writeBackupZip,
  type BackupManifest,
  type Template,
} from "../src";

const manifest = (): BackupManifest => ({
  format: BACKUP_FORMAT,
  version: 1,
  app: "labebal",
  createdAt: "2026-11-19T10:00:00.000Z",
  schema: { migrations: 4, lastMigrationAt: 1795060280237 },
  tables: [
    { name: "label_labels", rows: 0, columns: [{ name: "id", type: "text" }, { name: "template_id", type: "text" }, { name: "tags", type: "_text" }], primaryKey: ["id"], dependsOn: ["label_templates"] },
    { name: "label_templates", rows: 0, columns: [{ name: "id", type: "text" }, { name: "doc", type: "jsonb" }], primaryKey: ["id"], dependsOn: [] },
    { name: "label_assets", rows: 0, columns: [{ name: "id", type: "text" }, { name: "data", type: "bytea" }], primaryKey: ["id"], dependsOn: [] },
  ],
});

describe("backup zip", () => {
  it("round-trips rows, JSON documents and binary columns", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const rows = {
      label_templates: [{ id: "t-1", doc: { name: "A", root: { children: [] } }, created_at: "2026-11-19T10:00:00+00:00" }],
      label_labels: [{ id: "l-1", template_id: "t-1", tags: ["x", "y"] }, { id: "l-2", template_id: "t-1", tags: [] }],
      label_assets: [{ id: "a-1", data: bytes }],
    };
    const zip = await writeBackupZip({ manifest: manifest(), rows });
    const back = await readBackupZip(zip);
    expect(back.rows).toEqual(rows);
    expect(back.rows.label_assets[0].data).toBeInstanceOf(Uint8Array);
    expect(back.manifest.tables.map((t) => [t.name, t.rows])).toEqual([["label_labels", 2], ["label_templates", 1], ["label_assets", 1]]);
    // Blobs are files in the zip, not hex in the JSON.
    const z = await JSZip.loadAsync(zip);
    expect(z.file("blobs/label_assets/0-data")).toBeTruthy();
    expect(await z.file("tables/label_assets.json")!.async("string")).toContain('"$blob"');
  });

  it("rejects damaged or foreign files", async () => {
    await expect(readBackupZip(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a zip/);
    const z = new JSZip();
    z.file("manifest.json", JSON.stringify({ format: "other" }));
    await expect(readBackupZip(await z.generateAsync({ type: "uint8array" }))).rejects.toThrow(/wrong format/);
    const ok = await writeBackupZip({ manifest: manifest(), rows: { label_templates: [{ id: "t" }] } });
    const broken = await JSZip.loadAsync(ok);
    broken.remove("tables/label_templates.json");
    await expect(readBackupZip(await broken.generateAsync({ type: "uint8array" }))).rejects.toThrow(/incomplete/);
    const newer = await JSZip.loadAsync(ok);
    newer.file("manifest.json", JSON.stringify({ ...manifest(), version: 99 }));
    await expect(readBackupZip(await newer.generateAsync({ type: "uint8array" }))).rejects.toThrow(/newer/);
    const evil = await JSZip.loadAsync(ok);
    evil.file("manifest.json", JSON.stringify({ ...manifest(), tables: [{ name: "x; drop table y", columns: [], primaryKey: [], dependsOn: [] }] }));
    await expect(readBackupZip(await evil.generateAsync({ type: "uint8array" }))).rejects.toThrow(/bad table name/);
  });

  it("orders tables by foreign keys", () => {
    expect(restoreOrder(manifest().tables)).toEqual(["label_assets", "label_templates", "label_labels"]);
    // Cycles don't loop forever.
    expect(restoreOrder([{ name: "a", dependsOn: ["b"] }, { name: "b", dependsOn: ["a"] }]).sort()).toEqual(["a", "b"]);
  });

  it("plans a restore against the current schema", () => {
    const plan = planRestore(manifest(), {
      tables: { label_templates: ["id", "doc"], label_labels: ["id", "template_id"], label_counters: ["id"] },
      migrations: 3,
    });
    expect(plan.tables).toEqual(["label_templates", "label_labels"]);
    expect(plan.unknown).toEqual(["label_assets"]);
    expect(plan.missing).toEqual(["label_counters"]);
    expect(plan.droppedColumns).toEqual({ label_labels: ["tags"] });
    expect(plan.warnings[0]).toMatch(/newer labebal/);
  });

  it("hex <-> bytes like Postgres bytea", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe("\\x000fff");
    expect([...hexToBytes("\\x000fff")]).toEqual([0, 15, 255]);
  });

  it("names and prunes scheduled backups", () => {
    expect(backupFileName(new Date("2026-11-19T10:30:00.123Z"))).toBe("labebal-backup-2026-11-19T10-30-00Z.zip");
    const names = ["labebal-backup-2026-11-17T00-00-00Z.zip", "other.zip", "labebal-backup-2026-11-19T00-00-00Z.zip", "labebal-backup-2026-11-18T00-00-00Z.zip"];
    expect(backupsToPrune(names, 2)).toEqual(["labebal-backup-2026-11-17T00-00-00Z.zip"]);
    expect(backupsToPrune(names, 0)).toHaveLength(3);
  });
});

describe("template share file", () => {
  const t: Template = {
    id: "t-a",
    name: "Bin",
    schema: 2,
    design: { w: 30, h: 12 },
    fields: [],
    root: {
      id: "root",
      type: "frame",
      layout: "free",
      w: { kind: "fill" },
      h: { kind: "fill" },
      children: [
        { id: "i", type: "image", src: "/api/assets/a-img1", fit: "contain", dither: "threshold", color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
        { id: "c", type: "icon", icon: "custom:a-ico2", color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
        { id: "t", type: "text", text: "x", font: "My \"Font\"", sizePt: 8, color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
      ],
    },
  };

  it("finds the assets and fonts a template uses", () => {
    const refs = templateAssetRefs(t, [{ id: "l", templateId: "t-a", name: "l", values: { pic: "/api/assets/a-img3" } }]);
    expect(refs.assetIds.sort()).toEqual(["a-ico2", "a-img1", "a-img3"]);
    expect(refs.fonts).toEqual(['My "Font"']);
  });

  it("round-trips through JSON and zip", async () => {
    const b = makeBundle(t, [{ id: "l-1", templateId: "t-a", name: "One", values: {} }], [{ id: "a-img1", name: "x.png", kind: "image", mime: "image/png", meta: {}, data: new Uint8Array([9, 8, 7]) }]);
    const back = await parseBundle(bundleToJson(b));
    expect(back.template).toEqual(t);
    expect(back.labels).toHaveLength(1);
    expect([...back.assets[0].data]).toEqual([9, 8, 7]);

    const zip = new JSZip();
    zip.file("template.json", JSON.stringify({ ...b, assets: [{ ...b.assets[0], data: undefined }] }));
    zip.file("assets/a-img1", new Uint8Array([1, 2]));
    const fromZip = await parseBundle(await zip.generateAsync({ type: "uint8array" }));
    expect([...fromZip.assets[0].data]).toEqual([1, 2]);

    const copy = renameBundle(back, "t-b");
    expect(copy.template.id).toBe("t-b");
    expect(copy.labels[0]).toMatchObject({ id: "l-1-b", templateId: "t-b" });
    await expect(parseBundle("{}")).rejects.toThrow(/not a labebal template/);
  });
});

describe("1-bit PNG and proof PDF", () => {
  const bitmap = { w: 10, h: 3, dots: new Uint8Array(30).map((_, i) => (i % 3 === 0 ? 1 : 0)) };

  it("writes a valid 1-bit PNG", async () => {
    const png = await encodePng1(bitmap, 8);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(10);
    expect(view.getUint32(20)).toBe(3);
    expect(png[24]).toBe(1); // bit depth
    // IHDR CRC
    expect(view.getUint32(29)).toBe(crc32(png.subarray(12, 29)));
    expect(new TextDecoder().decode(png.slice(-8, -4))).toBe("IEND");
  });

  it("lays labels out on pages and writes a PDF", async () => {
    const item = { name: "Label", widthMm: 50, heightMm: 30, bitmap, dpmm: 8 };
    const { placed, pages } = layoutProof(Array(40).fill(item));
    expect(pages).toBeGreaterThan(1);
    expect(placed.every((p) => p.x >= 10 && p.x + 50 <= 200)).toBe(true);
    const pdf = await proofSheetPdf([item, { ...item, name: "Ünïcødé ✓" }], { title: "Proof" });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/ImageMask true");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // xref offsets point at objects.
    const xref = text.slice(text.indexOf("xref"));
    const first = Number(/\n(\d{10}) 00000 n/.exec(xref)![1]);
    expect(text.slice(first, first + 7)).toBe("1 0 obj");
  });
});
