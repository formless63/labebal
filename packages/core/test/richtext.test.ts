import { describe, expect, it } from "vitest";
import { layout, type TextMeasurer } from "../src/layout";
import { adjustSpans, applySpanStyle, buildRich, fitRich, inlineIconIds, isRichText, layoutRich, normalizeSpans, styleOfRange, type RichMeasure } from "../src/richtext";
import type { FrameNode, Template, TextNode } from "../src/schema";

/** Every character is 0.5 em wide (bold 0.6), ascent 0.8, descent 0.2, cap 0.7, line 1.1 em; 1 pt = 1 unit. */
const fakeRich: RichMeasure = {
  run: (_n, text, size, bold) => ({ w: [...text].length * size * (bold ? 0.6 : 0.5), ascent: 0.8 * size, descent: 0.2 * size, cap: 0.7 * size, line: 1.1 * size }),
};

const node = (text: string, extra: Partial<TextNode> = {}): TextNode => ({
  id: "t", type: "text", text, font: "x", sizePt: 10, color: "black", w: { kind: "hug" }, h: { kind: "hug" }, ...extra,
});

describe("rich text model", () => {
  it("plain text stays plain (old path)", () => {
    expect(isRichText(node("Hello {{name}}"))).toBe(false);
    expect(isRichText(node("A {{icon:mdi:cookie}} B"))).toBe(true);
    expect(isRichText(node("Hello", { spans: [{ start: 0, end: 2, bold: true }] }))).toBe(true);
    expect(isRichText(node("Hello", { spans: [{ start: 2, end: 2, bold: true }] }))).toBe(false);
  });

  it("splits styled runs, fills fields per run, and keeps icon tokens", () => {
    const n = node("NEW {{icon:mdi:cookie}} {{kind}}\nline2", { spans: [{ start: 0, end: 3, bold: true }] });
    // A field named "icon" must not swallow the inline icon token.
    const r = buildRich(n, { kind: "Fresh", icon: "box" });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].map((p) => (p.kind === "text" ? `${p.bold ? "*" : ""}${p.text}` : `[${p.icon}]`))).toEqual(["*NEW", " ", "[mdi:cookie]", " Fresh"]);
    expect(r.plain).toBe("NEW  Fresh\nline2");
  });

  it("icons can come from field values", () => {
    const r = buildRich(node("{{a}} x"), { a: "{{icon:nut}}" });
    expect(r.lines[0][0]).toMatchObject({ kind: "icon", icon: "nut" });
  });

  it("spans never cut a placeholder", () => {
    expect(normalizeSpans("ab {{name}} cd", [{ start: 5, end: 7, bold: true }])).toEqual([{ start: 3, end: 11, bold: true }]);
  });

  it("uppercase applies to text but not icon ids", () => {
    const r = buildRich(node("ab {{icon:mdi:nut}}", { uppercase: true }), {});
    expect(r.lines[0]).toMatchObject([{ kind: "text", text: "AB " }, { kind: "icon", icon: "mdi:nut" }]);
  });

  it("collects inline icon ids for preloading", () => {
    const t: Template = {
      id: "t", name: "t", schema: 2, design: { w: 30, h: 10 }, fields: [{ key: "a", label: "A", type: "text", default: "{{icon:x}}" }],
      root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [node("{{icon:mdi:a}}"), { id: "tb", type: "table", cols: [{ kind: "fill" }], rows: [{ kind: "fill" }], cells: [["{{icon:b}}"]], font: "x", sizePt: 6, color: "black", w: { kind: "fill" }, h: { kind: "fill" } }] },
    };
    expect(inlineIconIds(t, { values: { a: "{{icon:c}}" } }).sort()).toEqual(["b", "c", "mdi:a", "x"]);
  });
});

describe("rich text layout", () => {
  it("measures mixed sizes, bold runs and inline icons on one baseline", () => {
    const n = node("ab {{icon:nut}}cd", { spans: [{ start: 0, end: 2, bold: true }, { start: 15, end: 17, scale: 2 }] });
    const L = layoutRich(n, buildRich(n, {}), 10, fakeRich);
    const [line] = L.lines;
    // ab bold: 2*6 = 12; " " = 5; icon = 7 * 1.24 = 8.68; "cd" at 20 pt = 20
    expect(line.items.map((i) => Math.round(i.w * 100) / 100)).toEqual([12, 5, 8.68, 20]);
    expect(L.w).toBeCloseTo(45.68);
    // Tallest run (20 pt) sets the line: ascent 16 + descent 4.
    expect(line.baseline).toBeCloseTo(16);
    expect(L.h).toBeCloseTo(20);
  });

  it("stacks lines by the larger of line height and content", () => {
    const n = node("a\nb");
    const L = layoutRich(n, buildRich(n, {}), 10, fakeRich);
    expect(L.lines[1].baseline - L.lines[0].baseline).toBeCloseTo(11);
    expect(L.h).toBeCloseTo(8 + 11 + 2);
  });

  it("shrinks to fit the box, never below the minimum size", () => {
    const n = node("abcdefgh {{icon:x}}"); // 9 chars * 5 + icon 8.68 = 53.68 wide at 10 pt
    const r = buildRich(n, {});
    const fit = fitRich(n, r, 10, 26.84, 100, fakeRich);
    expect(fit.sizePt).toBeCloseTo(5);
    expect(fit.layout.w).toBeLessThanOrEqual(26.84 + 1e-6);
    expect(fitRich({ ...n, minSizePt: 8 }, r, 10, 26.84, 100, fakeRich).sizePt).toBe(8);
    expect(fitRich({ ...n, fit: "fixed" }, r, 10, 1, 1, fakeRich).sizePt).toBe(10);
    expect(fitRich({ ...n, fit: "fill" }, r, 10, 107.36, 100, fakeRich).sizePt).toBeCloseTo(20);
  });

  it("layout uses measureRich and exposes the rich model", () => {
    const measurer: TextMeasurer = {
      measure: () => ({ w: 1, h: 1 }),
      measureRich: (n, rich, size) => layoutRich(n, rich, size, fakeRich),
    };
    const root: FrameNode = { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [node("x {{icon:nut}}")] };
    const t: Template = { id: "t", name: "t", schema: 2, design: { w: 60, h: 20 }, root, fields: [] };
    const r = layout({ template: t, width: 60, height: 20, measurer });
    const it = r.byId.get("t")!;
    expect(it.rich?.lines[0]).toHaveLength(2);
    expect(it.text).toBe("x ");
    expect(it.box.w).toBeCloseTo(10 + 8.68);
  });
});

describe("rich text editing", () => {
  const spans = [{ start: 2, end: 5, bold: true }];
  it("typing inside or at the end of a span extends it; before it shifts it", () => {
    expect(adjustSpans(spans, "abcdefg", "abcXdefg")).toEqual([{ start: 2, end: 6, bold: true }]);
    expect(adjustSpans(spans, "abcdefg", "abcdeXfg")).toEqual([{ start: 2, end: 6, bold: true }]);
    expect(adjustSpans(spans, "abcdefg", "abXcdefg")).toEqual([{ start: 3, end: 6, bold: true }]);
    expect(adjustSpans(spans, "abcdefg", "Xabcdefg")).toEqual([{ start: 3, end: 6, bold: true }]);
  });
  it("deleting a styled range removes the span", () => {
    expect(adjustSpans(spans, "abcdefg", "abfg")).toBeUndefined();
    expect(adjustSpans(spans, "abcdefg", "abcfg")).toEqual([{ start: 2, end: 3, bold: true }]);
  });
  it("applies and clears styles on a range, merging neighbours", () => {
    let s = applySpanStyle(undefined, 0, 3, "bold", true);
    s = applySpanStyle(s, 3, 5, "bold", true);
    expect(s).toEqual([{ start: 0, end: 5, bold: true }]);
    s = applySpanStyle(s, 1, 2, "bold", false);
    expect(s).toEqual([{ start: 0, end: 1, bold: true }, { start: 2, end: 5, bold: true }]);
    s = applySpanStyle(s, 0, 5, "invert", true);
    expect(styleOfRange(s, 2, 4)).toMatchObject({ bold: true, invert: true });
    expect(styleOfRange(s, 0, 5)).toMatchObject({ bold: false, invert: true });
    s = applySpanStyle(s, 0, 5, "scale", 1.5);
    expect(styleOfRange(s, 0, 5).scale).toBe(1.5);
  });
});
