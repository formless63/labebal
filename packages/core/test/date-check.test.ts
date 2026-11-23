import { describe, expect, it } from "vitest";
import { fillPlaceholders, placeholdersIn } from "../src/schema";
import { askDefault, formatDate, gs1Digit, luhnDigit, parseDateValue, shiftDate } from "../src/tokens";

const now = new Date(2026, 0, 31, 9, 30); // 31 Jan 2026 09:30 local
const iso = (d: Date | null) => (d ? formatDate(d, "YYYY-MM-DD HH:mm") : null);

describe("date maths", () => {
  it("shifts by days, weeks, months, years and hours", () => {
    expect(iso(shiftDate(now, "+30d"))).toBe("2026-03-02 09:30");
    expect(iso(shiftDate(now, "-1w"))).toBe("2026-01-24 09:30");
    expect(iso(shiftDate(now, "+1m"))).toBe("2026-02-28 09:30"); // clamped
    expect(iso(shiftDate(new Date(2028, 0, 31), "+1m"))).toBe("2028-02-29 00:00");
    expect(iso(shiftDate(new Date(2028, 1, 29), "+1y"))).toBe("2029-02-28 00:00");
    expect(iso(shiftDate(now, "+1y-1d"))).toBe("2027-01-30 09:30");
    expect(iso(shiftDate(now, "+15h"))).toBe("2026-02-01 00:30");
    expect(shiftDate(now, "soon")).toBeNull();
  });

  it("resolves {{date±N:FMT}} and {{time±N}} tokens", () => {
    const ctx = { now };
    expect(fillPlaceholders("{{date+30d}}", {}, ctx)).toBe("2026-03-02");
    expect(fillPlaceholders("{{date+30d:DD MMM YYYY}}", {}, ctx)).toBe("02 Mar 2026");
    expect(fillPlaceholders("{{date-1d:D/M}}", {}, ctx)).toBe("30/1");
    expect(fillPlaceholders("{{date+6m:MM/YY}}", {}, ctx)).toBe("07/26");
    expect(fillPlaceholders("{{date+2y-1d:YYYY-MM-DD}}", {}, ctx)).toBe("2028-01-30");
    expect(fillPlaceholders("{{time+2h}}", {}, ctx)).toBe("11:30");
    expect(fillPlaceholders("BB {{date+30d:DD.MM.YY|upper}}", {}, ctx)).toBe("BB 02.03.26");
    expect(placeholdersIn("{{date+30d:X}}")).toEqual(["date+30d"]);
  });

  it("has extra date format tokens", () => {
    expect(formatDate(new Date(2026, 1, 1), "DDD")).toBe("032");
    expect(formatDate(new Date(2026, 11, 31), "YYDDD")).toBe("26365");
    expect(formatDate(new Date(2026, 10, 19), "dddd ddd MMMM [W]WW")).toBe("Thursday Thu November W47");
  });

  it("parses date values", () => {
    expect(iso(parseDateValue("2026-11-19"))).toBe("2026-11-19 00:00");
    expect(iso(parseDateValue("2026-11-19T14:05"))).toBe("2026-11-19 14:05");
    expect(iso(parseDateValue("20261119"))).toBe("2026-11-19 00:00");
    expect(iso(parseDateValue("261119"))).toBe("2026-11-19 00:00");
    expect(iso(parseDateValue("261100"))).toBe("2026-11-30 00:00"); // GS1 day 00
    expect(iso(parseDateValue("19/11/2026"))).toBe("2026-11-19 00:00");
    expect(iso(parseDateValue("19.11.26"))).toBe("2026-11-19 00:00");
    expect(parseDateValue("2026-02-30")).toBeNull();
    expect(parseDateValue("hello")).toBeNull();
  });

  it("date filter shifts and formats field values", () => {
    const v = { packed: "2026-11-19", bad: "n/a" };
    expect(fillPlaceholders("{{packed|date:DD MMM YYYY}}", v)).toBe("19 Nov 2026");
    expect(fillPlaceholders("{{packed|date:+30d}}", v)).toBe("2026-12-19");
    expect(fillPlaceholders("{{packed|date:+1m-1d:YYMMDD}}", v)).toBe("261218");
    expect(fillPlaceholders("{{bad|date:+30d}}", v)).toBe("n/a");
  });

  it("prefills date questions from defaults", () => {
    expect(askDefault({ askType: "date", default: "today" }, now)).toBe("2026-01-31");
    expect(askDefault({ askType: "date", default: "+30d" }, now)).toBe("2026-03-02");
    expect(askDefault({ askType: "date", default: "19/11/2026" }, now)).toBe("2026-11-19");
    expect(askDefault({ askType: "text", default: "+30d" }, now)).toBe("+30d");
    expect(askDefault({ askType: "date" }, now)).toBe("");
  });
});

describe("check digits and slicing", () => {
  it("computes Luhn and GS1 digits", () => {
    expect(luhnDigit("7992739871")).toBe(3);
    expect(gs1Digit("400638133393")).toBe(1); // EAN-13 4006381333931
    expect(gs1Digit("03600029145")).toBe(2); // UPC-A 036000291452
    expect(gs1Digit("629104150021")).toBe(3); // GS1 example 6291041500213
  });

  it("filters append check digits", () => {
    const v = { cc: "7992739871", ean: "400638133393", txt: "abc", spaced: "4006 3813 3393" };
    expect(fillPlaceholders("{{cc|mod10}}", v)).toBe("79927398713");
    expect(fillPlaceholders("{{ean|gs1}}", v)).toBe("4006381333931");
    expect(fillPlaceholders("{{spaced|replace: :|gs1}}", v)).toBe("4006381333931");
    expect(fillPlaceholders("{{txt|gs1}}", v)).toBe("abc");
    expect(fillPlaceholders("{{seq:00000|gs1}}", {}, { seq: 42 })).toBe("000420");
  });

  it("slices", () => {
    const v = { s: "ABCDEFG", gtin: "04006381333931" };
    expect(fillPlaceholders("{{s|slice:1:3}}", v)).toBe("BC");
    expect(fillPlaceholders("{{s|slice:-3}}", v)).toBe("EFG");
    expect(fillPlaceholders("{{s|slice::2}}", v)).toBe("AB");
    expect(fillPlaceholders("{{s|slice:2:-2}}", v)).toBe("CDE");
    expect(fillPlaceholders("{{gtin|slice:1:-1|gs1}}", v)).toBe("4006381333931");
  });

  it("adds to numbers keeping padding", () => {
    expect(fillPlaceholders("{{n|add:1}}", { n: "0099" })).toBe("0100");
    expect(fillPlaceholders("{{n|add:-5}}", { n: "3" })).toBe("-2");
    expect(fillPlaceholders("{{n|add:1}}", { n: "x" })).toBe("x");
  });
});
