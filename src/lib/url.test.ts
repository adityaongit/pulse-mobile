import { describe, expect, it } from "vitest";
import { dayHref, parentHref, parseDay, parseRange, stepDay, tabForPath, todayIn, weekOf, withParam } from "./url";

const today = "2026-10-02";

describe("parseDay", () => {
  it("parses a past day", () => {
    expect(parseDay("2026-09-26", today)).toEqual({ d: "2026-09-26", isToday: false, rejected: false });
  });
  it("defaults to today", () => {
    expect(parseDay(undefined, today)).toEqual({ d: today, isToday: true, rejected: false });
    expect(parseDay("", today).d).toBe(today);
  });
  it("rejects future, malformed, impossible and too-old dates", () => {
    // 0001-01-01 would make Home and Journal build a ~740k-day strip.
    for (const raw of ["2026-10-03", "2027-01-01", "yesterday", "2026-9-1", "2026-02-31", "0001-01-01"]) {
      expect(parseDay(raw, today)).toEqual({ d: today, isToday: true, rejected: true });
    }
  });
  it("takes the first of repeated params", () => {
    expect(parseDay(["2026-09-01", "2026-09-02"], today).d).toBe("2026-09-01");
  });
});

describe("stepDay", () => {
  const today = "2026-10-03";
  const first = "2026-09-25";
  // DateSwitcher folds each tap over the last target, so taps made while a day loads add up.
  const taps = (from: string, ...steps: number[]) => steps.reduce((d, n) => stepDay(d, n, today, first), from);

  it("consecutive steps accumulate from the latest target", () => {
    expect(taps(today, -1, -1)).toBe("2026-10-01");
    expect(taps(today, -1, -1, -1, 1)).toBe("2026-10-01");
    expect(taps("2026-10-01", -7)).toBe("2026-09-25");
  });

  it("clamps to [firstDay, today], so a run of taps stops at the edge and turns back from it", () => {
    expect(taps(today, 1)).toBe(today);
    expect(taps("2026-09-27", -1, -1, -1, -1)).toBe(first);
    expect(taps("2026-09-27", -7, 1)).toBe("2026-09-26");
    expect(stepDay("2026-09-20", 0, today, null)).toBe("2026-09-20");
  });
});

describe("dayHref", () => {
  it("carries d into detail links", () => {
    expect(dayHref("/recovery", "2026-09-26", today)).toBe("/recovery?d=2026-09-26");
  });
  it("omits d for today", () => {
    expect(dayHref("/recovery", today, today)).toBe("/recovery");
    expect(dayHref("/recovery?d=2026-09-01", today, today)).toBe("/recovery");
  });
  it("keeps other params and the hash", () => {
    expect(dayHref("/sleep#planner", "2026-09-26", today)).toBe("/sleep?d=2026-09-26#planner");
    expect(dayHref("/strain?r=w", "2026-09-26", today)).toBe("/strain?r=w&d=2026-09-26");
  });
});

describe("other URL state", () => {
  it("range defaults to m", () => {
    expect(parseRange("w")).toBe("w");
    expect(parseRange("6m")).toBe("6m");
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange("year")).toBe("m");
    expect(parseRange(undefined)).toBe("m");
  });
  it("withParam sets and removes", () => {
    expect(withParam("d=2026-09-01&r=w", "d", null)).toBe("?r=w");
    expect(withParam("", "r", "6m")).toBe("?r=6m");
    expect(withParam("?r=w", "r", null)).toBe("");
  });
  it("maps routes to tabs and parents", () => {
    expect(tabForPath("/")).toBe("home");
    expect(tabForPath("/activity/abc")).toBe("home");
    expect(tabForPath("/reports/2026-W39")).toBe("more");
    expect(tabForPath("/trends")).toBe("more");
    expect(tabForPath("/health/monitor")).toBe("health");
    expect(tabForPath("/journal/insights")).toBe("journal");
    expect(tabForPath("/settings")).toBe("more");
    expect(parentHref("/health/stress")).toBe("/health");
    expect(parentHref("/recovery")).toBe("/");
    expect(tabForPath("/workout")).toBe("workout");
    expect(tabForPath("/workout-coach")).toBe("workout");
    expect(parentHref("/workout-coach")).toBe("/workout");
  });
  it("weeks run Monday to Sunday", () => {
    expect(weekOf("2026-10-01")).toEqual(["2026-09-28", "2026-10-04"]);
  });
  it("today is computed in the user's zone", () => {
    const at = new Date("2026-10-01T20:00:00Z"); // 01:30 on Oct 2 in Kolkata
    expect(todayIn("Asia/Kolkata", at)).toBe("2026-10-02");
    expect(todayIn("UTC", at)).toBe("2026-10-01");
  });
});
