import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkFetchUrl,
  isAllowListed,
  isPrivateAddress,
  jsonToRecords,
  normalizeScan,
  normalizeSheetUrl,
  parsePath,
  selectPath,
  signWebhook,
  verifyWebhook,
  webhookRetryDelay,
} from "../src/integrations";

describe("normalizeSheetUrl", () => {
  it("turns an edit link into the CSV export of that tab", () => {
    expect(normalizeSheetUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=456")).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456");
    expect(normalizeSheetUrl("https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing")).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=csv");
  });
  it("turns a publish-to-web link into CSV output", () => {
    expect(normalizeSheetUrl("https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml?gid=7&single=true")).toBe(
      "https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?gid=7&single=true&output=csv",
    );
  });
  it("leaves CSV links and other URLs alone", () => {
    const csv = "https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv";
    expect(normalizeSheetUrl("https://docs.google.com/spreadsheets/d/abc/export?format=csv")).toBe("https://docs.google.com/spreadsheets/d/abc/export?format=csv");
    expect(normalizeSheetUrl(csv)).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv");
    expect(normalizeSheetUrl("https://example.com/a.csv")).toBe("https://example.com/a.csv");
    expect(normalizeSheetUrl(" not a url ")).toBe("not a url");
  });
});

describe("paths and JSON rows", () => {
  const body = { meta: { n: 2 }, data: { items: [{ sku: "A1", name: "Bolt", attrs: { size: "M3" }, tags: ["x", "y"] }, { sku: "B2", name: "Nut", attrs: { size: "M5" } }] } };

  it("parses JSONPath-ish selectors", () => {
    expect(parsePath("$.data.items[*].sku")).toEqual([{ key: "data" }, { key: "items" }, { all: true }, { key: "sku" }]);
    expect(parsePath('items[0]["odd key"]')).toEqual([{ key: "items" }, { index: 0 }, { key: "odd key" }]);
    expect(parsePath("$")).toEqual([]);
    expect(() => parsePath("a[b")).toThrow();
  });

  it("selects values", () => {
    expect(selectPath(body, "data.items[*].sku")).toEqual(["A1", "B2"]);
    expect(selectPath(body, "data.items[-1].name")).toEqual(["Nut"]);
    expect(selectPath(body, "nope.x")).toEqual([]);
  });

  it("maps rows with fields", () => {
    expect(
      jsonToRecords(body, {
        rowsPath: "$.data.items[*]",
        fields: [
          { column: "SKU", path: "sku" },
          { column: "Size", path: "attrs.size" },
          { column: "Tags", path: "tags" },
        ],
      }),
    ).toEqual([
      { SKU: "A1", Size: "M3", Tags: "x, y" },
      { SKU: "B2", Size: "M5", Tags: "" },
    ]);
  });

  it("accepts a path to the array itself and flattens without fields", () => {
    expect(jsonToRecords(body, { rowsPath: "data.items" })[0]).toEqual({ sku: "A1", name: "Bolt", "attrs.size": "M3", tags: "x, y" });
  });

  it("finds the rows without a path", () => {
    expect(jsonToRecords([{ a: 1 }, { a: true }])).toEqual([{ a: "1" }, { a: "true" }]);
    expect(jsonToRecords({ results: [{ a: "x" }], count: 1 })).toEqual([{ a: "x" }]);
    expect(jsonToRecords(["p", "q"])).toEqual([{ value: "p" }, { value: "q" }]);
  });
});

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it("checks URLs before DNS", () => {
    expect(checkFetchUrl("https://example.com/x.csv").ok).toBe(true);
    expect(checkFetchUrl("ftp://example.com/").ok).toBe(false);
    expect(checkFetchUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkFetchUrl("http://127.0.0.1:8080/").ok).toBe(false);
    expect(checkFetchUrl("http://[::1]/").ok).toBe(false);
    expect(checkFetchUrl("http://localhost/").ok).toBe(false);
    expect(checkFetchUrl("http://nas/").ok).toBe(false);
    expect(checkFetchUrl("http://printer.local/").ok).toBe(false);
    expect(checkFetchUrl("https://user:pw@example.com/").ok).toBe(false);
  });

  it("honours an allow list", () => {
    expect(isAllowListed("n8n.lan, 10.0.0.0/8", "n8n.lan")).toBe(true);
    expect(isAllowListed("n8n.lan, 10.0.0.0/8", "x.example", "10.2.3.4")).toBe(true);
    expect(isAllowListed("n8n.lan, 10.0.0.0/8", "x.example", "11.2.3.4")).toBe(false);
    expect(isAllowListed("*", "anything")).toBe(true);
    expect(isAllowListed(undefined, "n8n.lan")).toBe(false);
  });
});

describe("webhook signing", () => {
  it("matches a plain HMAC-SHA256 over timestamp.body", async () => {
    const body = JSON.stringify({ event: "print", data: { n: 1 } });
    const sig = await signWebhook("s3cret", 1700000000, body);
    expect(sig).toBe(createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex"));
  });

  it("verifies and rejects", async () => {
    const body = '{"a":1}';
    const sig = `sha256=${await signWebhook("k", "1700000000", body)}`;
    expect(await verifyWebhook("k", "1700000000", body, sig, { now: 1700000010 })).toBe(true);
    expect(await verifyWebhook("k", "1700000000", body + " ", sig, { now: 1700000010 })).toBe(false);
    expect(await verifyWebhook("other", "1700000000", body, sig, { now: 1700000010 })).toBe(false);
    expect(await verifyWebhook("k", "1700000000", body, sig, { now: 1700009999 })).toBe(false);
  });

  it("backs off", () => {
    expect(webhookRetryDelay(1)).toBe(30_000);
    expect(webhookRetryDelay(5)).toBe(21_600_000);
    expect(webhookRetryDelay(6)).toBeUndefined();
  });
});

describe("normalizeScan", () => {
  it("cleans scanner input", () => {
    expect(normalizeScan("  SCR-M3-8\r\n")).toBe("SCR-M3-8");
    expect(normalizeScan("\u001dA\u001dB")).toBe("A B");
    expect(normalizeScan("labebal:label:l-drawer-bin-x")).toBe("l-drawer-bin-x");
    expect(normalizeScan("https://labels.example.com/?label=l-1")).toBe("l-1");
  });
});
