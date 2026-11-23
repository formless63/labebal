import { describe, expect, it } from "vitest";
import { importNiimBlue, importZpl, isNiimBlue, isZpl, tokenizeZpl, type CodeNode, type LabelNode, type TextNode } from "../src";

const byType = (nodes: LabelNode[], type: LabelNode["type"]) => nodes.filter((n) => n.type === type);
const fixed = (s: LabelNode["w"]) => (s.kind === "fixed" ? s.mm : NaN);

describe("NiimBlue JSON import", () => {
  // Shape of NiimBlue's "Export" (ExportedLabelTemplate): label props + Fabric.js canvas JSON, sizes in dots (8/mm).
  const sample = {
    title: "Spice jar",
    timestamp: 1730000000,
    label: { size: { width: 240, height: 96 }, printDirection: "left", shape: "rect" },
    canvas: {
      version: "6.4.3",
      objects: [
        { type: "rect", left: 0, top: 0, width: 240, height: 96, fill: "transparent", stroke: "#000000", strokeWidth: 2, originX: "left", originY: "top" },
        { type: "i-text", left: 8, top: 8, width: 120, height: 30, fontSize: 24, fontFamily: "Noto Sans", fontWeight: "bold", text: "Paprika", fill: "#000000", textAlign: "left" },
        { type: "textbox", left: 8, top: 50, width: 120, height: 20, fontSize: 16, text: "Best before {date}", fill: "black" },
        { type: "QRCode", left: 160, top: 8, width: 80, height: 80, text: "https://example.com/p/1", ecl: "M" },
        { type: "Barcode", left: 8, top: 72, width: 100, height: 24, text: "590123412345", encoding: "EAN13", printText: true },
        { type: "line", left: 0, top: 46, width: 240, height: 0, x1: -120, y1: 0, x2: 120, y2: 0, stroke: "#000", strokeWidth: 1 },
        { type: "i-text", left: 200, top: 10, width: 40, height: 16, fontSize: 12, text: "R", angle: 90, originX: "left", originY: "top" },
        { type: "triangle", left: 0, top: 0, width: 10, height: 10 },
      ],
    },
  };

  it("detects NiimBlue files", () => {
    expect(isNiimBlue(sample)).toBe(true);
    expect(isNiimBlue([sample, sample])).toBe(true);
    expect(isNiimBlue({ templates: [] })).toBe(false);
    expect(isNiimBlue({ templates: [{ id: "t" }] })).toBe(false);
  });

  it("converts objects to nodes at true size", () => {
    const r = importNiimBlue(sample);
    expect(r.templates).toHaveLength(1);
    const t = r.templates[0];
    expect(t.id).toBe("t-niimblue-spice-jar");
    expect(t.design).toEqual({ w: 30, h: 12 });
    const kids = t.root.children;
    expect(byType(kids, "rect")).toHaveLength(1);
    expect(byType(kids, "line")).toHaveLength(1);
    expect((byType(kids, "line")[0] as { direction: string }).direction).toBe("horizontal");

    const texts = byType(kids, "text") as TextNode[];
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatchObject({ x: 1, y: 1, text: "{{text1}}", font: "Arial", weight: 700 });
    expect(texts[0].sizePt).toBeCloseTo((24 / 8) / (25.4 / 72), 1);
    // `{date}` placeholder -> field
    expect(texts[1].text).toBe("Best before {{date}}");
    // Rotated 90° about its top-left: box is 16 x 40 dots left of the origin.
    expect(texts[2]).toMatchObject({ rotate: 90, x: 23, y: 1.25 });
    expect(fixed(texts[2].w)).toBe(2);
    expect(fixed(texts[2].h)).toBe(5);

    const codes = byType(kids, "code") as CodeNode[];
    expect(codes.map((c) => c.format)).toEqual(["qrcode", "ean13"]);
    expect(codes[0]).toMatchObject({ ecc: "M", x: 20, y: 1 });

    expect(t.fields.map((f) => f.key)).toEqual(["text1", "date", "qr1", "barcode1", "text2"]);
    expect(r.labels[0]).toMatchObject({ templateId: t.id, values: { text1: "Paprika", date: "", qr1: "https://example.com/p/1", barcode1: "590123412345", text2: "R" } });
    expect(r.warnings.some((w) => w.includes("triangle"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Noto Sans"))).toBe(true);
  });

  it("imports lists with unique ids", () => {
    const r = importNiimBlue([sample, sample]);
    expect(r.templates.map((t) => t.id)).toEqual(["t-niimblue-spice-jar", "t-niimblue-spice-jar-2"]);
    expect(r.labels.map((l) => l.templateId)).toEqual(r.templates.map((t) => t.id));
    expect(new Set(r.labels.map((l) => l.id)).size).toBe(2);
  });

  it("respects the dots per mm", () => {
    expect(importNiimBlue(sample, { dpmm: 12 }).templates[0].design).toEqual({ w: 20, h: 8 });
  });

  it("rejects other JSON", () => {
    expect(() => importNiimBlue({ hello: 1 })).toThrow(/no NiimBlue labels/);
  });
});

describe("ZPL import", () => {
  const zpl = `
^XA
^PW400^LL240
^CF0,30
^FO20,20^A0N,40,40^FDACME Parts^FS
^FO20,70^FB360,2,0,C^A0N,24,24^FDLine one\\&Line two^FS
^FO20,130^BY2,3,60^BCN,60,Y,N,N^FDSKU-1234^FS
^FO300,120^BQN,2,4^FDQA,https://example.com/x^FS
^FO10,10^GB380,220,3^FS
^FO10,110^GB380,0,2^FS
^FO330,20^GB50,40,40,B,0^FS
^FO340,30^FR^A0N,20,20^FDNEW^FS
^FO200,200^FH^FDA_5FB^FS
^FO380,40^A0R,20,20^FDSIDE^FS
^PQ1
^XZ`;

  it("tokenizes commands and field data", () => {
    const cmds = tokenizeZpl("^XA^FO10,20^A0N,30,30^FDHello, ^world?^FS^XZ");
    expect(cmds.map((c) => c.code)).toEqual(["XA", "FO", "A", "FD", "FS", "XZ"]);
    expect(cmds[2].params).toBe("0N,30,30");
    expect(cmds[3].params).toBe("Hello, ^world?");
  });

  it("detects ZPL", () => {
    expect(isZpl(zpl)).toBe(true);
    expect(isZpl("hello")).toBe(false);
  });

  it("converts the common commands", () => {
    const r = importZpl(zpl, { name: "Bin" });
    const t = r.templates[0];
    expect(t.design).toEqual({ w: 50, h: 30 });
    const kids = t.root.children;

    const texts = byType(kids, "text") as TextNode[];
    expect(texts.map((x) => r.labels[0].values[x.text.slice(2, -2)])).toEqual(["ACME Parts", "Line one\nLine two", "NEW", "A_B", "SIDE"]);
    expect(texts[0]).toMatchObject({ x: 2.5, y: 2.5 });
    expect(texts[0].sizePt).toBeCloseTo(5 / (25.4 / 72), 1);
    expect(texts[1]).toMatchObject({ align: "center" });
    expect(fixed(texts[1].w)).toBe(45);
    expect(texts[2].color).toBe("invert");
    expect(texts[4].rotate).toBe(90);

    const codes = byType(kids, "code") as CodeNode[];
    expect(codes.map((c) => c.format)).toEqual(["code128", "qrcode"]);
    expect(codes[0]).toMatchObject({ x: 2.5, y: 16.25, showText: true });
    expect(r.labels[0].values[codes[1].value.slice(2, -2)]).toBe("https://example.com/x");
    expect(codes[1].ecc).toBe("Q");

    const rects = byType(kids, "rect");
    expect(rects).toHaveLength(3);
    // Frame: stroked; divider: thin solid line; filled box.
    expect(rects[0]).toMatchObject({ fill: "none", stroke: "black", strokeMm: 0.38 });
    expect(rects[1]).toMatchObject({ fill: "black" });
    expect(fixed(rects[1].h)).toBe(0.25);
    expect(rects[2]).toMatchObject({ fill: "black", x: 41.25, y: 2.5 });
    expect(r.warnings).toEqual([]);
  });

  it("splits several formats and keeps ^FN fields", () => {
    const r = importZpl("^XA^FO0,0^A0N,20^FN1^FDfirst^FS^XZ^XA^FO0,0^A0N,20^FDsecond^FS^XZ", { name: "Multi" });
    expect(r.templates.map((t) => t.name)).toEqual(["Multi 1", "Multi 2"]);
    expect(r.templates[0].fields.map((f) => f.key)).toEqual(["field1"]);
    expect(r.labels[0].values).toEqual({ field1: "first" });
    // No ^PW/^LL: sized to the content.
    expect(r.templates[1].design.w).toBeGreaterThan(1);
  });

  it("warns about unknown commands and rejects empty input", () => {
    expect(importZpl("^XA^FO1,1^ZZ9^FDx^FS^XZ").warnings[0]).toMatch(/\^ZZ/);
    expect(() => importZpl("^XA^XZ")).toThrow(/no ZPL label/);
  });
});
