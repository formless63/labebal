import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import type { NiimbotAbstractClient } from "@mmote/niimbluelib";
import { PrinterConnection, PrinterRegistry, type PrintJob } from "../src/printer";

/** Minimal stand-in for a niimbluelib client: records print tasks, emits progress like the status poll. */
function fakeClient(opts: { failOnTask?: number } = {}) {
  const handlers = new Map<string, Set<(e: unknown) => void>>();
  const tasks: { name: string; options: Record<string, unknown>; pages: number[]; ended: boolean }[] = [];
  const emit = (ev: string, e: unknown) => handlers.get(ev)?.forEach((h) => h(e));
  const client = {
    on: (ev: string, h: (e: unknown) => void) => void (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(h),
    off: (ev: string, h: (e: unknown) => void) => void handlers.get(ev)?.delete(h),
    getModelMetadata: () => ({ model: "N1", dpi: 203, printheadPixels: 96 }),
    getPrintTaskType: () => "B1",
    protocol: {
      cancelStatusPoll: () => {},
      newPrintTask: (name: string, options: Record<string, unknown>) => {
        const t = { name, options, pages: [] as number[], ended: false };
        tasks.push(t);
        const index = tasks.length - 1;
        return {
          printInit: async () => {},
          printPage: async (_img: unknown, qty: number) => void t.pages.push(qty),
          waitForPageFinished: async () => {},
          waitForFinished: async () => {
            const total = options.totalPages as number;
            if (opts.failOnTask === index) {
              emit("printprogress", { page: 2, pagesTotal: total, pagePrintProgress: 100, pageFeedProgress: 100 });
              throw new Error("Paper jam");
            }
            emit("printprogress", { page: total, pagesTotal: total, pagePrintProgress: 100, pageFeedProgress: 100 });
          },
          printEnd: async () => {
            t.ended = true;
            return true;
          },
        };
      },
    },
  };
  return { client: client as unknown as NiimbotAbstractClient, tasks };
}

const canvas = () => createCanvas(16, 16) as unknown as HTMLCanvasElement;
const jobs = (): PrintJob[] => [
  { canvas: canvas(), qty: 3, name: "A" },
  { canvas: canvas(), qty: 4, name: "B" },
];

describe("PrinterConnection.print", () => {
  it("prints in chunks with the given label type and print task", async () => {
    const { client, tasks } = fakeClient();
    const c = new PrinterConnection();
    c.attachClient(client);
    const r = await c.print(jobs(), { density: 2, direction: "left", labelType: 5, printTask: "D110", chunkSize: 5 });
    expect(r).toEqual({ status: "done", printed: 7, total: 7 });
    expect(tasks.map((t) => [t.name, t.options.totalPages, t.options.labelType, t.pages])).toEqual([
      ["D110", 5, 5, [3, 2]],
      ["D110", 2, 5, [2]],
    ]);
    expect(tasks.every((t) => t.ended)).toBe(true);
    expect(c.getSnapshot()).toMatchObject({ busy: false, progress: { done: 7, total: 7 } });
  });

  it("reports where it stopped and resumes from there", async () => {
    const { client, tasks } = fakeClient({ failOnTask: 1 });
    const c = new PrinterConnection();
    c.attachClient(client);
    const r = await c.print(jobs(), { density: 2, direction: "left", chunkSize: 3 });
    expect(r).toEqual({ status: "failed", printed: 5, total: 7, error: "Paper jam" });
    expect(tasks[0].options.labelType).toBe(1); // default: with gaps
    expect(c.getSnapshot().error).toBe("Paper jam");

    const again = fakeClient();
    c.attachClient(again.client);
    const r2 = await c.print(jobs(), { density: 2, direction: "left", chunkSize: 3, skip: r.printed });
    expect(r2).toEqual({ status: "done", printed: 2, total: 2 });
    expect(again.tasks.map((t) => t.pages)).toEqual([[2]]);
  });
});

describe("PrinterRegistry", () => {
  it("keeps a primary printer and adds / removes others", async () => {
    const reg = new PrinterRegistry();
    const first = reg.getSnapshot();
    expect(first).toHaveLength(1);
    const extra = reg.add();
    expect(reg.getSnapshot()).toHaveLength(2);
    expect(reg.getSnapshot()).not.toBe(first);
    expect(reg.get(extra.id)).toBe(extra);
    await reg.remove(extra.id);
    await reg.remove(reg.primary.id);
    expect(reg.list()).toHaveLength(1);
  });
});

import { liveFromHeartbeat } from "../src/printer";

describe("heartbeat lid flag", () => {
  it("is reversed on the N1 (verified on hardware) and passed through elsewhere", () => {
    expect(liveFromHeartbeat({ lidClosed: false }, "N1")?.lidClosed).toBe(true);
    expect(liveFromHeartbeat({ lidClosed: true }, "N1")?.lidClosed).toBe(false);
    expect(liveFromHeartbeat({ lidClosed: true }, "M2_H")?.lidClosed).toBe(true);
    expect(liveFromHeartbeat({ batteryPercents: 50 }, "N1")?.lidClosed).toBeUndefined();
  });
});
