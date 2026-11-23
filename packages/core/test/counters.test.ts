import { describe, expect, it } from "vitest";
import { counterKey, counterPeriod, formatCounter, isoWeek, peekCounter, reserveCounter, shouldReset, watchedValue, type CounterDef } from "../src/counters";
import { fillPlaceholders, type Template } from "../src/schema";
import { countersUsed, needsPerCopyRender, parseCounterArg } from "../src/tokens";

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("counter periods", () => {
  it("names the reset period", () => {
    const d = day(2026, 11, 19);
    expect(counterPeriod("daily", d)).toBe("2026-11-19");
    expect(counterPeriod("monthly", d)).toBe("2026-11");
    expect(counterPeriod("yearly", d)).toBe("2026");
    expect(counterPeriod("weekly", d)).toBe("2026-W47");
    expect(counterPeriod("never", d)).toBe("");
    expect(counterPeriod("change", d)).toBe("");
  });
  it("uses ISO weeks across year ends", () => {
    expect(isoWeek(day(2021, 1, 3))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(day(2024, 12, 30))).toEqual({ year: 2025, week: 1 });
    expect(isoWeek(day(2026, 1, 1))).toEqual({ year: 2026, week: 1 });
  });
});

describe("counter reservation", () => {
  const daily: CounterDef = { id: "box", scope: "global", reset: "daily", start: 1 };
  it("starts at start and continues", () => {
    const a = reserveCounter(daily, undefined, 3, day(2026, 11, 19, 9));
    expect([a.from, a.to, a.reset]).toEqual([1, 3, true]);
    const b = reserveCounter(daily, a.state, 2, day(2026, 11, 19, 17));
    expect([b.from, b.to, b.reset]).toEqual([4, 5, false]);
    expect(b.state.next).toBe(6);
  });
  it("resets on a new day / month", () => {
    const a = reserveCounter(daily, undefined, 5, day(2026, 11, 19, 23));
    const b = reserveCounter(daily, a.state, 1, day(2026, 11, 20, 0));
    expect([b.from, b.reset]).toEqual([1, true]);
    const monthly = { ...daily, reset: "monthly" as const, start: 100 };
    const m1 = reserveCounter(monthly, undefined, 1, day(2026, 11, 30));
    expect(reserveCounter(monthly, m1.state, 1, day(2026, 11, 1)).from).toBe(101);
    expect(reserveCounter(monthly, m1.state, 1, day(2026, 12, 1)).from).toBe(100);
  });
  it("never resets with 'never'", () => {
    const never = { ...daily, reset: "never" as const };
    const a = reserveCounter(never, { next: 42, period: "", watched: null }, 1, day(2030, 1, 1));
    expect(a.from).toBe(42);
    expect(shouldReset(never, undefined, "", null)).toBe(true);
  });
  it("resets when the watched value changes", () => {
    const lot: CounterDef = { id: "box", scope: "global", reset: "change", watchField: "lot", start: 1 };
    const w1 = watchedValue(lot, { lot: "L1 " });
    expect(w1).toBe("L1");
    const a = reserveCounter(lot, undefined, 4, day(2026, 1, 1), w1);
    const b = reserveCounter(lot, a.state, 2, day(2026, 2, 1), "L1");
    expect([b.from, b.to]).toEqual([5, 6]);
    const c = reserveCounter(lot, b.state, 1, day(2026, 2, 1), "L2");
    expect([c.from, c.reset]).toEqual([1, true]);
    expect(peekCounter(lot, c.state, day(2026, 2, 1), "L2")).toBe(2);
    expect(peekCounter(lot, c.state, day(2026, 2, 1), "L3")).toBe(1);
  });
  it("keys sequences by scope", () => {
    expect(counterKey({ scope: "global" }, "t-a", {})).toBe("");
    expect(counterKey({ scope: "template" }, "t-a", {})).toBe("t-a");
    expect(counterKey({ scope: "value", keyField: "sku" }, "t-a", { sku: " SKU-1" })).toBe("t-a/SKU-1");
  });
});

describe("counter formats and tokens", () => {
  it("formats numbers", () => {
    expect(formatCounter(7)).toBe("7");
    expect(formatCounter(7, "000")).toBe("007");
    expect(formatCounter(42, "LOT-####")).toBe("LOT-0042");
    expect(formatCounter(12345, "##")).toBe("12345");
    expect(formatCounter(5, "#/26")).toBe("5/26");
  });
  it("parses token args", () => {
    expect(parseCounterArg("Box")).toEqual({ id: "box", format: undefined });
    expect(parseCounterArg("box:000")).toEqual({ id: "box", format: "000" });
  });
  it("renders {{counter:...}} from the context", () => {
    const ctx = { counters: { box: { n: 7, format: "B-###" } } };
    expect(fillPlaceholders("{{counter:box}}", {}, ctx)).toBe("B-007");
    expect(fillPlaceholders("{{counter:box:0000}}", {}, ctx)).toBe("0007");
    expect(fillPlaceholders("{{counter:other}}", {}, ctx)).toBe("1");
    expect(fillPlaceholders("{{counter:box|gs1}}", {}, { counters: { box: { n: 1234567 } } })).toBe("12345670");
  });
  it("finds counters used by a template", () => {
    const t: Template = {
      id: "t", name: "t", schema: 2, design: { w: 30, h: 10 }, fields: [],
      root: { id: "root", type: "frame", layout: "row", w: { kind: "fill" }, h: { kind: "fill" }, children: [
        { id: "a", type: "text", text: "{{counter:Box:000}} {{ counter:lot }}", font: "x", sizePt: 8, color: "black", w: { kind: "hug" }, h: { kind: "hug" } },
      ] },
    };
    expect([...countersUsed(t)]).toEqual(["box", "lot"]);
    expect(needsPerCopyRender(t)).toBe(true);
  });
});
