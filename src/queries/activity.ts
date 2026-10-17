// Activity `/activity/[id]` (spec §7.4). Ported from Pulse's src/server/queries/activity.ts.
import { inUnits } from "@/lib/units";
import type { Metric } from "@/lib/reasons";
import { addDays } from "@/lib/time";
import {
  ACTIVITY_NAME,
  activityKind,
  distanceOf,
  exercisesBetween,
  type ExerciseRow,
  hrReason,
  loadDays,
  loadSeries,
  maxHrOf,
  maybe,
  meanSd,
  ms,
  none,
  ok,
  type QueryCtx,
  todayOf,
  activityStrainOf,
  dayStrainOf,
} from "./common";
import { getActivityCost } from "./activityCost";
import { hrChartOf, zoneNote, zoneRows } from "./strain";
import { trainingEffectVM } from "./training";
import type { ActivityCostVM, ActivityKind, ActivityVM, KeyStat, ZoneRow } from "./types";

/** Activity `/activity/[id]` (spec §7.4); null for an unknown id. */
export async function getActivity(id: string, ctx: QueryCtx): Promise<ActivityVM | null> {
  const e = (await ctx.store.allExercises()).find((x) => x.id === id);
  if (!e) return null;
  const [rows, recent, series, costs, next] = await Promise.all([
    loadDays(ctx, addDays(e.day, -30), e.day),
    exercisesBetween(ctx, addDays(e.day, -30), e.day),
    loadSeries(ctx, e.day, "hr"),
    getActivityCost(ctx),
    ctx.store.getScores(addDays(e.day, 1)),
  ]);
  const row = rows.get(e.day);
  const a = row?.activities.find((x) => x.id === id);
  const kind = activityKind(e.type);
  const reason = a && a.hrCount > 0 ? "insufficient_hr_data" : hrReason(row?.s1 ?? null);

  // 30-day averages over the same activity kind, before this one.
  const same = recent.filter((x) => x.id !== id && x.startTs < e.startTs && activityKind(x.type) === kind);
  const statOf = (x: ExerciseRow) => rows.get(x.day)?.activities.find((y) => y.id === x.id);
  // In the person's units (src/lib/units.ts): km and pace per km show as miles and per mile in imperial.
  const tile = (key: string, label: string, v: number | null | undefined, unit: string | undefined, prior: (number | null | undefined)[], r = reason): KeyStat => {
    const q = inUnits({ unit, pick: (x: number | null | undefined) => x });
    const { mean, sd } = meanSd(prior.map(q.pick));
    return { key, label, metric: maybe(q.pick(v), r), ...(q.unit && { unit: q.unit }), average: mean, ...(sd !== undefined && { sd }), direction: "neutral" };
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
  const stats = [
    tile("duration", "Duration", durationMin(e), "min", same.map(durationMin), "no_data"),
    ...distance,
    tile("avgHr", "Average heart rate", a?.avgHr, "bpm", same.map((x) => statOf(x)?.avgHr)),
    tile("maxHr", "Max heart rate", a?.maxHr, "bpm", same.map((x) => statOf(x)?.maxHr)),
    tile("calories", "Calories", e.calories, "kcal", same.map((x) => x.calories), "no_data"),
  ];

  // Heart-rate recovery on the Pulse engine: the largest drop within 2 minutes after the workout (null below zone 4).
  const hrr60 = a?.engine?.hrr?.drop;
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
    strain: activityStrainOf(a) != null ? ok(activityStrainOf(a)!) : none(reason),
    loadSplit: a?.effort != null ? loadSplit(a.cardioTrimp ?? null, a.muscularTrimp ?? 0) : null,
    trainingEffect: trainingEffectVM(row?.training, id),
    dayStrain: dayStrainOf(row?.s1),
    stats,
    insight: a && a.hrCount > 0 ? zoneInsight(a.zoneSeconds) : null,
    hr: hrChartOf(ctx, row, e.day, e.day === todayOf(ctx), series, recent.filter((y) => y.id === id), e.startTs - 600, e.endTs + 600),
    zones: a
      ? withTypical(
          zoneRows(row, a.zoneSeconds, a.zoneBelowSeconds),
          same.flatMap((x) => {
            const s = statOf(x);
            return s ? [[...s.zoneSeconds, s.zoneBelowSeconds ?? 0]] : [];
          }),
        )
      : none(reason),
    maxHr: row?.s1?.maxHr ?? maxHrOf(ctx),
    zoneNote: zoneNote(row, ctx),
    hrr,
    cost: costOf(costs, kind, next?.recovery?.value ?? null),
  };
}

/**
 * An activity's load as heart-rate and muscular shares of its TRIMP, whole percents that sum to 100; null without a
 * muscular part (or without heart rate).
 */
export function loadSplit(cardioTrimp: number | null, muscularTrimp: number): ActivityVM["loadSplit"] {
  if (cardioTrimp == null || !(muscularTrimp > 0)) return null;
  const muscularPct = Math.round((100 * muscularTrimp) / (cardioTrimp + muscularTrimp));
  return { cardioPct: 100 - muscularPct, muscularPct };
}

/** Mobile: this kind's Activity Cost, with the Recovery the morning after this workout. */
function costOf(vm: ActivityCostVM | null, kind: ActivityKind, nextMorning: number | null): ActivityVM["cost"] {
  const item = vm?.items.find((i) => i.kind === kind);
  if (!vm || !item) return null;
  return { baseline: vm.baseline, baselineKind: vm.baselineKind, minSessions: vm.minSessions, item, nextMorning };
}

/**
 * Adds each zone's typical seconds and share over earlier activities of the same kind (`prior`: seconds per zone, one
 * array per activity). Activities with no time in any zone are left out of the share; none at all leaves the rows as they are.
 */
export function withTypical(m: Metric<ZoneRow[]>, prior: number[][]): Metric<ZoneRow[]> {
  const rows = m.value;
  if (!rows || !prior.length) return m;
  const shares = prior.filter((p) => p.some((x) => x > 0)).map((p) => p.map((x) => x / p.reduce((a, b) => a + b, 0)));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    ...m,
    value: rows.map((z, i) => ({
      ...z,
      typical: { seconds: mean(prior.map((p) => p[i] ?? 0)), share: shares.length ? mean(shares.map((s) => s[i] ?? 0)) : 0 },
    })),
  };
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
