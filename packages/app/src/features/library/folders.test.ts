import { describe, expect, it } from "vitest";
import type { Label } from "@labebal/core";
import { ancestors, buildTree, renamedFolder } from "./folders";

const L = (id: string, folder?: string): Label => ({ id, name: id, templateId: "t", values: {}, ...(folder ? { tags: [`folder:${folder}`] } : {}) });

describe("label folder tree", () => {
  const labels = [L("b"), L("a", "Drawers/Screws"), L("c", "Drawers"), L("d", "Drawers/Screws/M3"), L("e", "Cables")];
  const tree = buildTree(labels, ["Empty"]);
  it("nests folders, sorts them, and counts labels below", () => {
    expect(tree.folders.map((f) => f.name)).toEqual(["Cables", "Drawers", "Empty"]);
    const drawers = tree.folders[1];
    expect(drawers.count).toBe(3);
    expect(drawers.labels.map((l) => l.id)).toEqual(["c"]);
    expect(drawers.folders[0].path).toBe("Drawers/Screws");
    expect(drawers.folders[0].folders[0].depth).toBe(2);
    expect(tree.folders[2].count).toBe(0);
    expect(tree.labels.map((l) => l.id)).toEqual(["b"]);
    expect(tree.count).toBe(5);
  });
  it("renaming a folder moves its subfolders", () => {
    expect(renamedFolder(L("x", "Drawers/Screws/M3"), "Drawers", "Bins")).toBe("Bins/Screws/M3");
    expect(renamedFolder(L("x", "Drawersmith"), "Drawers", "Bins")).toBeNull();
    expect(renamedFolder(L("x", "Drawers/Screws"), "Drawers/Screws", "")).toBe("");
  });
  it("lists ancestors", () => expect(ancestors("A/B/C")).toEqual(["A", "A/B"]));
});
