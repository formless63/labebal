import { describe, expect, it } from "vitest";
import { layout, type TextMeasurer } from "../src/layout";
import { labelInvert, matchedTemplateRules, resolveLabel, type RuleSet } from "../src/rules";
import type { Template } from "../src/schema";

const rules: RuleSet = {
  mode: "all",
  rules: [
    { id: "screws", when: { column: "category", op: "equals", value: "Screws" }, then: { values: { icon: "screw" } } },
    { id: "elec", when: { column: "category", op: "regex", value: "^(resistors|ics)$" }, then: { overrides: { box: { fill: "black" }, icon: { color: "white" } }, invert: true } },
    { id: "off", disabled: true, when: { column: "category", op: "isEmpty", not: true }, then: { values: { title: "never" } } },
  ],
};

const tpl: Template = {
  id: "t",
  name: "T",
  schema: 2,
  design: { w: 30, h: 12 },
  fields: [
    { key: "title", label: "Title", type: "text", default: "x" },
    { key: "category", label: "Category", type: "text", default: "Screws" },
    { key: "icon", label: "Icon", type: "text", default: "box" },
  ],
  root: {
    id: "root",
    type: "frame",
    layout: "row",
    w: { kind: "fill" },
    h: { kind: "fill" },
    children: [
      { id: "box", type: "frame", layout: "row", w: { kind: "fixed", mm: 8 }, h: { kind: "fill" }, children: [{ id: "icon", type: "icon", icon: "{{icon}}", color: "black", w: { kind: "fill" }, h: { kind: "fill" } }] },
      { id: "title", type: "text", text: "{{title}}", font: "Arial", color: "black", sizePt: 8, w: { kind: "fill" }, h: { kind: "fill" } },
    ],
  },
  rules,
};

describe("resolveLabel (template rules)", () => {
  it("returns the label untouched without rules or matches", () => {
    const l = { values: { category: "Nuts" } };
    expect(resolveLabel({ ...tpl, rules: undefined }, l)).toBe(l);
    expect(resolveLabel(tpl, l)).toBe(l);
  });

  it("fills empty fields from rules (a value set on the label wins) and uses field defaults as the row", () => {
    expect(resolveLabel(tpl, { values: { category: "screws", icon: "tool" } })?.values?.icon).toBe("tool");
    expect(resolveLabel(tpl, { values: { category: "screws", icon: "" } })?.values?.icon).toBe("screw");
    expect(resolveLabel(tpl, { values: { category: "screws", icon: "  " } })?.values?.icon).toBe("screw");
    // category comes from the field default "Screws"
    expect(resolveLabel(tpl, { values: {} })?.values?.icon).toBe("screw");
    expect(resolveLabel(tpl, undefined)?.values?.icon).toBe("screw");
  });

  it("merges overrides with the label's own on top, and keeps an explicit invert", () => {
    const r = resolveLabel(tpl, { values: { category: "ICs" }, overrides: { icon: { color: "black" } } });
    expect(r?.overrides).toEqual({ box: { fill: "black" }, icon: { color: "black" } });
    expect(r?.invert).toBe(true);
    expect(resolveLabel(tpl, { values: { category: "ICs" }, invert: false })?.invert).toBe(false);
  });

  it("labelInvert: label, then rules, then template default", () => {
    expect(labelInvert(tpl, { values: { category: "ICs" } })).toBe(true);
    expect(labelInvert(tpl, { values: { category: "Nuts" } })).toBe(false);
    expect(labelInvert({ ...tpl, invertByDefault: true }, { values: { category: "Nuts" } })).toBe(true);
    expect(labelInvert(tpl, { values: { category: "ICs" }, invert: false })).toBe(false);
    expect(labelInvert(undefined, { invert: true })).toBe(true);
  });

  it("ignores disabled rules and reports matches", () => {
    expect(matchedTemplateRules(tpl, { values: { category: "Screws" } })).toEqual(["screws"]);
  });

  it("layout applies template rules (render paths agree)", () => {
    const fake: TextMeasurer = { measure: (_n, text, pt) => ({ w: text.length * pt * 0.2, h: pt * 0.35 }) };
    const r = layout({ template: tpl, width: 30, height: 12, measurer: fake, label: { values: { category: "Resistors" } } });
    expect(r.byId.get("icon")?.text).toBe("box");
    expect((r.byId.get("box")?.node as { fill?: string }).fill).toBe("black");
    const s = layout({ template: tpl, width: 30, height: 12, measurer: fake, label: { values: { category: "Screws" } } });
    expect(s.byId.get("icon")?.text).toBe("screw");
  });
});
