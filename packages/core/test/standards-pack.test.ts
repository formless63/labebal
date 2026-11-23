/** The built-in Standard formats pack: every sample label renders without errors at its design size (203 dpi). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas as napiCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTestFonts } from "./fixtures/fonts";
import { GENERIC_ZPL, labelPixels, loadCodeEncoder, preflight, renderLabel, setCanvasFactory, setTeamValues, type Label, type LabelSize, type Template } from "../src";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../app/packs/standards");
const manifest = JSON.parse(readFileSync(resolve(dir, "labebal-pack.json"), "utf8")) as { templates: string[]; labels: string[] };
const templates = manifest.templates.map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Template);
const labels = manifest.labels.flatMap((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Label[]);

beforeAll(async () => {
  setCanvasFactory((w, h) => napiCanvas(w, h) as unknown as HTMLCanvasElement);
  registerTestFonts();
  await loadCodeEncoder();
  setTeamValues({ company: "Acme Ltd", address: "1 Main St, Springfield", phone: "555-0100" });
});
afterAll(() => {
  setCanvasFactory(null);
  setTeamValues({});
});

describe("standard formats pack", () => {
  it("has a sample label for every template", () => {
    for (const t of templates) expect(labels.some((l) => l.templateId === t.id)).toBe(true);
  });
  for (const l of labels) {
    it(`${l.name} renders without errors`, () => {
      const t = templates.find((x) => x.id === l.templateId)!;
      const size: LabelSize = { id: "design", printer: "zpl", name: "design", feed: "top", widthMm: t.design.w, heightMm: t.design.h };
      const o = { ...labelPixels(size, GENERIC_ZPL), marginMm: 1, invert: false, labelMm: { w: t.design.w, h: t.design.h } };
      const r = renderLabel(t, l, o);
      if (process.env.SAVE_PNG) {
        mkdirSync(process.env.SAVE_PNG, { recursive: true });
        writeFileSync(resolve(process.env.SAVE_PNG, `${l.id}.png`), (r.canvas as unknown as { toBuffer: (m: string) => Buffer }).toBuffer("image/png"));
      }
      const issues = preflight(t, l, o, r);
      const bad = issues.filter((i) => i.severity !== "info").map((i) => `${i.nodeId}: ${i.message}`);
      if (process.env.SHOW_ISSUES) process.stderr.write(`${JSON.stringify([l.name, issues.map((i) => `${i.severity} ${i.nodeId}: ${i.message}`)])}\n`);
      expect(bad).toEqual([]);
    });
  }
});
