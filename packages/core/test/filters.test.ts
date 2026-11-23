import { describe, expect, it } from "vitest";
import { fillPlaceholders, placeholdersIn } from "../src/schema";
import "../src/tokens";

describe("computed fields (filters)", () => {
  const v = { name: "m3 hex nut", sku: "42", v: "5", empty: "" };
  it("applies filters in order", () => {
    expect(fillPlaceholders("{{name|upper}}", v)).toBe("M3 HEX NUT");
    expect(fillPlaceholders("{{name|title}}", v)).toBe("M3 Hex Nut");
    expect(fillPlaceholders("SKU-{{sku|pad:5}}", v)).toBe("SKU-00042");
    expect(fillPlaceholders("{{v|suffix: V}}", v)).toBe("5 V");
    expect(fillPlaceholders("{{empty|suffix: V}}", v)).toBe("");
    expect(fillPlaceholders("{{empty|default:n/a|upper}}", v)).toBe("N/A");
    expect(fillPlaceholders("{{name|truncate:6}}", v)).toBe("m3 he…");
    expect(fillPlaceholders("{{name|replace: :_|upper}}", v)).toBe("M3_HEX_NUT");
  });
  it("works with tokens and keeps token args", () => {
    expect(fillPlaceholders("{{seq:000|prefix:#}}", {}, { seq: 7 })).toBe("#007");
    expect(fillPlaceholders("{{date:YYYY}}", {}, { now: new Date(2026, 0, 2) })).toBe("2026");
  });
  it("lists placeholder keys", () => {
    expect(placeholdersIn("{{a|upper}} {{b:x}} {{c}}")).toEqual(["a", "b", "c"]);
  });
});

import { renamePlaceholder } from "../src/edit";
import { fillFromRow } from "../src/rules";

describe("filters elsewhere", () => {
  it("rename keeps filters and token args", () => {
    expect(renamePlaceholder("{{title|upper}} {{title}} {{title:x}}", "title", "name")).toBe("{{name|upper}} {{name}} {{name:x}}");
  });
  it("rules fill from row with filters", () => {
    expect(fillFromRow("{{cat|upper}}-{{date}}", { cat: "nut" })).toBe("NUT-{{date}}");
  });
});
