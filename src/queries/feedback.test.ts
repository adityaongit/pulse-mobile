import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import { emptyMetrics, type Exercise, type Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";
import { DEFAULT_DISPLAY, setDisplayPrefs } from "@/lib/units";
import { getActivity } from "./activity";
import { activityItem, loadDays } from "./common";
import type { QueryCtx } from "./ctx";
import { getMonitor } from "./health";
import { getMetricDetail } from "./metric";

const today = "2026-10-02";
const timeZone = "Asia/Kolkata";
const now = Date.parse("2026-10-02T09:00:00+05:30") / 1000;
const profile: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone };
let ctx: QueryCtx;
beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today, timeZone, now });
  await runPipeline(store, profile, { today });
  ctx = { store, profile, today, timeZone, now, sync: await store.getSyncState() };
});

describe("reported vital range mismatch", () => {
  for (const units of ["metric", "imperial"] as const) {
    it(`uses the monitor's judged reading and normal band in ${units} units`, async () => {
      setDisplayPrefs({ units, hours: 24 });
      try {
        const monitor = await getMonitor(today, ctx);
        for (const [key, vital] of [["rhr", "restingHr"], ["hrv", "hrv"], ["resp", "resp"], ["skin", "skinTempDev"]] as const) {
          const detail = await getMetricDetail(key, today, ctx);
          const card = monitor.vitals.find((v) => v.key === vital)!;
          expect(card.range).not.toBeNull();
          expect(detail.value.value, key).toBe(card.metric.value);
          expect(detail.chart.baseline!.mean, key).toBeCloseTo((card.range!.low + card.range!.high) / 2, 9);
          expect(detail.chart.baseline!.sd, key).toBeCloseTo((card.range!.high - card.range!.low) / 2, 9);
          expect(detail.sections.some((s) => s.kind === "outliers"), key).toBe(true);
        }
      } finally {
        setDisplayPrefs(DEFAULT_DISPLAY);
      }
    });
  }

  it("uses the exact nightly values the monitor judged when daily aggregates differ", async () => {
    const store = new MemoryStore();
    const score = await ctx.store.getScores(today);
    if (!score?.health_monitor || score.health_monitor.reason !== null) throw new Error("missing scored monitor");
    const values = { restingHr: 49, hrv: 111, resp: 17, skinTempDev: -0.9, spo2: 98 };
    await store.putScores({ ...score, health_monitor: { ...score.health_monitor, vitals: score.health_monitor.vitals.map((v) => ({ ...v, value: values[v.key] })) } });
    await store.upsertMetrics([{ ...emptyMetrics(today), rhrBpm: 70, hrvMs: 40, respBpm: 12 }]);
    const local = { ...ctx, store };
    for (const [key, value] of [["rhr", 49], ["hrv", 111], ["resp", 17], ["skin", -0.9]] as const) {
      const detail = await getMetricDetail(key, today, local);
      expect(detail.value.value, key).toBe(value);
      expect(detail.history.value!.at(-1)!.value, key).toBe(value);
    }
  });

  it("does not invent a normal band before the monitor has scored it", async () => {
    const store = new MemoryStore();
    await seedDemo(store, { today, timeZone, now });
    const unscored = { ...ctx, store };
    for (const key of ["rhr", "hrv", "resp", "skin"] as const) {
      const detail = await getMetricDetail(key, today, unscored);
      expect(detail.chart.baseline, key).toBeNull();
      expect(detail.source, key).toBe("From Health Connect. No Health Monitor range is available for this day.");
    }
  });
});

describe("imported workout titles", () => {
  for (const [type, name] of [["RUNNING", "Treadmill Run"], ["STRENGTH_TRAINING", "Core Training"], ["RUNNING", null]] as const) {
    it(`keeps ${name ?? "the category fallback"} in detail and timeline`, async () => {
      const store = new MemoryStore();
      const e: Exercise = { id: "workout", day: today, startTs: now - 3600, endTs: now - 1800, type, name, calories: null, distanceM: null };
      await store.upsertExercises([e]);
      const local = { ...ctx, store };
      const row = (await loadDays(local, today, today)).get(today);
      const detail = await getActivity(e.id, local);
      const item = activityItem(e, row);
      expect(detail!.name).toBe(name ?? "Running");
      expect(item.name).toBe(name ?? "Running");
    });
  }
});
