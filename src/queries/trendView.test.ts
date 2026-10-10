import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../time";
import type { QueryCtx } from "./common";
import { seededCtx } from "./testing";
import { getTrendView, isTrendViewKey, TREND_VIEW, type TrendViewKey } from "./trendView";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

// The seeded range starts on Monday 2026-04-06 (day index 0); `now` is day 179.
const dayAt = (i: number) => addDays("2026-04-06", i);

describe("getTrendView", () => {
  it("every metric builds a window, a prior and a verdict", async () => {
    for (const key of Object.keys(TREND_VIEW) as TrendViewKey[]) {
      if (!isTrendViewKey(key)) continue;
      const vm = await getTrendView(key, dayAt(150), "w", 0, ctx);
      expect(vm.bars, key).toHaveLength(7);
      expect(vm.to, key).toBe(dayAt(150));
      expect(vm.verdict, key).toMatch(/\.$/);
      expect(vm.options.map((o) => o.key), key).toContain(key);
    }
  });

  it("VO2 max and lean body mass are a Health pair of line charts with a typical range", async () => {
    const vo2 = await getTrendView("vo2max", dayAt(150), "m", 0, ctx);
    expect(vo2.options.map((o) => o.key)).toEqual(["vo2max", "lean_mass"]);
    expect(vo2.value).toBeGreaterThan(20);
    expect(vo2.typical![0]).toBeLessThan(vo2.typical![1]);
  });

  it("steps back whole periods and compares with the one before", async () => {
    const now = await getTrendView("hrv", dayAt(150), "m", 0, ctx);
    const back = await getTrendView("hrv", dayAt(150), "m", 1, ctx);
    expect(back.to).toBe(dayAt(120));
    expect(now.prior).toBeCloseTo(back.value!, 6);
    expect(now.typical![0]).toBeLessThan(now.typical![1]);
    expect(now.period).toMatch(/^\w{3} \d+ - \w{3} \d+, \d{2}$/);
  });

  it("6M has month segments; weekly metrics total by week", async () => {
    const six = await getTrendView("recovery", dayAt(150), "6m", 0, ctx);
    expect(six.segments!.length).toBeGreaterThanOrEqual(6);
    expect(six.segments![0].change).toBeNull();
    const zones = await getTrendView("zones13", dayAt(150), "m", 0, ctx);
    expect(zones.bars).toHaveLength(4);
    expect(zones.caption).toBe("Avg. weekly total");
    const sum = zones.breakdown!.items.reduce((a, i) => a + i.value, 0);
    expect(sum).toBeCloseTo(zones.value!, 6);
  });

  it("breakdown days add up to the days with a value", async () => {
    const vm = await getTrendView("consistency", dayAt(150), "m", 0, ctx);
    const days = vm.bars.filter((b) => b.value !== null).length;
    expect(vm.breakdown!.items.reduce((a, i) => a + i.value, 0)).toBe(days);
  });

  it("time in bed carries bed and wake; the flagged sleep stress is not a key", async () => {
    const vm = await getTrendView("time_in_bed", dayAt(150), "w", 0, ctx);
    const last = vm.bars.at(-1)!;
    expect(last.parts!.bed).toBeLessThan(last.parts!.wake);
    expect(isTrendViewKey("sleep_stress")).toBe(false);
  });

  it("time in bed draws one bar per whole week in M and per whole month in 6M", async () => {
    const m = await getTrendView("time_in_bed", dayAt(150), "m", 0, ctx);
    expect(m.bars).toHaveLength(4);
    for (const b of m.bars) expect((Date.parse(b.to) - Date.parse(b.from)) / 864e5).toBe(6);
    const six = await getTrendView("time_in_bed", dayAt(150), "6m", 0, ctx);
    expect(six.segments).toBeNull();
    for (const b of six.bars) expect([b.from.slice(8), b.from.slice(0, 7)]).toEqual(["01", b.to.slice(0, 7)]);
    const last = six.bars.at(-1)!;
    expect(last.parts!.bed).toBeLessThan(last.parts!.wake);
  });
});
