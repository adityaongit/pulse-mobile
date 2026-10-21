// Own algorithm (a phone addition, after WHOOP's Weekly Plan): weekly targets for the habits Pulse Age scores (moderate
// and vigorous minutes, strength sessions, daily steps, sleep regularity and sleep against need), each week's progress
// and pace, and streaks of weeks met. Pure: the query (src/queries/weeklyPlan.ts) maps the Store's days into PlanDay.
import { weekStreaks, type Streaks } from "./streaks";

export const PLAN_KEYS = ["zone13", "zone45", "strength", "steps", "consistency", "sleepNeed"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PlanTargets = Record<PlanKey, number>;
export type PlanSettings = { targets: PlanTargets; enabled: Record<PlanKey, boolean> };

/**
 * Evidence-based defaults. Moderate 150 and vigorous 75 min a week: WHO 2020 guidelines (Bull et al., BJSM 54:1451),
 * Pulse Age's own reference for both. Strength on 2 days a week: the same guidelines. 8,000 steps a day: Paluch 2022
 * (Lancet Public Health), where the benefit levels off for most adults (8–10k under 60, 6–8k from 60). Consistency
 * 80: the Sleep screen's optimal band, past the middle quintile of Windred 2024 where most of the SRI benefit is.
 * Sleep need met on 5 nights of 7 (*tunable*): a week with a late night or two still counts.
 */
export const PLAN_DEFAULTS: PlanSettings = {
  targets: { zone13: 150, zone45: 75, strength: 2, steps: 8000, consistency: 80, sleepNeed: 5 },
  enabled: { zone13: true, zone45: true, strength: true, steps: true, consistency: true, sleepNeed: true },
};

/** How each target adds up over the week. */
export type PlanAgg = "sum" | "count" | "average" | "latest";
export const PLAN_AGG: Record<PlanKey, PlanAgg> = { zone13: "sum", zone45: "sum", strength: "count", steps: "average", consistency: "latest", sleepNeed: "count" };

/** `unit` sits inside the target's box; the card says weekly, and each target's hint says how it adds up. */
export type PlanLimit = { min: number; max: number; unit: string };
export const PLAN_LIMITS: Record<PlanKey, PlanLimit> = {
  zone13: { min: 10, max: 1500, unit: "min" },
  zone45: { min: 5, max: 600, unit: "min" },
  strength: { min: 1, max: 7, unit: "sessions" },
  steps: { min: 1000, max: 30_000, unit: "steps" },
  consistency: { min: 50, max: 100, unit: "%" },
  sleepNeed: { min: 1, max: 7, unit: "nights" },
};

/** An error as a code the screen turns into words: `errors:goals.<code>` with these params. */
export type PlanError = { code: "enterNumber" | "wholeOnly" | "between"; params?: { low: string; high: string } };

const grouped = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

/** Null when `value` is allowed for `key`, else why not ("between 1 and 7"). Every target is a whole number. */
export function validatePlanTarget(key: PlanKey, value: number | null): PlanError | null {
  const l = PLAN_LIMITS[key];
  if (value === null || !Number.isFinite(value)) return { code: "enterNumber" };
  if (!Number.isInteger(value)) return { code: "wholeOnly" };
  if (value < l.min || value > l.max) return { code: "between", params: { low: grouped(l.min), high: grouped(l.max) } };
  return null;
}

/** A field's text → the target it means and the error to show, if any. */
export function parsePlanTarget(key: PlanKey, text: string): { value: number | null; error: PlanError | null } {
  const t = text.trim().replace(/,/g, "");
  const value = t === "" ? null : Number(t);
  const error = validatePlanTarget(key, value);
  return { value: error ? null : value, error };
}

/** The stored JSON → plan settings; anything missing or out of range falls back to the default. */
export function parsePlan(raw: string | null): PlanSettings {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  const o = v && typeof v === "object" ? (v as { targets?: Record<string, unknown>; enabled?: Record<string, unknown> }) : {};
  const targets = { ...PLAN_DEFAULTS.targets };
  const enabled = { ...PLAN_DEFAULTS.enabled };
  for (const k of PLAN_KEYS) {
    const t = o.targets?.[k];
    if (typeof t === "number" && validatePlanTarget(k, t) === null) targets[k] = t;
    const e = o.enabled?.[k];
    if (typeof e === "boolean") enabled[k] = e;
  }
  return { targets, enabled };
}

export const isDefaultPlan = (p: PlanSettings) => JSON.stringify(p) === JSON.stringify(PLAN_DEFAULTS);

/** `plan` with one target changed (an invalid value is ignored). */
export const withPlanTarget = (plan: PlanSettings, key: PlanKey, value: number): PlanSettings =>
  validatePlanTarget(key, value) ? plan : { ...plan, targets: { ...plan.targets, [key]: value } };

/** `plan` with one target switched on or off. */
export const withPlanEnabled = (plan: PlanSettings, key: PlanKey, on: boolean): PlanSettings => ({ ...plan, enabled: { ...plan.enabled, [key]: on } });

// ── Evaluation ──────────────────────────────────────────────────────────────

/** One local day's inputs; null where the day has none. */
export interface PlanDay {
  day: string;
  /**
   * Moderate minutes: 40 % of heart-rate reserve to the top of Zone 3, Pulse Age's band but every minute once (no bout
   * rule, no doubling of 60–80 %). Null without HR.
   */
  zone13Min: number | null;
  /** Minutes in zones 4–5. Null without HR. */
  zone45Min: number | null;
  /** Strength, weightlifting, HIIT or calisthenics sessions that day. */
  strengthSessions: number;
  steps: number | null;
  /** Sleep consistency (0–100) over the 7 nights ending this morning. */
  consistency: number | null;
  /** The night ending this morning: minutes slept (with yesterday's naps, as the debt ledger credits them) and needed. */
  sleptMin: number | null;
  needMin: number | null;
}

/** done: met. on_pace / behind: the week still runs. missed: over (or out of reach) without it. no_data: nothing yet. */
export type PlanStatus = "done" | "on_pace" | "behind" | "missed" | "no_data";

export interface PlanItem {
  key: PlanKey;
  /** The week so far: a total (minutes, sessions, nights met), the daily average (steps) or the latest reading (consistency). */
  value: number | null;
  target: number;
  /** 0–1 */
  progress: number;
  done: boolean;
  status: PlanStatus;
  /** Totals: where an even pace would be by now (the days before an unfinished today); null for averages. */
  expected: number | null;
  /** Monday to Sunday; days after the evaluated day are null. `met`: the day's own share (steps at target, need met…). */
  days: { day: string; value: number | null; met: boolean }[];
  /** The last HISTORY_SHOWN weeks, oldest first, this one last. */
  weeks: { monday: string; value: number | null; met: boolean }[];
  /** Weeks in a row met; this week counts once met. */
  streak: Streaks;
}

export interface WeekPlan {
  monday: string;
  sunday: string;
  /** The evaluated day (the week runs to it). */
  day: string;
  /** Whole days of the week behind `day` (an unfinished today is not one). */
  elapsed: number;
  items: PlanItem[];
  /** Items done or on pace. */
  onTrack: number;
  /** Weeks with every switched-on target met. */
  planStreak: Streaks;
}

/** Weeks of history the streaks look back over (half a year). */
export const HISTORY_WEEKS = 26;
/** Weeks drawn per item in the sheet. */
export const HISTORY_SHOWN = 8;

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const nightMet = (d: PlanDay) => finite(d.sleptMin) && finite(d.needMin) && d.needMin > 0 && d.sleptMin >= d.needMin;
/** The day recorded anything the plan reads. */
export const hasPlanData = (d: PlanDay) => finite(d.zone13Min) || finite(d.steps) || finite(d.sleptMin) || d.strengthSessions > 0;

/** A day's own value for `key`, for the day bars. */
function dayValue(key: PlanKey, d: PlanDay | undefined): number | null {
  if (!d) return null;
  switch (key) {
    case "zone13":
      return d.zone13Min;
    case "zone45":
      return d.zone45Min;
    case "strength":
      return hasPlanData(d) ? d.strengthSessions : null;
    case "steps":
      return d.steps;
    case "consistency":
      return d.consistency;
    case "sleepNeed":
      return finite(d.sleptMin) && finite(d.needMin) ? d.sleptMin : null;
  }
}

/**
 * The week's value for `key` over `days` (Monday to the evaluated day, oldest first). With `partialToday` the last day is
 * still running: its steps count only once they lift the average, so a morning's few hundred never drag the week down.
 */
export function weekValue(key: PlanKey, days: readonly (PlanDay | undefined)[], partialToday = false): number | null {
  const present = days.filter((d): d is PlanDay => !!d);
  switch (PLAN_AGG[key]) {
    case "sum": {
      const xs = present.map((d) => dayValue(key, d)).filter(finite);
      return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
    }
    case "count":
      if (key === "strength") return present.some(hasPlanData) ? present.reduce((a, d) => a + d.strengthSessions, 0) : null;
      return present.some((d) => dayValue(key, d) !== null) ? present.filter(nightMet).length : null;
    case "average": {
      const last = days[days.length - 1];
      const done = (partialToday ? days.slice(0, -1) : days).map((d) => dayValue(key, d)).filter(finite);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      const before = mean(done);
      const today = partialToday ? dayValue(key, last) : null;
      if (today === null) return before;
      const withToday = mean([...done, today])!;
      return before === null || withToday > before ? withToday : before;
    }
    case "latest":
      return present.map((d) => dayValue(key, d)).filter(finite).at(-1) ?? null;
  }
}

/** Whether a day's own value meets its share of the target (the day bars' full colour). */
function dayMet(key: PlanKey, d: PlanDay | undefined, target: number): boolean {
  if (!d) return false;
  const v = dayValue(key, d);
  if (v === null) return false;
  if (key === "sleepNeed") return nightMet(d);
  if (key === "strength") return v > 0;
  if (PLAN_AGG[key] === "sum") return v >= target / 7;
  return v >= target;
}

/**
 * The status of a week in progress. Totals are on pace at `target × elapsed / 7`; counts (sessions, nights) at the
 * whole number below that, and missed once the days left can't make up the gap (one a day at most). Averages and the
 * latest reading are on pace while at the target.
 */
function statusOf(key: PlanKey, value: number | null, target: number, elapsed: number, daysLeft: number, over: boolean): { status: PlanStatus; expected: number | null } {
  const agg = PLAN_AGG[key];
  const met = value !== null && value >= target;
  const expected = agg === "sum" || agg === "count" ? (target * elapsed) / 7 : null;
  if (met) return { status: "done", expected };
  if (over) return { status: value === null ? "no_data" : "missed", expected };
  if (agg === "count" && target - (value ?? 0) > daysLeft) return { status: "missed", expected };
  if (expected !== null) {
    const pace = agg === "count" ? Math.floor(expected) : expected;
    if ((value ?? 0) >= pace) return { status: "on_pace", expected };
    return { status: value === null ? "no_data" : "behind", expected };
  }
  return { status: value === null ? "no_data" : "behind", expected };
}

/**
 * The plan for the week holding `day`, as of `day`, with HISTORY_WEEKS of week streaks. `rows` may hold any days;
 * `keys` are the switched-on targets, in order. `partialToday`: `day` is today and still running.
 */
export function weeklyPlan(rows: readonly PlanDay[], targets: PlanTargets, keys: readonly PlanKey[], day: string, partialToday: boolean, historyWeeks = HISTORY_WEEKS): WeekPlan {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const monday = mondayOf(day);
  const sunday = addDays(monday, 6);
  const sinceMonday = Math.round((Date.parse(day) - Date.parse(monday)) / DAY_MS);
  const elapsed = sinceMonday + (partialToday ? 0 : 1);
  // Days still to come, today included while it runs; one session or night a day at most.
  const daysLeft = 7 - elapsed;
  const over = day >= sunday && !partialToday;

  const span = (m: string, to: string) => {
    const out: (PlanDay | undefined)[] = [];
    for (let d = m; d <= to; d = addDays(d, 1)) out.push(byDay.get(d));
    return out;
  };
  const mondays = Array.from({ length: historyWeeks }, (_, k) => addDays(monday, -7 * (historyWeeks - 1 - k)));
  // Weeks before this one are whole; this one runs to `day`.
  const valueIn = (key: PlanKey, m: string) => (m === monday ? weekValue(key, span(m, day), partialToday) : weekValue(key, span(m, addDays(m, 6))));

  const histories = keys.map((key) =>
    mondays.map((m) => {
      const value = valueIn(key, m);
      return { monday: m, value, met: value !== null && value >= targets[key] };
    }),
  );

  const items: PlanItem[] = keys.map((key, i) => {
    const target = targets[key];
    const history = histories[i];
    const value = history[history.length - 1].value;
    // A day's night ends that morning: once today's is in (and counted in `value`), today can't add another, so one
    // night fewer is left than days.
    const nightIn = key === "sleepNeed" && partialToday && dayValue(key, byDay.get(day)) !== null;
    const { status, expected } = statusOf(key, value, target, elapsed, nightIn ? daysLeft - 1 : daysLeft, over);
    const days = Array.from({ length: 7 }, (_, k) => {
      const d = addDays(monday, k);
      const row = d <= day ? byDay.get(d) : undefined;
      return { day: d, value: dayValue(key, row), met: dayMet(key, row, target) };
    });
    return {
      key,
      value,
      target,
      progress: value === null || target <= 0 ? 0 : clamp01(value / target),
      done: status === "done",
      status,
      expected,
      days,
      weeks: history.slice(-HISTORY_SHOWN),
      streak: weekStreaks(
        history.map((h) => h.monday),
        history.map((h) => h.met),
        day,
      ),
    };
  });

  // A week counts toward the plan streak when every switched-on target was met in it.
  const allMet = mondays.map((_, w) => histories.length > 0 && histories.every((h) => h[w].met));
  return {
    monday,
    sunday,
    day,
    elapsed,
    items,
    onTrack: items.filter((i) => i.status === "done" || i.status === "on_pace").length,
    planStreak: weekStreaks(mondays, allMet, day),
  };
}
