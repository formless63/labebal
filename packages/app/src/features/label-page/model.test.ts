import { describe, expect, it } from "vitest";
import { labelIdForRow, type DatasetLink } from "@labebal/core";
import { datasetOfLabel, fieldRows, isHttpUrl, linkFor, normalizedHttpUrl, publicBaseUrl, requestOrigin, rowForLabel } from "./model";

describe("label page model", () => {
  it("turns URL-ish values into links", () => {
    expect(linkFor("https://www.mcmaster.com/91290A111")).toBe("https://www.mcmaster.com/91290A111");
    expect(linkFor(" www.digikey.com/x ")).toBe("https://www.digikey.com/x");
    expect(linkFor("parts@example.com")).toBe("mailto:parts@example.com");
    expect(linkFor("M3 x 8")).toBeUndefined();
    expect(linkFor("javascript:alert(1)")).toBeUndefined();
    expect(linkFor("")).toBeUndefined();
    expect(isHttpUrl("https://inv/x")).toBe(true);
    expect(isHttpUrl("ftp://inv/x")).toBe(false);
    expect(normalizedHttpUrl("https://inv.example/parts/10 kΩ")).toBe("https://inv.example/parts/10%20k%CE%A9");
    expect(normalizedHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizedHttpUrl("")).toBeUndefined();
  });

  it("lists template fields in order, then extra values", () => {
    const t = {
      fields: [
        { key: "title", label: "Part name", type: "text" as const },
        { key: "reorder", label: "Reorder", type: "text" as const },
        { key: "spec", label: "", type: "text" as const, default: "A2" },
      ],
    };
    expect(fieldRows(t, { title: "M3", reorder: "https://shop.example/m3", extra: "x", blank: " " })).toEqual([
      { key: "title", label: "Part name", value: "M3" },
      { key: "reorder", label: "Reorder", value: "https://shop.example/m3", href: "https://shop.example/m3" },
      { key: "spec", label: "spec", value: "A2" },
      { key: "extra", label: "extra", value: "x" },
    ]);
  });

  it("finds the dataset row a label was made from", () => {
    const link: DatasetLink = { templateId: "t", fields: {}, keyColumn: "c-sku", idPrefix: "l-drawer-", rules: { rules: [] } as never };
    const rows = [
      { id: "r-1", values: { "c-sku": "SCR M3-8" } },
      { id: "r-2", values: { "c-sku": "NUT-M3" } },
    ];
    const id = labelIdForRow(link, rows[1]);
    expect(id).toBe("l-drawer-nut-m3");
    expect(rowForLabel(link, id, rows)?.id).toBe("r-2");
    expect(rowForLabel(link, "other-nut-m3", rows)).toBeUndefined();
    expect(datasetOfLabel({ tags: ["folder:Drawers", "dataset:ds-drawer-akro"] })).toBe("ds-drawer-akro");
    expect(datasetOfLabel({})).toBeUndefined();
  });

  it("builds the public base URL", () => {
    expect(publicBaseUrl("https://labels.example.com/", "http://localhost:3000")).toBe("https://labels.example.com");
    expect(publicBaseUrl("", "http://localhost:3000/")).toBe("http://localhost:3000");
    expect(publicBaseUrl("not a url", "http://localhost:3000")).toBe("http://localhost:3000");
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(requestOrigin(h({ "x-forwarded-host": "labels.lan, proxy", "x-forwarded-proto": "https", host: "127.0.0.1:3000" }), "http://127.0.0.1:3000")).toBe("https://labels.lan");
    expect(requestOrigin(h({ host: "192.168.1.5:5184" }), "http://localhost:5184")).toBe("http://192.168.1.5:5184");
    expect(requestOrigin(h({ host: "evil.com/path" }), "http://localhost:5184")).toBe("http://localhost:5184");
  });
});
