// The activity screen's typical zone ranges, distance and pace tiles, and hero (spec §11 EX3).
import { beforeAll, describe, expect, it } from "vitest";
import { type QueryCtx } from "./common";
import { getActivity, withTypical } from "./activity";
import { seededCtx } from "./testing";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

const row = (zone: number, seconds: number) => ({ zone, label: `Z${zone}`, min: 100 + zone * 10, max: null, seconds });

/** The newest exercise of a type (pulse's `order by start_ts desc limit 1`). */
async function first(type: string) {
  const all = await ctx.store.sessions.readExercises();
  return all.filter((e) => e.type === type).sort((a, b) => b.startTs - a.startTs)[0].id;
}

describe("getActivity", () => {
  it("is null for an unknown id", async () => {
    expect(await getActivity(ctx, "nope")).toBeNull();
  });

  it("adds Distance and Pace for a run, Distance for a ride, neither for strength", async () => {
    const keys = async (type: string) => (await getActivity(ctx, await first(type)))!.stats.map((k) => k.key);
    expect(await keys("RUNNING")).toEqual(["calories", "avgHr", "maxHr", "duration", "distance", "pace"]);
    expect(await keys("BIKING")).toEqual(["calories", "avgHr", "maxHr", "duration", "distance"]);
    expect(await keys("STRENGTH_TRAINING")).toEqual(["calories", "avgHr", "maxHr", "duration"]);
    const run = (await getActivity(ctx, await first("RUNNING")))!.stats;
    expect(run.find((k) => k.key === "pace")).toMatchObject({ unit: "/km", format: "pace" });
    expect(run.find((k) => k.key === "pace")!.metric.value).toBeGreaterThan(180);
    expect(run.find((k) => k.key === "pace")!.average).not.toBeNull();
  });

  it("the hero: this kind's strain average, steps inside a run only, no split, and typical zone ranges", async () => {
    const run = (await getActivity(ctx, await first("RUNNING")))!;
    expect(run.strainAverage).toBeGreaterThan(0);
    expect(run.steps!.value).toBeGreaterThan(0);
    expect(run.steps!.average).toBeGreaterThan(0);
    expect(run.split).toBeNull();
    for (const z of run.zones.value!) expect(z.typical!.low).toBeLessThanOrEqual(z.typical!.high);
    const lift = (await getActivity(ctx, await first("STRENGTH_TRAINING")))!;
    expect(lift.steps).toBeNull();
  });
});

describe("withTypical", () => {
  it("adds each zone's interquartile share range over earlier activities", () => {
    const m = { value: [row(1, 600), row(2, 0)], reason: null, provisional: false };
    const out = withTypical(m, [
      [300, 300],
      [900, 0],
      [600, 200],
    ]);
    expect(out.value?.[0].typical).toEqual({ low: 0.625, high: 0.875 });
    expect(out.value?.[1].typical).toEqual({ low: 0.125, high: 0.375 });
  });
  it("leaves the rows alone with fewer than three earlier activities", () => {
    const m = { value: [row(1, 600)], reason: null, provisional: false };
    expect(withTypical(m, [])).toBe(m);
    expect(withTypical(m, [[1], [2]])).toBe(m);
  });
});
