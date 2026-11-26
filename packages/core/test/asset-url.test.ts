import { afterEach, describe, expect, it } from "vitest";
import { assetUrl, fontUrl, setAssetBase, setFontBase } from "../src";

describe("assetUrl", () => {
  afterEach(() => {
    setAssetBase("");
    setFontBase("");
  });

  it("leaves URLs alone at the site root", () => {
    expect(assetUrl("/api/assets/a1")).toBe("/api/assets/a1");
    expect(assetUrl("/fonts/x.woff2")).toBe("/fonts/x.woff2");
  });

  it("follows the mount for uploaded assets and built-in fonts", () => {
    setAssetBase("/fulfillment/labels/api/");
    setFontBase("/fulfillment/labels/api/static");
    expect(assetUrl("/api/assets/a1")).toBe("/fulfillment/labels/api/assets/a1");
    expect(fontUrl("/api/assets/f1")).toBe("/fulfillment/labels/api/assets/f1");
    expect(fontUrl("/fonts/x.woff2")).toBe("/fulfillment/labels/api/static/fonts/x.woff2");
  });

  it("does not touch other URLs", () => {
    setAssetBase("/labels/api");
    for (const u of ["data:image/png;base64,AA", "https://example.com/api/assets/a1", "blob:x", "/api/library", "/api/assetsx"]) expect(assetUrl(u)).toBe(u);
  });
});
