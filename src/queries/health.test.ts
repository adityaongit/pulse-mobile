// Pulse's health.test.ts on the F2 seed scored on SQLite (seededCtx). Pulse's `copyDb` tests become a second store
// holding the seed's raw rows without the recompute: heart rhythm and measurements read stored rows, not scores.
import { beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../data/testing";
import { loadSeed } from "../pipeline/testing/memoryStore";
import { loadF2 } from "../testing/fixtures";
import { addDays } from "../time";
import { getEcgReading, getFitness, getHealthHub, getHealthspan, getHeartRate, getMonitor, getStress } from "./health";
import { type QueryCtx, todayOf } from "./common";
import { seededCtx } from "./testing";

const SEED_DAYS = 180;
const ANCHOR = "2026-04-06";
const dayAt = (i: number) => addDays(ANCHOR, i);
const healthRecords = () => loadF2().tables.health_records as { id: string; kind: "ecg" | "irn"; ts: number; day: string; data: unknown }[];

let ctx: QueryCtx;
let today: string;
beforeAll(async () => {
  ctx = await seededCtx();
  today = todayOf(ctx);
  // loadSeed writes the daily rows, sessions, samples and journal; the seed's heart-rhythm records are added here.
  await ctx.store.daily.upsertHealthRecords(healthRecords());
}, 120_000);

/** A store with the seed's raw rows, not scored: the tests that add rows to it leave the shared one alone. */
async function rawCtx(): Promise<QueryCtx> {
  const { store } = testDb();
  await loadSeed(store, loadF2());
  await store.daily.upsertHealthRecords(healthRecords());
  return { ...ctx, store };
}

describe("seed", () => {
  it("today is the last seeded day", () => {
    expect(today).toBe(dayAt(SEED_DAYS - 1));
  });
});

describe("getMonitor heart rhythm", () => {
  it("lists the seeded ECG readings newest first, with Fitbit's labels, and counts the notification", async () => {
    const { ecg, irn } = (await getMonitor(today, ctx)).heartRhythm;
    expect(ecg.map((e) => e.label)).toEqual(["Normal sinus rhythm", "Inconclusive: high heart rate", "Normal sinus rhythm"]);
    expect(ecg.map((e) => e.tone)).toEqual(["optimal", "neutral", "optimal"]);
    expect(ecg[0].at).toBeGreaterThan(ecg[1].at);
    expect(ecg[0].avgBpm).toBe(66);
    expect(irn).toMatchObject({ count: 1, latestDay: dayAt(SEED_DAYS - 22) });
  });

  it("shows only what had happened by the selected day", async () => {
    const { ecg, irn } = (await getMonitor(dayAt(SEED_DAYS - 30), ctx)).heartRhythm;
    expect(ecg).toHaveLength(1);
    expect(irn).toEqual({ count: 0, latestAt: null, latestDay: null });
  });

  it("opens one reading for its sheet by id, and nothing for an unknown id", async () => {
    const [latest] = (await getMonitor(today, ctx)).heartRhythm.ecg;
    expect(await getEcgReading(ctx, latest.id)).toEqual(latest);
    expect(await getEcgReading(ctx, "nope")).toBeNull();
  });

  it("reads an unknown classification as no result, never as normal", async () => {
    const c2 = await rawCtx();
    await c2.store.daily.upsertHealthRecords([{ id: "x", kind: "ecg", ts: 1, day: today, data: { result: "SOMETHING_NEW" } }]);
    const x = (await getMonitor(today, c2)).heartRhythm.ecg.find((e) => e.id === "x")!;
    expect(x).toMatchObject({ label: "No result", tone: "neutral", avgBpm: null });
  });
});

describe("getMonitor measurements", () => {
  it("shows weight and body fat against the readings of the 30 days before, and hides metrics never recorded", async () => {
    const m = (await getMonitor(today, ctx)).measurements;
    expect(m.map((x) => x.key)).toEqual(["weight", "body_fat"]);
    const w = async (d: string) => (await ctx.store.daily.metricReadings("weightKg")).find((r) => r.day === d)!.value;
    // Monthly weigh-ins on day indexes 2, 32, ... 152: the latest is 152, compared with 122.
    expect(m[0].metric.value).toBe(await w(dayAt(152)));
    expect(m[0].average).toBe(await w(dayAt(122)));
    expect(m[0].caption).toMatch(/^\w{3}, \w{3} \d+$/);
  });

  it("adds blood glucose and core temperature once there is a value, and says no data before the first", async () => {
    const c2 = await rawCtx();
    await c2.store.daily.upsertDailyValues([
      { day: dayAt(170), key: "glucose", value: 98 },
      { day: dayAt(175), key: "glucose", value: 104 },
      { day: dayAt(176), key: "core_temp", value: 36.8 },
    ]);
    const m = (await getMonitor(today, c2)).measurements;
    expect(m.map((x) => x.key)).toEqual(["weight", "body_fat", "glucose", "core_temp"]);
    expect(m[2]).toMatchObject({ metric: { value: 104 }, average: 98, unit: "mg/dL" });
    expect(m[3].average).toBeNull();
    const before = (await getMonitor(dayAt(160), c2)).measurements[2];
    expect(before.metric).toMatchObject({ value: null, reason: "no_data" });
  });
});

describe("getHealthspan factors", () => {
  it("each factor carries its 6-month and 30-day means, how it stands and its Trend View", async () => {
    const vm = await getHealthspan(dayAt(170), ctx);
    const shown = vm.contributors.filter((c) => c.metric.value !== null);
    expect(shown.length).toBeGreaterThan(5);
    for (const c of shown) {
      expect(c.recent, c.key).not.toBeNull();
      expect(c.state?.title, c.key).toMatch(/^(Outperforming|On track|Room to improve)$/);
    }
    expect(Object.fromEntries(vm.contributors.map((c) => [c.key, c.trendHref]))).toMatchObject({
      sleepHours: "/trend/hours",
      sri: "/trend/consistency",
      zone13: "/trend/zones13",
      restingHr: "/trend/rhr",
      vo2max: "/trend/vo2max",
      leanMass: "/trend/lean_mass",
    });
  });
});

// The queries below have no pulse test of their own (pulse covers them through the screens); these check the view
// models' shape and the reads that changed with the repositories.
describe("getHealthHub", () => {
  it("assembles the five cards and the newest band reading", async () => {
    const vm = await getHealthHub(ctx);
    expect(vm.day).toBe(today);
    expect(vm.healthspan.value).not.toBeNull();
    expect(vm.monitor.value?.total).toBe(5);
    expect(vm.fitness.value?.vo2max).toBeGreaterThan(0);
    expect(vm.heartRate?.bpm).toBeGreaterThan(30);
  });
});

describe("getHeartRate", () => {
  it("a past day reads its minutes up to the day's end, a gap is a null, and the zones come from the stored day", async () => {
    const d = dayAt(100);
    const vm = await getHeartRate(d, ctx);
    expect(vm.isToday).toBe(false);
    expect(vm.points).toHaveLength(1440);
    expect(vm.points.some((p) => p.v !== null)).toBe(true);
    expect(vm.zoneBands.length).toBe(5);
    expect(vm.zones.value?.length).toBeGreaterThanOrEqual(5);
    expect(vm.end).toBe(vm.points[0].t + 86_400_000);
  });
});

describe("getStress and getFitness", () => {
  it("stress: gauge, chart, levels and a 182-day trend", async () => {
    const vm = await getStress(dayAt(100), ctx);
    expect(vm.gauge.value).not.toBeNull();
    expect(vm.levels.value?.weekday).toMatch(/day$/);
    expect(vm.trend.points.length).toBeGreaterThan(0);
  });

  it("fitness: VO2 max, training load and 90 days of load", async () => {
    const vm = await getFitness(ctx);
    expect(vm.vo2.value?.value).toBeGreaterThan(0);
    expect(vm.load).toHaveLength(90);
    expect(vm.load.at(-1)!.day).toBe(today);
  });
});
