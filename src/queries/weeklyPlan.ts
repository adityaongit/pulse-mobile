// Weekly Plan (a phone addition, after WHOOP's Weekly Plan): the week holding `day` against the person's weekly
// targets (src/state/weeklyPlan.ts), with pace, streaks of weeks met and what each habit is worth on Pulse Age today.
// The scoring is pure (src/core/algorithms/weeklyPlan.ts); this maps the Store's days into it. Pure over the Store.
import { STRENGTH_TYPES, type HealthspanInput } from "@/core/algorithms/healthspan";
import { HISTORY_WEEKS, PLAN_KEYS, weeklyPlan, type PlanDay, type PlanItem, type PlanKey, type PlanSettings, type WeekPlan } from "@/core/algorithms/weeklyPlan";
import { i18n } from "@/i18n/config";
import { addDays } from "@/lib/time";
import { type FormatKey, metricHref, weekOf } from "./_lib";
import { type DayRow, type ExerciseRow, exercisesBetween, finite, loadDays, nightNeedMin, type QueryCtx, todayOf } from "./common";

export { PLAN_KEYS, type PlanKey, type PlanSettings } from "@/core/algorithms/weeklyPlan";

/**
 * Health Connect exercise types (src/health/import.ts's ExerciseType names) that count as a strength session: Pulse
 * Age's strength types, HIIT, and the single lifts a session can be recorded as.
 */
export const RESISTANCE_TYPES = new RegExp(`${STRENGTH_TYPES.source}|HIGH_INTENSITY_INTERVAL|BARBELL|BENCH_PRESS|DEADLIFT|DUMBBELL|LAT_PULL_DOWN|SQUAT|LUNGE`);

export type PlanMeta = {
  key: PlanKey;
  label: string;
  /** A short name ("Moderate"). */
  short: string;
  /** What the number counts ("Zones 1–3, a week"). */
  detail: string;
  /** After the value ("min", "sessions"). */
  unit: string;
  format: FormatKey;
  href: string;
  /** The Pulse Age term this habit feeds. */
  ageInput: HealthspanInput;
};

/** Keys in the catalogue, words resolved when read (getters), so a language switch shows at once. */
const planMeta = (key: PlanKey, rest: Pick<PlanMeta, "format" | "href" | "ageInput">): PlanMeta => ({
  key,
  ...rest,
  get label() {
    return i18n.t(`goals:planLabel.${key}`);
  },
  get short() {
    return i18n.t(`goals:planShort.${key}`);
  },
  get detail() {
    return i18n.t(`goals:planDetail.${key}`);
  },
  get unit() {
    return i18n.t(`goals:planUnit.${key}`);
  },
});

export const PLAN_META: Record<PlanKey, PlanMeta> = {
  zone13: planMeta("zone13", { format: "grouped", href: "/strain#zones", ageInput: "zone13" }),
  zone45: planMeta("zone45", { format: "grouped", href: "/strain#zones", ageInput: "zone45" }),
  strength: planMeta("strength", { format: "int", href: "/activities", ageInput: "strength" }),
  steps: planMeta("steps", { format: "grouped", href: metricHref("steps"), ageInput: "steps" }),
  consistency: planMeta("consistency", { format: "int", href: "/sleep#consistency", ageInput: "sri" }),
  sleepNeed: planMeta("sleepNeed", { format: "int", href: "/sleep#need", ageInput: "sleepHours" }),
};

export type PlanRow = PlanItem &
  PlanMeta & {
    /** Years this habit adds to (+) or takes off (−) Pulse Age as of the day; null without a Pulse Age. */
    ageYears: number | null;
  };

export type WeeklyPlanVM = Omit<WeekPlan, "items"> & {
  today: string;
  /** The week holding today. */
  isCurrentWeek: boolean;
  items: PlanRow[];
};

/** Strength sessions per day, from the workouts in range. */
export function strengthByDay(exs: readonly ExerciseRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of exs) if (RESISTANCE_TYPES.test(e.type)) out.set(e.day, (out.get(e.day) ?? 0) + 1);
  return out;
}

/**
 * One stored day as the plan's inputs. Zone minutes are the Pulse engine's zones (% of max HR): zones 1–3 and 4–5, every
 * minute once on any day with HR. Sleep is the night ending that morning, credited as the debt ledger does.
 */
export function planDay(r: DayRow, strengthSessions: number): PlanDay {
  const s1 = r.s1;
  const z = s1 && s1.hrCount > 0 && s1.zoneSeconds.length >= 5 ? s1.zoneSeconds : null;
  const sleep = r.sleep;
  const main = sleep?.main ?? null;
  const steps = r.metrics?.steps;
  const need = nightNeedMin(sleep);
  return {
    day: r.day,
    zone13Min: z ? (z[0] + z[1] + z[2]) / 60 : null,
    zone45Min: z ? (z[3] + z[4]) / 60 : null,
    strengthSessions,
    steps: finite(steps) ? steps : null,
    consistency: finite(sleep?.consistency) ? sleep.consistency : null,
    sleptMin: main ? (finite(sleep?.creditedMin) ? sleep.creditedMin : main.asleepMin) : null,
    needMin: main && finite(need) && need > 0 ? need : null,
  };
}

/** The days in `rows` as plan inputs, oldest first. */
export const planDays = (rows: Map<string, DayRow>, exs: readonly ExerciseRow[]): PlanDay[] => {
  const strength = strengthByDay(exs);
  return [...rows.values()].map((r) => planDay(r, strength.get(r.day) ?? 0));
};

/** The week holding `day`, against `plan` (the phone's targets and switches). */
export async function getWeeklyPlan(day: string, ctx: QueryCtx, plan: PlanSettings): Promise<WeeklyPlanVM> {
  const today = todayOf(ctx);
  const [monday] = weekOf(day);
  const from = addDays(monday, -7 * (HISTORY_WEEKS - 1));
  const [rows, exs] = await Promise.all([loadDays(ctx, from, day), exercisesBetween(ctx, from, day)]);
  const keys = PLAN_KEYS.filter((k) => plan.enabled[k]);
  const wp = weeklyPlan(planDays(rows, exs), plan.targets, keys, day, day === today);

  // Pulse Age as of the day, else the newest one before it in the window.
  let contributions: { key: string; years: number }[] = [];
  for (let d = day; d >= from; d = addDays(d, -1)) {
    const hs = rows.get(d)?.healthspan;
    if (hs && hs.reason === null) {
      contributions = hs.contributions;
      break;
    }
  }
  const items: PlanRow[] = wp.items.map((it) => {
    const meta = PLAN_META[it.key];
    const c = contributions.find((x) => x.key === meta.ageInput);
    return { ...it, ...meta, ageYears: c && finite(c.years) ? c.years : null };
  });
  return { ...wp, items, today, isCurrentWeek: weekOf(today)[0] === monday };
}
