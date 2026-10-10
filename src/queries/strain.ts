import { type ExtraKey, extraMetric } from "@/lib/extraMetrics";
import { metricHref, trendHref } from "@/lib/url";
import { addDays } from "../time";
import {
  activityItem,
  activityKind,
  type DayRow,
  dayStartOf,
  exercisesBetween,
  finite,
  hrReason,
  loadDays,
  loadSeries,
  maybe,
  meanSd,
  minutePoints,
  ms,
  fromReason,
  daySpansOf,
  none,
  ok,
  type QueryCtx,
  strainMetric,
  todayOf,
  type ExerciseRow,
} from "./common";
import { ZONE_NAMES } from "@/core/scoring/zones";
import type { HrChart, KeyStat, Metric, StrainVM, ZoneRow } from "./types";

/** The activity roll-ups the Strain summary shows after Steps (spec §11 EX1). */
export const STRAIN_EXTRAS = ["distance", "floors", "active_minutes", "azm", "active_calories"] as const satisfies readonly ExtraKey[];

const isStrength = (e: ExerciseRow) => activityKind(e.type) === "strength";

/** Strain `/strain` for `day` (spec §7.3). */
export async function getStrain(ctx: QueryCtx, day: string): Promise<StrainVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const [rows, exs, hrSeries] = await Promise.all([
    loadDays(ctx, addDays(day, -181), day),
    exercisesBetween(ctx, addDays(day, -59), day),
    loadSeries(ctx, day, "hr"),
  ]);
  const row = rows.get(day);
  const strain = strainMetric(row);
  const t = row?.strainTarget;
  const target: StrainVM["target"] =
    !t
      ? none(isToday ? "awaiting_sleep_sync" : "band_not_worn")
      : t.reason !== null
        ? fromReason(t.reason, isToday, t.nightsLeft)
        : ok({ low: t.low, high: t.high, estimate: t.coldStart, acwrRule: t.acwrRule });

  const strengthMin = (d: string) => exs.filter((e) => e.day === d && isStrength(e)).reduce((a, e) => a + (e.endTs - e.startTs) / 60, 0);
  // Time in zones from..to-1 (0-based), the same zones as the zone chart and Pulse Age.
  const zoneMin = (r: DayRow | undefined, from: number, to: number) =>
    r?.s1 && r.s1.hrCount > 0 ? r.s1.zoneSeconds.slice(from, to).reduce((a, b) => a + b, 0) / 60 : null;
  const reason = hrReason(row?.s1 ?? null);
  const stat = (key: string, label: string, pick: (d: string) => number | null, unit: string | undefined, why = reason): KeyStat => {
    const prior = meanSd(Array.from({ length: 30 }, (_, k) => pick(addDays(day, -k - 1))));
    return { key, label, metric: maybe(pick(day), why), ...(unit && { unit }), average: prior.mean, ...(prior.sd !== undefined && { sd: prior.sd }), direction: "up" };
  };
  // Google's roll-ups beside Steps: a missing one is the band left off, or a day the account has none.
  const extra = (key: ExtraKey): KeyStat => {
    const m = extraMetric(key);
    const why = (row?.s1?.hrCount ?? 0) > 0 ? "no_data" : "band_not_worn";
    return { ...stat(key, m.label, (d) => rows.get(d)?.extra[key] ?? null, m.unit, why), format: m.format, direction: m.direction, href: metricHref(key) };
  };
  const worn = (d: string) => (rows.get(d)?.s1?.hrCount ?? 0) > 0;
  const summary: KeyStat[] = [
    // The reference app's four rows open their Trend Views (spec §11 R35); the extras keep their metric screens.
    { ...stat("zones13", "Heart rate zones 1-3", (d) => zoneMin(rows.get(d), 0, 3), "min"), href: trendHref("zones13") },
    { ...stat("zones45", "Heart rate zones 4-5", (d) => zoneMin(rows.get(d), 3, 5), "min"), href: trendHref("zones45") },
    { ...stat("strength", "Strength activity time", (d) => (worn(d) ? strengthMin(d) : null), "min"), href: trendHref("strength") },
    { ...stat("steps", "Steps", (d) => rows.get(d)?.metrics?.steps ?? null, undefined), href: trendHref("steps") },
    ...STRAIN_EXTRAS.map(extra),
  ];


  return {
    day,
    isToday,
    strain,
    soFar: isToday,
    target,
    summary,
    coach: coach(strain, target.value, row),
    hr: hrChartOf(ctx, row, day, isToday, hrSeries, exs.filter((e) => e.day === day)),
    zones: zoneRows(row),
    maxHr: row?.s1?.maxHr ?? ctx.profile.maxHr,
    zoneNote: zoneNote(row, ctx),
    activities: exs.filter((e) => e.day === day).map((e) => activityItem(e, row)).sort((a, b) => b.start - a.start),
  };
}

const fmt1 = (x: number) => x.toFixed(1);

/** Strain Coach copy (spec §7.3), by position against today's target. */
export function coach(strain: Metric<number>, target: { low: number; high: number } | null, row: DayRow | undefined): string | null {
  if (strain.value == null || !target) return null;
  const { low, high } = target;
  const range = `${fmt1(low)} - ${fmt1(high)}`;
  if (row?.recovery?.value != null && row.recovery.value < 34) return `Your body needs rest today. Keep strain between ${range.replace(" - ", " and ")}.`;
  if (strain.value < low) {
    // ponytail: about 8 minutes of moderate activity per strain point near the target; a rough guide, not a model.
    const minutes = Math.max(10, Math.round(((low - strain.value) * 8) / 5) * 5);
    return `Your target today is ${range}. You are at ${fmt1(strain.value)}, so about ${minutes} minutes of moderate activity would put you in range.`;
  }
  if (strain.value <= high) return `You are inside today’s target of ${range}. More strain from here adds load faster than benefit.`;
  return "You are past today’s target. Prioritise sleep tonight to recover.";
}

export const zoneBounds = (lower: number[]): ZoneRow[] =>
  lower.map((min, i) => ({ zone: i + 1, label: ZONE_NAMES[i], min: Math.round(min), max: i < lower.length - 1 ? Math.round(lower[i + 1]) - 1 : null, seconds: 0 }));

/** How the day's zones are set, under the zone rows. */
export const zoneNote = (row: DayRow | undefined, ctx: QueryCtx) =>
  `Zones on your heart-rate reserve: resting ${Math.round(row?.s1?.restingHr ?? 0)} to max ${row?.s1?.maxHr ?? ctx.profile.maxHr} bpm.`;

export function zoneRows(row: DayRow | undefined, seconds = row?.s1?.zoneSeconds, below = row?.s1?.zoneBelowSeconds): Metric<ZoneRow[]> {
  const s1 = row?.s1;
  if (!s1 || s1.hrCount === 0 || !seconds) return none(hrReason(s1 ?? null));
  const rows = zoneBounds(s1.zoneLower).map((z, i) => ({ ...z, seconds: Math.round(seconds[i]) }));
  // Zone 0: time under Zone 1, from the Zone 1 floor. Days stored before it was kept have no such row.
  if (below != null) rows.push({ zone: 0, label: "Zone 0", min: 0, max: rows[0].min - 1, seconds: Math.round(below) });
  return ok(rows);
}

/** Intraday HR for the day, or for [from, to) unix seconds (an activity window). */
export async function hrChart(ctx: QueryCtx, row: DayRow | undefined, day: string, isToday: boolean, from?: number, to?: number): Promise<Metric<HrChart>> {
  if (!row?.s1 || row.s1.hrCount === 0) return none("band_not_worn");
  const [series, exs] = await Promise.all([loadSeries(ctx, day, "hr"), exercisesBetween(ctx, day, day)]);
  return hrChartOf(ctx, row, day, isToday, series, exs, from, to);
}

/** hrChart() with the day's "hr" series and exercises already loaded. */
export function hrChartOf(
  ctx: QueryCtx,
  row: DayRow | undefined,
  day: string,
  isToday: boolean,
  series: (number | null)[] | null,
  dayExs: ExerciseRow[],
  from?: number,
  to?: number,
): Metric<HrChart> {
  const s1 = row?.s1;
  if (!s1 || s1.hrCount === 0) return none("band_not_worn");
  const start = dayStartOf(ctx, day);
  const fromM = from == null ? 0 : Math.floor((from - start) / 60);
  const toM = to == null ? Infinity : Math.ceil((to - start) / 60);
  const points = minutePoints(series, start, from == null ? 2 : 1, fromM, toM);
  if (!points.some((p) => finite(p.v))) return none("insufficient_hr_data");
  const spans = daySpansOf(row, start, dayExs);
  return ok({
    points,
    zones: zoneBounds(s1.zoneLower),
    // An activity window marks only its workouts, not sleep or a neighbouring session caught in the padding.
    spans: from == null ? spans : spans.filter((x) => x.kind === "workout" && x.end > ms(from) && x.start < ms(to!)),
    now: isToday && from == null && s1.lastHrTs != null ? ms(s1.lastHrTs) : null,
  });
}
