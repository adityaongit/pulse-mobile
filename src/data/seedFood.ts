// Pulse-only: food for the sample person, so "Explore with sample data" shows the Nutrition screen's calories in vs. out
// (halo's seed has no food). Kept out of seed.ts so that file stays comparable with halo's. Daily totals for the days
// before today plus today's meals so far, as the sync leaves them: the entries are Health Connect's (read-only, "Logged in Fitbit") and the day's total is their sum, so nothing counts twice.
import { addDays, localMidnight } from "@/lib/time";
import type { LoggedEntryRow, Store } from "./store";

/** Calories eaten, oldest day first, ending the day before today: a mix of under, in zone and over a ~2,350 kcal goal. */
const KCAL = [2310, 1650, 2890, 2380, 2150, 2420, 1980, 2760, 2290, 1720, 2400, 2330, 2050];
/** Protein, carbs and fat as shares of the calories (4, 4 and 9 kcal per gram). */
const SHARE = { protein: 0.22, carbs: 0.48, fat: 0.3 };

/** Today's meals, in the order they are eaten: the hour they were eaten and what they were. */
const MEALS = [
  { hour: 8.25, meal: "BREAKFAST", name: "Oats with banana and milk", kcal: 520, protein: 22, carbs: 78, fat: 12 },
  { hour: 13, meal: "LUNCH", name: "Chicken rice bowl", kcal: 640, protein: 42, carbs: 70, fat: 18 },
  { hour: 19.5, meal: "DINNER", name: "Dal, roti and sabzi", kcal: 760, protein: 28, carbs: 96, fat: 26 },
] as const;

export async function seedDemoFood(store: Store, opts: { today: string; timeZone: string; now: number }): Promise<void> {
  const { today, timeZone, now } = opts;
  const rows = KCAL.flatMap((kcal, i) => {
    const day = addDays(today, i - KCAL.length);
    return [
      { day, key: "calories_in", value: kcal },
      { day, key: "protein", value: Math.round((kcal * SHARE.protein) / 4) },
      { day, key: "carbs", value: Math.round((kcal * SHARE.carbs) / 4) },
      { day, key: "fat", value: Math.round((kcal * SHARE.fat) / 9) },
    ];
  });
  const midnight = localMidnight(today, timeZone);
  const eaten: LoggedEntryRow[] = MEALS.flatMap((m) => {
    const ts = midnight + Math.round(m.hour * 3600);
    if (ts > now) return [];
    const { hour: _hour, ...data } = m;
    return [{ id: `demo-food-${m.meal}`, type: "nutrition-log", ts, day: today, data, createdAt: ts, source: "health_connect" as const }];
  });
  const sum = (k: "kcal" | "protein" | "carbs" | "fat") => eaten.reduce((a, e) => a + (e.data as Record<typeof k, number>)[k], 0);
  if (eaten.length > 0) {
    rows.push(
      { day: today, key: "calories_in", value: sum("kcal") },
      { day: today, key: "protein", value: sum("protein") },
      { day: today, key: "carbs", value: sum("carbs") },
      { day: today, key: "fat", value: sum("fat") },
    );
    await store.addLoggedEntries(eaten);
  }
  await store.upsertDailyValues(rows);
}
