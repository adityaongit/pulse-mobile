import type { BloodPressureReading } from "@/data/types";
import { BP_CATEGORIES, classifyBloodPressure, type BloodPressureCategory, type BpGuideline } from "@/core/scoring/bloodPressure";
import { addDays, wall } from "@/lib/time";
import { none, ok, type QueryCtx, todayOf } from "@/queries/common";
import type { Metric } from "@/queries/types";

export type BloodPressureItem = {
  id: string;
  ts: number;
  day: string;
  /** Formatted local time e.g. "14:30" */
  time: string;
  systolic: number;
  diastolic: number;
  category: BloodPressureCategory;
  bodyPosition: string | null;
  measurementLocation: string | null;
};

export type BloodPressurePoint = {
  day: string;
  systolic: number | null;
  diastolic: number | null;
  category: BloodPressureCategory | null;
};

export type BloodPressureSummary = {
  day: string;
  /** The categories every `category` here is in (Settings › App; AHA/ACC unless the person picked ESH). */
  guideline: BpGuideline;
  isToday: boolean;
  /** Latest reading for the day, or none("no_data") */
  latest: Metric<BloodPressureItem>;
  /** All readings on the day, newest first */
  readings: BloodPressureItem[];
  /** Most recent prior reading if the current day has none */
  latestPrior: BloodPressureItem | null;
  /** Summary statistics for readings on the day */
  dayStats: {
    avgSystolic: number;
    avgDiastolic: number;
    minSystolic: number;
    maxSystolic: number;
    minDiastolic: number;
    maxDiastolic: number;
    count: number;
  } | null;
  /** 30-day baseline statistics from days prior to `day` */
  baseline: {
    avgSystolic: number;
    avgDiastolic: number;
    count: number;
  } | null;
  /** 30 days of representative readings ending on `day` */
  history: BloodPressurePoint[];
  /** Category distribution over the 30-day history window, the guideline's categories only. */
  distribution: Partial<Record<BloodPressureCategory, number>>;
};

/** Each category's chip tone: green in range, amber raised, red for the top stages and grades. */
export const BP_TONE: Record<BloodPressureCategory, "optimal" | "warning" | "alert"> = {
  optimal: "optimal",
  normal: "optimal",
  elevated: "warning",
  highNormal: "warning",
  stage1: "warning",
  grade1: "warning",
  isolatedSystolic: "warning",
  stage2: "alert",
  grade2: "alert",
  crisis: "alert",
  grade3: "alert",
};

const toItem = (r: BloodPressureReading, tz: string, guideline: BpGuideline): BloodPressureItem => ({
  id: r.id,
  ts: r.ts,
  day: r.day,
  time: wall(r.ts, tz).time.slice(0, 5),
  systolic: r.systolicMmhg,
  diastolic: r.diastolicMmhg,
  category: classifyBloodPressure(r.systolicMmhg, r.diastolicMmhg, guideline),
  bodyPosition: r.bodyPosition ?? null,
  measurementLocation: r.measurementLocation ?? null,
});

/**
 * Blood pressure elaboration query for Health Monitor.
 * Causally loads readings on or before `day`, determines the day's latest reading,
 * calculates baseline stats and trend history.
 */
export async function getBloodPressureSummary(
  day: string,
  ctx: QueryCtx,
): Promise<BloodPressureSummary> {
  const isToday = day === todayOf(ctx);
  // A display choice: the stored rows keep AHA/ACC, every category shown is worked out here.
  const guideline = ctx.profile.display?.bp ?? "aha";
  const windowStart = addDays(day, -29);
  const baselineStart = addDays(day, -30);

  // Causally load readings up to `day` (never future readings)
  const stored = await ctx.store.allBloodPressure();
  const all = stored
    .filter((r) => r.day <= day)
    .sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));

  const dayReadings = all.flatMap((r) => (r.day === day ? [toItem(r, ctx.timeZone, guideline)] : []));
  const latestPriorRaw = all.find((r) => r.day < day);
  const latestPrior = latestPriorRaw ? toItem(latestPriorRaw, ctx.timeZone, guideline) : null;

  const latest: Metric<BloodPressureItem> = dayReadings.length > 0
    ? ok(dayReadings[0])
    : none("no_data");

  const dayStats = dayReadings.length > 0
    ? {
        avgSystolic: Math.round(dayReadings.reduce((a, b) => a + b.systolic, 0) / dayReadings.length),
        avgDiastolic: Math.round(dayReadings.reduce((a, b) => a + b.diastolic, 0) / dayReadings.length),
        minSystolic: Math.min(...dayReadings.map((r) => r.systolic)),
        maxSystolic: Math.max(...dayReadings.map((r) => r.systolic)),
        minDiastolic: Math.min(...dayReadings.map((r) => r.diastolic)),
        maxDiastolic: Math.max(...dayReadings.map((r) => r.diastolic)),
        count: dayReadings.length,
      }
    : null;

  // 30-day baseline strictly from days prior to `day`
  const baselineReadings = all.filter((r) => r.day >= baselineStart && r.day < day);
  const baseline = baselineReadings.length > 0
    ? {
        avgSystolic: Math.round(baselineReadings.reduce((a, b) => a + b.systolicMmhg, 0) / baselineReadings.length),
        avgDiastolic: Math.round(baselineReadings.reduce((a, b) => a + b.diastolicMmhg, 0) / baselineReadings.length),
        count: baselineReadings.length,
      }
    : null;

  // 30 days of daily representative points [day - 29 ... day]
  const windowReadings = all.filter((r) => r.day >= windowStart && r.day <= day);
  const readingsByDay = new Map<string, BloodPressureReading[]>();
  for (const r of windowReadings) {
    const list = readingsByDay.get(r.day);
    if (list) list.push(r);
    else readingsByDay.set(r.day, [r]);
  }

  const history: BloodPressurePoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(day, -i);
    const list = readingsByDay.get(d);
    if (list && list.length > 0) {
      // Latest reading on day d
      const top = list[0];
      history.push({
        day: d,
        systolic: top.systolicMmhg,
        diastolic: top.diastolicMmhg,
        category: classifyBloodPressure(top.systolicMmhg, top.diastolicMmhg, guideline),
      });
    } else {
      history.push({
        day: d,
        systolic: null,
        diastolic: null,
        category: null,
      });
    }
  }

  const distribution: Partial<Record<BloodPressureCategory, number>> = Object.fromEntries(BP_CATEGORIES[guideline].map((c) => [c, 0]));
  for (const r of windowReadings) {
    const cat = classifyBloodPressure(r.systolicMmhg, r.diastolicMmhg, guideline);
    distribution[cat] = (distribution[cat] ?? 0) + 1;
  }

  return {
    day,
    guideline,
    isToday,
    latest,
    readings: dayReadings,
    latestPrior,
    dayStats,
    baseline,
    history,
    distribution,
  };
}
