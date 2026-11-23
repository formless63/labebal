import { describe, expect, it } from "vitest";
import { fillPlaceholders, type Template } from "../src/schema";
import { formatDate, needsPerCopyRender, resolveToken, tokensUsed, usesSequence } from "../src/tokens";

const now = new Date(2026, 2, 5, 9, 7, 3); // 5 Mar 2026 09:07:03 local

describe("tokens", () => {
  it("formats dates", () => {
    expect(formatDate(now, "YYYY-MM-DD")).toBe("2026-03-05");
    expect(formatDate(now, "D/M/YY")).toBe("5/3/26");
    expect(formatDate(now, "DD MMM YYYY HH:mm:ss")).toBe("05 Mar 2026 09:07:03");
    expect(formatDate(now, "[Made] YYYY")).toBe("Made 2026");
  });

  it("resolves date / time / seq / copy tokens through placeholders", () => {
    const ctx = { now, seq: 7, copy: 2, copies: 5 };
    expect(fillPlaceholders("{{date}}", {}, ctx)).toBe("2026-03-05");
    expect(fillPlaceholders("{{date:MMM YY}}", {}, ctx)).toBe("Mar 26");
    expect(fillPlaceholders("{{time}}", {}, ctx)).toBe("09:07");
    expect(fillPlaceholders("#{{seq:000}} ({{copy}}/{{copies}})", {}, ctx)).toBe("#007 (2/5)");
    expect(fillPlaceholders("{{seq}}", {}, { seq: 1234 })).toBe("1234");
    expect(fillPlaceholders("{{seq:00}}", {}, { seq: 1234 })).toBe("1234");
  });

  it("defaults to 1 without a print context and lets fields win", () => {
    expect(resolveToken("seq", undefined, {})).toBe("1");
    expect(fillPlaceholders("{{seq}}", { seq: "A" })).toBe("A");
    expect(resolveToken("nope", undefined, {})).toBeUndefined();
  });

  const tpl = (text: string, fields: Template["fields"] = []): Template => ({
    id: "t", name: "t", schema: 2, design: { w: 30, h: 10 }, fields,
    root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [
      { id: "a", type: "text", text, font: "x", sizePt: 8, color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
      { id: "q", type: "code", format: "qrcode", value: "x", color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
    ] },
  });

  it("detects per-copy tokens", () => {
    expect([...tokensUsed(tpl("{{title}} {{seq:000}}"))]).toEqual(["title", "seq"]);
    expect(needsPerCopyRender(tpl("{{date}} {{copies}}"))).toBe(false);
    expect(needsPerCopyRender(tpl("{{copy}}"))).toBe(true);
    expect(usesSequence(tpl("{{seq}}"))).toBe(true);
    expect(usesSequence(tpl("{{seq}}", [{ key: "seq", label: "Seq", type: "text" }]))).toBe(false);
    // Bound in a label override of another prop (code value).
    expect(needsPerCopyRender(tpl("x"), { overrides: { q: { value: "SN-{{seq}}" } } })).toBe(true);
  });
});

describe("team values", () => {
  it("fills {{team:name}} from setTeamValues or the context", async () => {
    const { setTeamValues, teamValuesIn } = await import("../src/tokens");
    setTeamValues({ Company: "Acme Ltd", phone: "555-0100" });
    expect(fillPlaceholders("{{team:company}} · {{team:phone}}", {})).toBe("Acme Ltd · 555-0100");
    expect(fillPlaceholders("{{team:company|upper}}", {})).toBe("ACME LTD");
    expect(fillPlaceholders("[{{team:missing}}]", {})).toBe("[]");
    expect(fillPlaceholders("{{team:company}}", {}, { team: { company: "Other" } })).toBe("Other");
    expect(teamValuesIn("{{team:Company}} {{ team:site|upper }} {{title}}")).toEqual(["company", "site"]);
    setTeamValues({});
  });
});
