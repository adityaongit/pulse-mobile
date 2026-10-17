// Strain `/strain` (spec §7.3). Ported from Pulse's src/server/queries/strain.ts.
import { inUnits } from "@/lib/units";
import { ZONE_NAMES } from "@/core/scoring/zones";
import { addDays } from "@/lib/time";
import { type ExtraKey, extraMetric, metricHref } from "./_lib";
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
  maxHrOf,
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
  dayStrainOf,
  type ExerciseRow,
  trendPoints,
} from "./common";
import type { HrChart, KeyStat, Metric, SplitPoint, StrainVM, ZoneRow } from "./types";

/** The activity roll-ups the Strain summary shows after Steps (spec §11 EX1). */
export const STRAIN_EXTRAS = ["distance", "floors", "active_minutes", "azm", "active_calories"] as const satisfies readonly ExtraKey[];

const isStrength = (e: ExerciseRow) => activityKind(e.type) === "strength";

/** Strain `/strain` for `day` (spec §7.3). */
export async function getStrain(day: string, ctx: QueryCtx): Promise<StrainVM> {
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
  const stat = (key: string, label: string, read: (d: string) => number | null, unit: string | undefined, why = reason): KeyStat => {
    // In the person's units (src/lib/units.ts): distance in miles, elevation in feet.
    const { pick, unit: shown } = inUnits({ unit, pick: read });
    const prior = meanSd(Array.from({ length: 30 }, (_, k) => pick(addDays(day, -k - 1))));
    return { key, label, metric: maybe(pick(day), why), ...(shown && { unit: shown }), average: prior.mean, ...(prior.sd !== undefined && { sd: prior.sd }), direction: "up" };
  };
  // The source's roll-ups beside Steps: a missing one is the band left off, or a day the account has none.
  const extra = (key: ExtraKey): KeyStat => {
    const m = extraMetric(key);
    const why = (row?.s1?.hrCount ?? 0) > 0 ? "no_data" : "band_not_worn";
    return { ...stat(key, m.label, (d) => rows.get(d)?.extra[key] ?? null, m.unit, why), format: m.format, direction: m.direction, href: metricHref(key) };
  };
  const worn = (d: string) => (rows.get(d)?.s1?.hrCount ?? 0) > 0;
  const summary: KeyStat[] = [
    // Each row leads to its own detail: the zones to the page's "Time in zones" (`#zones`), strength to its workouts.
    { ...stat("zones13", "Heart rate zones 1-3", (d) => zoneMin(rows.get(d), 0, 3), "min"), href: "#zones" },
    { ...stat("zones45", "Heart rate zones 4-5", (d) => zoneMin(rows.get(d), 3, 5), "min"), href: "#zones" },
    { ...stat("strength", "Strength activity time", (d) => (worn(d) ? strengthMin(d) : null), "min"), href: "/activities?kind=strength" },
    { ...stat("steps", "Steps", (d) => rows.get(d)?.metrics?.steps ?? null, undefined), href: metricHref("steps") },
    ...STRAIN_EXTRAS.map(extra),
  ];

  const pts = trendPoints(rows, day, (r) => dayStrainOf(r.s1));
  // Today's calories and workouts are running totals: drawn faded, like a provisional score.
  const soFar = (r: DayRow) => isToday && r.day === day;
  const workoutMin = new Map<string, number>();
  const workoutKcal = new Map<string, number>();
  for (const e of exs) {
    workoutMin.set(e.day, (workoutMin.get(e.day) ?? 0) + (e.endTs - e.startTs) / 60);
    if (finite(e.calories)) workoutKcal.set(e.day, (workoutKcal.get(e.day) ?? 0) + e.calories);
  }

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
    maxHr: row?.s1?.maxHr ?? maxHrOf(ctx),
    zoneNote: zoneNote(row, ctx),
    activities: exs.filter((e) => e.day === day).map((e) => activityItem(e, row)).sort((a, b) => b.start - a.start),
    trend: { points: pts, target: target.value ? [target.value.low, target.value.high] : null },
    calories: calorieSplit(rows, day, soFar, 30, workoutKcal),
    workouts: { points: trendPoints(rows, day, (r) => workoutMin.get(r.day) ?? 0, 60, soFar) },
  };
}

/**
 * The day's total calories split three ways (Onvy's breakdown): resting (the body's base burn), everyday movement, and
 * workouts. Active is `active_calories`, capped at the total so resting never goes below 0; the source has no daily
 * basal roll-up, so resting is the remainder. Workouts are the active calories inside the day's recorded sessions
 * (`workoutKcal`), capped at active; everyday is the rest of active. A day with a total but no active value keeps its
 * total and `parts: null` (no breakdown), never a guessed split.
 */
export function calorieSplit(rows: Map<string, DayRow>, day: string, provisional?: (r: DayRow) => boolean, n = 30, workoutKcal: ReadonlyMap<string, number> = new Map()): SplitPoint[] {
  return trendPoints(rows, day, (r) => r.metrics?.calories, n, provisional).map((p) => {
    const active = rows.get(p.day)?.extra.active_calories;
    if (p.value === null || !finite(active)) return { ...p, parts: null };
    const a = Math.min(Math.max(0, active), p.value);
    const w = Math.min(Math.max(0, workoutKcal.get(p.day) ?? 0), a);
    return { ...p, parts: { resting: p.value - a, everyday: a - w, workouts: w } };
  });
}

/** Strain as a whole percent: "42%". */
const pct = (x: number) => `${Math.round(x)}%`;

/** Strain Coach copy (spec §7.3), by position against today's target. */
export function coach(strain: Metric<number>, target: { low: number; high: number } | null, row: DayRow | undefined): string | null {
  if (strain.value == null || !target) return null;
  const { low, high } = target;
  const range = `${Math.round(low)} - ${pct(high)}`;
  if (row?.recovery?.value != null && row.recovery.value < 34) return `Your body needs rest today. Keep strain between ${range.replace(" - ", " and ")}.`;
  if (strain.value < low) {
    // ponytail: about 1.7 minutes of moderate activity per strain percent near the target; a rough guide, not a model.
    const minutes = Math.max(10, Math.round(((low - strain.value) * 1.7) / 5) * 5);
    return `Your target today is ${range}. You are at ${pct(strain.value)}, so about ${minutes} minutes of moderate activity would put you in range.`;
  }
  if (strain.value <= high) return `You are inside today’s target of ${range}. More strain from here adds load faster than benefit.`;
  return "You are past today’s target. Prioritise sleep tonight to recover.";
}

/**
 * The zones as whole bpm. A reading counts in a zone from its lower edge up (zones.ts: bpm >= lower), and heart rate is
 * whole beats, so a zone's first bpm is its edge rounded UP: a Zone 2 from 132.2 starts at 133, as 132 counts in Zone 1.
 */
export const zoneBounds = (lower: number[]): ZoneRow[] =>
  lower.map((min, i) => ({ zone: i + 1, label: ZONE_NAMES[i], min: Math.ceil(min), max: i < lower.length - 1 ? Math.ceil(lower[i + 1]) - 1 : null, seconds: 0 }));

/** How the day's zones are set, under the zone rows. */
export const zoneNote = (row: DayRow | undefined, ctx: QueryCtx) =>
  `Zones on % of your max heart rate (${row?.s1?.maxHr ?? maxHrOf(ctx)} bpm): zone 1 from 50%, zone 5 from 90%.`;

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
