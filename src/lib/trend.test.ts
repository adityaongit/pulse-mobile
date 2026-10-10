import { describe, expect, it } from "vitest";
import { addDays } from "./url";
import { bandCounts, monthSegments, parseOffset, periodLabel, periodWindow, relativeChange, verdict, weeklyTotals, windowDays } from "./trend";

const days = (from: string, values: (number | null)[]) => values.map((value, i) => ({ day: addDays(from, i), value }));
const fmt = (v: number) => String(Math.round(v));

describe("periodWindow", () => {
  it("ends on the day and steps back whole periods", () => {
    expect(periodWindow("2026-04-15", "w")).toEqual({ from: "2026-04-09", to: "2026-04-15" });
    expect(periodWindow("2026-04-15", "m")).toEqual({ from: "2026-03-17", to: "2026-04-15" });
    expect(periodWindow("2026-04-15", "w", 1)).toEqual({ from: "2026-04-02", to: "2026-04-08" });
    expect(periodWindow("2026-04-15", "m", 0, "weekly")).toEqual({ from: "2026-03-19", to: "2026-04-15" });
    expect(windowDays("6m")).toBe(182);
  });
});

describe("periodLabel", () => {
  it("prints the reference app's range", () => {
    expect(periodLabel("2026-03-17", "2026-04-15")).toBe("Mar 17 - Apr 15, 26");
    expect(periodLabel("2025-10-16", "2026-04-15")).toBe("Oct 16, 25 - Apr 15, 26");
  });
});

describe("parseOffset", () => {
  it("accepts small whole numbers only", () => {
    expect(parseOffset("3")).toBe(3);
    for (const raw of [undefined, "", "-1", "1.5", "x", "5000"]) expect(parseOffset(raw)).toBe(0);
  });
});

describe("relativeChange", () => {
  it("rounds to whole percent against the prior", () => {
    expect(relativeChange(85, 80)).toBe(6);
    expect(relativeChange(4, 1)).toBe(300);
    expect(relativeChange(46, 47)).toBe(-2);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(3, 0)).toBeNull();
    expect(relativeChange(null, 3)).toBeNull();
  });
});

describe("weeklyTotals", () => {
  it("sums 7-day weeks ending on the last day", () => {
    const w = weeklyTotals(days("2026-04-01", [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, null, 5]));
    expect(w.map((x) => x.value)).toEqual([1, 8, 15]);
    expect(w.at(-1)).toMatchObject({ from: "2026-04-09", to: "2026-04-15" });
  });
});

describe("monthSegments", () => {
  it("averages each month and compares it with the month before", () => {
    const pts = [...days("2026-02-27", [10, 10]), ...days("2026-03-01", [12, null, 12])];
    expect(monthSegments(pts)).toEqual([
      { month: "2026-02", from: "2026-02-27", to: "2026-02-28", value: 10, change: null },
      { month: "2026-03", from: "2026-03-01", to: "2026-03-03", value: 12, change: 20 },
    ]);
  });
  it("turns weekly metrics into a weekly total per month", () => {
    expect(monthSegments(days("2026-03-01", [10, 0, 0, 0, 0, 0, 0]), "weekly")[0].value).toBe(10);
  });
});

describe("bandCounts", () => {
  it("counts each day in its highest band and skips gaps", () => {
    const bands = [
      { key: "optimal", label: "Optimal", min: 80 },
      { key: "sufficient", label: "Sufficient", min: 70 },
      { key: "poor", label: "Poor", min: -Infinity },
    ];
    expect(bandCounts([85, 80, 79, 10, null], bands).map((b) => b.count)).toEqual([2, 1, 1]);
  });
});

describe("verdict", () => {
  const base = { label: "Sleep consistency", range: "w" as const, agg: "daily" as const, fmt };
  it("compares with the prior period", () => {
    expect(verdict({ ...base, now: 85, prior: 80 })).toBe("Your average Sleep consistency this week (85) was above your previous 7-day average of 80.");
    expect(verdict({ ...base, range: "m", now: 46, prior: 47 })).toBe("Your average Sleep consistency this month (46) was below your previous 30-day average of 47.");
    expect(verdict({ ...base, now: 95.2, prior: 95 })).toContain("consistent with");
    expect(verdict({ ...base, now: 95, prior: null })).toBe("Your average Sleep consistency this week (95).");
    expect(verdict({ ...base, now: null, prior: 3 })).toBe("No Sleep consistency data this week.");
  });
  it("uses the typical range on the week when one is given", () => {
    expect(verdict({ ...base, label: "RHR", now: 60, prior: 59, typical: [58, 62] })).toBe(
      "Your average RHR during this 7-day period was within its typical range (58 - 62).",
    );
  });
  it("words weekly totals", () => {
    expect(verdict({ ...base, label: "time in HR zones 1-3", agg: "weekly", range: "w", now: 129, prior: 327 })).toBe(
      "During this 7-day period, your total time in HR zones 1-3 (129) was below your previous 7-day total of 327.",
    );
    expect(verdict({ ...base, label: "time in HR zones 1-3", agg: "weekly", range: "m", now: 142, prior: 150 })).toBe(
      "Your average weekly time in HR zones 1-3 over these four weeks (142) was below your previous four-week average of 150.",
    );
  });
});
