// Shared by the screen queries: the query context, batched day loaders and the Metric builders. Ported from pulse
// src/server/queries/common.ts: reads go through the repositories, there is no user id (one person per install) and no
// demo mode (the phone only reads Google). Everything below the loaders is unchanged.
import type { ExtraKey } from "@/lib/extraMetrics";
import type { Store } from "../data/repos";
import type { ExerciseRow } from "../data/repos/sessions";
import { getProfile, type Profile } from "../profile";
import type {
  EnergyBankRow,
  FitnessRow,
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
} from "../pipeline";
import { STRENGTH_TYPES } from "@/core/algorithms/healthspan";
import { toStrainScale } from "@/core/scoring/strain";
import { stressLevel } from "@/lib/bands";
import { addDays, localDay, localMidnight } from "../time";
import type { ActivityKind, DayPoint, Metric, MetricTag, ReasonCode, SleepPlanVM, Span, StressDayChart, TimelineItem, TimePoint } from "./types";

export type QueryCtx = {
  store: Store;
  timeZone: string;
  profile: Profile;
  /** Unix seconds. */
  now: number;
};

/** The query context: throws `profile_missing` before onboarding (the root layout sends the person there first). */
export async function ctxOf(store: Store, now = Math.floor(Date.now() / 1000)): Promise<QueryCtx> {
  const profile = await getProfile(store);
  if (!profile) throw new Error("profile_missing");
  return { store, timeZone: profile.timeZone, profile, now };
}

export const todayOf = (ctx: QueryCtx) => localDay(ctx.now, ctx.timeZone);

export type MetricsRow = {
  day: string;
  hrvMs: number | null;
  rhrBpm: number | null;
  respBpm: number | null;
  nightlyTempC: number | null;
  spo2Pct: number | null;
  vo2maxDaily: number | null;
  vo2maxRun: number | null;
  steps: number | null;
  calories: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  /** Google's all-day minutes in Light + Moderate and Vigorous + Peak. */
  lightModerateMin: number | null;
  vigorousPeakMin: number | null;
  /** Google's 30-night SD of skin temperature from its baseline, °C. */
  tempSdC: number | null;
};

export type DayRow = {
  day: string;
  s1: Stage1Day | null;
  activities: Stage1Activity[];
  sessionRhr: number | null;
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
  metrics: MetricsRow | null;
  /** Google's shown-only daily roll-ups (src/lib/extraMetrics.ts); a key is absent when that day has none. */
  extra: Partial<Record<ExtraKey, number>>;
};

/** Every day in [from, to], one query per table (in parallel); days without rows come back empty. */
export async function loadDays(ctx: QueryCtx, from: string, to: string): Promise<Map<string, DayRow>> {
  const { store } = ctx;
  const [scoreRows, metricRows, extraRows] = await Promise.all([
    store.scores.readDays(from, to),
    store.daily.readMetricsBetween(from, to),
    store.daily.readValuesBetween(from, to),
  ]);
  const scores = new Map(scoreRows.map((r) => [r.day, r]));
  const metrics = new Map<string, MetricsRow>(metricRows.map((r) => [r.day, r]));
  const extra = new Map<string, Partial<Record<ExtraKey, number>>>();
  // daily_values.day is text ('latest' sorts after every date, so the range already excludes it).
  for (const r of extraRows) extra.set(r.day, { ...extra.get(r.day), [r.key as ExtraKey]: r.value });
  const out = new Map<string, DayRow>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = scores.get(d);
    out.set(d, {
      day: d,
      s1: (r?.strain as Stage1Day | null) ?? null,
      activities: (r?.activities as Stage1Activity[] | null) ?? [],
      sessionRhr: r?.sessionRhr ?? null,
      recovery: (r?.recovery as RecoveryRow | null) ?? null,
      sleep: (r?.sleep as SleepRow | null) ?? null,
      trainingLoad: (r?.trainingLoad as TrainingLoadRow | null) ?? null,
      strainTarget: (r?.strainTarget as StrainTargetRow | null) ?? null,
      sleepPlanner: (r?.sleepPlanner as SleepPlannerRow | null) ?? null,
      energyBank: (r?.energyBank as EnergyBankRow | null) ?? null,
      stress: (r?.stress as StressRow | null) ?? null,
      healthMonitor: (r?.healthMonitor as HealthMonitorRow | null) ?? null,
      healthspan: (r?.healthspan as HealthspanRow | null) ?? null,
      fitness: (r?.fitness as FitnessRow | null) ?? null,
      metrics: metrics.get(d) ?? null,
      extra: extra.get(d) ?? {},
    });
  }
  return out;
}

export const loadSeries = (ctx: QueryCtx, day: string, kind: string): Promise<(number | null)[] | null> => ctx.store.series.loadSeries(day, kind);

export const firstDay = (ctx: QueryCtx): Promise<string | null> => ctx.store.scores.firstDay();

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

export const toStrain = toStrainScale;
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

export type { ExerciseRow };

export const exercisesBetween = (ctx: QueryCtx, from: string, to: string): Promise<ExerciseRow[]> => ctx.store.sessions.exercisesBetween(from, to);

export function activityItem(e: ExerciseRow, row: DayRow | undefined): Extract<TimelineItem, { kind: "activity" }> {
  const kind = activityKind(e.type);
  const a = row?.activities.find((x) => x.id === e.id);
  const strain = a?.effort != null ? ok(toStrain(a.effort)) : none<number>(a && a.hrCount > 0 ? "insufficient_hr_data" : "band_not_worn");
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
    plans: p.plans.map((x, i) => ({
      key: PLAN_LABELS[i][0],
      label: PLAN_LABELS[i][1],
      share: x.share,
      sleepMin: x.sleepMin,
      bedtimeAt: ms(wakeMidnight + Math.round(x.bedtimeMin * 60)),
    })),
  });
}

export { recoveryBand, stressLevel } from "@/lib/bands";

/** Recovery tags: stale baselines and a late-gained term. */
export const recoveryTags = (r: RecoveryRow): MetricTag[] => [...(r.stale.length ? ["stale_baseline" as const] : []), ...(r.updated ? ["updated" as const] : [])];

export function recoveryMetric(row: DayRow | undefined, isToday: boolean): Metric<number> {
  const r = row?.recovery;
  if (!r) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (r.value == null) return fromReason(r.reason, isToday, r.nightsLeft);
  return ok(r.value, r.provisional, recoveryTags(r));
}

export function sleepMetric(row: DayRow | undefined, isToday: boolean): Metric<number> {
  const s = row?.sleep;
  if (!s) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (s.performance == null) return fromReason(s.reason, isToday);
  return ok(s.performance);
}

export function strainMetric(row: DayRow | undefined): Metric<number> {
  const s1 = row?.s1;
  return s1?.effort != null ? ok(toStrain(s1.effort)) : none(hrReason(s1 ?? null));
}

/** The day's stress line for the Stress Monitor screen and Home's tile: every 2nd still minute, spans, now (spec §7.9). */
export function stressChartOf(ctx: QueryCtx, row: DayRow | undefined, day: string, isToday: boolean, series: (number | null)[] | null, exs: ExerciseRow[]): Metric<StressDayChart> {
  const st = row?.stress;
  if (!st || st.average == null) return none(row?.s1?.hrCount ? "no_data" : "band_not_worn");
  const start = dayStartOf(ctx, day);
  return ok({ points: minutePoints(series, start, 2), spans: daySpansOf(row, start, exs), now: isToday && st.latest ? ms(st.latest.ts) : null }, st.provisional);
}

export function stressNow(row: DayRow | undefined, isToday: boolean): Metric<{ value: number; level: "low" | "medium" | "high"; at: number | null; dayAverage: boolean }> {
  const st = row?.stress;
  if (!row?.s1 || row.s1.hrCount === 0) return none("band_not_worn");
  if (!st || st.average == null) return none("no_data");
  if (isToday && st.latest) return ok({ value: st.latest.value, level: stressLevel(st.latest.value), at: ms(st.latest.ts), dayAverage: false }, st.provisional);
  return ok({ value: st.average, level: stressLevel(st.average), at: null, dayAverage: true }, st.provisional);
}
