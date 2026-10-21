import { describe, expect, it } from "vitest";
import type { ChartDayVM, ChartDef, ChartSeriesVM } from "@/queries/chart";
import {
  alignDaily,
  compareDomain,
  compareIndex,
  dailySeries,
  dayCompareView,
  dayReference,
  dayWhy,
  gainNotes,
  inWorkouts,
  lengthText,
  levelsFor,
  NO_COMPARE,
  runningStats,
  stageNotes,
  summaryOf,
  daySeries,
  deltaText,
  drawsBars,
  extentOf,
  fixedDomain,
  noteFor,
  parseRange,
  pointLabels,
  valueText,
  windowFor,
  windowText,
  workoutNotes,
  workoutWindow,
  yDomain,
  type Series,
} from "./model";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

const vm = (values: (number | null)[], from = "2026-09-01"): ChartSeriesVM => ({
  key: "x",
  today: days(from, values.length).at(-1)!,
  days: days(from, values.length),
  values,
  provisional: values.map(() => false),
  partial: values.map(() => false),
  baseline: null,
  reference: null,
});

const dayVm = (p: Partial<ChartDayVM>): ChartDayVM => ({
  view: "hr",
  day: "2026-10-01",
  today: "2026-10-07",
  origin: 0,
  from: 0,
  to: 1440,
  xs: [],
  ys: [],
  spans: [],
  zones: [],
  stages: [],
  bed: null,
  wake: null,
  now: null,
  refs: { resting: null, average: null },
  band: null,
  ...p,
});

const STEPS: ChartDef = { key: "steps", label: "Steps", group: "activity", format: "grouped", colorBy: "single", direction: "up", mark: "bar" };
const HRV: ChartDef = { key: "hrv", label: "Heart rate variability", group: "vitals", unit: "ms", format: "int", colorBy: "single", direction: "up", mark: "line" };
const RECOVERY: ChartDef = { key: "recovery", label: "Recovery", group: "recovery", unit: "%", format: "int", colorBy: "band", direction: "up", mark: "bar", domain: [0, 100] };

describe("ranges", () => {
  it("parses the range param", () => {
    expect(parseRange("6m", false)).toBe("6m");
    expect(parseRange("all", false)).toBe("all");
    expect(parseRange("day", true)).toBe("day");
    expect(parseRange("day", false)).toBe("m");
    expect(parseRange("nope", true)).toBe("m");
    expect(parseRange(undefined, true)).toBe("m");
  });

  it("windows a daily series on the chosen end day", () => {
    const s = dailySeries(STEPS, vm(Array.from({ length: 100 }, (_, i) => i)));
    expect(windowFor("w", s, 99)).toEqual({ start: 92.5, span: 7 });
    expect(windowFor("m", s, 49)).toEqual({ start: 19.5, span: 30 });
    expect(windowFor("all", s, 99)).toEqual({ start: -0.5, span: 100 });
    expect(extentOf("daily", s)).toEqual({ min: -0.5, max: 99.5, minSpan: 4 });
  });

  it("windows a day view on its data", () => {
    const day = dayVm({ xs: [300, 301, 900], ys: [60, null, 70] });
    const s = daySeries(day, "Heart rate", "bpm", "int");
    expect(s.colorBy).toBe("zones");
    expect(windowFor("day", s, 0)).toEqual({ start: 300, span: 600 });
    expect(extentOf("day", s, 0, 1440)).toEqual({ min: 0, max: 1440, minSpan: 20 });
  });
});

describe("y axes", () => {
  it("keeps a band metric's fixed domain on its cut points", () => {
    const s = dailySeries(RECOVERY, vm([10, 90, 50]));
    expect(yDomain(s, 0, 2, { bars: true, count: 4 })).toEqual({ lo: 0, hi: 100, ticks: [0, 33.333333, 66.666667, 100] });
    expect(fixedDomain(0, 3, 4).ticks).toEqual([0, 1, 2, 3]);
  });

  it("starts bars at zero and fits lines to the visible window", () => {
    const steps = dailySeries(STEPS, vm([4000, 12000, 9000, 20000]));
    const bars = yDomain(steps, -0.5, 2.5, { bars: true });
    expect(bars.lo).toBe(0);
    expect(bars.hi).toBeGreaterThanOrEqual(12000);
    expect(bars.hi).toBeLessThan(20000);
    const hrv = dailySeries(HRV, vm([48, 52, 61, 95]));
    const line = yDomain(hrv, -0.5, 2.5, { bars: false });
    expect(line.lo).toBeGreaterThan(0);
    expect(line.lo).toBeLessThanOrEqual(48);
    expect(line.hi).toBeGreaterThanOrEqual(61);
    expect(line.hi).toBeLessThan(95);
  });

  it("keeps the goal and the normal range in view", () => {
    const steps = dailySeries(STEPS, vm([3000, 4000, 5000]));
    expect(yDomain(steps, -1, 3, { bars: true, extra: [10000] }).hi).toBeGreaterThanOrEqual(10000);
    const hrv = dailySeries(HRV, vm([50, 52, 51]));
    const d = yDomain(hrv, -1, 3, { bars: false, extra: [40, 62] });
    expect(d.lo).toBeLessThanOrEqual(40);
    expect(d.hi).toBeGreaterThanOrEqual(62);
  });

  it("aligns the compare axis on the primary grid", () => {
    const hrv: Series = { ...dailySeries(HRV, vm([40, 55, 70])) };
    const d = compareDomain(hrv, -1, 3, 5);
    expect(d.ticks).toHaveLength(5);
    expect(d.lo).toBeLessThanOrEqual(40);
    expect(d.hi).toBeGreaterThanOrEqual(70);
    const rec = dailySeries(RECOVERY, vm([10, 90]));
    expect(compareDomain(rec, 0, 1, 3)).toEqual({ lo: 0, hi: 100, ticks: [0, 50, 100] });
  });

  it("draws bars only for bar metrics over short windows", () => {
    const steps = dailySeries(STEPS, vm([1, 2, 3]));
    const hrv = dailySeries(HRV, vm([1, 2, 3]));
    expect(drawsBars(steps, 30)).toBe(true);
    expect(drawsBars(steps, 182)).toBe(false);
    expect(drawsBars(hrv, 7)).toBe(false);
  });
});

describe("compare", () => {
  it("aligns another metric on the primary's days", () => {
    const a = vm([1, 2, 3, 4], "2026-09-01");
    const b = vm([10, null, 30], "2026-09-02");
    expect(alignDaily(a, b)).toEqual([null, 10, null, 30]);
  });

  it("pairs each point with the compare point beside it", () => {
    const p: Series = { key: "p", label: "P", format: "int", colorBy: "single", mark: "line", sparse: false, xs: [0, 1, 2], ys: [1, 2, 3] };
    const daily: Series = { ...p, ys: [5, null, 7] };
    expect(compareIndex("daily", p, daily)).toEqual([0, -1, 2]);
    const day: Series = { ...p, xs: [0, 30, 60], ys: [1, null, 3] };
    const hr: Series = { ...p, xs: [1, 29, 58, 200], ys: [1, 1, 1, 1] };
    expect(compareIndex("day", day, hr, 5)).toEqual([0, 1, 2]);
    expect(compareIndex("day", { ...p, xs: [100] }, hr, 5)).toEqual([-1]);
  });
});

describe("text", () => {
  it("formats values, deltas and notes", () => {
    expect(valueText(64, "int", "%")).toBe("64%");
    expect(valueText(72, "int", "bpm")).toBe("72 bpm");
    expect(valueText(null, "int", "bpm")).toBe("--");
    expect(deltaText(4, "int", "bpm")).toBe("+4 bpm");
    expect(deltaText(-1.24, "decimal1", "kg")).toBe("−1.2 kg");
    expect(deltaText(0.02, "decimal1")).toBe("±0.0");
    expect(noteFor(70, "int", "ms", { baseline: { mean: 50, sd: 8 } })).toBe("Above your normal range");
    expect(noteFor(50, "int", "ms", { baseline: { mean: 50, sd: 8 } })).toBe("Within your normal range");
    expect(noteFor(8000, "grouped", undefined, { goal: 7000 })).toBe("Goal met");
    expect(noteFor(5000, "grouped", undefined, { goal: 7000 })).toBe("2,000 to goal");
    expect(noteFor(55, "int", "%", { average: 50 })).toBe("+5% vs. average");
    expect(noteFor(50.2, "int", "%", { average: 50 })).toBe("At the average");
    expect(noteFor(null, "int", "%", { average: 50 })).toBe("");
  });

  it("labels points and the visible window", () => {
    const ds = ["2025-12-30", "2026-01-02"];
    expect(pointLabels("daily", [0, 1], ds, "2026-10-07")).toEqual(["Tue, Dec 30, 2025", "Fri, Jan 2"]);
    expect(pointLabels("day", [60, 845], null, "2026-10-07")).toEqual(["01:00", "14:05"]);
    expect(windowText("daily", -0.5, 1.5, ds, "2026-10-07")).toBe("Dec 30, 2025 – Jan 2, 2026");
    expect(windowText("daily", 0, 1, ["2026-09-03", "2026-10-07"], "2026-10-07")).toBe("Sep 3 – Oct 7");
    expect(windowText("day", 360, 870, null, "2026-10-07")).toBe("06:00 – 14:30");
  });
});

describe("today's running total", () => {
  it("is drawn but stays out of the window's stats", () => {
    const v = vm([4000, 6000, 1200]);
    v.partial = [false, false, true];
    const s = dailySeries(STEPS, v);
    expect(s.ys.at(-1)).toBe(1200);
    expect(summaryOf(s, 0, 2).avg).toBe(5000);
  });
});

describe("day views", () => {
  it("draws heart rate beside Strain, stress and the Energy Bank unless turned off", () => {
    expect(dayCompareView("strain", null)).toBe("hr");
    expect(dayCompareView("stress", null)).toBe("hr");
    expect(dayCompareView("energy", null)).toBe("hr");
    expect(dayCompareView("hr", null)).toBeNull();
    expect(dayCompareView("strain", NO_COMPARE)).toBeNull();
    // Another clock-sharing view picked; the view itself or the night never.
    expect(dayCompareView("strain", "energy")).toBe("energy");
    expect(dayCompareView("hr", "strain")).toBe("strain");
    expect(dayCompareView("hr", "hr")).toBeNull();
    expect(dayCompareView("strain", "sleep")).toBe("hr");
    expect(dayCompareView("sleep", "hr")).toBeNull();
  });

  it("says what each day view draws, short enough for the header", () => {
    expect(dayWhy("strain", "strain", "hr")).toBe("Strain as it builds, with heart rate");
    expect(dayWhy("strain", "strain", null)).toBe("Strain as it builds through the day");
    expect(dayWhy("stress", "stress", "hr")).toBe("Stress minute by minute, with heart rate");
    expect(dayWhy("hr", "rhr", null)).toBe("Heart rate against resting HR");
    expect(dayWhy("hr", "avg_hr", null)).toBe("Heart rate against its average");
    expect(dayWhy("hr", "workouts", "strain")).toBe("Heart rate, workouts highlighted, with strain");
    expect(dayWhy("sleep", "hours", null)).toBe("Heart rate and sleep stages, overnight");
    for (const v of ["hr", "strain", "stress", "energy", "sleep"] as const) for (const c of [null, "hr", "energy"] as const) expect(dayWhy(v, "rhr", c).length).toBeLessThanOrEqual(52);
  });

  it("marks the heart-rate metrics' own value as a named line", () => {
    const refs = { resting: 58, average: 74.3 };
    expect(dayReference("rhr", refs)).toEqual({ y: 58, label: "Resting HR", name: "resting HR" });
    expect(dayReference("avg_hr", refs)).toEqual({ y: 74.3, label: "Day average", name: "the day's average" });
    expect(dayReference("workouts", refs)?.y).toBe(58);
    expect(dayReference("avg_hr", { resting: 58, average: null })).toBeNull();
    expect(noteFor(72, "int", "bpm", { reference: { y: 58, name: "resting HR" }, average: 70 })).toBe("+14 bpm vs. resting HR");
    expect(noteFor(70, "int", "bpm", { reference: { y: 74.3, name: "the day's average" } })).toBe("−4 bpm vs. the day's average");
  });

  it("names the night's stage under each minute", () => {
    const stages = [
      { stage: "light" as const, from: -60, to: -20 },
      { stage: "deep" as const, from: -20, to: 30 },
      { stage: "rem" as const, from: 35, to: 70 },
    ];
    expect(stageNotes([-80, -60, -21, 0, 32, 40, 80], stages, -65, 70)).toEqual(["Before sleep", "Light · 23:00–23:40", "Light · 23:00–23:40", "Deep · 23:40–00:30", "", "REM · 00:35–01:10", "After waking"]);
  });

  it("reads a running total by what it gained and where it stood", () => {
    const s: Series = { key: "strain", label: "Day strain", format: "decimal1", colorBy: "strain", mark: "line", sparse: false, zero: true, cumulative: true, xs: [400, 430, 460, 520, 600], ys: [0, 2, 6.5, 6.5, 8] };
    // 520 reads against 460 (an hour before): nothing since. 600 against 520 (the last point at or before 540).
    expect(gainNotes(s)).toEqual(["No change in the last hour", "+2.0 in the last hour", "+6.5 in the last hour", "No change in the last hour", "+1.5 in the last hour"]);
    expect(runningStats(s, 0, 1440)).toEqual({ start: 0, end: 8, gained: 8 });
    expect(runningStats(s, 450, 530)).toEqual({ start: 2, end: 6.5, gained: 4.5 });
    expect(runningStats(s, 0, 300)).toEqual({ start: null, end: null, gained: null });
    // Its axis starts at zero, like bars, and fits the day.
    const d = yDomain(s, 0, 1440, { bars: false });
    expect(d.lo).toBe(0);
    expect(d.hi).toBeGreaterThanOrEqual(8);
    expect(d.hi).toBeLessThan(21);
  });

  it("lights the workouts and frames them", () => {
    const spans = [
      { kind: "sleep" as const, label: "Sleep", from: 0, to: 400 },
      { kind: "workout" as const, label: "Run", from: 420, to: 465 },
      { kind: "workout" as const, label: "Ride", from: 1080, to: 1175 },
    ];
    expect(inWorkouts([410, 420, 440, 465, 470], spans)).toEqual([false, true, true, true, false]);
    expect(workoutNotes([300, 440, 1100], spans)).toEqual([null, "Run · 45 min", "Ride · 1 h 35 min"]);
    expect(workoutWindow(spans, { min: 0, max: 1440 })).toEqual({ start: 360, span: 875 });
    // A late workout's window stays inside the day; no workouts, no window.
    expect(workoutWindow([{ kind: "workout", label: "Run", from: 1400, to: 1420 }], { min: 0, max: 1440 })).toEqual({ start: 1300, span: 140 });
    expect(workoutWindow(spans.slice(0, 1), { min: 0, max: 1440 })).toBeNull();
    expect(lengthText(42)).toBe("42 min");
    expect(lengthText(120)).toBe("2 h");
  });

  it("ends a whole day at 24:00: the window, the last point's readout and the axis' last tick", () => {
    expect(windowText("day", 0, 1440, null, "2026-10-07")).toBe("00:00 – 24:00");
    expect(windowText("day", -65, 430, null, "2026-10-07")).toBe("22:55 – 07:10");
    expect(pointLabels("day", [0, 845, 1440], null, "2026-10-07")).toEqual(["00:00", "14:05", "24:00"]);
    const sixHourly = levelsFor("day", null, 0, 1440).find((l) => l.step === 360)!;
    expect(sixHourly.ticks.map((t) => t.text)).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
    // A night across midnight keeps its clock times.
    expect(levelsFor("day", null, -120, 480).find((l) => l.step === 60)!.ticks[2].text).toBe("00:00");
  });
});
