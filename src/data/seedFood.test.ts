import { describe, expect, it } from "vitest";
import { getNutrition } from "@/queries/nutrition";
import { NO_CUSTOM } from "@/nutrition/targets";
import { openMemoryStore } from "./memory";
import { seedDemo } from "./seed";
import { seedDemoFood } from "./seedFood";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";

describe("the sample person's food", () => {
  it("fills the calories in vs. out chart: days under, in zone and over, and today's meals so far", async () => {
    const store = openMemoryStore();
    const now = Date.parse(`${TODAY}T15:00:00+05:30`) / 1000;
    const profile = await seedDemo(store, { today: TODAY, timeZone: TZ, now });
    await seedDemoFood(store, { today: TODAY, timeZone: TZ, now });
    const ctx = { store, profile, timeZone: TZ, today: TODAY, now, sync: { lastSyncTs: now, firstDay: null, lastError: null } };
    const vm = await getNutrition(ctx, NO_CUSTOM);
    expect(vm.balance.days.filter((d) => d.kcalIn !== null).length).toBeGreaterThanOrEqual(6);
    expect(new Set(vm.balance.days.map((d) => d.zone))).toContain("under");
    expect(vm.meals.flatMap((m) => m.items.map((i) => i.name))).toContain("Chicken rice bowl");
  });
});
