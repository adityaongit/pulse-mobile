import { i18n } from "@/i18n/config";
import { deltaTone, type GoodDirection, type Tone } from "@/lib/bands";
import { inUnits } from "@/lib/units";
import { FEATURES } from "@/lib/features";
import { formatDay, formatValue, type FormatKey } from "@/lib/format";
import {
  bandCounts,
  mean,
  monthSegments,
  wholeMonths,
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
import { addDays, localMinutes } from "@/lib/time";
import { activityKind, exercisesBetween, finite, firstDay, loadDays, meanSd, todayOf, dayStrainOf, type DayRow, type ExerciseRow, type QueryCtx, vo2Of } from "./common";

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

const SLEEP_BANDS = (key: "sleep" | "hours_need" | "consistency" | "efficiency", optimal: number, sufficient: number) => ({
  title: i18n.t(`trends:bandsTitle.${key}`),
  list: [
    { key: "optimal", label: i18n.t("trends:bandLabel.optimal"), min: optimal, detail: `${optimal}%+` },
    { key: "sufficient", label: i18n.t("trends:bandLabel.sufficient"), min: sufficient, detail: `${sufficient}-${optimal - 1}%` },
    { key: "poor", label: i18n.t("trends:bandLabel.poor"), min: -Infinity, detail: `<${sufficient}%` },
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
    group: "recovery", get label() { return i18n.t("trends:viewLabel.recovery"); }, get short() { return i18n.t("trends:viewShort.recovery"); }, unit: "%", format: "int", direction: "up", colorBy: "band", chart: "bars", agg: "daily",
    pick: (r) => r.recovery?.value, domain: [0, 100],
    get bands() { return { title: i18n.t("trends:bandsTitle.recovery"), list: [
      { key: "green", label: i18n.t("trends:bandLabel.green"), min: 67, detail: "67%+" },
      { key: "yellow", label: i18n.t("trends:bandLabel.yellow"), min: 34, detail: "34-66%" },
      { key: "red", label: i18n.t("trends:bandLabel.red"), min: -Infinity, detail: "<34%" },
    ] }; },
    get about() { return { title: i18n.t("trends:aboutTitle.recovery"), body: [
      i18n.t("trends:aboutBody.recovery1"),
      i18n.t("trends:aboutBody.recovery2"),
      i18n.t("trends:aboutBody.recovery3"),
    ] }; },
  },
  hrv: {
    group: "recovery", get label() { return i18n.t("trends:viewLabel.hrv"); }, get short() { return i18n.t("trends:viewShort.hrv"); }, unit: "ms", format: "int", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.metrics?.hrvMs, typical: true,
    get about() { return { title: i18n.t("trends:aboutTitle.hrv"), body: [
      i18n.t("trends:aboutBody.hrv1"),
      i18n.t("trends:aboutBody.hrv2"),
      i18n.t("trends:aboutBody.hrv3"),
    ] }; },
  },
  rhr: {
    group: "recovery", get label() { return i18n.t("trends:viewLabel.rhr"); }, get short() { return i18n.t("trends:viewShort.rhr"); }, unit: "bpm", format: "int", direction: "down", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.rhr, typical: true,
    get about() { return { title: i18n.t("trends:aboutTitle.rhr"), body: [
      i18n.t("trends:aboutBody.rhr1"),
      i18n.t("trends:aboutBody.rhr2"),
    ] }; },
  },
  resp: {
    group: "recovery", get label() { return i18n.t("trends:viewLabel.resp"); }, get short() { return i18n.t("trends:viewShort.resp"); }, unit: "rpm", format: "decimal1", direction: "down", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => r.metrics?.respBpm, typical: true,
    get about() { return { title: i18n.t("trends:aboutTitle.resp"), body: [
      i18n.t("trends:aboutBody.resp1"),
      i18n.t("trends:aboutBody.resp2"),
    ] }; },
  },
  sleep: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.sleep"); }, get short() { return i18n.t("trends:viewShort.sleep"); }, unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r) => r.sleep?.performance, domain: [0, 100], get bands() { return SLEEP_BANDS("sleep", 85, 70); },
    get about() { return { title: i18n.t("trends:aboutTitle.sleep"), body: [
      i18n.t("trends:aboutBody.sleep1"),
      i18n.t("trends:aboutBody.sleep2"),
    ] }; },
  },
  hours: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.hours"); }, get card() { return i18n.t("trends:viewCard.hours"); }, get short() { return i18n.t("trends:viewShort.hours"); }, format: "duration", direction: "up", colorBy: "sleep", chart: "pair", agg: "daily",
    pick: (r) => r.sleep?.main?.asleepMin,
    parts: (r, x) => {
      const need = needMin(r, x);
      return r.sleep?.main && need !== null ? { asleep: r.sleep.main.asleepMin, need } : null;
    },
    get series() { return [{ key: "asleep", label: i18n.t("trends:seriesLabel.asleep") }, { key: "need", label: i18n.t("trends:seriesLabel.need") }]; },
    get about() { return { title: i18n.t("trends:aboutTitle.hours"), body: [
      i18n.t("trends:aboutBody.hours1"),
      i18n.t("trends:aboutBody.hours2"),
    ] }; },
  },
  hours_need: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.hours_need"); }, get card() { return i18n.t("trends:viewCard.hours_need"); }, get short() { return i18n.t("trends:viewShort.hours_need"); }, unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r, x) => {
      const need = needMin(r, x);
      return r.sleep?.main && need ? (r.sleep.main.asleepMin / need) * 100 : null;
    },
    domain: [0, 100], get bands() { return SLEEP_BANDS("hours_need", 85, 70); },
    get about() { return { title: i18n.t("trends:aboutTitle.hours_need"), body: [
      i18n.t("trends:aboutBody.hours_need1"),
      i18n.t("trends:aboutBody.hours_need2"),
    ] }; },
  },
  restorative: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.restorative"); }, get short() { return i18n.t("trends:viewShort.restorative"); }, format: "duration", direction: "up", colorBy: "sleep", chart: "stack", agg: "daily",
    pick: (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null),
    parts: (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? { deep: r.sleep.main.deepMin, rem: r.sleep.main.remMin } : null),
    get series() { return [{ key: "rem", label: i18n.t("trends:seriesLabel.rem") }, { key: "deep", label: i18n.t("trends:seriesLabel.deep") }]; },
    get about() { return { title: i18n.t("trends:aboutTitle.restorative"), body: [
      i18n.t("trends:aboutBody.restorative1"),
      i18n.t("trends:aboutBody.restorative2"),
    ] }; },
  },
  consistency: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.consistency"); }, get short() { return i18n.t("trends:viewShort.consistency"); }, unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "bars", agg: "daily",
    pick: (r) => r.sleep?.consistency, domain: [0, 100], get bands() { return SLEEP_BANDS("consistency", 80, 70); },
    get about() { return { title: i18n.t("trends:aboutTitle.consistency"), body: [
      i18n.t("trends:aboutBody.consistency1"),
      i18n.t("trends:aboutBody.consistency2"),
    ] }; },
  },
  efficiency: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.efficiency"); }, get short() { return i18n.t("trends:viewShort.efficiency"); }, unit: "%", format: "int", direction: "up", colorBy: "sleep", chart: "line", agg: "daily",
    pick: (r) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null), get bands() { return SLEEP_BANDS("efficiency", 90, 80); },
    get about() { return { title: i18n.t("trends:aboutTitle.efficiency"), body: [
      i18n.t("trends:aboutBody.efficiency1"),
      i18n.t("trends:aboutBody.efficiency2"),
      i18n.t("trends:aboutBody.efficiency3"),
    ] }; },
  },
  time_in_bed: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.time_in_bed"); }, get short() { return i18n.t("trends:viewShort.time_in_bed"); }, format: "duration", direction: "neutral", colorBy: "sleep", chart: "range", agg: "daily",
    pick: (r) => r.sleep?.main?.inBedMin,
    parts: (r, x) => {
      const m = r.sleep?.main;
      if (!m) return null;
      const bed = localMinutes(m.start, x.tz);
      return { bed: bed > 720 ? bed - 1440 : bed, wake: localMinutes(m.end, x.tz) };
    },
    get about() { return { title: i18n.t("trends:aboutTitle.time_in_bed"), body: [
      i18n.t("trends:aboutBody.time_in_bed1"),
      i18n.t("trends:aboutBody.time_in_bed2"),
    ] }; },
  },
  sleep_stress: {
    group: "sleep", get label() { return i18n.t("trends:viewLabel.sleep_stress"); }, get short() { return i18n.t("trends:viewShort.sleep_stress"); }, format: "duration", direction: "down", colorBy: "stress", chart: "stack", agg: "daily",
    pick: () => null, flag: "sleepStress",
    get series() { return [{ key: "low", label: i18n.t("trends:seriesLabel.low") }, { key: "medium", label: i18n.t("trends:seriesLabel.medium") }, { key: "high", label: i18n.t("trends:seriesLabel.high") }]; },
    get about() { return { title: i18n.t("trends:aboutTitle.sleep_stress"), body: [
      i18n.t("trends:aboutBody.sleep_stress1"),
    ] }; },
  },
  strain: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.strain"); }, get card() { return i18n.t("trends:viewCard.strain"); }, get short() { return i18n.t("trends:viewShort.strain"); }, unit: "%", format: "int", direction: "neutral", colorBy: "strain", chart: "bars", agg: "daily",
    pick: (r) => dayStrainOf(r.s1), partialToday: true, domain: [0, 100],
    get bands() { return { title: i18n.t("trends:bandsTitle.strain"), round: 0, list: [
      { key: "all_out", label: i18n.t("trends:bandLabel.allOut"), min: 80, detail: ">79%" },
      { key: "strenuous", label: i18n.t("trends:bandLabel.strenuous"), min: 61, detail: "61-79%" },
      { key: "moderate", label: i18n.t("trends:bandLabel.moderate"), min: 41, detail: "41-60%" },
      { key: "light", label: i18n.t("trends:bandLabel.light"), min: -Infinity, detail: "≤40%" },
    ] }; },
    get about() { return { title: i18n.t("trends:aboutTitle.strain"), body: [
      i18n.t("trends:aboutBody.strain1"),
      i18n.t("trends:aboutBody.strain2"),
    ] }; },
  },
  zones13: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.zones13"); }, get card() { return i18n.t("trends:viewCard.zones13"); }, get short() { return i18n.t("trends:viewShort.zones13"); }, format: "duration", direction: "up", colorBy: "single", chart: "stack", agg: "weekly",
    pick: zoneSum(0, 3), parts: zoneParts(0, 3), series: zoneSeries(0, 3), partBreakdown: "series", partialToday: true,
    get footnote() { return i18n.t("trends:viewFootnote.zones13"); },
    get actions() { return { addActivity: true, goal: i18n.t("trends:viewGoal.zones13") }; },
    get about() { return { title: i18n.t("trends:aboutTitle.zones13"), body: [
      i18n.t("trends:aboutBody.zones131"),
      i18n.t("trends:aboutBody.zones132"),
    ] }; },
  },
  zones45: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.zones45"); }, get card() { return i18n.t("trends:viewCard.zones45"); }, get short() { return i18n.t("trends:viewShort.zones45"); }, format: "duration", direction: "up", colorBy: "single", chart: "stack", agg: "weekly",
    pick: zoneSum(3, 5), parts: zoneParts(3, 5), series: zoneSeries(3, 5), partBreakdown: "series", partialToday: true,
    get footnote() { return i18n.t("trends:viewFootnote.zones45"); },
    get actions() { return { addActivity: true, goal: i18n.t("trends:viewGoal.zones45") }; },
    get about() { return { title: i18n.t("trends:aboutTitle.zones45"), body: [
      i18n.t("trends:aboutBody.zones451"),
      i18n.t("trends:aboutBody.zones452"),
    ] }; },
  },
  strength: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.strength"); }, get short() { return i18n.t("trends:viewShort.strength"); }, format: "duration", direction: "up", colorBy: "single", chart: "bars", agg: "weekly",
    pick: (r, x) => (worn(r) || x.strength.has(r.day) ? (x.strength.get(r.day)?.min ?? 0) : null), partBreakdown: "strength", partialToday: true,
    get footnote() { return i18n.t("trends:viewFootnote.strength"); },
    get actions() { return { addActivity: true, goal: i18n.t("trends:viewGoal.strength") }; },
    get about() { return { title: i18n.t("trends:aboutTitle.strength"), body: [
      i18n.t("trends:aboutBody.strength1"),
      i18n.t("trends:aboutBody.strength2"),
    ] }; },
  },
  steps: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.steps"); }, get short() { return i18n.t("trends:viewShort.steps"); }, format: "grouped", direction: "up", colorBy: "single", chart: "bars", agg: "daily",
    pick: (r) => r.metrics?.steps, partialToday: true,
    get actions() { return { goal: i18n.t("trends:viewGoal.steps") }; },
    get about() { return { title: i18n.t("trends:aboutTitle.steps"), body: [
      i18n.t("trends:aboutBody.steps1"),
    ] }; },
  },
  calories: {
    group: "strain", get label() { return i18n.t("trends:viewLabel.calories"); }, get short() { return i18n.t("trends:viewShort.calories"); }, unit: "kcal", format: "grouped", direction: "neutral", colorBy: "single", chart: "bars", agg: "daily",
    pick: (r) => r.metrics?.calories, partialToday: true,
    get about() { return { title: i18n.t("trends:aboutTitle.calories"), body: [
      i18n.t("trends:aboutBody.calories1"),
    ] }; },
  },
  vo2max: {
    group: "health", get label() { return i18n.t("trends:viewLabel.vo2max"); }, get short() { return i18n.t("trends:viewShort.vo2max"); }, unit: "ml/kg/min", format: "decimal1", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => vo2Of(r)?.value, typical: true,
    get about() { return { title: i18n.t("trends:aboutTitle.vo2max"), body: [
      i18n.t("trends:aboutBody.vo2max1"),
      i18n.t("trends:aboutBody.vo2max2"),
    ] }; },
  },
  lean_mass: {
    group: "health", get label() { return i18n.t("trends:viewLabel.lean_mass"); }, get short() { return i18n.t("trends:viewShort.lean_mass"); }, unit: "kg", format: "decimal1", direction: "up", colorBy: "single", chart: "line", agg: "daily",
    pick: (r) => (r.metrics?.weightKg != null && r.metrics.bodyFatPct != null ? r.metrics.weightKg * (1 - r.metrics.bodyFatPct / 100) : null),
    get about() { return { title: i18n.t("trends:aboutTitle.lean_mass"), body: [
      i18n.t("trends:aboutBody.lean_mass1"),
      i18n.t("trends:aboutBody.lean_mass2"),
    ] }; },
  },
} as const satisfies Record<string, Def>;

export type TrendViewKey = keyof typeof TREND_VIEW;
export const isTrendViewKey = (k: string): k is TrendViewKey => k in TREND_VIEW && !flagOff(k as TrendViewKey);
/** A metric in the person's units (src/lib/units.ts), its unit and its values alike. */
const def = (k: TrendViewKey): Def => inUnits<Def>(TREND_VIEW[k]);
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

export const priorLabel = (r: TrendViewRange) => i18n.t(`ui:trend.prior${({ w: "W", m: "M", "6m": "SixM" } as const)[r]}`);

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
          title: i18n.t(range === "w" ? "trends:breakdown.zonesWeekly" : "trends:breakdown.zonesAvgWeekly"),
          unit: "duration",
          items: [...m.series].reverse().map((s) => ({ key: s.key, label: s.label, value: perWeek(settled(cur).reduce((a, p) => a + (p.parts?.[s.key] ?? 0), 0)) })),
        }
      : m.partBreakdown === "strength"
        ? {
            title: i18n.t(range === "w" ? "trends:breakdown.strengthWeekly" : "trends:breakdown.strengthAvgWeekly"),
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

  const todayNote = m.partialToday && m.agg === "daily" && win.to >= today && win.from <= today ? i18n.t("trends:todayNote", { day: formatDay(today, { month: "short", day: "numeric" }) }) : null;

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
    caption: m.agg === "weekly" ? i18n.t(range === "w" ? "trends:caption.weeklyTotal" : "trends:caption.avgWeeklyTotal") : i18n.t("trends:caption.average"),
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
