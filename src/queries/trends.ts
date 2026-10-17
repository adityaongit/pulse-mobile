// Trends `/trends?metric=&r=` (More): one daily metric over up to a year, with each range's average against
// the range before it. Ported from Pulse's src/server/queries/trends.ts.
import { inUnits } from "@/lib/units";
import { addDays } from "@/lib/time";
import { EXTRA_METRICS, type ExtraKey, type FormatKey, type GoodDirection, metricHref, RANGE_DAYS, RANGES, type TrendRange } from "./_lib";
import { type DayRow, finite, loadDays, none, ok, type QueryCtx, todayOf, dayStrainOf } from "./common";
import type { DayPoint, Metric } from "./types";

export type TrendMetricKey =
  | "recovery"
  | "strain"
  | "sleep"
  | "hours"
  | "consistency"
  | "hrv"
  | "rhr"
  | "resp"
  | "spo2"
  | "skin"
  | "stress"
  | "steps"
  | "weight"
  | "body_fat"
  | ExtraKey;

/** The Trends picker's sections, in order. */
export const TREND_GROUPS = ["Recovery & sleep", "Activity", "Body", "Nutrition", "Vitals"] as const;
export type TrendGroup = (typeof TREND_GROUPS)[number];

export type TrendMetric = {
  key: TrendMetricKey;
  label: string;
  group: TrendGroup;
  unit?: string;
  format: FormatKey;
  colorBy: "band" | "strain" | "sleep" | "single" | "stress";
  direction: GoodDirection;
  /** The metric's own screen. */
  href: string;
  /** Column name in the daily export. */
  column: string;
  pick: (r: DayRow) => number | null | undefined;
  provisional?: (r: DayRow) => boolean;
  /** Accrues through the day (Strain, steps): today is a gap, not a low bar. */
  partialToday?: boolean;
  /** A difference from a baseline (skin temperature): converts without a unit's offset (src/lib/units.ts). */
  deviation?: boolean;
};

/** Where each extra sits in the picker; typed by key, so a new extra metric must pick a section. */
const EXTRA_GROUP: Record<ExtraKey, TrendGroup> = {
  distance: "Activity",
  floors: "Activity",
  elevation: "Activity",
  active_minutes: "Activity",
  light_minutes: "Activity",
  azm: "Activity",
  active_calories: "Activity",
  sedentary_minutes: "Activity",
  swim_strokes: "Activity",
  avg_hr: "Vitals",
  water: "Nutrition",
  calories_in: "Nutrition",
  protein: "Nutrition",
  carbs: "Nutrition",
  fat: "Nutrition",
  glucose: "Vitals",
  core_temp: "Vitals",
};

/** Export column: the key plus its unit ("distance_km", "glucose_mg_dl"); h:mm metrics export minutes. */
const columnOf = (key: string, unit: string | undefined, format: FormatKey) =>
  unit ? `${key}_${unit.replace("°", "").replace("/", "_").toLowerCase()}` : format === "duration" && !key.endsWith("_minutes") ? `${key}_minutes` : key;

const CORE: readonly TrendMetric[] = [
  { key: "recovery", group: "Recovery & sleep", label: "Recovery", unit: "%", format: "int", colorBy: "band", direction: "up", href: "/recovery", column: "recovery_pct", pick: (r) => r.recovery?.value, provisional: (r) => !!r.recovery?.provisional },
  { key: "strain", group: "Activity", label: "Strain", unit: "%", format: "int", colorBy: "strain", direction: "neutral", href: "/strain", column: "strain_pct", pick: (r) => dayStrainOf(r.s1), partialToday: true },
  { key: "sleep", group: "Recovery & sleep", label: "Sleep performance", unit: "%", format: "int", colorBy: "sleep", direction: "up", href: "/sleep", column: "sleep_performance_pct", pick: (r) => r.sleep?.performance },
  { key: "hours", group: "Recovery & sleep", label: "Hours of sleep", format: "duration", colorBy: "sleep", direction: "up", href: "/sleep", column: "sleep_minutes", pick: (r) => r.sleep?.main?.asleepMin },
  { key: "consistency", group: "Recovery & sleep", label: "Sleep consistency", unit: "%", format: "int", colorBy: "sleep", direction: "up", href: "/sleep", column: "sleep_consistency_pct", pick: (r) => r.sleep?.consistency },
  { key: "hrv", group: "Vitals", label: "Heart rate variability", unit: "ms", format: "int", colorBy: "single", direction: "up", href: metricHref("hrv"), column: "hrv_ms", pick: (r) => r.metrics?.hrvMs },
  { key: "rhr", group: "Vitals", label: "Resting heart rate", unit: "bpm", format: "int", colorBy: "single", direction: "down", href: metricHref("rhr"), column: "resting_hr_bpm", pick: (r) => r.rhr },
  { key: "resp", group: "Vitals", label: "Respiratory rate", unit: "rpm", format: "decimal1", colorBy: "single", direction: "neutral", href: metricHref("resp"), column: "respiratory_rate_rpm", pick: (r) => r.metrics?.respBpm },
  { key: "spo2", group: "Vitals", label: "Blood oxygen", unit: "%", format: "int", colorBy: "single", direction: "up", href: metricHref("spo2"), column: "spo2_pct", pick: (r) => r.metrics?.spo2Pct },
  { key: "skin", group: "Vitals", label: "Skin temperature", unit: "°C", format: "decimal1", colorBy: "single", direction: "toward_zero", href: metricHref("skin"), column: "skin_temperature_deviation_c", pick: (r) => r.recovery?.inputs.skinTempDev, deviation: true },
  { key: "stress", group: "Recovery & sleep", label: "Stress", format: "int", colorBy: "stress", direction: "down", href: "/health/stress", column: "stress_avg", pick: (r) => r.stress?.average, provisional: (r) => !!r.stress?.provisional, partialToday: true },
  { key: "steps", group: "Activity", label: "Steps", format: "grouped", colorBy: "single", direction: "up", href: metricHref("steps"), column: "steps", pick: (r) => r.metrics?.steps, partialToday: true },
  { key: "weight", group: "Body", label: "Weight", unit: "kg", format: "decimal1", colorBy: "single", direction: "neutral", href: metricHref("weight"), column: "weight_kg", pick: (r) => r.metrics?.weightKg },
  { key: "body_fat", group: "Body", label: "Body fat", unit: "%", format: "decimal1", colorBy: "single", direction: "down", href: metricHref("body_fat"), column: "body_fat_pct", pick: (r) => r.metrics?.bodyFatPct },
];

/** Every metric: Pulse's own first, then the source's extras from their catalogue, each in a picker section. */
export const TREND_METRICS: readonly TrendMetric[] = [
  ...CORE,
  ...EXTRA_METRICS.map((m): TrendMetric => ({
    key: m.key,
    group: EXTRA_GROUP[m.key],
    label: m.label,
    ...("unit" in m && { unit: m.unit }),
    format: m.format,
    colorBy: "single",
    direction: m.direction,
    href: metricHref(m.key),
    column: columnOf(m.key, "unit" in m ? m.unit : undefined, m.format),
    pick: (r) => r.extra[m.key],
    ...("partialToday" in m && { partialToday: m.partialToday }),
  })),
];

/**
 * A metric as the screens show it: in the person's units (src/lib/units.ts), its unit and its values alike. Unknown
 * keys fall back to the first. The daily export reads TREND_METRICS itself, in metric.
 */
export const trendMetric = (key: string | undefined): TrendMetric => inUnits(TREND_METRICS.find((m) => m.key === key) ?? TREND_METRICS[0]);

export const parseTrendMetric = (raw: string | string[] | undefined): TrendMetric => trendMetric(Array.isArray(raw) ? raw[0] : raw);

/** The longest range, and the days the chart gets. */
const SPAN = RANGE_DAYS["1y"];

export type TrendsVM = {
  metric: TrendMetricKey;
  /** 365 days ending today, oldest first; a reason when there is nothing to draw yet. */
  points: Metric<DayPoint[]>;
  /** Per range: the average and the average of the range before it (null where a range has no values). */
  periods: { range: TrendRange; average: Metric<number>; prior: number | null }[];
};

const mean = (xs: (number | null)[]) => {
  const v = xs.filter(finite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Why a metric has nothing to show yet: Recovery calibrates for its first nights, the rest just have no data. */
function emptyReason(m: TrendMetric, rows: Map<string, DayRow>, today: string): Metric<DayPoint[]> {
  const r = rows.get(today)?.recovery ?? rows.get(addDays(today, -1))?.recovery;
  if (m.key === "recovery" && r?.reason === "calibrating") return none("calibrating", r.nightsLeft);
  return none("no_data");
}

export async function getTrends(metric: TrendMetricKey, ctx: QueryCtx): Promise<TrendsVM> {
  const m = trendMetric(metric);
  const today = todayOf(ctx);
  // Two years: the 1Y average needs the year before it.
  const from = addDays(today, -(2 * SPAN - 1));
  const rows = await loadDays(ctx, from, today);
  const all: DayPoint[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const r = rows.get(d)!;
    const v = m.pick(r);
    // Today's running total is drawn (faded, "so far") but is not a day's value yet: averages leave it out.
    const partial = !!m.partialToday && d === today && finite(v);
    all.push({ day: d, value: finite(v) ? v : null, ...((m.provisional?.(r) || partial) && { provisional: true }), ...(partial && { partial: true }) });
  }
  const settled = all.map((p) => (p.partial ? null : p.value));
  const shown = all.slice(-SPAN);
  const periods = RANGES.map((range) => {
    const n = RANGE_DAYS[range];
    const avg = mean(settled.slice(-n));
    return { range, average: avg === null ? none<number>("no_data") : ok(avg), prior: mean(settled.slice(-2 * n, -n)) };
  });
  return {
    metric: m.key,
    points: shown.some((p) => p.value !== null) ? ok(shown) : emptyReason(m, rows, today),
    periods,
  };
}
