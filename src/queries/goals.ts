// Daily goals (Fitbit-style, a phone-only addition): how far `day` has come toward each target the person set, with a
// week of history for the rings and streaks, and Active Zone Minutes against the weekly target. Pulse's own screens
// never set goals; they are kept on the phone (src/state/goals.ts) and come in as `goals`. Pure over the Store.
import { inUnits, quantity } from "@/lib/units";
import { addDays } from "@/lib/time";
import { type FormatKey, metricHref, weekOf } from "./_lib";
import { type DayRow, finite, loadDays, nightNeedMin, type QueryCtx, todayOf } from "./common";

export type GoalKey = "steps" | "distance" | "floors" | "azm" | "active_minutes" | "active_calories" | "water" | "sleep";
export const GOAL_KEYS: readonly GoalKey[] = ["steps", "distance", "floors", "azm", "active_minutes", "active_calories", "water", "sleep"];

/** Targets per day (sleep: hours a night; null = Pulse's sleep need for that night) and Active Zone Minutes per week. */
export type GoalTargets = {
  steps: number;
  /** km */
  distance: number;
  floors: number;
  /** minutes a day */
  azm: number;
  /** minutes a week */
  azmWeek: number;
  active_minutes: number;
  /** kcal */
  active_calories: number;
  /** ml */
  water: number;
  /** hours a night; null follows Pulse's sleep need */
  sleep: number | null;
};
export type Goals = { targets: GoalTargets; enabled: Record<GoalKey, boolean> };

export type GoalMeta = {
  key: GoalKey;
  label: string;
  /** Under a small ring. */
  short: string;
  /** "Step goal", for "Step goal reached". */
  goalName: string;
  unit?: string;
  format: FormatKey;
  /** Accrues through the day: today's value is a running total. */
  partialToday: boolean;
  /** The metric's own screen. */
  href: string;
};

export const GOAL_META: Record<GoalKey, GoalMeta> = {
  steps: { key: "steps", label: "Steps", short: "Steps", goalName: "Step goal", format: "grouped", partialToday: true, href: metricHref("steps") },
  distance: { key: "distance", label: "Distance", short: "Distance", goalName: "Distance goal", unit: "km", format: "decimal2", partialToday: true, href: metricHref("distance") },
  floors: { key: "floors", label: "Floors", short: "Floors", goalName: "Floor goal", format: "grouped", partialToday: true, href: metricHref("floors") },
  azm: { key: "azm", label: "Active Zone Minutes", short: "Zone min", goalName: "Active Zone Minutes goal", format: "duration", partialToday: true, href: metricHref("azm") },
  active_minutes: { key: "active_minutes", label: "Active minutes", short: "Active", goalName: "Active minutes goal", format: "duration", partialToday: true, href: metricHref("active_minutes") },
  active_calories: { key: "active_calories", label: "Active calories", short: "Calories", goalName: "Active calories goal", unit: "kcal", format: "grouped", partialToday: true, href: metricHref("active_calories") },
  water: { key: "water", label: "Water", short: "Water", goalName: "Water goal", unit: "ml", format: "grouped", partialToday: true, href: metricHref("water") },
  sleep: { key: "sleep", label: "Sleep", short: "Sleep", goalName: "Sleep goal", format: "duration", partialToday: false, href: "/sleep" },
};

/** One day of a goal: the value so far, the day's target, progress on [0, 1] (null with no value) and whether it was met. */
export type GoalDay = { day: string; value: number | null; target: number; progress: number | null; done: boolean };

export type GoalRow = GoalMeta & {
  /** So far on `day`; null when the day recorded nothing for it. */
  value: number | null;
  target: number;
  /** 0–1, 0 with no value. */
  progress: number;
  done: boolean;
  /** Today's running total, still accruing. */
  partial: boolean;
  /** The 7 days ending on `day`, oldest first. */
  history: GoalDay[];
  /** Consecutive days met ending on `day` (or the day before, while today's still runs), within the last 5 weeks. */
  streak: number;
};

export type GoalsWeek = {
  from: string;
  to: string;
  /** Active Zone Minutes from Monday through `day`. */
  total: number;
  target: number;
  progress: number;
  done: boolean;
  /** Monday to Sunday; days after `day` are null. */
  days: { day: string; value: number | null }[];
};

export type GoalsDayVM = {
  day: string;
  today: string;
  isToday: boolean;
  /** The switched-on goals, in catalogue order. */
  goals: GoalRow[];
  /** How many of them are met. */
  done: number;
  /** Active Zone Minutes against the weekly target; null while that goal is off. */
  week: GoalsWeek | null;
};

/** Streaks look back this far. */
const WINDOW = 35;
/** Sleep's fallback need before Pulse has scored a night. */
const DEFAULT_SLEEP_NEED_H = 8;

const valueOf = (key: GoalKey, r: DayRow | undefined): number | null => {
  if (!r) return null;
  const v = key === "steps" ? r.metrics?.steps : key === "sleep" ? r.sleep?.main?.asleepMin : r.extra[key];
  return finite(v) ? v : null;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The day's target: sleep follows the night's need (the latest known one before a night without a score) unless set. */
function targetOf(key: GoalKey, goals: Goals, rows: Map<string, DayRow>, day: string): number {
  if (key !== "sleep") return goals.targets[key];
  if (goals.targets.sleep !== null) return goals.targets.sleep * 60;
  for (let k = 0; k < WINDOW; k++) {
    const need = nightNeedMin(rows.get(addDays(day, -k))?.sleep);
    if (finite(need) && need > 0) return need;
  }
  return DEFAULT_SLEEP_NEED_H * 60;
}

function dayOf(key: GoalKey, goals: Goals, rows: Map<string, DayRow>, day: string): GoalDay {
  const value = valueOf(key, rows.get(day));
  const target = targetOf(key, goals, rows, day);
  const progress = value === null ? null : target > 0 ? clamp01(value / target) : 0;
  // Shown in the person's units (src/lib/units.ts); progress and done are the same either way.
  const q = quantity(GOAL_META[key].unit);
  return { day, value: value === null ? null : q.value(value), target: q.value(target), progress, done: value !== null && target > 0 && value >= target };
}

/** The goals for `day`. `goals` are the phone's targets and switches (src/state/goals.ts). */
export async function getGoalsDay(day: string, ctx: QueryCtx, goals: Goals): Promise<GoalsDayVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const [monday, sunday] = weekOf(day);
  const from = addDays(day, -(WINDOW - 1)) < monday ? addDays(day, -(WINDOW - 1)) : monday;
  const rows = await loadDays(ctx, from, day);

  const out: GoalRow[] = [];
  for (const key of GOAL_KEYS) {
    if (!goals.enabled[key]) continue;
    const meta = GOAL_META[key];
    const current = dayOf(key, goals, rows, day);
    const history = Array.from({ length: 7 }, (_, k) => dayOf(key, goals, rows, addDays(day, k - 6)));
    // Today counts once it is met; until then the streak runs to yesterday (as the Steps screen counts it).
    let d = meta.partialToday && isToday && !current.done ? addDays(day, -1) : day;
    let streak = 0;
    while (d >= from && dayOf(key, goals, rows, d).done) {
      streak++;
      d = addDays(d, -1);
    }
    out.push({
      ...inUnits(meta),
      value: current.value,
      target: current.target,
      progress: current.progress ?? 0,
      done: current.done,
      partial: meta.partialToday && isToday,
      history,
      streak,
    });
  }

  let week: GoalsWeek | null = null;
  if (goals.enabled.azm) {
    const days: GoalsWeek["days"] = [];
    let total = 0;
    for (let d = monday; d <= sunday; d = addDays(d, 1)) {
      const value = d <= day ? valueOf("azm", rows.get(d)) : null;
      if (value !== null) total += value;
      days.push({ day: d, value });
    }
    const target = goals.targets.azmWeek;
    week = { from: monday, to: day, total, target, progress: target > 0 ? clamp01(total / target) : 0, done: target > 0 && total >= target, days };
  }

  return { day, today, isToday, goals: out, done: out.filter((g) => g.done).length, week };
}
