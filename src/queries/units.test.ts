// The person's units (src/lib/units.ts) on the demo seed: every view model that reads a stored value shows it in the
// chosen units, with the shown unit, and a skin-temperature deviation scales without the °F offset.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { coachInstructions } from "@/coach/instructions";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { DEFAULT_DISPLAY, setDisplayPrefs } from "@/lib/units";
import { runPipeline } from "@/pipeline";
import { DEFAULT_GOALS } from "@/state/goals";
import { getChartSeries } from "./chart";
import type { QueryCtx } from "./ctx";
import { getGoalsDay } from "./goals";
import { getMonitor } from "./health";
import { getMetricDetail } from "./metric";
import { getTrendView } from "./trendView";
import { getTrends, parseTrendMetric } from "./trends";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T21:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const LB = 2.2046226218;
const MI = 0.6213711922;

let ctx: QueryCtx;
beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: await store.getSyncState() };
});
afterEach(() => setDisplayPrefs(DEFAULT_DISPLAY));

/** The same query in metric, then in imperial. */
async function both<T>(read: () => Promise<T>): Promise<[T, T]> {
  setDisplayPrefs({ units: "metric", hours: 24 });
  const metric = await read();
  setDisplayPrefs({ units: "imperial", hours: 24 });
  return [metric, await read()];
}

const values = (xs: { value: number | null }[]) => xs.map((x) => x.value).filter((v): v is number => v !== null);

describe("units in the view models", () => {
  it("shows Trends' weight in pounds, its unit and every point", async () => {
    const [m, i] = await both(() => getTrends("weight", ctx));
    if (!m.points.value || !i.points.value) throw new Error("no weight");
    const kg = values(m.points.value);
    expect(kg.length).toBeGreaterThan(3);
    values(i.points.value).forEach((lb, k) => expect(lb).toBeCloseTo(kg[k] * LB, 6));
    expect(i.periods[0].average.value!).toBeCloseTo(m.periods[0].average.value! * LB, 6);
    setDisplayPrefs({ units: "imperial", hours: 24 });
    expect(parseTrendMetric("weight").unit).toBe("lb");
  });

  it("shows the distance page in miles, its workout part converted alike", async () => {
    const [m, i] = await both(() => getMetricDetail("distance", TODAY, ctx));
    expect([m.unit, i.unit]).toEqual(["km", "mi"]);
    expect(i.ranges.m.average!).toBeCloseTo(m.ranges.m.average! * MI, 6);
    for (const p of i.history.value ?? []) {
      if (p.value === null || !p.parts) continue;
      expect(p.parts.workouts + p.parts.everyday).toBeCloseTo(p.value, 6);
    }
  });

  it("scales a skin-temperature deviation by 1.8 without the 32, its range alike", async () => {
    const [m, i] = await both(() => getMonitor(TODAY, ctx));
    const skin = (vm: typeof m) => vm.vitals.find((v) => v.key === "skinTempDev")!;
    expect([skin(m).unit, skin(i).unit]).toEqual(["°C", "°F"]);
    expect(skin(i).metric.value!).toBeCloseTo(skin(m).metric.value! * 1.8, 6);
    if (skin(m).range) expect(skin(i).range!.low).toBeCloseTo(skin(m).range!.low * 1.8, 6);
    const [cm, ci] = await both(() => getChartSeries("skin_temp", ctx));
    ci.values.forEach((v, k) => v !== null && expect(v).toBeCloseTo(cm.values[k]! * 1.8, 6));
  });

  it("shows Trend View's lean body mass and the goals in the person's units", async () => {
    const [m, i] = await both(() => getTrendView("lean_mass", TODAY, "m", 0, ctx));
    expect([m.unit, i.unit]).toEqual(["kg", "lb"]);
    expect(i.value!).toBeCloseTo(m.value! * LB, 6);
    const [gm, gi] = await both(() => getGoalsDay(TODAY, ctx, DEFAULT_GOALS));
    const distance = (vm: typeof gm) => vm.goals.find((g) => g.key === "distance")!;
    expect([distance(gm).unit, distance(gi).unit]).toEqual(["km", "mi"]);
    expect(distance(gi).target).toBeCloseTo(8 * MI, 6);
    expect(distance(gi).progress).toBe(distance(gm).progress);
  });

  it("tells the coach the person's units and clock", () => {
    setDisplayPrefs({ units: "imperial", hours: 12 });
    expect(coachInstructions(ctx)).toContain("imperial units (pounds, miles, feet and inches, °F, fluid ounces) and a 12-hour clock");
  });
});
