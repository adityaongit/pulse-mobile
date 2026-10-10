import { deltaTone, type GoodDirection, type Tone } from "@/lib/bands";
import { FEATURES } from "@/lib/features";
import { formatDay, formatValue, type FormatKey } from "@/lib/format";
import {
  bandCounts,
  mean,
  monthSegments,
  periodLabel,
  periodWindow,
  relativeChange,
  verdict,
  weeklyTotals,
  type BreakdownBand,
  type MonthSegment,
  type TrendAgg,
  type TrendViewBar,
  type TrendViewRange,
} from "@/lib/trend";
import { addDays, localMinutes } from "../time";
import { activityKind, exercisesBetween, finite, firstDay, loadDays, meanSd, todayOf, toStrain, type DayRow, type ExerciseRow, type QueryCtx } from "./common";

// The Trend View `/trend/[key]` (spec §11 R29): one metric over a W / M / 6M window that steps back through time,
// against the window before it, with a verdict, a breakdown and an explainer.

export type TrendViewGroup = "recovery" | "sleep" | "strain" | "health";
export type TrendViewChart = "bars" | "line" | "stack" | "range" | "pair";

type Ctx = { strength: Map<string, { min: number; byType: Record<string, number> }>; tz: string; rows: Map<string, DayRow> };

type Def = {
  group: TrendViewGroup;
  /** The dropdown's name ("Heart Rate Variability"). */
  label: string;
  /** The Weekly Trends card's title when it differs ("Hours vs. Needed (hours)"). */
  card?: string;
  /** The verdict's name ("HRV"). */
  short: string;
  unit?: string;
  format: FormatKey;
  direction: GoodDirection;
  colorBy: "band" | "strain" | "sleep" | "single" | "stress";
  chart: TrendViewChart;
  agg: TrendAgg;
  pick: (r: DayRow, x: Ctx) => number | null | undefined;
  /** `stack`: the day's parts by series key; `range`: bed and wake as minutes from midnight (bed negative before it);
   * `pair`: the two lines' values. */
  parts?: (r: DayRow, x: Ctx) => Record<string, number> | null;
  /** Series keys bottom first, for `stack` charts and part breakdowns. */
  series?: readonly { key: string; label: string }[];
  /** Day counts by band: highest band first. Values are compared after rounding to `round` decimals. */
  bands?: { title: string; round?: number; list: readonly (BreakdownBand & { detail: string })[] };
  /** Part totals ("HR Zones Breakdown"): sums each series, or the strength minutes by activity type. */
  partBreakdown?: "series" | "strength";
  /** Shades the personal typical range (mean ± 1 σ over the 60 days to the window's end). */
  typical?: boolean;
  /** Accrues through the day: today's value is drawn but left out of the average. */
  partialToday?: boolean;
  /** Fixed axis floor and ceiling. */
  domain?: [number, number];
  footnote?: string;
  /** Buttons under the chart: "Add activity" (zones, strength) and the goal button's label (behind `FEATURES.goals`). */
  actions?: { addActivity?: boolean; goal?: string };
  flag?: keyof typeof FEATURES;
  about: { title: string; body: readonly string[] };
};

const SLEEP_BANDS = (title: string, optimal: number, sufficient: number) => ({
  title,
  list: [
    { key: "optimal", label: "Optimal", min: optimal, detail: `${optimal}%+` },
    { key: "sufficient", label: "Sufficient", min: sufficient, detail: `${sufficient}-${optimal - 1}%` },
    { key: "poor", label: "Poor", min: -Infinity, detail: `<${sufficient}%` },
  ],
});

const zoneMin = (r: DayRow, i: number) => (r.s1 && r.s1.hrCount > 0 ? r.s1.zoneSeconds[i] / 60 : null);
const zoneParts = (from: number, to: number) => (r: DayRow) => {
  if (!r.s1 || r.s1.hrCount === 0) return null;
  return Object.fromEntries(Array.from({ length: to - from }, (_, k) => [`z${from + k + 1}`, r.s1!.zoneSeconds[from + k] / 60]));
};
export const zoneSum = (from: number, to: number) => (r: DayRow) => {
  const xs = Array.from({ length: to - from }, (_, k) => zoneMin(r, from + k));
  return xs.every(finite) ? xs.reduce((a, b) => a + b, 0) : null;
};
const zoneSeries = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => ({ key: `z${from + k + 1}`, label: `Zone ${from + k + 1}` }));
export const worn = (r: DayRow) => (r.s1?.hrCount ?? 0) > 0;
/** The night's need: the plan made the evening before, else the baseline need (as the Sleep page reads it). */
const needMin = (r: DayRow, x: Ctx) => {
  if (!r.sleep) return null;
  const plan = x.rows.get(addDays(r.day, -1))?.sleepPlanner;
  return plan && plan.reason === null ? plan.needMin : r.sleep.needHours * 60;
};

export const TREND_VIEW = {
  recovery: {
    group: "recovery", label: "Recovery", short: "Recovery", unit: "%", format: "int", direction: "up", colorBy: "band", chart: "bars", agg: "daily",
    pick: (r) => r.recovery?.value, domain: [0, 100],
    bands: { title: "Recovery breakdown (days)", list: [
      { key: "green", label: "Green", min: 67, detail: "67%+" },
      { key: "yellow", label: "Yellow", min: 34, detail: "34-66%" },
      { key: "red", label: "Red", min: -Infinity, detail: "<34%" },
    ] },
    about: { title: "What is Recovery?", body: [
      "Recovery is how ready your body is to take on strain today, on a scale from 0 to 100%.",
      "Pulse scores it each morning from your heart rate variability, resting heart rate, respiratory rate, sleep performance and skin temperature, each compared with your own recent baseline.",
      "Green (67% and up) means you are primed for a hard day, yellow means maintain, and red means your body is asking for rest.",
    ] },
  },
  hrv: {
    group: "recovery", label: "Heart Rate Variability", short: "HRV", unit: "ms", format: "int", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.metrics?.hrvMs, typical: true,
    about: { title: "What is Heart Rate Variability?", body: [
      "Heart rate variability (HRV) is the variation in time between your heartbeats, measured in milliseconds while you sleep.",
      "A higher HRV usually means your nervous system is relaxed and ready for stress; a lower one often follows hard training, poor sleep, alcohol or illness.",
      "HRV differs a lot from person to person, so compare it only with your own typical range, not with anyone else's.",
    ] },
  },
  rhr: {
    group: "recovery", label: "Resting Heart Rate", short: "RHR", unit: "bpm", format: "int", direction: "down", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.metrics?.rhrBpm ?? r.sessionRhr, typical: true,
    about: { title: "What is Resting Heart Rate?", body: [
      "Resting heart rate (RHR) is how many times your heart beats per minute while you are fully at rest, measured during sleep.",
      "A lower RHR generally reflects better fitness and recovery. A rise of a few beats above your typical range can point to fatigue, stress, heat, alcohol or the start of an illness.",
    ] },
  },
  resp: {
    group: "recovery", label: "Respiratory Rate", short: "respiratory rate", unit: "rpm", format: "decimal1", direction: "down", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.metrics?.respBpm, typical: true,
    about: { title: "What is Respiratory Rate?", body: [
      "Respiratory rate is how many breaths you take per minute while you sleep.",
      "It is one of the most stable vitals: night to night it rarely moves much. A clear rise above your typical range is worth noticing, since it often comes with illness or a heavy load on the body.",
    ] },
  },
  sleep: {
    group: "sleep", label: "Sleep Performance", short: "Sleep Performance", unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r) => r.sleep?.performance, domain: [0, 100], bands: SLEEP_BANDS("Sleep performance breakdown (days)", 85, 70),
    about: { title: "What is Sleep Performance?", body: [
      "Sleep Performance compares the sleep you got with the sleep your body needed, adjusted for how consistent and efficient that sleep was.",
      "Your need rises with yesterday's strain and any sleep debt you carry, so the same hours can score differently on different nights.",
    ] },
  },
  hours: {
    group: "sleep", label: "Hours of Sleep", card: "Hours vs. Needed (hours)", short: "hours of sleep", format: "duration", direction: "up", colorBy: "sleep", chart: "pair", agg: "daily",
    pick: (r) => r.sleep?.main?.asleepMin,
    parts: (r, x) => {
      const need = needMin(r, x);
      return r.sleep?.main && need !== null ? { asleep: r.sleep.main.asleepMin, need } : null;
    },
    series: [{ key: "asleep", label: "Hours of sleep" }, { key: "need", label: "Sleep needed" }],
    about: { title: "What is Hours of Sleep?", body: [
      "Hours of sleep is the time you actually spent asleep in your main sleep, not counting time awake in bed.",
      "Most adults need between seven and nine hours, and your own need changes with strain and sleep debt.",
    ] },
  },
  hours_need: {
    group: "sleep", label: "Hours vs. Needed", card: "Hours vs. Needed (%)", short: "hours vs. needed", unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r, x) => {
      const need = needMin(r, x);
      return r.sleep?.main && need ? (r.sleep.main.asleepMin / need) * 100 : null;
    },
    domain: [0, 100], bands: SLEEP_BANDS("Hours vs. needed breakdown (days)", 85, 70),
    about: { title: "What is Hours vs. Needed?", body: [
      "Hours vs. needed is the sleep you got as a share of the sleep your body needed that night.",
      "Your need is a baseline plus extra for yesterday's strain and any sleep debt, so a hard day raises it.",
    ] },
  },
  restorative: {
    group: "sleep", label: "Restorative Sleep", short: "restorative sleep", format: "duration", direction: "up", colorBy: "sleep", chart: "stack", agg: "daily",
    pick: (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null),
    parts: (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? { deep: r.sleep.main.deepMin, rem: r.sleep.main.remMin } : null),
    series: [{ key: "rem", label: "REM" }, { key: "deep", label: "SWS (Deep)" }],
    about: { title: "What is Restorative Sleep?", body: [
      "Restorative sleep is the time you spend in deep (slow-wave) sleep and REM sleep, the two stages where most physical and mental repair happens.",
      "Deep sleep comes mostly early in the night and REM mostly late, so a short night cuts REM first.",
    ] },
  },
  consistency: {
    group: "sleep", label: "Sleep Consistency", short: "Sleep Consistency", unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r) => r.sleep?.consistency, domain: [0, 100], bands: SLEEP_BANDS("Sleep consistency breakdown (days)", 80, 70),
    about: { title: "What is Sleep Consistency?", body: [
      "Sleep consistency measures how closely your sleep and wake times match from one day to the next.",
      "Going to bed and waking at similar times keeps your body clock steady, which makes the same hours of sleep more restful.",
    ] },
  },
  efficiency: {
    group: "sleep", label: "Sleep Efficiency", short: "Sleep Efficiency", unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "line", agg: "daily",
    pick: (r) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null), bands: SLEEP_BANDS("Sleep efficiency breakdown (days)", 90, 80),
    about: { title: "What is Sleep Efficiency?", body: [
      "Sleep efficiency is the share of your time in bed that you actually spent asleep: hours of sleep divided by time in bed.",
      "Above 85% is generally considered good. Long spells awake, many wake-ups or a lot of time in bed before falling asleep all lower it.",
      "Better efficiency means more of the night goes to sleep stages that restore you, which also lifts your Sleep Performance.",
    ] },
  },
  time_in_bed: {
    group: "sleep", label: "Time in Bed", short: "time in bed", format: "duration", direction: "neutral", colorBy: "sleep", chart: "range", agg: "daily",
    pick: (r) => r.sleep?.main?.inBedMin,
    parts: (r, x) => {
      const m = r.sleep?.main;
      if (!m) return null;
      const bed = localMinutes(m.start, x.tz);
      return { bed: bed > 720 ? bed - 1440 : bed, wake: localMinutes(m.end, x.tz) };
    },
    about: { title: "What is Time in Bed?", body: [
      "Time in bed runs from when your main sleep started to when it ended, including any time awake.",
      "Each bar spans your bedtime to your wake time, so a steady row of bars means a steady schedule.",
    ] },
  },
  sleep_stress: {
    group: "sleep", label: "Sleep Stress", short: "time in high stress", format: "duration", direction: "down", colorBy: "stress", chart: "stack", agg: "daily",
    pick: () => null, flag: "sleepStress",
    series: [{ key: "low", label: "Low" }, { key: "medium", label: "Medium" }, { key: "high", label: "High" }],
    about: { title: "What is Sleep Stress?", body: [
      "Sleep stress is how much of the night your heart rate and heart rate variability showed a stress response instead of rest.",
    ] },
  },
  strain: {
    group: "strain", label: "Day Strain", card: "Strain", short: "Day Strain", format: "decimal1", direction: "neutral", colorBy: "strain", chart: "bars", agg: "daily",
    pick: (r) => (finite(r.s1?.effort) ? toStrain(r.s1.effort) : null), partialToday: true, domain: [0, 21],
    bands: { title: "Strain breakdown (days)", round: 1, list: [
      { key: "all_out", label: "All Out", min: 18.1, detail: ">18.0" },
      { key: "strenuous", label: "Strenuous", min: 14.1, detail: "14.1-18.0" },
      { key: "moderate", label: "Moderate", min: 10.1, detail: "10.1-14.0" },
      { key: "light", label: "Light", min: -Infinity, detail: "<10.0" },
    ] },
    about: { title: "What is Day Strain?", body: [
      "Day Strain measures the load on your heart and body across the whole day, on a scale from 0 to 21.",
      "It builds from the time you spend in higher heart-rate zones, so the climb gets steeper the harder you go.",
    ] },
  },
  zones13: {
    group: "strain", label: "Heart Rate Zones 1-3", card: "HR Zones 1-3", short: "time in HR zones 1-3", format: "duration", direction: "up", colorBy: "single", chart: "stack", agg: "weekly",
    pick: zoneSum(0, 3), parts: zoneParts(0, 3), series: zoneSeries(0, 3), partBreakdown: "series", partialToday: true,
    footnote: "Zone time is derived from your heart rate through the day.",
    actions: { addActivity: true, goal: "Set a HR zones goal in Weekly Plan" },
    about: { title: "What are Heart Rate Zones 1-3?", body: [
      "Zones 1 to 3 cover light to moderate effort, 50 to 80% of your heart-rate reserve: brisk walks, easy runs, steady rides.",
      "Time here builds your aerobic base and helps recovery without adding much fatigue.",
    ] },
  },
  zones45: {
    group: "strain", label: "Heart Rate Zones 4-5", card: "HR Zones 4-5", short: "time in HR zones 4-5", format: "duration", direction: "up", colorBy: "single", chart: "stack", agg: "weekly",
    pick: zoneSum(3, 5), parts: zoneParts(3, 5), series: zoneSeries(3, 5), partBreakdown: "series", partialToday: true,
    footnote: "Zone time is derived from your heart rate through the day.",
    actions: { addActivity: true, goal: "Update your HR zones 4-5 goal" },
    about: { title: "What are Heart Rate Zones 4-5?", body: [
      "Zones 4 and 5 are hard effort, above 80% of your heart-rate reserve: intervals, races and the end of a hard climb.",
      "A little time here each week raises your fitness ceiling; too much without rest adds strain faster than you recover.",
    ] },
  },
  strength: {
    group: "strain", label: "Strength Activity Time", short: "strength activity time", format: "duration", direction: "up", colorBy: "single", chart: "bars", agg: "weekly",
    pick: (r, x) => (worn(r) || x.strength.has(r.day) ? (x.strength.get(r.day)?.min ?? 0) : null), partBreakdown: "strength", partialToday: true,
    footnote: "Strength activity time is derived from your logged strength workouts.",
    actions: { addActivity: true, goal: "Set a goal in Weekly Plan" },
    about: { title: "What is Strength Activity Time?", body: [
      "Strength activity time is the time you spent in resistance training: weights, bodyweight work, CrossFit and similar sessions.",
      "Regular strength work builds muscle and bone and supports healthy ageing. Most guidelines suggest at least two sessions a week.",
    ] },
  },
  steps: {
    group: "strain", label: "Steps", short: "steps", format: "grouped", direction: "up", colorBy: "single", chart: "bars", agg: "daily",
    pick: (r) => r.metrics?.steps, partialToday: true,
    actions: { goal: "Update your daily step goal" },
    about: { title: "What are Steps?", body: [
      "Steps are counted by your Fitbit through the day. They are a simple measure of how much you move outside workouts.",
    ] },
  },
  calories: {
    group: "strain", label: "Calories", short: "calories", unit: "kcal", format: "grouped", direction: "neutral", colorBy: "single", chart: "bars", agg: "daily",
    pick: (r) => r.metrics?.calories, partialToday: true,
    about: { title: "What are Calories?", body: [
      "Calories are everything you burned in the day: your resting burn plus movement and workouts.",
    ] },
  },
  vo2max: {
    group: "health", label: "VO2 Max", short: "VO2 max", unit: "ml/kg/min", format: "decimal1", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => (r.fitness?.reason === null ? r.fitness.vo2max : null), typical: true,
    about: { title: "What is VO2 Max?", body: [
      "VO2 max is the most oxygen your body can use during hard exercise, in millilitres per kilogram of body weight per minute. Fitbit estimates it from your runs, or from your resting heart rate when you don't run.",
      "It is one of the strongest signs of long-term health: higher fitness goes with a longer life. Steady aerobic training raises it over weeks and months.",
    ] },
  },
  lean_mass: {
    group: "health", label: "Lean Body Mass", short: "lean body mass", unit: "kg", format: "decimal1", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => (r.metrics?.weightKg != null && r.metrics.bodyFatPct != null ? r.metrics.weightKg * (1 - r.metrics.bodyFatPct / 100) : null),
    about: { title: "What is Lean Body Mass?", body: [
      "Lean body mass is your weight minus your body fat: muscle, bone, organs and water. Pulse works it out from the weight and body fat your scale or the Fitbit app records.",
      "More lean mass for your height is linked to a longer life, whatever your body fat. Strength training and enough protein build it.",
    ] },
  },
} as const satisfies Record<string, Def>;

export type TrendViewKey = keyof typeof TREND_VIEW;
export const isTrendViewKey = (k: string): k is TrendViewKey => k in TREND_VIEW && !flagOff(k as TrendViewKey);
const def = (k: TrendViewKey): Def => TREND_VIEW[k];
const flagOff = (k: TrendViewKey) => {
  const f = def(k).flag;
  return f !== undefined && !FEATURES[f];
};

export type TrendViewVM = {
  key: TrendViewKey;
  label: string;
  /** The Weekly Trends card's title. */
  card: string;
  unit?: string;
  format: FormatKey;
  direction: GoodDirection;
  colorBy: Def["colorBy"];
  chart: TrendViewChart;
  agg: TrendAgg;
  series?: readonly { key: string; label: string }[];
  domain?: [number, number];
  /** The dropdown: the other metrics of the same screen. */
  options: { key: TrendViewKey; label: string }[];
  range: TrendViewRange;
  offset: number;
  from: string;
  to: string;
  period: string;
  /** Older data exists before `from`. */
  canPrev: boolean;
  /** "Average", "Weekly total", "Avg. weekly total". */
  caption: string;
  value: number | null;
  prior: number | null;
  /** Whole-percent change against the prior window. */
  change: number | null;
  tone: Tone;
  verdict: string;
  /** W and M: one bar per day (per week for weekly totals in M); 6M: the days (weeks) behind the month segments. */
  bars: TrendViewBar[];
  segments: MonthSegment[] | null;
  typical: [number, number] | null;
  breakdown: { title: string; unit: "days" | "duration"; items: { key: string; label: string; detail?: string; value: number }[] } | null;
  footnote: string | null;
  actions: NonNullable<Def["actions"]>;
  about: Def["about"];
};

const wholeMonths = (segs: MonthSegment[]) => {
  const out = segs[0] && !segs[0].from.endsWith("-01") ? segs.slice(1) : segs;
  return out.map((s, i) => (i === 0 ? { ...s, change: null } : s));
};

const PRIOR_WORD: Record<TrendViewRange, string> = { w: "week", m: "month", "6m": "6 months" };
export const priorLabel = (r: TrendViewRange) => `vs. prior ${PRIOR_WORD[r]}`;

const typeName = (e: ExerciseRow) => e.name ?? e.type.toLowerCase().replace(/(^|_)(\w)/g, (_, s: string, c: string) => `${s ? " " : ""}${c.toUpperCase()}`);

export async function getTrendView(key: TrendViewKey, end: string, range: TrendViewRange, offset: number, ctx: QueryCtx): Promise<TrendViewVM> {
  const m = def(key);
  const today = todayOf(ctx);
  const win = periodWindow(end, range, offset, m.agg);
  const prior = periodWindow(end, range, offset + 1, m.agg);
  // The typical range looks back 60 days from the window's end, so it may reach before the prior window.
  const loadFrom = m.typical ? (addDays(win.to, -59) < prior.from ? addDays(win.to, -59) : prior.from) : prior.from;
  const [rows, first, exs] = await Promise.all([
    loadDays(ctx, addDays(loadFrom, -1), win.to),
    firstDay(ctx),
    m.partBreakdown === "strength" ? exercisesBetween(ctx, prior.from, win.to) : Promise.resolve([] as ExerciseRow[]),
  ]);
  const strength: Ctx["strength"] = new Map();
  for (const e of exs) {
    if (activityKind(e.type) !== "strength") continue;
    const s = strength.get(e.day) ?? { min: 0, byType: {} };
    const min = (e.endTs - e.startTs) / 60;
    s.min += min;
    s.byType[typeName(e)] = (s.byType[typeName(e)] ?? 0) + min;
    strength.set(e.day, s);
  }
  const x: Ctx = { strength, tz: ctx.timeZone, rows };

  const day = (d: string) => {
    const r = rows.get(d);
    const v = r ? m.pick(r, x) : null;
    return {
      day: d,
      value: finite(v) ? v : null,
      ...(m.partialToday && d === today && { provisional: true }),
      ...(m.parts && { parts: r && finite(v) ? m.parts(r, x) : null }),
    };
  };
  const span = (from: string, to: string) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(day(d));
    return out;
  };
  const cur = span(win.from, win.to);
  const old = span(prior.from, prior.to);
  // Today's running total is drawn, not averaged.
  const settled = (ps: typeof cur) => (m.agg === "weekly" ? ps : ps.map((p) => (p.provisional ? { ...p, value: null } : p)));

  const headline = (ps: typeof cur) => (m.agg === "weekly" ? mean(weeklyTotals(ps).map((w) => w.value)) : mean(ps.map((p) => p.value)));
  const value = headline(settled(cur));
  const priorValue = headline(old);
  const change = relativeChange(value, priorValue);
  const tone: Tone = value === null || priorValue === null || change === 0 ? "neutral" : deltaTone(m.direction, value, priorValue).tone;

  const typicalStats = m.typical ? meanSd(span(addDays(win.to, -59), win.to).map((p) => p.value)) : null;
  const typical: [number, number] | null =
    typicalStats?.mean != null && typicalStats.sd !== undefined ? [typicalStats.mean - typicalStats.sd, typicalStats.mean + typicalStats.sd] : null;

  const fmt = (v: number) => `${formatValue(m.format, v)}${m.unit === "%" ? "%" : ""}`;
  const weeklyBars = m.agg === "weekly" && range !== "w";
  // A bed-to-wake bar carries two clock labels, which only fit a few dozen bars: M draws one per whole week, 6M one per whole month.
  const rangeBars = m.chart === "range" && range !== "w";
  const bars: TrendViewBar[] = weeklyBars
    ? weeklyTotals(cur).map((w, i, all) => {
        const days = cur.filter((p) => p.day >= w.from && p.day <= w.to);
        const parts = m.series && days.some((p) => p.parts) ? Object.fromEntries(m.series.map((s) => [s.key, days.reduce((a, p) => a + (p.parts?.[s.key] ?? 0), 0)])) : undefined;
        return { from: w.from, to: w.to, value: w.value, ...(i === all.length - 1 && days.some((p) => p.provisional) && { provisional: true }), ...(parts && { parts }) };
      })
    : rangeBars
      ? (range === "m" ? weeklyTotals(cur).filter((w) => addDays(w.from, 6) === w.to) : wholeMonths(monthSegments(cur))).map(({ from, to }) => {
          const days = cur.flatMap((p) => (p.day >= from && p.day <= to && "parts" in p && p.parts ? [{ value: p.value, bed: p.parts.bed, wake: p.parts.wake }] : []));
          return { from, to, value: mean(days.map((d) => d.value)), parts: days.length ? { bed: mean(days.map((d) => d.bed))!, wake: mean(days.map((d) => d.wake))! } : null };
        })
    : cur.map((p) => ({ from: p.day, to: p.day, value: p.value, ...(p.provisional && { provisional: true }), ...("parts" in p && { parts: p.parts }) }));

  const b = m.bands;
  const k = 10 ** (b?.round ?? 0);
  const values = settled(cur).map((p) => (p.value === null ? null : b?.round !== undefined ? Math.round(p.value * k) / k : p.value));
  const weeks = Math.max(1, weeklyTotals(cur).length);
  const perWeek = (total: number) => (range === "w" ? total : total / weeks);
  const breakdown: TrendViewVM["breakdown"] = b
    ? { title: b.title, unit: "days", items: bandCounts(values, b.list).map((c) => ({ key: c.key, label: c.label, detail: c.detail, value: c.count })) }
    : m.partBreakdown === "series" && m.series
      ? {
          title: `HR zones breakdown (${range === "w" ? "weekly total" : "avg. weekly total"})`,
          unit: "duration",
          items: [...m.series].reverse().map((s) => ({ key: s.key, label: s.label, value: perWeek(settled(cur).reduce((a, p) => a + (p.parts?.[s.key] ?? 0), 0)) })),
        }
      : m.partBreakdown === "strength"
        ? {
            title: `Strength activity breakdown (${range === "w" ? "weekly total" : "avg. weekly total"})`,
            unit: "duration",
            items: Object.entries(
              cur.reduce<Record<string, number>>((acc, p) => {
                for (const [t, v] of Object.entries(strength.get(p.day)?.byType ?? {})) acc[t] = (acc[t] ?? 0) + v;
                return acc;
              }, {}),
            )
              .sort((a, c) => c[1] - a[1])
              .map(([t, v]) => ({ key: t, label: t, value: perWeek(v) })),
          }
        : null;

  const todayNote = m.partialToday && m.agg === "daily" && win.to >= today && win.from <= today ? `Average does not include today (${formatDay(today, { month: "short", day: "numeric" })}).` : null;

  return {
    key,
    label: m.label,
    card: m.card ?? m.label,
    ...(m.unit && { unit: m.unit }),
    format: m.format,
    direction: m.direction,
    colorBy: m.colorBy,
    chart: m.chart,
    agg: m.agg,
    ...(m.series && { series: m.series }),
    ...(m.domain && { domain: m.domain }),
    options: (Object.keys(TREND_VIEW) as TrendViewKey[]).filter((o) => def(o).group === m.group && !flagOff(o)).map((o) => ({ key: o, label: def(o).label })),
    range,
    offset,
    from: win.from,
    to: win.to,
    period: periodLabel(win.from, win.to),
    canPrev: first !== null && first < win.from,
    caption: m.agg === "weekly" ? (range === "w" ? "Weekly total" : "Avg. weekly total") : "Average",
    value,
    prior: priorValue,
    change,
    tone,
    verdict: verdict({ label: m.short, range, agg: m.agg, now: value, prior: priorValue, fmt, typical }),
    bars,
    segments: range === "6m" && !rangeBars ? wholeMonths(monthSegments(settled(cur), m.agg)) : null,
    typical,
    breakdown,
    footnote: [m.footnote, todayNote].filter(Boolean).join(" ") || null,
    actions: m.actions ?? {},
    about: m.about,
  };
}

/** Weekly Trends (spec §11 R32): each metric's 7 days ending on `day`, the same view model as its Trend View's W. */
export const getWeeklyTrends = (keys: readonly TrendViewKey[], day: string, ctx: QueryCtx) =>
  Promise.all(keys.filter((k) => !flagOff(k)).map((k) => getTrendView(k, day, "w", 0, ctx)));
