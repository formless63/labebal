import { afterEach, describe, expect, it } from "vitest";
import { fillPlaceholders, type FrameNode, type Template } from "../src/schema";
import { labelContext, labelIdFromUrl, labelPath, labelUrlBaseFor, labelUrlFor, setLabelUrlBase, tokensUsed } from "../src/tokens";
import { layout, type TextMeasurer } from "../src/layout";
import { normalizeScan } from "../src/integrations";

const fake: TextMeasurer = { measure: (_n, text, sizePt) => ({ w: text.length * sizePt * 0.1, h: sizePt * 0.1 }) };

const tpl = (extra: Partial<Template> = {}): Template => ({
  id: "t",
  name: "t",
  schema: 2,
  design: { w: 40, h: 12 },
  fields: [{ key: "sku", label: "SKU", type: "text" }],
  root: {
    id: "root",
    type: "frame",
    layout: "row",
    w: { kind: "fill" },
    h: { kind: "fill" },
    children: [
      { id: "qr", type: "code", format: "qr", value: "{{labelUrl}}", w: { kind: "fixed", mm: 10 }, h: { kind: "fixed", mm: 10 } },
      { id: "rec", type: "text", text: "{{recordUrl}}", font: "x", sizePt: 6, color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
    ],
  } as FrameNode,
  ...extra,
});

afterEach(() => setLabelUrlBase(undefined));

describe("label URLs", () => {
  it("builds label page paths and URLs", () => {
    expect(labelPath("l-drawer-a1")).toBe("/l/l-drawer-a1");
    expect(labelPath("odd id/1")).toBe("/l/odd%20id%2F1");
    expect(labelUrlFor("x", "https://labels.example.com/")).toBe("https://labels.example.com/l/x");
    expect(labelUrlFor("x", "")).toBe("/l/x");
  });

  it("picks the base: context, then setLabelUrlBase, then location.origin", () => {
    // Node has no location: nothing configured -> "".
    expect(labelUrlBaseFor()).toBe("");
    setLabelUrlBase("https://labebal.lan/ ");
    expect(labelUrlBaseFor()).toBe("https://labebal.lan");
    expect(labelUrlBaseFor({ baseUrl: "http://other:3000/" })).toBe("http://other:3000");
    setLabelUrlBase("");
    const g = globalThis as { location?: unknown };
    g.location = { origin: "http://localhost:5184" };
    try {
      expect(labelUrlBaseFor()).toBe("http://localhost:5184");
    } finally {
      delete g.location;
    }
  });

  it("resolves {{labelUrl}} and {{recordUrl}} tokens", () => {
    setLabelUrlBase("https://labebal.lan");
    expect(fillPlaceholders("{{labelUrl}}", {}, { labelId: "l-1" })).toBe("https://labebal.lan/l/l-1");
    expect(fillPlaceholders("{{labelUrl}}", {}, { labelId: "l-1", baseUrl: "http://x" })).toBe("http://x/l/l-1");
    // No label id (a template preview with example values): a stand-in so the QR still shows.
    expect(fillPlaceholders("{{labelUrl}}", {})).toBe("https://labebal.lan/l/example");
    // A field of the same name wins.
    expect(fillPlaceholders("{{labelUrl}}", { labelUrl: "mine" }, { labelId: "l-1" })).toBe("mine");
    expect(fillPlaceholders("{{recordUrl|upper}}", {}, { recordUrl: "https://inv/p/1" })).toBe("HTTPS://INV/P/1");
    expect(fillPlaceholders("https://inv/p/{{sku|url}}", { sku: "M3 × 8/A2" })).toBe("https://inv/p/M3%20%C3%97%208%2FA2");
    expect(tokensUsed(tpl())).toEqual(new Set(["labelUrl", "recordUrl"]));
  });

  it("labelContext adds the label id and fills the template's recordUrl", () => {
    const t = tpl({ recordUrl: "https://inventory.example/parts/{{sku}}?from={{recordUrl}}" });
    expect(labelContext(t, { id: "l-9" }, { sku: "M3-8" })).toEqual({ labelId: "l-9", recordUrl: "https://inventory.example/parts/M3-8?from=" });
    // Explicit context wins.
    expect(labelContext(t, { id: "l-9" }, { sku: "x" }, { labelId: "other", recordUrl: "r" })).toEqual({ labelId: "other", recordUrl: "r" });
    expect(labelContext(tpl(), undefined, {})).toEqual({});
  });

  it("layout fills the tokens from the label being laid out", () => {
    setLabelUrlBase("https://labebal.lan");
    const t = tpl({ recordUrl: "https://inventory.example/parts/{{sku}}" });
    const r = layout({ template: t, width: 40, height: 12, measurer: fake, label: { id: "l-drawer-a1", values: { sku: "SCR-M3" } } });
    expect(r.byId.get("qr")!.text).toBe("https://labebal.lan/l/l-drawer-a1");
    expect(r.byId.get("rec")!.text).toBe("https://inventory.example/parts/SCR-M3");
  });

  it("reads label ids back from label page links (scanning)", () => {
    expect(labelIdFromUrl("https://labebal.lan/l/l-drawer-a1")).toBe("l-drawer-a1");
    expect(labelIdFromUrl("http://localhost:5184/l/odd%20id%2F1/?x=1")).toBe("odd id/1");
    expect(labelIdFromUrl("https://labebal.lan/labels/x")).toBeNull();
    expect(labelIdFromUrl("l-drawer-a1")).toBeNull();
    expect(normalizeScan("https://labebal.lan/l/l-drawer-a1\r\n")).toBe("l-drawer-a1");
    expect(normalizeScan("https://labebal.lan/?label=l-2")).toBe("l-2");
  });
});
