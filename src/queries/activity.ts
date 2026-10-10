import { zoneShareRanges } from "@/core/algorithms/zoneTypical";
import { addDays } from "../time";
import {
  ACTIVITY_NAME,
  activityKind,
  distanceOf,
  exercisesBetween,
  type ExerciseRow,
  hrReason,
  loadDays,
  loadSeries,
  maybe,
  meanSd,
  ms,
  none,
  ok,
  type QueryCtx,
  todayOf,
  toStrain,
} from "./common";
import { hrChartOf, zoneNote, zoneRows } from "./strain";
import type { Metric } from "@/lib/reasons";
import type { ActivityVM, KeyStat, ZoneRow } from "./types";

/** Activity `/activity/[id]` (spec §7.4); null for an unknown id. */
export async function getActivity(ctx: QueryCtx, id: string): Promise<ActivityVM | null> {
  const e = await ctx.store.sessions.exerciseById(id);
  if (!e) return null;
  const kind = activityKind(e.type);
  // Steps inside the workout for the kinds that walk or run (activity-05), and the same for earlier ones of that kind.
  const stepping = kind === "run" || kind === "walk";
  const [rows, recent, series] = await Promise.all([
    loadDays(ctx, addDays(e.day, -30), e.day),
    exercisesBetween(ctx, addDays(e.day, -30), e.day),
    loadSeries(ctx, e.day, "hr"),
  ]);
  const row = rows.get(e.day);
  const a = row?.activities.find((x) => x.id === id);
  const reason = a && a.hrCount > 0 ? "insufficient_hr_data" : hrReason(row?.s1 ?? null);

  // 30-day averages over the same activity kind, before this one.
  const same = recent.filter((x) => x.id !== id && x.startTs < e.startTs && activityKind(x.type) === kind);
  const statOf = (x: ExerciseRow) => rows.get(x.day)?.activities.find((y) => y.id === x.id);
  const steps = stepping ? await ctx.store.samples.readSamples("steps", Math.min(e.startTs, ...same.map((x) => x.startTs)), e.endTs) : [];
  const stepsIn = (x: { startTs: number; endTs: number }) => steps.reduce((s, m) => (m.ts >= x.startTs && m.ts < x.endTs ? s + m.v : s), 0);
  const strainOf = (x: ExerciseRow) => {
    const effort = statOf(x)?.effort;
    return effort == null ? null : toStrain(effort);
  };
  const tile = (key: string, label: string, v: number | null | undefined, unit: string | undefined, prior: (number | null | undefined)[], r = reason): KeyStat => {
    const { mean, sd } = meanSd(prior);
    return { key, label, metric: maybe(v, r), ...(unit && { unit }), average: mean, ...(sd !== undefined && { sd }), direction: "neutral" };
  };
  const durationMin = (x: ExerciseRow) => (x.endTs - x.startTs) / 60;
  // Distance for the kinds that travel (pace for runs and walks), before the heart-rate tiles (spec §11 EX3).
  const here = distanceOf(e);
  const travels = kind === "run" || kind === "walk" || kind === "ride";
  const distance = travels
    ? [
        { ...tile("distance", "Distance", here.distanceKm, "km", same.map((x) => distanceOf(x).distanceKm), "no_data"), format: "decimal2" as const },
        ...(kind === "ride" ? [] : [{ ...tile("pace", "Pace", here.paceS, "/km", same.map((x) => distanceOf(x).paceS), "no_data"), format: "pace" as const }]),
      ]
    : [];
  // The reference app's order (activity-03): calories, heart rate, then duration; distance and pace after.
  const stats = [
    tile("calories", "Calories", e.calories, "kcal", same.map((x) => x.calories), "no_data"),
    tile("avgHr", "Average heart rate", a?.avgHr, "bpm", same.map((x) => statOf(x)?.avgHr)),
    tile("maxHr", "Max heart rate", a?.maxHr, "bpm", same.map((x) => statOf(x)?.maxHr)),
    tile("duration", "Duration", durationMin(e), "min", same.map(durationMin), "no_data"),
    ...distance,
  ];
  const ownSteps = stepping ? stepsIn(e) : 0;

  const hrr60 = a?.hrr?.after1Minute;
  const hrr: ActivityVM["hrr"] =
    hrr60 == null
      ? none("insufficient_hr_data")
      : ok(hrr60 >= 20 ? { value: hrr60, tone: "optimal", label: "Good" } : hrr60 >= 12 ? { value: hrr60, tone: "neutral", label: "Typical" } : { value: hrr60, tone: "warning", label: "Low" });

  return {
    id,
    day: e.day,
    name: ACTIVITY_NAME[kind],
    kind,
    start: ms(e.startTs),
    end: ms(e.endTs),
    strain: a?.effort != null ? ok(toStrain(a.effort)) : none(reason),
    strainAverage: meanSd(same.map(strainOf)).mean,
    steps: ownSteps > 0 ? { value: ownSteps, average: meanSd(same.map(stepsIn).filter((n) => n > 0)).mean } : null,
    // No source estimates muscular load yet: the split stays empty and its bar hidden (FEATURES.muscularLoad).
    split: null,
    stats,
    insight: a && a.hrCount > 0 ? zoneInsight(a.zoneSeconds) : null,
    hr: hrChartOf(ctx, row, e.day, e.day === todayOf(ctx), series, recent.filter((y) => y.id === id), e.startTs - 600, e.endTs + 600),
    zones: a ? withTypical(zoneRows(row, a.zoneSeconds, a.zoneBelowSeconds), same.flatMap((x) => { const s = statOf(x); return s ? [[...s.zoneSeconds, s.zoneBelowSeconds ?? 0]] : []; })) : none(reason),
    maxHr: row?.s1?.maxHr ?? ctx.profile.maxHr,
    zoneNote: zoneNote(row, ctx),
    hrr,
  };
}

/**
 * Adds each zone's typical range (docs/algorithms/zone-typical-range.md) over earlier activities of the same kind
 * (`prior`: seconds per zone in the rows' order, one array per activity). Too few activities leave the rows as they are.
 */
export function withTypical(m: Metric<ZoneRow[]>, prior: number[][]): Metric<ZoneRow[]> {
  const rows = m.value;
  const ranges = rows && zoneShareRanges(prior, rows.length);
  if (!rows || !ranges) return m;
  return { ...m, value: rows.map((z, i) => ({ ...z, typical: ranges[i] })) };
}

/** Seconds per zone, Zone 1 to Zone 5 (Zone 0 is not counted). */
function zoneInsight(seconds: number[]): string | null {
  const min = seconds.map((s) => Math.round(s / 60));
  const hard = min[3] + min[4];
  if (hard >= 10) return `You spent ${hard} minutes in zones 4 and 5, hard work that builds speed and power.`;
  if (min[2] >= 10) return `You spent ${min[2]} minutes in zone 3, steady aerobic work that builds your base.`;
  if (min[0] + min[1] >= 10) return `You spent ${min[0] + min[1]} minutes in zones 1 and 2, easy movement that helps you recover.`;
  return null;
}
