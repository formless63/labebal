import { describe, expect, it } from "vitest";
import {
  RunControl,
  chunkJobs,
  countLabels,
  expandCopies,
  parseLabelRange,
  pickPositions,
  routeItems,
  runChunks,
  runsOf,
  skipLabels,
} from "../src/print-plan";
import { addUsage, consumableKey, resolveMediaKind, usageEstimate, usageLevel } from "../src/media";

const order = (qtys: number[], c: "grouped" | "collated") => expandCopies(qtys, c).map((e) => `${e.item}.${e.copy}`);

describe("expandCopies", () => {
  it("groups copies (1,1,2,2) or collates sets (1,2,1,2)", () => {
    expect(order([2, 2], "grouped")).toEqual(["0.1", "0.2", "1.1", "1.2"]);
    expect(order([2, 2], "collated")).toEqual(["0.1", "1.1", "0.2", "1.2"]);
  });
  it("collates uneven quantities and skips zero", () => {
    expect(order([3, 0, 1], "collated")).toEqual(["0.1", "2.1", "0.2", "0.3"]);
    expect(expandCopies([1, 2], "collated").map((e) => e.position)).toEqual([1, 2, 3]);
    expect(expandCopies([-1, NaN, 2.7]).length).toBe(2);
  });
});

describe("parseLabelRange", () => {
  it("parses ranges, singles and open ends; merges and clamps", () => {
    expect(parseLabelRange("40-80", 100)).toEqual({ ok: true, ranges: [[40, 80]], count: 41 });
    expect(parseLabelRange("5, 1-3, 2-4, 90-", 95)).toEqual({ ok: true, ranges: [[1, 5], [90, 95]], count: 11 });
    expect(parseLabelRange("8-200", 10)).toEqual({ ok: true, ranges: [[8, 10]], count: 3 });
    expect(parseLabelRange("", 7)).toEqual({ ok: true, ranges: [[1, 7]], count: 7 });
    expect(parseLabelRange("-3", 7)).toEqual({ ok: true, ranges: [[1, 3]], count: 3 });
  });
  it("explains bad input", () => {
    expect(parseLabelRange("abc", 10).ok).toBe(false);
    expect(parseLabelRange("9-3", 10).ok).toBe(false);
    expect(parseLabelRange("0", 10).ok).toBe(false);
    expect(parseLabelRange("11", 10)).toMatchObject({ ok: false, error: expect.stringContaining("only 10") });
  });
  it("picks positions in run order", () => {
    const e = expandCopies([3, 3], "collated");
    const r = parseLabelRange("2-4", e.length);
    expect(r.ok && pickPositions(e, r.ranges).map((x) => `${x.item}.${x.copy}`)).toEqual(["1.1", "0.2", "1.2"]);
  });
});

describe("runsOf", () => {
  it("merges consecutive copies of one item into a page", () => {
    expect(runsOf(expandCopies([3, 2], "grouped")).map((r) => [r.item, r.firstCopy, r.count])).toEqual([
      [0, 1, 3],
      [1, 1, 2],
    ]);
    expect(runsOf(expandCopies([2, 2], "collated")).length).toBe(4);
  });
  it("does not merge across a gap in a range", () => {
    const e = expandCopies([10]);
    const r = parseLabelRange("1-2, 5-6", 10);
    expect(r.ok && runsOf(pickPositions(e, r.ranges)).map((x) => [x.firstCopy, x.count])).toEqual([
      [1, 2],
      [5, 2],
    ]);
  });
});

describe("chunkJobs / skipLabels", () => {
  const jobs = [
    { name: "a", qty: 7 },
    { name: "b", qty: 1 },
    { name: "c", qty: 4 },
  ];
  it("splits into tasks of at most N labels, splitting big quantities", () => {
    const c = chunkJobs(jobs, 5);
    expect(c.map((x) => x.map((j) => `${j.name}${j.qty}`))).toEqual([["a5"], ["a2", "b1", "c2"], ["c2"]]);
    expect(c.map(countLabels)).toEqual([5, 5, 2]);
    expect(chunkJobs([], 5)).toEqual([]);
  });
  it("resumes after N labels", () => {
    expect(skipLabels(jobs, 0)).toEqual(jobs);
    expect(skipLabels(jobs, 3).map((j) => `${j.name}${j.qty}`)).toEqual(["a4", "b1", "c4"]);
    expect(skipLabels(jobs, 8).map((j) => `${j.name}${j.qty}`)).toEqual(["c4"]);
    expect(skipLabels(jobs, 99)).toEqual([]);
  });
});

describe("runChunks", () => {
  const chunks = chunkJobs([{ qty: 25 }], 10);

  it("prints every chunk and reports per-label progress", async () => {
    const seen: number[] = [];
    const r = await runChunks(chunks, async (c, _i, report) => report(countLabels(c)), undefined, (p) => seen.push(p.done));
    expect(r).toEqual({ status: "done", printed: 25, total: 25 });
    expect(seen.at(-1)).toBe(25);
  });

  it("stops at a failure and counts what the printer reported", async () => {
    const r = await runChunks(chunks, async (_c, i, report) => {
      if (i === 1) {
        report(3);
        throw new Error("Lid open");
      }
    });
    expect(r).toEqual({ status: "failed", printed: 13, total: 25, error: "Lid open" });
    // "Continue from label 14" = skip 13.
    expect(countLabels(skipLabels([{ qty: 25 }], r.printed))).toBe(12);
  });

  it("cancels between chunks", async () => {
    const control = new RunControl();
    const r = await runChunks(chunks, async (_c, i) => {
      if (i === 0) control.cancel();
    }, control);
    expect(r).toMatchObject({ status: "cancelled", printed: 0 });
  });

  it("cancels inside a chunk, keeping the reported count", async () => {
    const control = new RunControl();
    const r = await runChunks(chunks, async (_c, i, report) => {
      if (i === 1) {
        report(4);
        control.cancel();
      }
    }, control);
    expect(r).toMatchObject({ status: "cancelled", printed: 14 });
  });

  it("honours an external abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runChunks(chunks, async () => {}, new RunControl(ac.signal));
    expect(r).toMatchObject({ status: "cancelled", printed: 0 });
  });

  it("pauses between chunks until resumed", async () => {
    const control = new RunControl();
    const started: number[] = [];
    const run = runChunks(chunks, async (_c, i) => {
      started.push(i);
      if (i === 0) control.pause();
    }, control);
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual([0]);
    expect(control.paused).toBe(true);
    control.resume();
    expect(await run).toMatchObject({ status: "done", printed: 25 });
    expect(started).toEqual([0, 1, 2]);
  });
});

describe("routeItems", () => {
  const n1 = { id: "n1", w: 30, h: 12 };
  const m2 = { id: "m2", w: 50, h: 30 };
  it("sends each item to the printer whose label is closest to its design size", () => {
    expect(routeItems([{ design: { w: 28, h: 12 } }, { design: { w: 48, h: 28 } }, {}], [n1, m2])).toEqual(["n1", "m2", "n1"]);
  });
  it("respects a hand-picked printer and skips busy ones", () => {
    expect(routeItems([{ design: { w: 28, h: 12 }, pinned: "m2" }], [n1, m2])).toEqual(["m2"]);
    expect(routeItems([{ design: { w: 28, h: 12 }, pinned: "gone" }], [n1, m2])).toEqual(["n1"]);
    expect(routeItems([{ design: { w: 28, h: 12 } }], [{ ...n1, available: false }, m2])).toEqual(["m2"]);
    expect(routeItems([{}], [])).toEqual([null]);
  });
  it("accepts a rotated fit", () => {
    expect(routeItems([{ design: { w: 12, h: 30 } }], [n1, m2])).toEqual(["n1"]);
  });
});

describe("media kind", () => {
  it("prefers override, then the roll tag, then the material", () => {
    expect(resolveMediaKind({ materialId: "white" })).toBe("gap");
    expect(resolveMediaKind({ materialId: "transparent" })).toBe("transparent");
    expect(resolveMediaKind({ materialId: "white", rollType: 3 })).toBe("continuous");
    expect(resolveMediaKind({ materialId: "transparent", rollType: 99 })).toBe("transparent");
    expect(resolveMediaKind({ materialId: "white", rollType: 1, override: "black-mark" })).toBe("black-mark");
  });
});

describe("roll usage", () => {
  it("counts labels per roll and warns when low", () => {
    const key = consumableKey("roll", "SN1", "BC");
    let m = addUsage({}, key, { kind: "roll", barcode: "BC", total: 160, used: 100 }, 20, 1);
    m = addUsage(m, key, { kind: "roll", barcode: "BC", total: 160, used: 100 }, 30, 2);
    expect(m[key]).toMatchObject({ printed: 50, usedAtStart: 100, firstSeen: 1, lastUsed: 2 });
    // Tag not updated: our count wins.
    const est = usageEstimate(m[key], { total: 160, used: 100 });
    expect(est).toMatchObject({ used: 150, left: 10 });
    expect(usageLevel(est.left, est.total)).toBe("low");
    // Tag ahead of us: the tag wins.
    expect(usageEstimate(m[key], { total: 160, used: 155 }).left).toBe(5);
    expect(usageLevel(0, 160)).toBe("empty");
    expect(usageLevel(100, 160)).toBe("ok");
    expect(usageLevel(5, 0)).toBeNull();
  });
});
