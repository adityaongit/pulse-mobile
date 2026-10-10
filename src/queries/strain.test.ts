// Strain's activity extras and the distance on activities (spec §11 EX1, EX3), and F6's getStrain on every day.
import { beforeAll, describe, expect, it } from "vitest";
import { activityItem, distanceOf, type ExerciseRow, type QueryCtx } from "./common";
import { getStrain, STRAIN_EXTRAS } from "./strain";
import { loadF2 } from "../testing/fixtures";
import { expectF6, f6Days, seededCtx } from "./testing";

const ANCHOR = "2026-04-06";
const dayAt = (i: number) => new Date(Date.parse(ANCHOR) + i * 86_400_000).toISOString().slice(0, 10);

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
  // seededCtx() loads what the pipeline reads; F6 was recorded with F2's Google roll-ups (daily_values) in place too.
  await ctx.store.daily.upsertDailyValues(loadF2().tables.daily_values.map((r) => ({ day: r.day as string, key: r.key as string, value: r.value as number })));
}, 120_000);

describe("getStrain summary", () => {
  it("lists the extras after Steps with the catalogue's unit, format and direction, and a 30-day average", async () => {
    const vm = await getStrain(ctx, dayAt(178));
    expect(vm.summary.map((k) => k.key)).toEqual(["zones13", "zones45", "strength", "steps", ...STRAIN_EXTRAS]);
    // The reference app's four rows open their Trend Views; the extras keep their metric screens (spec §11 R35).
    expect(vm.summary.slice(0, 4).map((k) => k.href)).toEqual(["/trend/zones13", "/trend/zones45", "/trend/strength", "/trend/steps"]);
    const distance = vm.summary.find((k) => k.key === "distance")!;
    expect(distance).toMatchObject({ label: "Distance", unit: "km", format: "decimal2", direction: "up" });
    expect(distance.metric.value).toBeGreaterThan(0);
    expect(distance.average).toBeGreaterThan(0);
    const azm = (await ctx.store.daily.readValuesBetween(dayAt(148), dayAt(177))).filter((r) => r.key === "azm");
    const avg = azm.reduce((a, r) => a + r.value, 0) / azm.length;
    expect(vm.summary.find((k) => k.key === "azm")!.average).toBeCloseTo(avg, 6);
    expect(vm.summary.find((k) => k.key === "active_calories")!.direction).toBe("neutral");
  });

  it("is honest without a value: band_not_worn on the band-off day, no_data on a worn day the account has none", async () => {
    const off = (await getStrain(ctx, dayAt(156))).summary.find((k) => k.key === "floors")!;
    expect(off.metric).toMatchObject({ value: null, reason: "band_not_worn" });
    // The day's floors row removed, on a read-through copy of the store (the seeded database is shared).
    const daily = ctx.store.daily;
    const without = { ...ctx, store: { ...ctx.store, daily: { ...daily, readValuesBetween: async (a: string, b: string) => (await daily.readValuesBetween(a, b)).filter((r) => !(r.day === dayAt(170) && r.key === "floors")) } } };
    const missing = (await getStrain(without, dayAt(170))).summary.find((k) => k.key === "floors")!;
    expect(missing.metric).toMatchObject({ value: null, reason: "no_data" });
  });

  it("reproduces F6 on every day", async () => {
    for (const day of f6Days()) expectF6("getStrain", day, await getStrain(ctx, day));
  });
});

describe("activity distance", () => {
  const ex = (type: string, distanceM: number | null): ExerciseRow => ({ id: "x", day: dayAt(1), startTs: 0, endTs: 30 * 60, type, name: null, calories: null, distanceM });

  it("gives km for any recorded distance, pace only for runs and walks, nothing for none or zero", () => {
    expect(distanceOf(ex("RUNNING", 6000))).toEqual({ distanceKm: 6, paceS: 300 });
    expect(distanceOf(ex("WALKING", 2500))).toEqual({ distanceKm: 2.5, paceS: 720 });
    expect(distanceOf(ex("BIKING", 15000))).toEqual({ distanceKm: 15, paceS: null });
    expect(distanceOf(ex("STRENGTH_TRAINING", null))).toEqual({ distanceKm: null, paceS: null });
    expect(distanceOf(ex("RUNNING", 0))).toEqual({ distanceKm: null, paceS: null });
    expect(activityItem(ex("RUNNING", 6000), undefined)).toMatchObject({ distanceKm: 6, paceS: 300 });
  });
});
