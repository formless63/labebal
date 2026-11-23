import { describe, expect, it } from "vitest";
import type { Label, Template } from "@labebal/core";
import { EMPTY_LABEL_FILTER, EMPTY_TEMPLATE_FILTER, activeCount, labelFacts, matchLabel, matchTemplate, sizeBucket, tagCounts, templateFacts } from "./filter";
import { parseTags, userTags } from "./tags";

const t = (over: Partial<Template> = {}) => ({ id: "t1", name: "T", design: { w: 30, h: 12 }, tags: ["Freezer"], ...over }) as Template;
const l = (over: Partial<Label> = {}) => ({ id: "l1", name: "L", templateId: "t1", values: {}, tags: ["folder:Drawers", "outdoor"], ...over }) as Label;

describe("tags", () => {
  it("parses what people type", () => {
    expect(parseTags("Freezer, outdoor ,, Freezer\ngarage  box")).toEqual(["freezer", "outdoor", "garage box"]);
    expect(parseTags("folder:x, dataset:y, ok")).toEqual(["ok"]);
  });
  it("hides bookkeeping tags", () => {
    expect(userTags(["folder:a", "dataset:b", "red"])).toEqual(["red"]);
  });
});

describe("label filter", () => {
  it("combines the label's and its template's tags", () => {
    const x = labelFacts(l(), t(), false, false);
    expect(x.tags.sort()).toEqual(["freezer", "outdoor"]);
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, tags: ["freezer", "outdoor"] }, x)).toBe(true);
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, tags: ["freezer", "garage"] }, x)).toBe(false);
  });
  it("filters by template, source and invert", () => {
    const data = labelFacts(l({ tags: ["dataset:ds1"] }), t(), false, true);
    expect(data.source).toBe("data");
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, sources: ["data"] }, data)).toBe(true);
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, sources: ["pack"] }, data)).toBe(false);
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, templates: ["t2"] }, data)).toBe(false);
    expect(matchLabel({ ...EMPTY_LABEL_FILTER, invert: "no" }, data)).toBe(false);
    expect(labelFacts(l(), t(), true, false).source).toBe("pack");
  });
});

describe("template filter", () => {
  it("buckets sizes", () => {
    expect(sizeBucket(t({ design: { w: 30, h: 12 } }))).toBe("tape");
    expect(sizeBucket(t({ design: { w: 40, h: 30 } }))).toBe("small");
    expect(sizeBucket(t({ design: { w: 50, h: 30 } }))).toBe("medium");
    expect(sizeBucket(t({ design: { w: 101.6, h: 152.4 } }))).toBe("large");
  });
  it("filters by size, use and tags", () => {
    const x = templateFacts(t(), false, false);
    expect(matchTemplate({ ...EMPTY_TEMPLATE_FILTER, sizes: ["tape"], usage: "unused", tags: ["freezer"] }, x)).toBe(true);
    expect(matchTemplate({ ...EMPTY_TEMPLATE_FILTER, usage: "used" }, x)).toBe(false);
    expect(activeCount({ ...EMPTY_TEMPLATE_FILTER, sizes: ["tape"], usage: "unused" })).toBe(2);
  });
  it("counts tags", () => {
    expect(tagCounts([["a", "b"], ["b"], []])).toEqual([
      { tag: "b", count: 2 },
      { tag: "a", count: 1 },
    ]);
  });
});
