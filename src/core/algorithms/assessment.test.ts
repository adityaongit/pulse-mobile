// The Performance Assessment in reports.ts: period values, moves scaled by spread, the biggest changes and the focus
// points, over synthetic weeks (Sep 21–27 before Sep 28 – Oct 4, 2026).
import { describe, expect, it } from "vitest";
import { assessPeriod, minutesText, previousPeriod, type AssessmentDay } from "./reports";

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** A steady week: Recovery 60, Strain 10, sleep 80 %, HRV 50, RHR 55, 30 + 15 zone min a day, lifts Mon and Thu, 9k steps. */
const week = (monday: string, x: Partial<AssessmentDay> = {}, n = 7): AssessmentDay[] =>
  Array.from({ length: n }, (_, k) => ({
    day: addDays(monday, k),
    recovery: 60,
    strain: 10,
    sleepPerf: 80,
    hrv: 50,
    rhr: 55,
    zone13Min: 30,
    zone45Min: 15,
    strengthSessions: k === 0 || k === 3 ? 1 : 0,
    steps: 9000,
    consistency: 85,
    sleptMin: 480,
    needMin: 450,
    ...x,
  }));
const PREV = "2026-09-21";
const CUR = "2026-09-28";

describe("assessPeriod", () => {
  it("averages each metric, with zone minutes and strength sessions a week", () => {
    const a = assessPeriod(week(CUR), week(PREV), "week");
    expect(a.stats.recovery).toMatchObject({ value: 60, previous: 60, delta: 0, n: 7, prevN: 7, move: 0 });
    expect(a.stats.zone13.value).toBe(210);
    expect(a.stats.zone45.value).toBe(105);
    expect(a.stats.strength.value).toBe(2);
    expect(a.stats.slept.value).toBe(480);
    expect(a.sleep).toEqual({ sleptMin: 480, needMin: 450, nightsMet: 7, nights: 7 });
    expect(a).toMatchObject({ days: 7, prevDays: 7, improved: [], declined: [] });
    expect(a.focus).toEqual([{ code: "steadyWeek", params: {} }]);
  });

  it("names a consistency drop with what to do about it", () => {
    const a = assessPeriod(week(CUR, { consistency: 73 }), week(PREV), "week");
    expect(a.stats.consistency.delta).toBe(-12);
    expect(a.stats.consistency.move).toBeCloseTo(-1.5, 10);
    expect(a.declined.map((s) => s.key)).toEqual(["consistency"]);
    expect(a.focus).toEqual([{ code: "declineConsistency", params: { points: 12 } }]);
  });

  it("ranks focus points by salience: a drop or a gap to target, two at most", () => {
    const sleepy = { sleptMin: 400, needMin: 460 };
    const a = assessPeriod(week(CUR, { ...sleepy, steps: 5500 }), week(PREV, sleepy), "week");
    expect(a.focus).toEqual([
      { code: "declineSteps", params: { steps: "3,500" } },
      { code: "gapSlept", params: { slept: "6:40", need: "7:40", earlier: "1 h" } },
    ]);
    expect(a.sleep).toMatchObject({ nightsMet: 0, nights: 7 });
  });

  it("gaps follow the plan's targets", () => {
    const a = assessPeriod(week(CUR, { zone13Min: 10 }), week(PREV, { zone13Min: 10 }), "week", { zone13: 150, zone45: 75, strength: 2, steps: 8000, consistency: 80, sleepNeed: 5 });
    expect(a.focus).toEqual([{ code: "gapZone13", params: { value: 70, target: 150, walks: 3 } }]);
    const lower = assessPeriod(week(CUR, { zone13Min: 10 }), week(PREV, { zone13Min: 10 }), "week", { zone13: 70, zone45: 75, strength: 2, steps: 8000, consistency: 80, sleepNeed: 5 });
    expect(lower.focus).toEqual([{ code: "steadyWeek", params: {} }]);
  });

  it("with nothing to fix, the biggest improvement is the focus", () => {
    const a = assessPeriod(week(CUR, { hrv: 56, rhr: 53 }), week(PREV), "month");
    expect(a.improved.map((s) => s.key)).toEqual(["hrv", "rhr"]);
    expect(a.stats.rhr.move).toBeCloseTo(0.5, 10);
    expect(a.focus).toEqual([{ code: "riseHrvUp", params: { value: 6 } }]);
  });

  it("Strain has no good direction: never a change or a focus", () => {
    const a = assessPeriod(week(CUR, { strain: 18 }), week(PREV), "week");
    expect(a.stats.strain.delta).toBe(8);
    expect(a.stats.strain.move).toBeNull();
    expect([...a.improved, ...a.declined]).toEqual([]);
  });

  it("few days: too early for a trend, and no moves ranked", () => {
    const a = assessPeriod(week(CUR, { hrv: 80 }, 2), week(PREV), "week");
    expect(a.days).toBe(2);
    expect(a.stats.hrv.move).toBeNull();
    expect(a.focus).toEqual([{ code: "earlyWeek", params: { days: 2 } }]);
    const thin = assessPeriod(week(CUR), week(PREV, {}, 2), "week");
    expect(thin.focus).toEqual([{ code: "prevThinWeek", params: { days: 2 } }]);
  });

  it("an empty previous period leaves deltas null", () => {
    const a = assessPeriod(week(CUR), [], "week");
    expect(a.stats.recovery).toMatchObject({ value: 60, previous: null, delta: null, move: null });
    expect(a.prevDays).toBe(0);
  });
});

describe("helpers", () => {
  it("the previous period of the same kind", () => {
    expect(previousPeriod("2026-W40")).toBe("2026-W39");
    expect(previousPeriod("2026-W01")).toBe("2025-W52");
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-03")).toBe("2026-02");
  });

  it("minutes in words", () => {
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(70)).toBe("1 h 10 min");
  });
});
