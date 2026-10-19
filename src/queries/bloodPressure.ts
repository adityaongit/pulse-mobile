import type { BloodPressureReading } from "@/data/types";
import { classifyBloodPressure, type BloodPressureCategory } from "@/core/scoring/bloodPressure";
import { addDays, wall } from "@/lib/time";
import { none, ok, type QueryCtx, todayOf } from "./common";
import type { Metric } from "./types";

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
  /** Category distribution over the 30-day history window */
  distribution: Record<BloodPressureCategory, number>;
};

const toItem = (r: BloodPressureReading, tz: string): BloodPressureItem => ({
  id: r.id,
  ts: r.ts,
  day: r.day,
  time: wall(r.ts, tz).time.slice(0, 5),
  systolic: r.systolicMmhg,
  diastolic: r.diastolicMmhg,
  category: classifyBloodPressure(r.systolicMmhg, r.diastolicMmhg),
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
  const windowStart = addDays(day, -29);
  const baselineStart = addDays(day, -30);

  // Causally load readings up to `day` (never future readings)
  const all = (await ctx.store.allBloodPressure())
    .filter((r) => r.day <= day)
    .sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));

  const dayReadings = all.filter((r) => r.day === day).map((r) => toItem(r, ctx.timeZone));
  const latestPriorRaw = all.find((r) => r.day < day);
  const latestPrior = latestPriorRaw ? toItem(latestPriorRaw, ctx.timeZone) : null;

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
        category: classifyBloodPressure(top.systolicMmhg, top.diastolicMmhg),
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

  const distribution: Record<BloodPressureCategory, number> = {
    normal: 0,
    elevated: 0,
    stage1: 0,
    stage2: 0,
    crisis: 0,
  };
  for (const r of windowReadings) {
    const cat = classifyBloodPressure(r.systolicMmhg, r.diastolicMmhg);
    distribution[cat]++;
  }

  return {
    day,
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
