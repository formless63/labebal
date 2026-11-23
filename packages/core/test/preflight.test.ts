/** Preflight rules, rendered headlessly (@napi-rs/canvas behind the canvas seam). */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import {
  BUILTIN_FONTS,
  issuesByNode,
  labelPixels,
  loadCodeEncoder,
  preflight,
  preflightSummary,
  printerFor,
  setCanvasFactory,
  sizeById,
  type LabelNode,
  type PreflightOptions,
  type Template,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
beforeAll(async () => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
  await loadCodeEncoder();
});
afterAll(() => setCanvasFactory(null));

/** N1 on 14 x 40 mm tape: 96-dot (12 mm) band on 14 mm stock. */
const n1 = (invert = false): PreflightOptions => {
  const size = sizeById("n1-14x40")!;
  const px = labelPixels(size, printerFor("N1"));
  return { ...px, marginMm: 0.5, invert, labelMm: { w: size.widthMm, h: size.heightMm } };
};

const tpl = (children: LabelNode[], extra: Partial<Template> = {}): Template => ({
  id: "t",
  name: "t",
  schema: 2,
  design: { w: 39, h: 11 },
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "code", label: "Code value", type: "text" },
  ],
  root: { id: "root", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children },
  ...extra,
});

const text = (id: string, x: number, y: number, w: number, h: number, extra: Partial<LabelNode> = {}): LabelNode =>
  ({ id, type: "text", text: "{{title}}", font: "sans-serif", sizePt: 14, fit: "shrink", color: "black", x, y, w: { kind: "fixed", mm: w }, h: { kind: "fixed", mm: h }, ...extra }) as LabelNode;

const code = (id: string, x: number, y: number, w: number, h: number, extra: Partial<LabelNode> = {}): LabelNode =>
  ({ id, type: "code", format: "qrcode", value: "{{code}}", color: "black", x, y, w: { kind: "fixed", mm: w }, h: { kind: "fixed", mm: h }, ...extra }) as LabelNode;

const rules = (t: Template, values: Record<string, string>, o = n1()) => preflight(t, { values }, o).map((i) => `${i.rule}:${i.nodeId ?? "-"}`);

describe("text", () => {
  it("is fine when big enough", () => {
    expect(rules(tpl([text("a", 1, 1, 30, 8)]), { title: "OK1" })).toEqual([]);
  });

  it("warns when shrunk below a readable height", () => {
    const issues = preflight(tpl([text("a", 1, 1, 8, 1.2)]), { values: { title: "A rather long title here" } }, n1());
    const small = issues.find((i) => i.rule === "text-small")!;
    expect(small).toMatchObject({ severity: "warning", nodeId: "a" });
    expect(small.message).toMatch(/Text too small to read/);
    expect(small.fix).toMatch(/bigger or shorten/);
  });

  it("reports text that doesn't fit at its minimum size", () => {
    expect(rules(tpl([text("a", 1, 1, 6, 6, { fit: "fixed", sizePt: 20 })]), { title: "WIDE TEXT" })).toContain("text-overflow:a");
  });

  it("checks pixel fonts by dots per font pixel", () => {
    const small = text("a", 1, 1, 8, 0.6, { font: "Test Pixel 8" });
    expect(rules(tpl([small]), { title: "HI" })).toContain("text-small:a");
    const ok = text("a", 1, 1, 30, 8, { font: "Test Pixel 8", sizePt: 8 });
    expect(rules(tpl([ok]), { title: "HI" })).toEqual([]);
  });
});

describe("codes", () => {
  it("flags values a format can't encode", () => {
    const issues = preflight(tpl([code("c", 1, 1, 30, 9, { format: "ean13" })]), { values: { code: "abc" } }, n1());
    expect(issues[0]).toMatchObject({ rule: "code-invalid", severity: "error", nodeId: "c" });
    expect(issues[0].message).toMatch(/EAN-13 can only hold 12 digits/);
  });

  it("flags 1-dot modules", () => {
    const long = "https://example.com/a/very/long/address/that/needs/a/big/qr/code/1234567890";
    expect(rules(tpl([code("c", 1, 1, 9, 9)]), { code: long })).toContain("code-thin:c");
    expect(rules(tpl([code("c", 1, 1, 9, 9)]), { code: "A1" })).not.toContain("code-thin:c");
  });

  it("errors when not even one dot fits", () => {
    expect(rules(tpl([code("c", 1, 1, 1, 1)]), { code: "https://example.com/long/enough" })).toContain("code-too-small:c");
  });

  it("wants a blank margin around the symbol", () => {
    // A code right next to a black block has no quiet zone.
    const block: LabelNode = { id: "blk", type: "rect", fill: "black", x: 10.2, y: 0, w: { kind: "fixed", mm: 5 }, h: { kind: "fixed", mm: 11 } };
    expect(rules(tpl([code("c", 1, 1, 9, 9), block]), { code: "A1" })).toContain("code-quiet-zone:c");
    // With room around it, it's fine.
    expect(rules(tpl([code("c", 1, 1, 9, 9, { quietZone: true }), { ...block, x: 20 } as LabelNode]), { code: "A1" })).not.toContain("code-quiet-zone:c");
  });

  it("warns about reversed (light on dark) codes", () => {
    expect(rules(tpl([code("c", 1, 1, 9, 9, { quietZone: true })]), { code: "A1" }, n1(true))).toContain("code-reversed:c");
  });

  it("skips empty codes (reported as empty fields)", () => {
    expect(rules(tpl([code("c", 1, 1, 9, 9)]), { code: "" })).toEqual(["empty-field:c"]);
  });
});

describe("label", () => {
  it("finds content outside the printhead band on 14 mm tape", () => {
    const issues = preflight(tpl([text("a", 1, 8, 20, 5)]), { values: { title: "LOW" } }, n1());
    const dz = issues.find((i) => i.rule === "dead-zone")!;
    expect(dz.nodeId).toBe("a");
    expect(dz.message).toMatch(/12 mm .* 14 mm/);
  });

  it("names empty fields that feed visible elements", () => {
    const issues = preflight(tpl([text("a", 1, 1, 30, 8)]), { values: {} }, n1());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: "empty-field", nodeId: "a" });
    expect(issues[0].message).toBe('"Title" is empty, so this prints nothing.');
    // Field defaults count as filled.
    const t = tpl([text("a", 1, 1, 30, 8)]);
    t.fields[0].default = "Untitled";
    expect(rules(t, {})).toEqual([]);
  });

  it("doesn't flag solid ink on inverted labels, but explains the unprintable strips", () => {
    const r = rules(tpl([text("a", 1, 1, 30, 8)]), { title: "x" }, n1(true));
    expect(r).not.toContain("heavy-ink:-");
    expect(r).toContain("bleed-strips:-");
    // A clean border inside the margin has no strips to explain.
    expect(rules(tpl([text("a", 1, 1, 30, 8)], { invertArea: "content" }), { title: "x" }, n1(true))).not.toContain("bleed-strips:-");
  });

  it("summarises and groups by node, worst first", () => {
    const issues = preflight(tpl([code("c", 1, 1, 9, 9, { format: "ean8" }), text("a", 1, 8, 20, 5)]), { values: { code: "x", title: "LOW" } }, n1());
    expect(issues[0].severity).toBe("error");
    expect(preflightSummary(issues)).toMatchObject({ worst: "error", counts: { error: 1, warning: 1 } });
    expect([...issuesByNode(issues).keys()].sort()).toEqual(["a", "c"]);
    expect(preflightSummary([]).worst).toBeNull();
  });

  it("reports issues in mirrored halves on the mirror frame", () => {
    const t = tpl([]);
    t.root = {
      id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" },
      children: [
        { id: "a", type: "frame", layout: "free", w: { kind: "fill" }, h: { kind: "fill" }, children: [code("c", 0, 0, 9, 9, { format: "ean8" })] },
        { id: "b", type: "frame", layout: "free", mirror: { of: "a", mode: "repeat" }, w: { kind: "fill" }, h: { kind: "fill" }, children: [] },
      ],
    };
    expect(rules(t, { code: "x" })).toEqual(["code-invalid:c", "code-invalid:b"]);
  });
});
