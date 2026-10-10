import { beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../data/testing";
import { recompute } from "../pipeline";
import { loadSeed } from "../pipeline/testing/memoryStore";
import { saveProfile } from "../profile";
import { loadF2, loadF6 } from "../testing/fixtures";
import { addDays, localMidnight } from "../time";
import { loadDays, type QueryCtx } from "./common";
import { DETAIL_KEYS, getMetricDetail, rangeStats, STEP_TARGET, WEEKLY_TARGET, type DetailKey, type Section } from "./metric";
import { expectF6, f6Days, seededCtx } from "./testing";

let ctx: QueryCtx;
let mutable: QueryCtx;
// loadSeed leaves Google's shown-only roll-ups (daily_values) out, because the pipeline does not read them; the metric
// pages do (distance, active minutes, avg HR ...), so these tests add them to the seeded databases.
const addRollups = (c: QueryCtx) => c.store.daily.upsertDailyValues(loadF2().tables.daily_values as { day: string; key: string; value: number }[]);

beforeAll(async () => {
  ctx = await seededCtx();
  await addRollups(ctx);
  // The tests that change stored rows (the web ran them on a copy of the database) get their own scored database.
  const { ctx: f6 } = loadF6();
  const { store } = testDb();
  await loadSeed(store, loadF2());
  const { birthDate, sex, maxHr, maxHrSource, heightCm, timeZone } = f6.profile;
  await saveProfile(store, { birthDate, sex, maxHr: maxHrSource === "set" ? maxHr : null, heightCm, timeZone });
  await recompute(store, { timeZone, profile: f6.profile });
  mutable = { store, timeZone, profile: f6.profile, now: f6.now };
  await addRollups(mutable);
}, 120_000);

// The seeded range starts on Monday 2026-04-06 (day index 0); `now` (Friday 14:00) is day 179.
const dayAt = (i: number) => addDays("2026-04-06", i);
const TODAY = dayAt(179);
const PAST = dayAt(170);
const section = <K extends Section["kind"]>(s: Section[], kind: K) => s.find((x) => x.kind === kind) as Extract<Section, { kind: K }> | undefined;

function finiteEverywhere(v: unknown, path = "vm"): void {
  if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) finiteEverywhere(x, `${path}.${k}`);
}

describe("getMetricDetail", () => {
  it("reproduces F6 for every day and metric key", async () => {
    const { metricKeys } = loadF6();
    expect(metricKeys.length).toBeGreaterThan(0);
    for (const day of f6Days())
      for (const key of metricKeys) expectF6("getMetricDetail", day, await getMetricDetail(key as DetailKey, day, ctx), key);
  });

  it("builds every metric, today and on a past day, with finite numbers and honest empty states", async () => {
    for (const key of DETAIL_KEYS)
      for (const day of [TODAY, PAST]) {
        const vm = await getMetricDetail(key, day, ctx);
        finiteEverywhere(vm, `${key}@${day}`);
        if (vm.value.value === null) expect(vm.value.reason).toBeTruthy();
        if (vm.history.value === null) expect(vm.history.reason).toBe("no_data");
        else expect(vm.history.value).toHaveLength(365);
      }
  });

  it("nightly vital pages open the selected metric and end their history on the selected day", async () => {
    for (const key of ["hrv", "rhr", "resp", "spo2", "skin"] as const) {
      const detail = await getMetricDetail(key, PAST, ctx);
      expect(detail.total).toBe(false);
      expect(detail.history.value?.at(-1)?.day).toBe(PAST);
      expect(detail.history.value?.at(-1)?.value).toBe(detail.value.value);
    }
  });

  it("steps: the day's value against its prior 30 days, today a gap in history, hours summing the stored steps", async () => {
    const vm = await getMetricDetail("steps", PAST, ctx);
    const days = await loadDays(ctx, dayAt(139), PAST);
    const steps = (d: string) => days.get(d)?.metrics?.steps ?? null;
    expect(vm.value.value).toBe(steps(PAST));
    const prior = Array.from({ length: 30 }, (_, k) => steps(dayAt(169 - k))).filter((x): x is number => x != null);
    expect(vm.average).toBeCloseTo(prior.reduce((a, b) => a + b, 0) / prior.length, 6);
    const hours = section(vm.sections, "hourly")!.hours.value!;
    const start = localMidnight(PAST, ctx.timeZone);
    const sum = (await ctx.store.samples.readSamples("steps", start, start + 86400)).reduce((a, x) => a + x.v, 0);
    expect(hours).toHaveLength(24);
    expect(hours.reduce((a, h) => a + (h.value ?? 0), 0)).toBe(sum);
    expect(vm.chart.reference).toEqual({ y: STEP_TARGET, label: "7,000" });
    expect(section(vm.sections, "weekday")!.days.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

    const today = await getMetricDetail("steps", TODAY, ctx);
    expect(today.soFar).toBe(true);
    expect(today.history.value!.at(-1)!.value).toBeNull();
    // 14:00: the hours after now are gaps, not zeros.
    expect(section(today.sections, "hourly")!.hours.value!.slice(15).every((h) => h.value === null)).toBe(true);
  });

  it("sedentary time: the longest stretch without steps stays inside 07:00-22:00", async () => {
    const still = section((await getMetricDetail("sedentary_minutes", PAST, ctx)).sections, "hourly")!.still!;
    const start = localMidnight(PAST, ctx.timeZone) * 1000;
    expect(still.from).toBeGreaterThanOrEqual(start + 7 * 3600_000);
    expect(still.to).toBeLessThanOrEqual(start + 22 * 3600_000);
    expect(still.minutes).toBe(Math.round((still.to - still.from) / 60_000));
  });

  it("steps goal: the streak runs back from the day, today counting only once it is met", async () => {
    const set = (steps: number, day: string) => mutable.store.daily.upsertDailyMetrics([{ day, source: "test", steps }]);
    for (let k = 1; k <= 40; k++) await set(k <= 4 ? STEP_TARGET + 500 : 1000, dayAt(179 - k));
    await set(200, TODAY);
    const g = section((await getMetricDetail("steps", TODAY, mutable)).sections, "goal")!;
    expect(g).toMatchObject({ streak: 4, met: 4, days: 30 });
    expect(g.longest).toBeGreaterThanOrEqual(4);
    await set(STEP_TARGET, TODAY);
    expect(section((await getMetricDetail("steps", TODAY, mutable)).sections, "goal")!.streak).toBe(5);
  });

  it("calories: each day's parts add up to its total; workouts list the day's exercises", async () => {
    const vm = await getMetricDetail("calories", PAST, ctx);
    expect(vm.chart.stack).toBe("calories");
    for (const p of vm.history.value!.filter((x) => x.parts)) expect(p.parts!.active + p.parts!.resting).toBeCloseTo(p.value!, 6);
    const n = (await ctx.store.sessions.exercisesBetween(PAST, PAST)).length;
    expect(section(vm.sections, "workouts")!.items).toHaveLength(n);
  });

  it("active minutes: this week's total and twelve weeks against 150", async () => {
    const vm = await getMetricDetail("active_minutes", PAST, ctx);
    const w = section(vm.sections, "weekly")!;
    const sum = (await ctx.store.daily.readValuesBetween(w.week.from, PAST)).filter((x) => x.key === "active_minutes").reduce((a, x) => a + x.value, 0);
    expect(w.week.total).toBeCloseTo(sum, 6);
    expect(w.target).toBe(WEEKLY_TARGET);
    expect(w.weeks).toHaveLength(12);
    expect(w.met).toBe(w.weeks.filter((x) => (x.value ?? 0) >= WEEKLY_TARGET).length);
    expect(section(vm.sections, "intensity")!.rows.map((r) => r.key)).toEqual(["active_minutes", "light_minutes", "sedentary_minutes"]);
  });

  it("weight: the latest reading on or before the day, with its changes and readings", async () => {
    const vm = await getMetricDetail("weight", PAST, ctx);
    const latest = (await ctx.store.daily.metricReadings("weightKg")).find((r) => r.day <= PAST)!;
    expect(vm.valueDay).toBe(latest.day);
    expect(vm.value.value).toBe(latest.value);
    expect(vm.chart.smooth).toBe(7);
    expect(section(vm.sections, "readings")!.items[0]).toEqual({ day: latest.day, value: latest.value });
  });

  it("vitals: days outside mean ± 2 SD of the last 90 are listed", async () => {
    const rows = Array.from({ length: 90 }, (_, k) => ({ day: dayAt(170 - k), key: "avg_hr", value: 70 + (k % 3) }));
    await mutable.store.daily.upsertDailyValues([...rows, { day: dayAt(160), key: "avg_hr", value: 110 }]);
    const vm = await getMetricDetail("avg_hr", PAST, mutable);
    expect(section(vm.sections, "outliers")!.items).toEqual([{ day: dayAt(160), value: 110, dir: "high" }]);
    expect(vm.chart.baseline!.mean).toBeGreaterThan(70);
  });

  it("nutrition: the day's logged entries, eaten vs burned and the protein reference", async () => {
    const ts = localMidnight(PAST, mutable.timeZone) + 13 * 3600;
    await mutable.store.log.insertEntry({ id: "e1", type: "nutrition-log", ts, day: PAST, data: { meal: "lunch", kcal: 650, proteinG: 30 }, googleName: null, createdAt: ts });
    await mutable.store.daily.upsertDailyValues([
      { day: PAST, key: "calories_in", value: 2000 },
      { day: PAST, key: "protein", value: 90 },
    ]);
    const vm = await getMetricDetail("calories_in", PAST, mutable);
    expect(section(vm.sections, "entries")!.items.map((e) => e.id)).toEqual(["e1"]);
    const burned = (await loadDays(mutable, PAST, PAST)).get(PAST)!.metrics!.calories!;
    expect(section(vm.sections, "balance")!.rows.find((r) => r.key === "balance")!.metric.value).toBeCloseTo(2000 - burned, 6);
    expect(section(vm.sections, "macros")!.rows.map((r) => r.key)).toContain("protein_target");
  });

  it("is honest when Google has never sent the metric", async () => {
    const vm = await getMetricDetail("glucose", PAST, ctx);
    expect(vm.value).toMatchObject({ value: null, reason: "no_data" });
    expect(vm.history).toMatchObject({ value: null, reason: "no_data" });
    expect(vm.sections).toEqual([]);
  });
});

describe("rangeStats", () => {
  it("averages, extremes, total and coverage over the last n, against the n before", () => {
    const days = ["a", "b", "c", "d", "e", "f"];
    expect(rangeStats([1, 3, 5, null, 2, 8], days, 3, true)).toEqual({
      average: 5,
      prior: 3,
      high: { day: "f", value: 8 },
      low: { day: "e", value: 2 },
      total: 10,
      withData: 2,
      days: 3,
    });
    expect(rangeStats([null, null], ["a", "b"], 1, true)).toMatchObject({ average: null, prior: null, high: null, total: null, withData: 0 });
  });
});
