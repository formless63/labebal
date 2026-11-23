import { describe, expect, it } from "vitest";
import { applyRules, describeCondition, ruleProblem, testCondition, type RuleSet } from "../src/rules";

const row = { category: "Screws", name: "M3 x 8 socket head", sku: "SCR-M3-8", note: "" };

describe("testCondition", () => {
  it("compares text case-insensitively by default", () => {
    expect(testCondition({ column: "category", op: "equals", value: "screws" }, row)).toBe(true);
    expect(testCondition({ column: "category", op: "equals", value: "screws", caseSensitive: true }, row)).toBe(false);
    expect(testCondition({ column: "name", op: "contains", value: "SOCKET" }, row)).toBe(true);
    expect(testCondition({ column: "sku", op: "startsWith", value: "scr-" }, row)).toBe(true);
    expect(testCondition({ column: "sku", op: "endsWith", value: "-8" }, row)).toBe(true);
  });
  it("handles regex, empty and negation", () => {
    expect(testCondition({ column: "name", op: "regex", value: "^M\\d" }, row)).toBe(true);
    expect(testCondition({ column: "name", op: "regex", value: "(" }, row)).toBe(false);
    expect(testCondition({ column: "note", op: "isEmpty" }, row)).toBe(true);
    expect(testCondition({ column: "missing", op: "isEmpty" }, row)).toBe(true);
    expect(testCondition({ column: "note", op: "isEmpty", not: true }, row)).toBe(false);
    expect(testCondition({ column: "category", op: "equals", value: "Nuts", not: true }, row)).toBe(true);
  });
  it("reports broken patterns", () => {
    expect(ruleProblem({ column: "name", op: "regex", value: "(" })).toMatch(/not valid/);
    expect(ruleProblem({ column: "name", op: "regex", value: "a+" })).toBeUndefined();
    expect(ruleProblem({ column: "", op: "isEmpty" })).toBe("Pick a column");
  });
  it("describes conditions in plain words", () => {
    expect(describeCondition({ column: "category", op: "equals", value: "Screws" }, "Category")).toBe('Category is "Screws"');
    expect(describeCondition({ column: "note", op: "isEmpty", not: true })).toBe("note is not empty");
  });
});

describe("applyRules", () => {
  const set = (mode: RuleSet["mode"]): RuleSet => ({
    mode,
    rules: [
      { id: "a", when: { column: "category", op: "equals", value: "Screws" }, then: { values: { icon: "screw", spec: "{{sku}} / {{date}}" } } },
      { id: "off", disabled: true, when: { column: "category", op: "contains", value: "s" }, then: { invert: false } },
      { id: "b", when: { column: "name", op: "contains", value: "socket" }, then: { values: { icon: "hexagon" }, overrides: { header: { fill: "black" } }, invert: true } },
      { id: "c", when: { column: "name", op: "contains", value: "M3" }, then: { overrides: { header: { stroke: "white" } }, templateId: "t-other" } },
    ],
  });

  it("first-match stops at the first rule", () => {
    const r = applyRules(row, set("first"));
    expect(r.matched).toEqual(["a"]);
    expect(r.values).toEqual({ icon: "screw", spec: "SCR-M3-8 / {{date}}" });
    expect(r.invert).toBeUndefined();
  });

  it("all-matches applies in order, later wins, overrides merge", () => {
    const r = applyRules(row, set("all"));
    expect(r.matched).toEqual(["a", "b", "c"]);
    expect(r.values.icon).toBe("hexagon");
    expect(r.overrides).toEqual({ header: { fill: "black", stroke: "white" } });
    expect(r.invert).toBe(true);
    expect(r.templateId).toBe("t-other");
  });

  it("no rules, no changes", () => {
    expect(applyRules(row, undefined)).toEqual({ values: {}, overrides: {}, matched: [] });
  });
});
