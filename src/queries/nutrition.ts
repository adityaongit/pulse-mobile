// Nutrition `/nutrition` (a phone-only screen): today's calories and macros against the person's targets, their 7- and
// 30-day averages, 30 days of daily protein and calories, and today's food, Pulse's entries (editable) beside those
// read from Health Connect (logged in Fitbit). Every number is counted as the metric screens count it: the source's
// daily roll-up plus Pulse's own entries, a meal logged in both apps once (food.ts).
import { metricsWithLoggedBody } from "@/data/body";
import { i18n } from "@/i18n/config";
import { addDays, localMidnight } from "@/lib/time";
import type { Metric } from "@/lib/reasons";
import { balanceOf, zoneOf, type BalanceZone } from "@/nutrition/balance";
import { BURN_DAYS, NO_CUSTOM, resolveTargets, type CustomTargets, type Targets } from "@/nutrition/targets";
import { type DayRow, finite, loadDays, type QueryCtx, todayOf } from "./common";
import { countedPulse, EMPTY_TOTALS, foodEntry, mealOverlaps, roundNutrient, sumFood, type FoodEntry, type FoodVia, type Totals } from "./food";
import { MEALS, type Meal } from "./log";

/** The nutrients the overview averages and charts (fiber is Pulse's alone, so it shows only in today's total). */
export const MACROS = ["kcal", "protein", "carbs", "fat"] as const;
export type Macro = (typeof MACROS)[number];

/** Daily averages over the days that have each nutrient, and how many days had food logged out of `span`. */
export type Averages = Record<Macro, number | null> & { days: number; span: number };

export type FoodItem = {
  id: string;
  /** The food's name, or its meal's when it has none. */
  title: string;
  name: string | null;
  portion: string | null;
  meal: Meal | "UNKNOWN";
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  ts: number;
  /** Pulse's own (editable), or read from Health Connect (logged in Fitbit, read-only). */
  source: "pulse" | "health_connect";
  via: FoodVia | null;
  /** A Pulse entry that repeats this Fitbit entry: the meal counts once, as Fitbit's. */
  duplicateOf: string | null;
  /** The person said this Pulse entry is a food of its own ("Count it too"): never taken for a repeat. */
  separate: boolean;
};

export type MealGroup = {
  meal: Meal | "UNKNOWN";
  label: string;
  /** The calories this meal counts (repeats left out). */
  kcal: number;
  items: FoodItem[];
  /** Pulse and Fitbit both logged this meal with entries that don't match: maybe one meal twice. */
  overlap: boolean;
};

/** One day of the calories in vs. out chart; a side with no data is null (never a made-up zero). */
export type BalanceDay = { day: string; kcalIn: number | null; kcalOut: number | null; zone: BalanceZone | null };

export type CalorieBalance = {
  /** The calorie goal each day is measured against: the calorie target in force. */
  goal: number;
  /** Today so far: eaten, burned (Health Connect's running total, so provisional) and in minus out. */
  kcalIn: Metric<number>;
  kcalOut: Metric<number>;
  net: number | null;
  /** The 7 days ending today, oldest first. */
  days: BalanceDay[];
};

export type NutritionVM = {
  today: string;
  timeZone: string;
  /** Today so far, as the metrics count it. */
  totals: Totals;
  /** The targets in force: the person's own where set, else Pulse's suggestion. */
  targets: Targets;
  /** Pulse's suggestions alone (the edit sheet's placeholders). */
  suggested: Targets;
  /** The 7 and 30 days before today (today is still running, so it never counts in an average). */
  week: Averages;
  month: Averages;
  /** 30 days ending today, oldest first; today's running totals are provisional. */
  history: { day: string; kcal: number | null; protein: number | null; provisional?: true }[];
  /** Today's food by meal, in meal order. */
  meals: MealGroup[];
  /**
   * What the source's daily total holds beyond the entries listed (a Google account sends totals only, no entries);
   * null when the list accounts for it all.
   */
  unlisted: Totals | null;
  /** Calories in vs. out, today and the last 7 days. */
  balance: CalorieBalance;
  /** Today has food logged in Pulse (some counted, some maybe repeats). */
  pulseToday: number;
};

/** A meal's name, read when called so it follows the language in use (the meal names are Journal's). */
const mealLabel = (meal: Meal | "UNKNOWN"): string => (meal === "UNKNOWN" ? i18n.t("nutrition:meal.other") : (MEALS.find((m) => m[0] === meal)?.[1] ?? meal));
const MEAL_ORDER: (Meal | "UNKNOWN")[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "UNKNOWN"];
const FOOD_PICK: Record<Macro, (r: DayRow) => number | undefined> = {
  kcal: (r) => r.extra.calories_in,
  protein: (r) => r.extra.protein,
  carbs: (r) => r.extra.carbs,
  fat: (r) => r.extra.fat,
};

/** Each macro's mean over the rows that have it; `days` counts the rows with calories (food logged). */
export function averagesOf(rows: (DayRow | undefined)[], span: number): Averages {
  const out = { kcal: null, protein: null, carbs: null, fat: null, days: 0, span } as Averages;
  for (const m of MACROS) {
    const xs = rows.flatMap((r) => {
      const v = r ? FOOD_PICK[m](r) : undefined;
      return finite(v) ? [v] : [];
    });
    if (xs.length) out[m] = roundNutrient(m, xs.reduce((a, b) => a + b, 0) / xs.length);
    if (m === "kcal") out.days = xs.length;
  }
  return out;
}

/** The latest weight on or before `day`, logged in Pulse or synced. */
async function latestWeight(ctx: QueryCtx, day: string): Promise<number | null> {
  const rows = await metricsWithLoggedBody(ctx.store);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.day <= day && finite(r.weightKg)) return r.weightKg;
  }
  return null;
}

const itemOf = (e: FoodEntry, dup: Map<string, string>): FoodItem => ({
  id: e.id,
  title: e.data.name ?? mealLabel(e.data.meal),
  name: e.data.name,
  portion: e.data.portion ?? null,
  meal: e.data.meal,
  kcal: e.data.kcal,
  protein: e.data.protein,
  carbs: e.data.carbs,
  fat: e.data.fat,
  fiber: e.data.fiber ?? null,
  ts: e.ts,
  source: e.source,
  via: e.data.via ?? null,
  duplicateOf: dup.get(e.id) ?? null,
  separate: !!e.data.separate,
});

/** Today's food by meal. */
export function mealGroups(entries: FoodEntry[]): MealGroup[] {
  const { dup } = countedPulse(entries);
  const overlaps = new Set<string>(mealOverlaps(entries, dup));
  return MEAL_ORDER.flatMap((meal) => {
    const es = entries.filter((e) => e.data.meal === meal).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    if (!es.length) return [];
    const kcal = es.reduce((a, e) => a + (dup.has(e.id) ? 0 : e.data.kcal), 0);
    return [{ meal, label: mealLabel(meal), kcal: Math.round(kcal), items: es.map((e) => itemOf(e, dup)), overlap: overlaps.has(meal) }];
  });
}

/** Calories in vs. out for the 7 days ending `today`, each day's intake in its zone against `goal`. */
export function calorieBalance(rows: Map<string, DayRow>, today: string, goal: number): CalorieBalance {
  const num = (v: number | null | undefined) => (finite(v) ? v : null);
  const days = Array.from({ length: 7 }, (_, k) => {
    const day = addDays(today, k - 6);
    const r = rows.get(day);
    const kcalIn = num(r?.extra.calories_in);
    return { day, kcalIn, kcalOut: num(r?.metrics?.calories), zone: kcalIn === null ? null : zoneOf(kcalIn, goal) };
  });
  const t = days[6];
  // Today is still running, so both sides are provisional.
  const metric = (v: number | null): Metric<number> => ({ value: v, reason: v === null ? "no_data" : null, provisional: v !== null });
  return { goal, kcalIn: metric(t.kcalIn), kcalOut: metric(t.kcalOut), net: balanceOf(t.kcalIn, t.kcalOut), days };
}

/** Nutrition for today, against `custom` targets (the person's own; null fields follow Pulse's suggestion). */
export async function getNutrition(ctx: QueryCtx, custom: CustomTargets): Promise<NutritionVM> {
  const today = todayOf(ctx);
  const from = addDays(today, -30);
  const [rows, weightKg, logged, synced] = await Promise.all([
    loadDays(ctx, from, today),
    latestWeight(ctx, today),
    ctx.store.loggedEntries(localMidnight(today, ctx.timeZone), 10_000),
    ctx.store.dailyValues({ from: today, to: today }),
  ]);
  const before = (n: number) => Array.from({ length: n }, (_, k) => rows.get(addDays(today, -n + k)));

  const entries = logged.flatMap((r) => {
    const e = r.day === today ? foodEntry(r) : null;
    return e ? [e] : [];
  });
  const { counted } = countedPulse(entries);
  const row = rows.get(today);
  const pulse = sumFood(counted);
  const totals: Totals = { kcal: null, protein: null, carbs: null, fat: null, fiber: pulse.fiber };
  for (const m of MACROS) {
    const v = row ? FOOD_PICK[m](row) : undefined;
    totals[m] = finite(v) ? v : null;
  }

  // The roll-up beyond the Fitbit entries listed: with Health Connect they match; a Google account sends totals only.
  const listed = sumFood(entries.filter((e) => e.source !== "pulse"));
  const unlisted: Totals = { ...EMPTY_TOTALS };
  let more = false;
  for (const m of MACROS) {
    const key = m === "kcal" ? "calories_in" : m;
    const v = synced.find((x) => x.key === key)?.value;
    if (!finite(v)) continue;
    const rest = roundNutrient(m, v - (listed[m] ?? 0));
    if (rest > (m === "kcal" ? 5 : 0.5)) {
      unlisted[m] = rest;
      more = true;
    }
  }

  const basis = { weightKg, heightCm: ctx.profile.heightCm, burned: before(BURN_DAYS).map((r) => r?.metrics?.calories) };
  const targets = resolveTargets(custom, basis);
  return {
    today,
    timeZone: ctx.timeZone,
    totals,
    targets,
    balance: calorieBalance(rows, today, targets.kcal.value),
    suggested: resolveTargets(NO_CUSTOM, basis),
    week: averagesOf(before(7), 7),
    month: averagesOf(before(30), 30),
    history: Array.from({ length: 30 }, (_, k) => {
      const day = addDays(today, k - 29);
      const r = rows.get(day);
      const kcal = r?.extra.calories_in;
      const protein = r?.extra.protein;
      const shown = finite(kcal) || finite(protein);
      return { day, kcal: finite(kcal) ? kcal : null, protein: finite(protein) ? protein : null, ...(day === today && shown && { provisional: true as const }) };
    }),
    meals: mealGroups(entries),
    unlisted: more ? unlisted : null,
    pulseToday: entries.filter((e) => e.source === "pulse").length,
  };
}

