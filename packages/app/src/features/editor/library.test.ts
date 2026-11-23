import { describe, expect, it } from "vitest";
import type { LabelComponent } from "@labebal/core";
import { backHref, componentHref, componentToTemplate, templateToComponent } from "./library";

const logo: LabelComponent = {
  id: "c-logo",
  name: "Logo",
  design: { w: 3, h: 10 },
  root: {
    id: "r", type: "frame", layout: "row", lockup: true, w: { kind: "hug" }, h: { kind: "fill" },
    children: [{ id: "t", type: "text", text: "{{title}} {{date:YYYY}}", font: "x", sizePt: 5, color: "black", w: { kind: "hug" }, h: { kind: "hug" } }],
  },
};

describe("component mode", () => {
  it("edits a component as a template whose root fills the design area", () => {
    const t = componentToTemplate(logo);
    expect(t.id).toBe("component:c-logo");
    expect(t.design).toEqual({ w: 3, h: 10 });
    expect(t.root.w).toEqual({ kind: "fill" });
    // Fields used get example values; tokens are not fields.
    expect(t.fields.map((f) => f.key)).toEqual(["title"]);
  });

  it("saves back keeping the default instance size", () => {
    const t = componentToTemplate(logo);
    const c = templateToComponent({ ...t, name: "Brand", design: { w: 4, h: 10 }, root: { ...t.root, gap: 1 } }, logo);
    expect(c).toMatchObject({ id: "c-logo", name: "Brand", design: { w: 4, h: 10 } });
    expect(c.root).toMatchObject({ gap: 1, lockup: true, w: { kind: "hug" }, h: { kind: "fill" } });
  });

  it("links there and back", () => {
    expect(componentHref("c 1", "t-a")).toBe("/components/c%201?from=t-a");
    expect(backHref("t-a")).toBe("/templates/t-a");
    expect(backHref("component:c-2")).toBe("/components/c-2");
    expect(backHref(undefined)).toBe("/templates#parts");
  });
});
