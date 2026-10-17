// Shared by the screen queries: the batched day loader over the Store and the Metric builders.
// Ported from Pulse's src/server/queries/common.ts; every Postgres read is a Store read.
import type { DetectedActivity } from "@/core/algorithms/autoWorkout";
import { STRENGTH_TYPES } from "@/core/algorithms/healthspan";
import { zonesOf as engineZones } from "@/core/engine/strain";
import type { Exercise, Metrics } from "@/data/types";
import type { Metric, MetricTag, ReasonCode } from "@/lib/reasons";
import { addDays, localMidnight, wholeYears } from "@/lib/time";
import type {
  EnergyBankRow,
  FitnessRow,
  HrvStatusRow,
  TrainingRow,
  HealthMonitorRow,
  HealthspanRow,
  RecoveryRow,
  SleepPlannerRow,
  SleepRow,
  Stage1Activity,
  Stage1Day,
  StrainTargetRow,
  StressRow,
  TrainingLoadRow,
} from "@/pipeline/types";
import type { SeriesKind } from "@/data/store";
import { type ExtraKey, recoveryBand, stressLevel } from "./_lib";
import type { QueryCtx } from "./ctx";
import type { ActivityKind, DayPoint, SleepPlanVM, Span, TimelineItem, TimePoint } from "./types";
import { metricsWithLoggedBody } from "@/data/body";
import { pulseFoodByDay, withFood } from "./food";
import { dayRestingHr } from "@/pipeline/restingHr";

export type { QueryCtx } from "./ctx";

export const todayOf = (ctx: QueryCtx) => ctx.today;

/** The person's max HR: their own, else Tanaka (208 − 0.7·age) on `today`, as the pipeline resolves it. */
/** The Pulse engine's max HR: the profile's own, else 220 − age. */
export const maxHrOf = (ctx: QueryCtx) => ctx.profile.maxHr ?? 220 - wholeYears(ctx.profile.birthDate, ctx.today);

/** The daily aggregates row; the Store's `Metrics` is a superset of the web's `MetricsRow`. */
export type MetricsRow = Metrics;

/**
 * The screens' zones are the Pulse engine's (% of max HR, max HR the profile's or 220 − age): a stored day or workout
 * with engine zone seconds shows those, zone 0 as the time below zone 1, with the engine's lower bounds. Halo's zones on
 * heart-rate reserve stay in the stored row for halo's extras.
 */
function engineZoned(s1: Stage1Day): Stage1Day {
  const st = s1.engine?.strain;
  if (!st?.zoneS || st.maxHr == null) return s1;
  return { ...s1, zoneSeconds: st.zoneS.slice(1), zoneBelowSeconds: st.zoneS[0], zoneLower: [...engineZones(st.maxHr).lowest], maxHr: st.maxHr };
}
function engineZonedActivity(a: Stage1Activity, s1: Stage1Day | null): Stage1Activity {
  const z = a.engine?.zoneS;
  return z && s1?.engine?.strain?.maxHr != null ? { ...a, zoneSeconds: z.slice(1), zoneBelowSeconds: z[0] } : a;
}

export type DayRow = {
  day: string;
  s1: Stage1Day | null;
  activities: Stage1Activity[];
  /** Mobile: workouts stage 1 detected from elevated HR with none recorded (autoWorkout.ts); shown, never scored. */
  detected: DetectedActivity[];
  sessionRhr: number | null;
  /** The day's resting HR (dayRestingHr), the one Recovery and Health Monitor score and every screen shows. */
  rhr: number | null;
  recovery: RecoveryRow | null;
  sleep: SleepRow | null;
  trainingLoad: TrainingLoadRow | null;
  strainTarget: StrainTargetRow | null;
  sleepPlanner: SleepPlannerRow | null;
  energyBank: EnergyBankRow | null;
  stress: StressRow | null;
  healthMonitor: HealthMonitorRow | null;
  healthspan: HealthspanRow | null;
  fitness: FitnessRow | null;
  /** Version 19: HRV Status and the Garmin-style training row; null on older rows. */
  hrvStatus: HrvStatusRow | null;
  training: TrainingRow | null;
  metrics: MetricsRow | null;
  /** Shown-only daily roll-ups (`_lib.ts` EXTRA_METRICS); a key is absent when that day has none. */
  extra: Partial<Record<ExtraKey, number>>;
};

/** Every day in [from, to], one Store read per table (in parallel); days without rows come back empty. */
export async function loadDays(ctx: QueryCtx, from: string, to: string): Promise<Map<string, DayRow>> {
  const { store } = ctx;
  const [scoreRows, metricRows, extraRows, logged] = await Promise.all([
    store.scoresIn({ from, to }),
    metricsWithLoggedBody(store),
    store.dailyValues({ from, to }),
    store.loggedEntries(localMidnight(from, ctx.timeZone), Number.MAX_SAFE_INTEGER),
  ]);
  const scores = new Map(scoreRows.map((r) => [r.day, r]));
  const metrics = new Map<string, MetricsRow>();
  for (const m of metricRows) if (m.day >= from && m.day <= to) metrics.set(m.day, m);
  const extra = new Map<string, Partial<Record<ExtraKey, number>>>();
  for (const r of extraRows) if (r.day >= from && r.day <= to) extra.set(r.day, { ...extra.get(r.day), [r.key as ExtraKey]: r.value });
  // Water logged in Pulse never reaches Health Connect (Pulse writes nothing there), so it adds to the synced total here,
  // as the Log's waterOn does: the water goal, the Water screen and Trends count what the Log shows.
  for (const e of logged) {
    if (e.type !== "hydration-log" || e.source !== "pulse" || e.day < from || e.day > to) continue;
    const ml = Number((e.data as { ml?: unknown } | null)?.ml ?? 0);
    if (!(ml > 0)) continue;
    const day = extra.get(e.day) ?? {};
    extra.set(e.day, { ...day, water: (day.water ?? 0) + ml });
  }
  // Food logged in Pulse, the same way: its calories and macros add to the synced totals (calories eaten, protein,
  // carbs, fat), except entries that repeat a meal Fitbit's log already counts (src/queries/food.ts).
  for (const [day, add] of pulseFoodByDay(logged, from, to)) extra.set(day, withFood(extra.get(day) ?? {}, add));
  const out = new Map<string, DayRow>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = scores.get(d);
    out.set(d, {
      day: d,
      s1: r?.strain ? engineZoned(r.strain) : null,
      activities: (r?.activities ?? []).map((a) => engineZonedActivity(a, r?.strain ?? null)),
      detected: r?.detected ?? [],
      sessionRhr: r?.sessionRhrBpm ?? null,
      rhr: dayRestingHr(metrics.get(d)?.rhrBpm, r?.sessionRhrBpm),
      recovery: r?.recovery ?? null,
      sleep: r?.sleep ?? null,
      trainingLoad: r?.training_load ?? null,
      strainTarget: r?.strain_target ?? null,
      sleepPlanner: r?.sleep_planner ?? null,
      energyBank: r?.energy_bank ?? null,
      stress: r?.stress ?? null,
      healthMonitor: r?.health_monitor ?? null,
      healthspan: r?.healthspan ?? null,
      fitness: r?.fitness ?? null,
      hrvStatus: r?.hrv_status ?? null,
      training: r?.training ?? null,
      metrics: metrics.get(d) ?? null,
      extra: extra.get(d) ?? {},
    });
  }
  return out;
}

export const loadSeries = (ctx: QueryCtx, day: string, kind: SeriesKind): Promise<(number | null)[] | null> => ctx.store.getSeries(day, kind);

/** The first day with scores (the sync's first imported day), or null before any data. */
export async function firstDay(ctx: QueryCtx): Promise<string | null> {
  return ctx.sync.firstDay ?? (await ctx.store.getSyncState()).firstDay;
}

/**
 * The latest stored score day on or before `today` (looking back `lookback` days), else `today`. The web asks
 * Postgres for max(day); here one ranged read does it.
 */
export async function lastStored(ctx: QueryCtx, today: string, lookback = 60): Promise<string> {
  const rows = await ctx.store.scoresIn({ from: addDays(today, -lookback), to: today });
  let last: string | null = null;
  for (const r of rows) if (last === null || r.day > last) last = r.day;
  return last ?? today;
}

// ── Metric builders ─────────────────────────────────────────────────────────

export const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function ok<T>(value: T, provisional = false, tags: MetricTag[] = []): Metric<T> {
  if (typeof value === "number" && !Number.isFinite(value)) return none("no_data");
  return { value, reason: null, provisional, ...(tags.length && { tags }) };
}

export function none<T>(reason: ReasonCode, nightsLeft?: number): Metric<T> {
  return { value: null, reason, provisional: false, ...(nightsLeft !== undefined && { nightsLeft }) };
}

/** A stored `{ reason, nightsLeft }` as a null metric; "band_not_worn" on today means the night hasn't synced yet. */
export const fromReason = <T>(reason: ReasonCode | null | undefined, isToday: boolean, nightsLeft?: number): Metric<T> =>
  none(nightReason(reason ?? "no_data", isToday), nightsLeft);

export const nightReason = (reason: ReasonCode, isToday: boolean): ReasonCode =>
  reason === "band_not_worn" && isToday ? "awaiting_sleep_sync" : reason;

/** Why a nightly vital (HRV, resting HR, …) is missing on `row`'s day. */
export function vitalReason(row: DayRow | undefined, isToday: boolean, hrv = false): ReasonCode {
  const main = row?.sleep?.main;
  if (!main) return isToday ? "awaiting_sleep_sync" : "band_not_worn";
  if (!main.processed) return "awaiting_sleep_sync";
  return hrv ? "no_hrv_last_night" : "no_data";
}

/** A value metric when finite, else the given reason. */
export const maybe = (v: number | null | undefined, reason: ReasonCode, provisional = false, tags: MetricTag[] = []): Metric<number> =>
  finite(v) ? ok(v, provisional, tags) : none(reason);

/** Why strain-type (HR) data is missing. */
export const hrReason = (s1: Stage1Day | null): ReasonCode => (!s1 || s1.hrCount === 0 ? "band_not_worn" : "insufficient_hr_data");

/** Daily Strain, a percent (the Pulse engine, stage 1's `engine.strain`); null on a day without one. */
export const dayStrainOf = (s1: Stage1Day | null | undefined): number | null => s1?.engine?.strain?.value ?? null;
/** A workout's strain, a percent; null without one. */
export const activityStrainOf = (a: Stage1Activity | null | undefined): number | null => a?.engine?.strain ?? null;
export const ms = (s: number) => s * 1000;

export function meanSd(xs: (number | null | undefined)[]) {
  const v = xs.filter(finite);
  if (!v.length) return { mean: null, sd: undefined };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1)) : undefined;
  return { mean, sd };
}

/** Mean and SD over the `n` days before `day` (exclusive). */
export function priorStats(rows: Map<string, DayRow>, day: string, pick: (r: DayRow) => number | null | undefined, n = 30) {
  const xs: (number | null | undefined)[] = [];
  for (let k = 1; k <= n; k++) {
    const r = rows.get(addDays(day, -k));
    if (r) xs.push(pick(r));
  }
  return meanSd(xs);
}

/** `n` days ending on `day`, oldest first. */
export function trendPoints(rows: Map<string, DayRow>, day: string, pick: (r: DayRow) => number | null | undefined, n = 182, provisional?: (r: DayRow) => boolean): DayPoint[] {
  return Array.from({ length: n }, (_, k) => {
    const d = addDays(day, k - n + 1);
    const r = rows.get(d);
    const v = r ? pick(r) : null;
    return { day: d, value: finite(v) ? v : null, ...(r && provisional?.(r) && { provisional: true }) };
  });
}

/** A per-minute series on the day's grid → points every `step` minutes (nulls kept as gaps). */
export function minutePoints(series: (number | null)[] | null, dayStart: number, step = 1, from = 0, to = Infinity): TimePoint[] {
  if (!series) return [];
  const out: TimePoint[] = [];
  for (let m = Math.max(0, from); m < Math.min(series.length, to); m += step) {
    const v = series[m];
    out.push({ t: ms(dayStart + m * 60), v: finite(v) ? v : null });
  }
  return out;
}

export const dayStartOf = (ctx: QueryCtx, day: string) => localMidnight(day, ctx.timeZone);

// ── Activities and plans ─────────────────────────────────────────────────────

export function activityKind(type: string): ActivityKind {
  if (/RUN/.test(type)) return "run";
  if (/BIK|CYCL|RIDE/.test(type)) return "ride";
  if (/WALK|HIK/.test(type)) return "walk";
  if (STRENGTH_TYPES.test(type)) return "strength";
  return "workout";
}

export const ACTIVITY_NAME: Record<ActivityKind, string> = {
  run: "Running",
  ride: "Cycling",
  walk: "Walking",
  strength: "Strength training",
  workout: "Workout",
};

export type ExerciseRow = Exercise;

const byStart = (a: ExerciseRow, b: ExerciseRow) => a.startTs - b.startTs || a.id.localeCompare(b.id);

/** Workouts with `from <= day <= to`, by start time then id. */
export async function exercisesBetween(ctx: QueryCtx, from: string, to: string): Promise<ExerciseRow[]> {
  return (await ctx.store.allExercises()).filter((e) => e.day >= from && e.day <= to).sort(byStart);
}

export function activityItem(e: ExerciseRow, row: DayRow | undefined): Extract<TimelineItem, { kind: "activity" }> {
  const kind = activityKind(e.type);
  const a = row?.activities.find((x) => x.id === e.id);
  const st = activityStrainOf(a);
  const strain = st != null ? ok(st) : none<number>(a && a.hrCount > 0 ? "insufficient_hr_data" : "band_not_worn");
  return { kind: "activity", id: e.id, day: e.day, name: ACTIVITY_NAME[kind], activityKind: kind, strain, start: ms(e.startTs), end: ms(e.endTs), ...distanceOf(e) };
}

/** Distance in km where the workout recorded one, and pace (seconds per km) for runs and walks. */
export function distanceOf(e: ExerciseRow): { distanceKm: number | null; paceS: number | null } {
  const km = finite(e.distanceM) && e.distanceM > 0 ? e.distanceM / 1000 : null;
  const paced = km !== null && /^(run|walk)$/.test(activityKind(e.type));
  return { distanceKm: km, paceS: paced ? (e.endTs - e.startTs) / km : null };
}

/** The day's timeline: main sleep, naps and workouts, in time order. */
export async function timeline(ctx: QueryCtx, row: DayRow | undefined, day: string): Promise<TimelineItem[]> {
  return timelineOf(row, day, await exercisesBetween(ctx, day, day));
}

/** timeline() with the day's exercises already loaded (lets callers fetch them alongside other reads). */
export function timelineOf(row: DayRow | undefined, day: string, exs: ExerciseRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const s = row?.sleep;
  if (s?.main) items.push({ kind: "sleep", id: s.main.id, day, minutes: s.main.asleepMin, start: ms(s.main.start), end: ms(s.main.end) });
  for (const n of s?.naps ?? []) items.push({ kind: "nap", id: n.id, day, minutes: n.asleepMin, start: ms(n.start), end: ms(n.end) });
  for (const e of exs) items.push(activityItem(e, row));
  return items.sort((a, b) => b.start - a.start); // newest first, like the Activities page
}

const SPAN_LABEL: Record<ActivityKind, string> = { run: "Run", ride: "Ride", walk: "Walk", strength: "Strength", workout: "Workout" };

/** Chart spans for the day: main sleep (clipped to `dayStart`), naps and workouts. */
export async function daySpans(ctx: QueryCtx, row: DayRow | undefined, day: string, dayStart: number): Promise<Span[]> {
  return daySpansOf(row, dayStart, await exercisesBetween(ctx, day, day));
}

/** daySpans() with the day's exercises already loaded. */
export function daySpansOf(row: DayRow | undefined, dayStart: number, exs: ExerciseRow[]): Span[] {
  const spans: Span[] = [];
  const s = row?.sleep;
  if (s?.main) spans.push({ kind: "sleep", label: "Sleep", start: ms(Math.max(s.main.start, dayStart)), end: ms(s.main.end) });
  for (const n of s?.naps ?? []) spans.push({ kind: "nap", label: "Nap", start: ms(n.start), end: ms(n.end) });
  for (const e of exs) spans.push({ kind: "workout", label: SPAN_LABEL[activityKind(e.type)], start: ms(e.startTs), end: ms(e.endTs) });
  return spans;
}

const PLAN_LABELS = [
  ["peak", "Peak"],
  ["perform", "Perform"],
  ["get_by", "Get by"],
] as const;

export function planVM(ctx: QueryCtx, row: DayRow | undefined, isToday: boolean): Metric<SleepPlanVM> {
  const p = row?.sleepPlanner;
  if (!p) return none(isToday ? "awaiting_sleep_sync" : "no_data");
  if (p.reason !== null) return none(p.reason, p.nightsLeft);
  if (p.wakeMin == null) return none("no_data");
  const wakeMidnight = localMidnight(p.wakeDay, ctx.timeZone);
  return ok({
    needMin: p.needMin,
    parts: p.parts,
    wakeAt: ms(wakeMidnight + Math.round(p.wakeMin * 60)),
    weekend: p.weekend,
    latencyMin: p.latencyMin ?? 0,
    plans: p.plans.map((x, i) => ({
      key: PLAN_LABELS[i][0],
      label: PLAN_LABELS[i][1],
      share: x.share,
      sleepMin: x.sleepMin,
      bedtimeAt: ms(wakeMidnight + Math.round(x.bedtimeMin * 60)),
    })),
  });
}

export { recoveryBand, stressLevel };

/** Recovery tags: stale baselines and a late-gained term. */
export const recoveryTags = (r: RecoveryRow): MetricTag[] => [
  // Skin temperature isn't part of Recovery since version 17, so its stale baseline doesn't mark the score.
  ...(r.stale.some((k) => k !== "skinTemp") ? ["stale_baseline" as const] : []),
  ...(r.updated ? ["updated" as const] : []),
];

export function recoveryMetric(row: DayRow | undefined, isToday: boolean): Metric<number> {
  const r = row?.recovery;
  if (!r) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (r.value == null) return fromReason(r.reason, isToday, r.nightsLeft);
  return ok(r.value, r.provisional, recoveryTags(r));
}

/**
 * The night's need in minutes: the full need it was scored against (the evening's plan: baseline + strain + debt − naps,
 * version 16), else the baseline need on older rows.
 */
export const nightNeedMin = (s: Pick<SleepRow, "needHours" | "needMin"> | null | undefined): number | null =>
  s ? (s.needMin ?? s.needHours * 60) : null;

export function sleepMetric(row: DayRow | undefined, isToday: boolean): Metric<number> {
  const s = row?.sleep;
  if (!s) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (s.performance == null) return fromReason(s.reason, isToday);
  return ok(s.performance);
}

export function strainMetric(row: DayRow | undefined): Metric<number> {
  const s1 = row?.s1;
  const v = dayStrainOf(s1);
  return v != null ? ok(v) : none(hrReason(s1 ?? null));
}

export function stressNow(row: DayRow | undefined, isToday: boolean): Metric<{ value: number; level: "low" | "medium" | "high"; at: number | null; dayAverage: boolean }> {
  const st = row?.stress;
  if (!row?.s1 || row.s1.hrCount === 0) return none("band_not_worn");
  if (!st || st.average == null) return none("no_data");
  if (isToday && st.latest) return ok({ value: st.latest.value, level: stressLevel(st.latest.value), at: ms(st.latest.ts), dayAverage: false }, st.provisional);
  return ok({ value: st.average, level: stressLevel(st.average), at: null, dayAverage: true }, st.provisional);
}
