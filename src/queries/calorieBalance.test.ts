// Calories in vs. out on the Nutrition screen: today's balance and the 7-day chart, from the in-memory store.
import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import { emptyMetrics, type Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { NO_CUSTOM } from "@/nutrition/targets";
import type { QueryCtx } from "./ctx";
import { getNutrition } from "./nutrition";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };

let store: Store;
let ctx: QueryCtx;
beforeEach(() => {
  store = openMemoryStore();
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: Date.parse(`${TODAY}T20:00:00+05:30`) / 1000, sync: { lastSyncTs: null, firstDay: null, lastError: null } };
});
const eat = (day: string, kcal: number) => store.upsertDailyValues([{ day, key: "calories_in", value: kcal }]);
const burn = (day: string, calories: number) => store.upsertMetrics([{ ...emptyMetrics(day), calories }]);

describe("calories in vs. out", () => {
  it("sums today as in, out and the balance, and zones each day against the goal", async () => {
    // Goal 2,000 (nothing burned long enough to suggest one, so the default).
    await eat(TODAY, 1092);
    await burn(TODAY, 544);
    await eat(addDays(TODAY, -1), 1700); // under
    await eat(addDays(TODAY, -2), 2000); // in zone
    await eat(addDays(TODAY, -3), 2300); // over
    const { balance } = await getNutrition(ctx, NO_CUSTOM);
    expect(balance.goal).toBe(2000);
    expect(balance.kcalIn).toEqual({ value: 1092, reason: null, provisional: true });
    expect(balance.kcalOut).toEqual({ value: 544, reason: null, provisional: true });
    expect(balance.net).toBe(548);
    expect(balance.days.map((d) => d.day)).toHaveLength(7);
    expect(balance.days[6].day).toBe(TODAY);
    expect(balance.days.slice(3, 6).map((d) => d.zone)).toEqual(["over", "in", "under"]);
    // No food, no zone and no bar; no burn, no bar.
    expect(balance.days[0]).toEqual({ day: addDays(TODAY, -6), kcalIn: null, kcalOut: null, zone: null });
  });

  it("says no data, never a number, when today has no burn or no food", async () => {
    const { balance } = await getNutrition(ctx, NO_CUSTOM);
    expect(balance.kcalIn).toEqual({ value: null, reason: "no_data", provisional: false });
    expect(balance.kcalOut).toEqual({ value: null, reason: "no_data", provisional: false });
    expect(balance.net).toBeNull();
  });

  it("measures against the person's own calorie target", async () => {
    await eat(TODAY, 1500);
    const { balance } = await getNutrition(ctx, { ...NO_CUSTOM, kcal: 1500 });
    expect(balance.goal).toBe(1500);
    expect(balance.days[6].zone).toBe("in");
  });
});
