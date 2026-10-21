// Home's My Dashboard with Pulse's catalogue (src/lib/dashboard.ts): the v1 rows, the reference app's scored rows
// (Recovery, sleep consistency, hours, restorative sleep, debt, Day Strain, weekly zones and strength, VO2 max, lean
// mass), the Stress Monitor tile, body and the shown-only extras. halo's getHome carries only the v1 rows, body and
// extras, so the rows and the editor's "No data yet" marks are built here, as the earlier Pulse query built them.
import { inUnits, shownValue } from "@/lib/units";
import { BODY_METRICS, DASHBOARD_DEFAULT, DASHBOARD_LABEL, DASHBOARD_METRICS, type DashboardKey, isDashboardKey, PHONE_DEFAULT, type ScoredKey } from "@/lib/dashboard";
import { EXTRA_METRICS, type ExtraKey, type ExtraMetric } from "@/lib/extraMetrics";
import type { ReasonCode } from "@/lib/reasons";
import { addDays } from "@/lib/time";
import { metricHref, trendHref } from "@/lib/url";
import { activityKind, type DayRow, exercisesBetween, finite, hrReason, loadDays, maybe, priorStats, recoveryMetric, sleepMetric, dayStrainOf, vitalReason, vo2Of } from "./common";
import type { QueryCtx } from "./ctx";
import { getStress } from "./health";
import { worn, zoneSum } from "./trendView";
import type { KeyStat, Metric, StressVM } from "./types";

/** True once any heart rate has synced: a phone-only install (no Fitbit band) has none. */
export const dashboardDefault = async (ctx: QueryCtx): Promise<DashboardKey[]> => ((await ctx.store.hrBounds()) ? DASHBOARD_DEFAULT : PHONE_DEFAULT);

/** My Dashboard's chosen metrics in order. Keys missing from the catalogue are skipped; none chosen means the default list. */
export async function dashboardKeys(ctx: QueryCtx, chosen: readonly string[] | null): Promise<DashboardKey[]> {
  const keys = (chosen ?? []).filter(isDashboardKey);
  return keys.length ? keys : dashboardDefault(ctx);
}

type StatSpec = Omit<KeyStat, "key" | "label" | "average" | "sd"> & { pick: (r: DayRow) => number | null | undefined };

const spec = (
  pick: StatSpec["pick"],
  metric: Metric<number>,
  unit: string | undefined,
  direction: KeyStat["direction"],
  href?: string,
  format?: KeyStat["format"],
  deviation = false,
): StatSpec => {
  // In the person's units (src/lib/units.ts): the day's value, and the pick its average reads.
  const s = inUnits({ unit, pick, deviation });
  const value = metric.value === null ? metric : { ...metric, value: shownValue(unit, metric.value, deviation) };
  return { pick: s.pick, metric: value, ...(s.unit && { unit: s.unit }), direction, ...(href && { href }), ...(format && { format }) };
};

/** Strength-workout minutes per day over [from, to]. */
async function strengthMinutes(ctx: QueryCtx, from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const e of await exercisesBetween(ctx, from, to)) if (activityKind(e.type) === "strength") out.set(e.day, (out.get(e.day) ?? 0) + (e.endTs - e.startTs) / 60);
  return out;
}

/** A daily pick summed over the 7 days ending on the row's day; null when none of them has a value. */
const weekly = (rows: Map<string, DayRow>, pick: (r: DayRow) => number | null | undefined) => (r: DayRow) => {
  const xs = Array.from({ length: 7 }, (_, k) => rows.get(addDays(r.day, -k))).flatMap((d) => (d ? [pick(d)] : [])).filter(finite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
};

function statSpecs(row: DayRow | undefined, isToday: boolean, rows: Map<string, DayRow>, strength: Map<string, number>): Record<DashboardKey, StatSpec> {
  const m = row?.metrics;
  const rhr = (r: DayRow) => r.rhr;
  const skin = (r: DayRow) => r.recovery?.inputs.skinTempDev ?? null;
  const skinReason = m?.nightlyTempC != null ? "calibrating" : vitalReason(row, isToday);
  const dailyReason = !row?.s1 || row.s1.hrCount === 0 ? hrReason(row?.s1 ?? null) : "no_data";
  const out = {
    hrv: spec((r) => r.metrics?.hrvMs, maybe(m?.hrvMs, vitalReason(row, isToday, true)), "ms", "up", metricHref("hrv")),
    rhr: spec(rhr, maybe(row && rhr(row), vitalReason(row, isToday)), "bpm", "down", metricHref("rhr")),
    resp: spec((r) => r.metrics?.respBpm, maybe(m?.respBpm, vitalReason(row, isToday)), "rpm", "down", metricHref("resp")),
    sleep: spec((r) => r.sleep?.performance, sleepMetric(row, isToday), "%", "up", "/sleep"),
    calories: spec((r) => r.metrics?.calories, maybe(m?.calories, dailyReason), "kcal", "neutral", metricHref("calories")),
    steps: spec((r) => r.metrics?.steps, maybe(m?.steps, dailyReason), undefined, "up", metricHref("steps")),
    spo2: spec((r) => r.metrics?.spo2Pct, maybe(m?.spo2Pct, vitalReason(row, isToday)), "%", "up", metricHref("spo2")),
    skin: spec(skin, maybe(row && skin(row), skinReason), "°C", "toward_zero", metricHref("skin"), undefined, true),
    stress: spec((r) => r.stress?.average, maybe(row?.stress?.average, dailyReason), undefined, "down", "/health/stress", "int"),
  } as Record<DashboardKey, StatSpec>;
  // The reference app's rows (dashboard-03..09); each opens its Trend View, or its screen where it has none.
  const sleepMain = (r: DayRow) => r.sleep?.main;
  const restorative = (r: DayRow) => {
    const s = sleepMain(r);
    return s?.deepMin != null && s.remMin != null ? s.deepMin + s.remMin : null;
  };
  const night: ReasonCode = sleepMetric(row, isToday).reason ?? "no_data";
  const scored = (pick: StatSpec["pick"], reason: ReasonCode, unit: string | undefined, direction: KeyStat["direction"], href: string, format?: KeyStat["format"]) =>
    spec(pick, maybe(row && pick(row), reason), unit, direction, href, format);
  const strengthDay = (r: DayRow) => (worn(r) || strength.has(r.day) ? (strength.get(r.day) ?? 0) : null);
  const lean = (r: DayRow) => (r.metrics?.weightKg != null && r.metrics.bodyFatPct != null ? r.metrics.weightKg * (1 - r.metrics.bodyFatPct / 100) : null);
  Object.assign(out, {
    recovery: scored((r) => r.recovery?.value, recoveryMetric(row, isToday).reason ?? "no_data", "%", "up", trendHref("recovery"), "int"),
    consistency: scored((r) => r.sleep?.consistency, night, "%", "up", trendHref("consistency"), "int"),
    hours: scored((r) => sleepMain(r)?.asleepMin, night, "min", "up", trendHref("hours")),
    restorative_pct: scored(
      (r) => {
        const x = restorative(r);
        const s = sleepMain(r);
        return x != null && s?.asleepMin ? (x / s.asleepMin) * 100 : null;
      },
      night,
      "%",
      "up",
      trendHref("restorative"),
      "int",
    ),
    restorative: scored(restorative, night, "min", "up", trendHref("restorative")),
    debt: scored((r) => (sleepMain(r) ? r.sleep!.debtMin : null), night, "min", "down", "/sleep"),
    strain: scored((r) => dayStrainOf(r.s1), dailyReason, "%", "neutral", trendHref("strain"), "int"),
    zones13: scored(weekly(rows, zoneSum(0, 3)), dailyReason, "min", "up", trendHref("zones13")),
    zones45: scored(weekly(rows, zoneSum(3, 5)), dailyReason, "min", "up", trendHref("zones45")),
    zones_all: scored(weekly(rows, zoneSum(0, 5)), dailyReason, "min", "up", "/strain"),
    strength: scored(weekly(rows, strengthDay), dailyReason, "min", "up", trendHref("strength")),
    // Fitbit's VO2 max, else Pulse's estimate (provisional), as the Fitness page shows it.
    vo2max: spec((r) => vo2Of(r)?.value, maybe(row && vo2Of(row)?.value, "no_data", !!(row && vo2Of(row)?.estimate)), "ml/kg/min", "up", "/health/fitness", "decimal1"),
    lean_mass: scored(lean, "no_data", "kg", "neutral", metricHref("weight"), "decimal1"),
  } satisfies Record<ScoredKey, StatSpec>);
  for (const b of BODY_METRICS) {
    const pick = (r: DayRow) => (b.key === "weight" ? r.metrics?.weightKg : r.metrics?.bodyFatPct);
    out[b.key] = spec(pick, maybe(row && pick(row), "no_data"), b.unit, b.direction, b.href, b.format);
  }
  for (const e of EXTRA_METRICS as readonly ExtraMetric[])
    out[e.key as ExtraKey] = spec((r) => r.extra[e.key as ExtraKey], maybe(row?.extra[e.key as ExtraKey], "no_data"), e.unit, e.direction, metricHref(e.key), e.format);
  return out;
}

export type HomeDashboard = {
  keys: DashboardKey[];
  keyStats: KeyStat[];
  /** Catalogue metrics with no value on the day or in the 30 days before it: the editor marks them "No data yet". */
  empty: DashboardKey[];
  /** The Stress Monitor tile's line; null when the tile is not on the dashboard. */
  stressChart: StressVM["chart"] | null;
};

/** My Dashboard for `day`: its rows against their prior 30 days, the editor's empty metrics and the stress tile's line. */
export async function getHomeDashboard(day: string, ctx: QueryCtx, chosen: readonly string[] | null): Promise<HomeDashboard> {
  const today = ctx.today;
  const isToday = day === today;
  const from = addDays(day < addDays(today, -29) ? day : addDays(today, -29), -36);
  const keys = await dashboardKeys(ctx, chosen);
  const [rows, strength, stress] = await Promise.all([
    loadDays(ctx, from, today),
    keys.includes("strength") ? strengthMinutes(ctx, from, today) : new Map<string, number>(),
    keys.includes("stress") ? getStress(day, ctx) : null,
  ]);
  const specs = statSpecs(rows.get(day), isToday, rows, strength);
  const keyStats = keys.map((key) => {
    const { pick, ...s } = specs[key];
    const { mean, sd } = priorStats(rows, day, pick);
    return { key, label: DASHBOARD_LABEL[key], ...s, average: mean, ...(sd !== undefined && { sd }) } as KeyStat;
  });
  const days = Array.from({ length: 31 }, (_, k) => rows.get(addDays(day, -k))).filter((r): r is DayRow => !!r);
  const empty = DASHBOARD_METRICS.map((m) => m.key).filter((key) => !days.some((r) => finite(specs[key].pick(r))));
  return { keys, keyStats, empty, stressChart: stress?.chart ?? null };
}
