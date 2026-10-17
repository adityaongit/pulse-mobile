// The metric detail query on the demo seed, at 09:00 on its last day.
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "./ctx";
import { getMetricDetail, isDetailKey } from "./metric";
import { getTrends, TREND_METRICS } from "./trends";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T09:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };

let ctx: QueryCtx;
beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: await store.getSyncState() };
});

describe("Average heart rate", () => {
  it("is today's so far until the day ends: kept out of the averages and the outliers", async () => {
    const vm = await getMetricDetail("avg_hr", TODAY, ctx);
    // At 09:00 the day's samples are mostly the night's, well under a whole day's average.
    expect(vm.value.value).toBeTypeOf("number");
    expect(vm.value.value!).toBeLessThan(vm.average! - 2 * vm.sd!);
    expect(vm.soFar).toBe(true);
    if (vm.history.value === null) throw new Error("no history");
    expect(vm.history.value.at(-1)).toMatchObject({ day: TODAY, provisional: true });
    const out = vm.sections.find((s) => s.kind === "outliers");
    if (!out || out.kind !== "outliers") throw new Error("no outliers section");
    expect(out.items.map((i) => i.day)).not.toContain(TODAY);
  });

  it("leaves today's so-far value out of Trends' week average", async () => {
    const t = await getTrends("avg_hr", ctx);
    if (t.points.value === null) throw new Error("no points");
    const last7 = t.points.value.slice(-7);
    expect(last7.at(-1)).toMatchObject({ day: TODAY, partial: true });
    const sixDays = last7.slice(0, -1).map((p) => p.value!);
    expect(t.periods[0].average.value).toBeCloseTo(sixDays.reduce((a, b) => a + b, 0) / sixDays.length, 9);
  });
});

describe("metric links", () => {
  it("open a metric that has a screen", () => {
    const keys = TREND_METRICS.filter((m) => m.href.startsWith("/metric/")).map((m) => m.href.replace("/metric/", ""));
    expect(keys.filter((k) => !isDetailKey(k))).toEqual([]);
  });
});

describe("Calories history", () => {
  it("splits each day into the resting and active parts its chart stacks, adding up to the total", async () => {
    const vm = await getMetricDetail("calories", TODAY, ctx);
    const split = (vm.history.value ?? []).filter((p) => p.parts);
    expect(split.length).toBeGreaterThan(100);
    for (const p of split) {
      expect(Object.keys(p.parts!).sort(), p.day).toEqual(["active", "resting"]);
      expect(p.parts!.resting + p.parts!.active, p.day).toBeCloseTo(p.value!, 6);
    }
  });
});
