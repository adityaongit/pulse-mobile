import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../time";
import { RANGE_DAYS, RANGES } from "@/lib/url";
import { todayOf, type QueryCtx } from "./common";
import { seededCtx } from "./testing";
import { getTrends, parseTrendMetric, TREND_GROUPS, TREND_METRICS } from "./trends";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("getTrends", () => {
  it("every metric gives 365 days ending today, and an average with its prior for every range", async () => {
    const today = todayOf(ctx);
    for (const m of TREND_METRICS) {
      const vm = await getTrends(m.key, ctx);
      expect(vm.metric).toBe(m.key);
      expect(vm.periods.map((p) => p.range)).toEqual([...RANGES]);
      if (vm.points.value === null) expect(vm.points.reason, m.key).toBe("no_data");
      else {
        expect(vm.points.value, m.key).toHaveLength(RANGE_DAYS["1y"]);
        expect(vm.points.value.at(-1)!.day).toBe(today);
        expect(vm.points.value[0].day).toBe(addDays(today, -364));
      }
    }
  });

  it("today's running total is a gap for Steps and Strain, a value for Recovery's day", async () => {
    expect((await getTrends("steps", ctx)).points.value!.at(-1)!.value).toBeNull();
    expect((await getTrends("strain", ctx)).points.value!.at(-1)!.value).toBeNull();
  });

  it("a range's average is the mean of its days", async () => {
    const vm = await getTrends("hrv", ctx);
    const xs = vm.points.value!.slice(-30).flatMap((p) => (p.value === null ? [] : [p.value]));
    expect(vm.periods.find((p) => p.range === "m")!.average.value).toBeCloseTo(xs.reduce((a, b) => a + b, 0) / xs.length, 9);
  });

  it("the picker lists every metric once, in the five sections", () => {
    expect(new Set(TREND_METRICS.map((m) => m.key)).size).toBe(TREND_METRICS.length);
    for (const g of TREND_GROUPS) expect(TREND_METRICS.some((m) => m.group === g), g).toBe(true);
    expect(parseTrendMetric("nope").key).toBe(TREND_METRICS[0].key);
    expect(parseTrendMetric(["weight"]).key).toBe("weight");
  });
});
