import { describe, expect, it } from "vitest";
import {
  isDefaultPlan,
  parsePlan,
  parsePlanTarget,
  PLAN_DEFAULTS,
  PLAN_KEYS,
  validatePlanTarget,
  weeklyPlan,
  weekValue,
  withPlanEnabled,
  withPlanTarget,
  type PlanDay,
} from "./weeklyPlan";

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const blank = (day: string): PlanDay => ({ day, zone13Min: null, zone45Min: null, strengthSessions: 0, steps: null, consistency: null, sleptMin: null, needMin: null });
const d = (day: string, x: Partial<PlanDay> = {}): PlanDay => ({ ...blank(day), ...x });

/** A week that meets every default: 30 moderate and 15 vigorous min a day, lifts on Mon and Thu, 9k steps, 85 %, need met. */
const goodWeek = (monday: string): PlanDay[] =>
  Array.from({ length: 7 }, (_, k) =>
    d(addDays(monday, k), { zone13Min: 30, zone45Min: 15, strengthSessions: k === 0 || k === 3 ? 1 : 0, steps: 9000, consistency: 85, sleptMin: 480, needMin: 450 }),
  );
/** A week that misses every default. */
const poorWeek = (monday: string): PlanDay[] =>
  Array.from({ length: 7 }, (_, k) => d(addDays(monday, k), { zone13Min: 10, zone45Min: 0, steps: 5000, consistency: 60, sleptMin: 380, needMin: 460 }));

describe("plan settings", () => {
  it("parses stored JSON, falling back to the defaults for anything missing or out of range", () => {
    expect(parsePlan(null)).toEqual(PLAN_DEFAULTS);
    expect(parsePlan("not json")).toEqual(PLAN_DEFAULTS);
    const p = parsePlan(JSON.stringify({ targets: { zone13: 200, strength: 9, steps: 7500.5 }, enabled: { zone45: false, steps: "no" } }));
    expect(p.targets).toEqual({ ...PLAN_DEFAULTS.targets, zone13: 200 });
    expect(p.enabled).toEqual({ ...PLAN_DEFAULTS.enabled, zone45: false });
  });

  it("validates whole numbers inside each target's limits", () => {
    expect(validatePlanTarget("strength", 2)).toBeNull();
    expect(validatePlanTarget("strength", 1.5)).toEqual({ code: "wholeOnly" });
    expect(validatePlanTarget("strength", 8)).toEqual({ code: "between", params: { low: "1", high: "7" } });
    expect(validatePlanTarget("steps", 500)).toEqual({ code: "between", params: { low: "1,000", high: "30,000" } });
    expect(validatePlanTarget("zone13", null)).toEqual({ code: "enterNumber" });
    expect(parsePlanTarget("steps", " 8,500 ")).toEqual({ value: 8500, error: null });
    expect(parsePlanTarget("steps", "")).toEqual({ value: null, error: { code: "enterNumber" } });
    expect(parsePlanTarget("zone45", "abc").error).toEqual({ code: "enterNumber" });
  });

  it("edits one target or switch at a time; an invalid target is ignored", () => {
    expect(withPlanTarget(PLAN_DEFAULTS, "zone45", 90).targets.zone45).toBe(90);
    expect(withPlanTarget(PLAN_DEFAULTS, "zone45", 9999)).toBe(PLAN_DEFAULTS);
    const off = withPlanEnabled(PLAN_DEFAULTS, "steps", false);
    expect(off.enabled.steps).toBe(false);
    expect(isDefaultPlan(off)).toBe(false);
    expect(isDefaultPlan(withPlanEnabled(off, "steps", true))).toBe(true);
  });
});

describe("weekValue", () => {
  const days = [d("2026-10-05", { zone13Min: 40, steps: 9000, consistency: 70, sleptMin: 470, needMin: 460 }), d("2026-10-06", { zone13Min: 20, steps: 6000, consistency: 74, sleptMin: 400, needMin: 460 }), undefined];

  it("totals minutes, averages steps, takes the latest consistency and counts nights at need", () => {
    expect(weekValue("zone13", days)).toBe(60);
    expect(weekValue("zone45", days)).toBeNull();
    expect(weekValue("steps", days)).toBe(7500);
    expect(weekValue("consistency", days)).toBe(74);
    expect(weekValue("sleepNeed", days)).toBe(1);
    expect(weekValue("strength", days)).toBe(0);
    expect(weekValue("strength", [undefined, blank("2026-10-05")])).toBeNull();
  });

  it("today's running steps count only once they lift the average", () => {
    const morning = [...days.slice(0, 2), d("2026-10-07", { steps: 1200 })];
    expect(weekValue("steps", morning, true)).toBe(7500);
    const evening = [...days.slice(0, 2), d("2026-10-07", { steps: 12_000 })];
    expect(weekValue("steps", evening, true)).toBe(9000);
    // Monday morning: today is all there is.
    expect(weekValue("steps", [d("2026-10-05", { steps: 800 })], true)).toBe(800);
  });
});

describe("weeklyPlan", () => {
  // Wednesday 2026-10-07, mid-afternoon. Weeks of Sep 14 (poor), Sep 21 and Sep 28 (good), then this one.
  const TODAY = "2026-10-07";
  const thisWeek = [
    d("2026-10-05", { zone13Min: 40, zone45Min: 0, strengthSessions: 1, steps: 9000, consistency: 82, sleptMin: 470, needMin: 460 }),
    d("2026-10-06", { zone13Min: 30, zone45Min: 0, steps: 6000, consistency: 80, sleptMin: 400, needMin: 460 }),
    d("2026-10-07", { zone13Min: 10, zone45Min: 0, steps: 3000, consistency: 78, sleptMin: 480, needMin: 460 }),
  ];
  const rows = [...poorWeek("2026-09-14"), ...goodWeek("2026-09-21"), ...goodWeek("2026-09-28"), ...thisWeek];
  const plan = weeklyPlan(rows, PLAN_DEFAULTS.targets, PLAN_KEYS, TODAY, true);
  const by = Object.fromEntries(plan.items.map((i) => [i.key, i]));

  it("frames the week and counts whole days behind an unfinished today", () => {
    expect(plan).toMatchObject({ monday: "2026-10-05", sunday: "2026-10-11", day: TODAY, elapsed: 2 });
    expect(plan.items.map((i) => i.key)).toEqual(PLAN_KEYS);
  });

  it("totals and paces moderate and vigorous minutes", () => {
    expect(by.zone13).toMatchObject({ value: 80, target: 150, done: false, status: "on_pace" });
    expect(by.zone13.expected).toBeCloseTo((150 * 2) / 7, 10);
    expect(by.zone13.progress).toBeCloseTo(80 / 150, 10);
    expect(by.zone45).toMatchObject({ value: 0, status: "behind", progress: 0 });
  });

  it("counts sessions and nights on whole-number pace", () => {
    expect(by.strength).toMatchObject({ value: 1, status: "on_pace" });
    expect(by.sleepNeed).toMatchObject({ value: 2, status: "on_pace" });
  });

  it("averages steps without today's partial count, and reads the latest consistency", () => {
    expect(by.steps).toMatchObject({ value: 7500, status: "behind" });
    expect(by.consistency).toMatchObject({ value: 78, status: "behind" });
  });

  it("draws the days Monday to Sunday, nothing after today", () => {
    expect(by.zone13.days.map((x) => x.value)).toEqual([40, 30, 10, null, null, null, null]);
    expect(by.sleepNeed.days.map((x) => x.met)).toEqual([true, false, true, false, false, false, false]);
    expect(by.strength.days[0]).toMatchObject({ value: 1, met: true });
  });

  it("streaks count weeks met in a row; this week joins once met", () => {
    expect(by.zone13.streak).toEqual({ current: 2, longest: 2 });
    expect(by.zone13.weeks.slice(-4).map((w) => w.met)).toEqual([false, true, true, false]);
    expect(by.zone13.weeks).toHaveLength(8);
    expect(plan.planStreak).toEqual({ current: 2, longest: 2 });
    expect(plan.onTrack).toBe(plan.items.filter((i) => i.status === "done" || i.status === "on_pace").length);
  });

  it("a finished week is done or missed", () => {
    const good = weeklyPlan(rows, PLAN_DEFAULTS.targets, PLAN_KEYS, "2026-10-04", false);
    expect(good.items.every((i) => i.status === "done")).toBe(true);
    expect(good.items.find((i) => i.key === "strength")!.value).toBe(2);
    const poor = weeklyPlan(rows, PLAN_DEFAULTS.targets, PLAN_KEYS, "2026-09-20", false);
    expect(poor.items.every((i) => i.status === "missed")).toBe(true);
    expect(poor.planStreak.current).toBe(0);
  });

  it("a count is missed once the days left can't close the gap", () => {
    const quiet = Array.from({ length: 7 }, (_, k) => d(addDays("2026-10-05", k), { zone13Min: 30 }));
    const sat = weeklyPlan(quiet, PLAN_DEFAULTS.targets, ["strength"], "2026-10-10", true).items[0];
    expect(sat).toMatchObject({ value: 0, status: "behind" });
    const sun = weeklyPlan(quiet, PLAN_DEFAULTS.targets, ["strength"], "2026-10-11", true).items[0];
    expect(sun).toMatchObject({ value: 0, status: "missed" });
  });

  it("sleep need is missed once today's night is in and the nights left can't close the gap", () => {
    // Target 5 nights; Monday to Wednesday's nights all short. On Wednesday (still running) only Thursday to Sunday's
    // four nights are left, so 5 is out of reach: missed, not behind.
    const short = Array.from({ length: 3 }, (_, k) => d(addDays("2026-10-05", k), { sleptMin: 380, needMin: 460 }));
    const wed = weeklyPlan(short, PLAN_DEFAULTS.targets, ["sleepNeed"], "2026-10-07", true).items[0];
    expect(wed).toMatchObject({ value: 0, status: "missed" });
    // Before this morning's night syncs, today can still bring one: five nights left, so only behind.
    const unsynced = weeklyPlan(short.slice(0, 2), PLAN_DEFAULTS.targets, ["sleepNeed"], "2026-10-07", true).items[0];
    expect(unsynced).toMatchObject({ value: 0, status: "behind" });
    // Tuesday with both nights short: five nights left (Wednesday's to Sunday's), still reachable and on whole-number pace.
    const tue = weeklyPlan(short.slice(0, 2), PLAN_DEFAULTS.targets, ["sleepNeed"], "2026-10-06", true).items[0];
    expect(tue).toMatchObject({ value: 0, status: "on_pace" });
  });

  it("only the switched-on targets, and no data reads as no data", () => {
    const empty = weeklyPlan([], PLAN_DEFAULTS.targets, ["steps", "consistency"], TODAY, true);
    expect(empty.items.map((i) => [i.key, i.value, i.status])).toEqual([
      ["steps", null, "no_data"],
      ["consistency", null, "no_data"],
    ]);
    expect(empty.planStreak).toEqual({ current: 0, longest: 0 });
  });
});
