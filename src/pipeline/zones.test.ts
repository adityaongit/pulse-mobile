// The person's own heart-rate zones (Profile.hrZones) on the demo seed: setting them rescores every day on them, as a new
// max HR does, and clearing them gives back exactly the default scores.
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { lastRun, runPipeline, type Stage1Day } from "@/pipeline";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const OWN = [85, 100, 120, 140, 160];

const strains = async (store: MemoryStore) =>
  new Map((await store.scoresIn({ from: "0000-00-00", to: "9999-99-99" })).map((r) => [r.day, (r.strain as Stage1Day | null)?.engine?.strain ?? null]));

describe("own heart-rate zones", () => {
  let store: MemoryStore;
  let defaults: Awaited<ReturnType<typeof strains>>;
  beforeAll(async () => {
    store = new MemoryStore();
    await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
    await runPipeline(store, PROFILE, { today: TODAY });
    defaults = await strains(store);
  }, 120_000);

  it("scores every day on them, keeps them with the day, and clears back to the default scores", async () => {
    const scored = [...defaults.values()].filter((s) => s !== null);
    expect(scored.length).toBeGreaterThan(100);
    expect(scored.every((s) => s.zones === undefined)).toBe(true);

    const { days } = await runPipeline(store, { ...PROFILE, hrZones: OWN }, { today: TODAY });
    expect(lastRun.stage1Days.length).toBe(days);
    const own = await strains(store);
    for (const [day, s] of own) if (s) expect(s.zones, day).toEqual(OWN);
    // Lower zones than 50–90 % of 183 (92, 110, 129, 147, 165): more time in the higher zones, so more Strain.
    const both = [...own.keys()].filter((d) => own.get(d) && defaults.get(d));
    expect(both.filter((d) => own.get(d)!.value > defaults.get(d)!.value).length).toBeGreaterThan(both.length / 2);
    expect(both.every((d) => own.get(d)!.value >= defaults.get(d)!.value)).toBe(true);

    await runPipeline(store, { ...PROFILE, hrZones: OWN }, { today: TODAY });
    expect(lastRun.stage1Days).toEqual([]);

    await runPipeline(store, PROFILE, { today: TODAY });
    expect(await strains(store)).toEqual(defaults);
  }, 240_000);
});
