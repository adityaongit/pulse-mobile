// Daily goals over the demo seed, scored by the pipeline: values come from the day's metrics, extras and sleep row;
// progress, done, the 7-day history, streaks and the Active Zone Minutes week add up.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "./ctx";
import { getGoalsDay, GOAL_KEYS, type Goals } from "./goals";
import { waterOn } from "./log";

// src/state/goals.ts reads the phone's storage when it loads; in node there is none.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
const { DEFAULT_GOALS, parseGoals, parseTarget, trendGoal, validateTarget, withEnabled, withTarget } = await import("@/state/goals");

const TZ = "Asia/Kolkata";
/** A Friday; its ISO week runs 2026-09-28 to 2026-10-04. */
const TODAY = "2026-10-02";
const MONDAY = "2026-09-28";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const DAYS = 21;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };

let store: MemoryStore;
let ctx: QueryCtx;
let steps: Map<string, number | null>;
let extra: Map<string, Map<string, number>>;

const extraOf = (day: string, key: string) => extra.get(day)?.get(key) ?? null;

beforeAll(async () => {
  store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW, days: DAYS });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: { lastSyncTs: NOW, firstDay: addDays(TODAY, 1 - DAYS), lastError: null } };
  steps = new Map((await store.allMetrics()).map((m) => [m.day, m.steps]));
  extra = new Map();
  for (const v of await store.dailyValues()) {
    if (!extra.has(v.day)) extra.set(v.day, new Map());
    extra.get(v.day)!.set(v.key, v.value);
  }
});

describe("getGoalsDay on today", () => {
  it("lists the switched-on goals in catalogue order, with the day's values from metrics and extras", async () => {
    const vm = await getGoalsDay(TODAY, ctx, DEFAULT_GOALS);
    expect(vm).toMatchObject({ day: TODAY, today: TODAY, isToday: true });
    expect(vm.goals.map((g) => g.key)).toEqual(GOAL_KEYS.filter((k) => DEFAULT_GOALS.enabled[k]));
    expect(vm.goals.map((g) => g.key)).not.toContain("active_calories");
    const by = Object.fromEntries(vm.goals.map((g) => [g.key, g]));

    const todaySteps = steps.get(TODAY)!;
    expect(todaySteps).toBeGreaterThan(0);
    expect(by.steps).toMatchObject({ value: todaySteps, target: 10_000, partial: true });
    expect(by.steps.progress).toBeCloseTo(Math.min(1, todaySteps / 10_000), 12);
    expect(by.steps.done).toBe(todaySteps >= 10_000);

    expect(by.distance.value).toBe(extraOf(TODAY, "distance"));
    expect(by.distance.target).toBe(8);
    expect(by.floors.value).toBe(extraOf(TODAY, "floors"));
    expect(by.azm.value).toBe(extraOf(TODAY, "azm"));
    expect(by.azm.target).toBe(22);
    expect(by.active_minutes.value).toBe(extraOf(TODAY, "active_minutes"));
    expect(by.active_minutes.target).toBe(30);

    // The demo writes no water: a goal with nothing logged is 0 % and not done, never an error.
    expect(by.water).toMatchObject({ value: null, progress: 0, done: false, target: 2000 });

    for (const g of vm.goals) {
      expect(g.progress).toBeGreaterThanOrEqual(0);
      expect(g.progress).toBeLessThanOrEqual(1);
      expect(g.done).toBe(g.value !== null && g.value >= g.target);
    }
    expect(vm.done).toBe(vm.goals.filter((g) => g.done).length);
  });

  it("scores last night's sleep against its full need (the evening's plan), or the hours set", async () => {
    const vm = await getGoalsDay(TODAY, ctx, DEFAULT_GOALS);
    const sleep = vm.goals.find((g) => g.key === "sleep")!;
    const row = (await store.getScores(TODAY))!.sleep!;
    expect(row.main).not.toBeNull();
    expect(sleep.value).toBe(row.main!.asleepMin);
    expect(row.needMin).toBeGreaterThan(row.needHours * 60); // baseline + strain + debt
    expect(sleep.target).toBeCloseTo(row.needMin!, 9);
    expect(sleep.partial).toBe(false);
    expect(sleep.done).toBe(row.main!.asleepMin >= row.needMin!);

    const custom: Goals = { ...DEFAULT_GOALS, targets: { ...DEFAULT_GOALS.targets, sleep: 7.5 } };
    const set = (await getGoalsDay(TODAY, ctx, custom)).goals.find((g) => g.key === "sleep")!;
    expect(set.target).toBe(450);
    expect(set.progress).toBeCloseTo(Math.min(1, row.main!.asleepMin / 450), 12);
  });

  it("carries 7 days of history ending today, oldest first", async () => {
    const vm = await getGoalsDay(TODAY, ctx, DEFAULT_GOALS);
    const s = vm.goals.find((g) => g.key === "steps")!;
    expect(s.history).toHaveLength(7);
    expect(s.history.map((h) => h.day)).toEqual(Array.from({ length: 7 }, (_, k) => addDays(TODAY, k - 6)));
    expect(s.history[6]).toMatchObject({ day: TODAY, value: steps.get(TODAY) });
    const y = addDays(TODAY, -1);
    const ySteps = steps.get(y)!;
    expect(s.history[5]).toMatchObject({ day: y, value: ySteps, target: 10_000, done: ySteps >= 10_000 });
    expect(s.history[5].progress).toBeCloseTo(Math.min(1, ySteps / 10_000), 12);
  });

  it("counts the streak of met days, running to yesterday while today's goal is still open", async () => {
    // An easy target every worn day meets: the streak is the run of such days ending today (today counts once met).
    const easy: Goals = { ...DEFAULT_GOALS, targets: { ...DEFAULT_GOALS.targets, steps: 1000 } };
    const s = (await getGoalsDay(TODAY, ctx, easy)).goals.find((g) => g.key === "steps")!;
    let expected = 0;
    for (let d = s.done ? TODAY : addDays(TODAY, -1); (steps.get(d) ?? 0) >= 1000; d = addDays(d, -1)) expected++;
    expect(expected).toBeGreaterThan(0);
    expect(s.streak).toBe(expected);

    const hard: Goals = { ...DEFAULT_GOALS, targets: { ...DEFAULT_GOALS.targets, steps: 50_000 } };
    expect((await getGoalsDay(TODAY, ctx, hard)).goals.find((g) => g.key === "steps")!.streak).toBe(0);
  });

  it("sums Active Zone Minutes from Monday through today against the weekly 150", async () => {
    const vm = await getGoalsDay(TODAY, ctx, DEFAULT_GOALS);
    const w = vm.week!;
    expect(w).toMatchObject({ from: MONDAY, to: TODAY, target: 150 });
    expect(w.days.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, k) => addDays(MONDAY, k)));
    let total = 0;
    for (let d = MONDAY; d <= TODAY; d = addDays(d, 1)) total += extraOf(d, "azm") ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(w.total).toBe(total);
    expect(w.days.slice(0, 5).map((d) => d.value)).toEqual(Array.from({ length: 5 }, (_, k) => extraOf(addDays(MONDAY, k), "azm")));
    expect(w.days.slice(5).map((d) => d.value)).toEqual([null, null]); // Saturday and Sunday are still to come
    expect(w.progress).toBeCloseTo(Math.min(1, total / 150), 12);
    expect(w.done).toBe(total >= 150);
  });

  it("drops the week and the daily ring when Active Zone Minutes is switched off, and adds active calories when on", async () => {
    const off = withEnabled(DEFAULT_GOALS, "azm", false);
    const vm = await getGoalsDay(TODAY, ctx, off);
    expect(vm.week).toBeNull();
    expect(vm.goals.map((g) => g.key)).not.toContain("azm");

    const on = withEnabled(DEFAULT_GOALS, "active_calories", true);
    const cal = (await getGoalsDay(TODAY, ctx, on)).goals.find((g) => g.key === "active_calories")!;
    expect(cal.value).toBe(extraOf(TODAY, "active_calories"));
    expect(cal.target).toBe(500);
  });
});

describe("getGoalsDay on a past day", () => {
  it("scores that day's whole totals, nothing partial, and its week through that day", async () => {
    const day = addDays(TODAY, -3); // Tuesday
    const vm = await getGoalsDay(day, ctx, DEFAULT_GOALS);
    expect(vm).toMatchObject({ day, isToday: false });
    for (const g of vm.goals) expect(g.partial).toBe(false);
    expect(vm.goals.find((g) => g.key === "steps")!.value).toBe(steps.get(day));
    const w = vm.week!;
    expect(w).toMatchObject({ from: MONDAY, to: day });
    expect(w.total).toBe((extraOf(MONDAY, "azm") ?? 0) + (extraOf(day, "azm") ?? 0));
    expect(w.days.slice(2).every((d) => d.value === null)).toBe(true);
  });

  it("is empty but sane before any data", async () => {
    const vm = await getGoalsDay(addDays(TODAY, -400), ctx, DEFAULT_GOALS);
    expect(vm.goals).toHaveLength(7);
    for (const g of vm.goals) expect(g).toMatchObject({ value: null, progress: 0, done: false, streak: 0 });
    expect(vm.goals.find((g) => g.key === "sleep")!.target).toBe(8 * 60);
    expect(vm.week!.total).toBe(0);
    expect(vm.done).toBe(0);
  });
});

describe("water logged in Pulse", () => {
  it("counts toward the water goal with what Health Connect synced, as the Log's total does", async () => {
    const water = new MemoryStore();
    const day = "2026-10-01";
    const at = (hh: string) => Date.parse(`${day}T${hh}:00+05:30`) / 1000;
    // Fitbit's 1,000 ml synced (its own entry, read from Health Connect, is already in that total), and 250 + 150 ml
    // logged in Pulse, which never reaches Health Connect.
    await water.upsertDailyValues([{ day, key: "water", value: 1000 }]);
    await water.addLoggedEntries([
      { id: "hc-1", type: "hydration-log", ts: at("08:00"), day, data: { ml: 1000 }, createdAt: at("08:00"), source: "health_connect" },
      { id: "p-1", type: "hydration-log", ts: at("10:00"), day, data: { ml: 250 }, createdAt: at("10:00"), source: "pulse" },
      { id: "p-2", type: "hydration-log", ts: at("16:00"), day, data: { ml: 150 }, createdAt: at("16:00"), source: "pulse" },
      { id: "p-3", type: "hydration-log", ts: at("12:00") + 86_400, day: "2026-10-02", data: { ml: 300 }, createdAt: at("12:00"), source: "pulse" },
    ]);
    const wctx: QueryCtx = { ...ctx, store: water };
    const vm = await getGoalsDay(day, wctx, withEnabled(DEFAULT_GOALS, "water", true));
    expect(vm.goals.find((g) => g.key === "water")!.value).toBe(1400);
    expect(await waterOn(water, day, TZ)).toBe(1400);
    // A day with only Pulse's log.
    const next = await getGoalsDay("2026-10-02", wctx, withEnabled(DEFAULT_GOALS, "water", true));
    expect(next.goals.find((g) => g.key === "water")!.value).toBe(300);
  });
});

describe("the goal model (src/state/goals.ts)", () => {
  it("keeps targets inside their limits", () => {
    expect(validateTarget("steps", 10_000)).toBeNull();
    expect(validateTarget("steps", 500)).toBe("Between 1,000 and 50,000");
    expect(parseTarget("steps", "10000.5")).toEqual({ value: null, error: "Whole numbers only" });
    expect(validateTarget("distance", 8.5)).toBeNull();
    expect(validateTarget("sleep", null)).toBeNull();
    expect(validateTarget("water", null)).toBe("Enter a number");
    expect(parseTarget("distance", "8,5")).toEqual({ value: 8.5, error: null });
    expect(parseTarget("floors", "abc")).toEqual({ value: null, error: "Enter a number" });
    expect(parseTarget("sleep", " ")).toEqual({ value: null, error: null });
  });

  it("reads stored goals tolerantly and falls back to Fitbit's defaults", () => {
    expect(parseGoals(null)).toEqual(DEFAULT_GOALS);
    expect(parseGoals("{nope")).toEqual(DEFAULT_GOALS);
    const g = parseGoals(JSON.stringify({ targets: { steps: 12_000, water: 99, sleep: 7 }, enabled: { water: false, bogus: true } }));
    expect(g.targets).toMatchObject({ steps: 12_000, water: 2000, sleep: 7 });
    expect(g.enabled).toMatchObject({ water: false, steps: true });
    expect(withTarget(DEFAULT_GOALS, "steps", 9)).toBe(DEFAULT_GOALS);
    expect(withTarget(DEFAULT_GOALS, "steps", 9000).targets.steps).toBe(9000);
  });

  it("gives Trends a goal line only for metrics with a goal switched on", () => {
    expect(trendGoal(DEFAULT_GOALS, "steps")).toBe(10_000);
    expect(trendGoal(DEFAULT_GOALS, "active_calories")).toBeNull();
    expect(trendGoal(DEFAULT_GOALS, "hrv")).toBeNull();
    expect(trendGoal(withEnabled(DEFAULT_GOALS, "steps", false), "steps")).toBeNull();
  });
});
