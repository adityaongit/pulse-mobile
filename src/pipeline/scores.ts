// Stage 2's per-day scorers, one per daily_scores column. Each reads the day and the fold (state built
// from earlier days only) and returns its row; the few that feed later days push onto the fold.
// stage2.ts calls them in a fixed order, which the pushes depend on. From Pulse's src/server/pipeline/scores.ts; the
// mobile changes (Training load's missing Effort, Pulse Age's HR coverage) are marked where they are.
import type { ReasonCode } from "@/lib/reasons";
import { addDays, fractionalYears, localMidnight, localMinutes, wholeYears } from "@/lib/time";
import { forecast as recoveryForecast } from "@/core/scoring/forecast";
import { evaluateWithTrainingLoad, type ReadinessDay } from "@/core/scoring/readiness";
import { creditedSleepMin, hypnogramMetrics, ledger, minNeedNights, personalizedNeedHours, sleepPerformance, sleepPerformanceParts } from "@/core/scoring/sleep";
import { toStrainScale } from "@/core/scoring/strain";
import { foldDaytimeBaseline } from "@/core/scoring/stressBase";
import type { BaselineState } from "@/core/scoring/types";
import { fitnessEstimate as fitnessEstimateOf, type FitnessEstimateDay, fitnessLevel } from "@/core/algorithms/fitnessLevel";
import { healthMonitor, healthMonitorConfig, type HealthMonitorDay, type VitalKey } from "@/core/algorithms/healthMonitor";
import { HEALTHSPAN_STRENGTH_TYPES, healthspan, type HealthspanDay } from "@/core/algorithms/healthspan";
import type { OutcomeDay } from "@/core/algorithms/journalImpact";
import type { ReportDay } from "@/core/algorithms/reports";
import { sleepPlan, type SleepPlan } from "@/core/algorithms/sleepPlanner";
import { laggedPairs, poolPairs, sriOf, sriPairs, type SriPair, WHOOP_CONSISTENCY_DAYS, whoopConsistency } from "@/core/algorithms/sleepRegularity";
import { stress } from "@/core/algorithms/stress";
import { hrvStatus } from "@/core/algorithms/hrvStatus";
import {
  activityClass,
  addRecovery,
  aerobicTE,
  countdownRate,
  primaryBenefit,
  sessionRecoveryHours,
  teLabel,
} from "@/core/algorithms/trainingEffect";
import { trainingReadiness, type TrainingReadinessInput } from "@/core/algorithms/trainingReadiness";
import { trainingStatus, trainingStatusConfig } from "@/core/algorithms/trainingStatus";
import { classifyBloodPressure } from "@/core/scoring/bloodPressure";
import { byteOrder, type Data, round, type Segment, type Session } from "./data";
import { newEngineFold } from "./engine";
import type {
  FitnessRow,
  HealthMonitorRow,
  HealthspanRow,
  HrvStatusRow,
  PipelineOptions,
  RecoveryRow,
  SleepPlannerRow,
  SleepRow,
  Stage1Activity,
  Stage1Day,
  StressRow,
  TrainingLoadRow,
  TrainingRow,
  TrainingSession,
} from "./types";

/** A day's stage-1 results as stage 2 reads them back, with the recovery it showed last run. */
export type Cached = { s1: Stage1Day; activities: Stage1Activity[]; sessionRhr: number | null; recovery: RecoveryRow | null };

/** What stage 2 reads once, besides `Data`. */
export type Inputs = {
  cached: Map<string, Cached>;
  /** Per-minute series, loaded a batch of days at a time by stage 2 (only the day being scored is ever asked for). */
  stillHr: Pick<Map<string, (number | null)[]>, "get">;
  /** Version 22: the day's minute heart rate (stage 1's "hr" series), for the engine's Stress and Energy Bank. */
  hrSeries?: Pick<Map<string, (number | null)[]>, "get">;
  segments: Map<string, Segment[]>;
  tagOn: (day: string, tag: string) => boolean;
};

/** State folded over the days before the current one (baselines before today's fold). */
export type Fold = ReturnType<typeof newFold>;
export const newFold = () => ({
  hrvB: null as BaselineState | null,
  /** Recovery's HRV baseline in ln(ms) (version 17, recoveryHRVLnCfg); hrvB stays in ms for display. */
  hrvLnB: null as BaselineState | null,
  rhrB: null as BaselineState | null,
  respB: null as BaselineState | null,
  skinB: null as BaselineState | null,
  nights: [] as { day: string; hours: number }[],
  ledgerSeries: [] as [string, number | null][],
  readinessRows: [] as ReadinessDay[],
  monitorRows: [] as HealthMonitorDay[],
  hsRows: [] as HealthspanDay[],
  /** Today's newest SRI pair (scoreSleep: last night against the night before), for Pulse Age's row (scoreHealthspan). */
  sriPair: null as SriPair | null,
  /** Fitness Age's days: resting HR and bout-counted zone minutes, each minute once (hsRows' zone13Min doubles some). */
  fitnessDays: [] as FitnessEstimateDay[],
  outcomes: [] as OutcomeDay[],
  efforts: [] as (number | null)[],
  recoveries: [] as number[],
  aggregates: [] as (number | null)[],
  reportRows: [] as ReportDay[],
  wakeNights: [] as { day: string; wakeMin: number; efficiency: number | null; latencyMin: number | null; inBedMin: number }[],
  prevAcwr: null as number | null,
  /** Tonight's need as the planner made it this evening, for scoring the night it plans (scoreSleep, the next day). */
  prevPlan: null as { wakeDay: string; needMin: number } | null,
  /** Version 19: nightly HRV (ms) one per day, and HRV Status by day, for HRV Status and Training Status. */
  hrvNights: [] as (number | null)[],
  hrvStatusHist: [] as { status: HrvStatusRow["status"]; direction: "high" | "low" | null }[],
  /** Version 19: Recovery Time left at the end of the last day run to midnight. */
  recoveryTime: null as { day: string; hours: number } | null,
  /** Version 19: Sleep Performance and mean awake stress by day, VO2max readings, acute loads, the last main sleep's end. */
  sleepPerfHist: [] as (number | null)[],
  stressHist: [] as (number | null)[],
  vo2Hist: [] as { day: string; value: number }[],
  acuteHist: [] as (number | null)[],
  lastWake: null as number | null,
  lastWeight: null as number | null,
  /** Pace of Aging as last published (a Monday's row, version 18), carried through the week. */
  weeklyPace: null as { day: string; value: number | null } | null,
  /** Version 20: the Pulse engine's state (engine.ts). */
  engine: newEngineFold(),
});

/** One day's inputs. */
export type Day = ReturnType<typeof dayOf>;
export function dayOf(data: Data, inputs: Inputs, day: string, opts: PipelineOptions) {
  const cache = inputs.cached.get(day)!;
  const mainSession = data.mainOf.get(day);
  const main = mainSession ? nightOf(mainSession, inputs.segments.get(mainSession.id)) : null;
  const bpReadings = data.bloodPressureByDay.get(day) ?? [];
  // Representative daily blood pressure: latest reading on day D (sorted by ts descending, then id descending).
  // Standard clinical practice for spot measurements. If no reading on day D, bloodPressure is null
  // (no fabricated data; never carry forward into daily vitals).
  const bpLatest = bpReadings.length > 0
    ? bpReadings.slice().sort((a, b) => b.ts - a.ts || byteOrder(b.id, a.id))[0]
    : null;
  return {
    day,
    start: data.dayStart(day),
    end: data.dayStart(addDays(day, 1)),
    dm: data.metrics.get(day),
    cache,
    s1: cache.s1,
    worn: cache.s1.hrCount > 0,
    mainSession,
    main,
    naps: (data.sessionsByDay.get(day) ?? [])
      .filter((s) => s !== mainSession && !s.isMain)
      .map((s) => ({ id: s.id, start: s.startTs, end: s.endTs, asleepMin: s.asleepMin ?? 0 })),
    // noop truncates to whole years for sleep need; healthspan and fitness take the fraction.
    age: { whole: wholeYears(opts.profile.birthDate, day), years: fractionalYears(opts.profile.birthDate, day) },
    bpReadings,
    bpLatest,
  };
}

/** A Monday (its yyyy-MM-dd as a UTC date). */
const isMonday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

function nightOf(main: Session, segments: Segment[] | undefined): NonNullable<SleepRow["main"]> {
  const staged = main.stagesStatus === "SUCCEEDED" && !!segments?.length;
  const inBedS = Math.max(0, main.endTs - main.startTs);
  if (staged) {
    const h = hypnogramMetrics({
      start: main.startTs,
      end: main.endTs,
      stages: segments!.map((g) => ({ start: g.startTs, end: g.endTs, stage: g.stage })),
    });
    return {
      id: main.id,
      start: main.startTs,
      end: main.endTs,
      processed: main.processed,
      staged,
      inBedMin: h.tibS / 60,
      asleepMin: h.tstS / 60,
      awakeMin: (h.tibS - h.tstS) / 60,
      deepMin: h.deepMin,
      remMin: h.remMin,
      lightMin: h.lightMin,
      efficiency: h.efficiency,
      wakeEvents: h.disturbances,
      latencyMin: h.solS / 60,
    };
  }
  const asleepMin = main.asleepMin ?? 0;
  return {
    id: main.id,
    start: main.startTs,
    end: main.endTs,
    processed: main.processed,
    staged,
    inBedMin: inBedS / 60,
    asleepMin,
    awakeMin: main.awakeMin ?? Math.max(0, inBedS / 60 - asleepMin),
    deepMin: main.deepMin,
    remMin: main.remMin,
    lightMin: main.lightMin,
    efficiency: inBedS > 0 ? Math.min(1, (asleepMin * 60) / inBedS) : 0,
    wakeEvents: null,
    latencyMin: null,
  };
}

// ── Sleep ────────────────────────────────────────────────────────────────────

export function scoreSleep(data: Data, inputs: Inputs, f: Fold, d: Day, tz: string): SleepRow {
  const { day, main, naps, mainSession } = d;
  const recentNights = f.nights.slice(-28).map((n) => n.hours);
  const needHours = personalizedNeedHours(recentNights, d.age.whole);
  const { sri, newest, consistency } = sleepRegularity(data, inputs.cached, day, tz);
  f.sriPair = newest;
  // The night is scored against its full need, as the planner made it the evening before (baseline + strain + debt −
  // naps, WHOOP's Hours vs Needed); the first night, without a plan, against the baseline.
  const needMin = f.prevPlan?.wakeDay === day ? f.prevPlan.needMin : needHours * 60;
  const stressPct = main ? (d.s1.sleepStress?.pct ?? null) : null;
  const perfInput = main ? { asleepMin: main.asleepMin, needMin, efficiency: main.efficiency, consistency, stressPct } : null;
  const performance = perfInput ? sleepPerformance(perfInput) : null;
  const yesterdayNaps = (data.sessionsByDay.get(addDays(day, -1)) ?? []).filter((s) => !s.isMain);
  const creditedMin = creditedSleepMin(main?.asleepMin ?? null, yesterdayNaps.reduce((a, s) => a + (s.asleepMin ?? 0), 0));
  f.ledgerSeries.push([day, creditedMin]);
  const debtMin = ledger(f.ledgerSeries, needHours).magnitudeMin;
  const reason: ReasonCode | null = !mainSession
    ? "band_not_worn"
    : !mainSession.processed
      ? "awaiting_sleep_sync"
      : performance == null
        ? "no_data"
        : null;
  return {
    reason,
    main,
    naps,
    performance,
    parts: performance != null && perfInput ? sleepPerformanceParts(perfInput) : null,
    needHours,
    needMin,
    needNights: Math.min(recentNights.length, 28),
    creditedMin,
    debtMin,
    sri,
    consistency,
    stressPct,
  };
}

/**
 * SRI over the 7 nights ending on D: noon-to-noon periods, so tonight's sleep never counts toward today. Also the window's
 * newest pair (last night against the night before), which Pulse Age pools over its own window, each pair once; and
 * WHOOP-style Sleep Consistency (sleepRegularity.ts): the last 24 hours, noon to noon, against each of the 4 before.
 */
function sleepRegularity(data: Data, cached: Map<string, Cached>, day: string, tz: string): { sri: number | null; newest: SriPair | null; consistency: number | null } {
  const noon = (d: string) => localMidnight(d, tz) + 12 * 3600;
  const windowStart = noon(addDays(day, -7));
  const sessions: { start: number; end: number }[] = [];
  for (let k = -7; k <= 0; k++) {
    for (const s of data.sessionsByDay.get(addDays(day, k)) ?? []) sessions.push({ start: s.startTs, end: s.endTs });
  }
  // A period is covered when the band was worn for at least half of it, and (mobile) some sleep was recorded in it: with
  // heart rate but no sleep sessions (sleep not shared to Health Connect) every minute read as awake on both days, a
  // "perfectly regular" SRI of 100 that Pulse Age then credited.
  const covered = Array.from({ length: 7 }, (_, k) => {
    const pm = cached.get(addDays(day, k - 7))?.s1.hrMinutesPm ?? 0;
    const am = cached.get(addDays(day, k - 6))?.s1.hrMinutesAm ?? 0;
    const from = windowStart + k * 86_400;
    return pm + am >= 720 && sessions.some((s) => s.end > from && s.start < from + 86_400);
  });
  const pairs = sriPairs(sessions, windowStart, covered);
  const all = poolPairs(pairs);
  // The last 5 of the 7 periods: the last 24 hours and the 4 before it.
  const recent = WHOOP_CONSISTENCY_DAYS + 1;
  const lagged = laggedPairs(sessions, windowStart + (7 - recent) * 86_400, covered.slice(7 - recent));
  return { sri: all === null ? null : sriOf(all.same, all.pairs), newest: pairs[pairs.length - 1] ?? null, consistency: whoopConsistency(lagged) };
}

// ── Training load and readiness (today's strain counts toward today's ACWR) ──

export function scoreTrainingLoad(f: Fold, d: Day, rec: RecoveryRow): TrainingLoadRow {
  const { hrv, rhr, resp } = rec.inputs;
  // A day without an Effort (too little heart rate to score) is missing, not a rest day (mobile; the web counts a worn
  // day's missing Effort as 0, which on sparse heart rate dragged the 7-day load down: four such days in a steady week
  // took the ACWR from 1.00 to 0.64, "ramping down").
  // The load is the day's linear TRIMP (version 18, Garmin's model; the log-compressed Effort before).
  f.readinessRows.push({ day: d.day, hrv, rhr, resp, effort: d.s1.effort, load: d.s1.effort == null ? null : (d.s1.trimp ?? null) });
  const { readiness, trainingLoad } = evaluateWithTrainingLoad(f.readinessRows, d.day);
  return {
    acwr: readiness.acwr,
    acute: readiness.acute,
    chronic: readiness.chronic,
    acwrPrior: f.prevAcwr,
    monotony: readiness.monotony,
    level: readiness.level,
    state: trainingLoad.state,
    contiguousDays: trainingLoad.contiguousDays,
    ctl: trainingLoad.ctl,
    atl: trainingLoad.atl,
    tsb: trainingLoad.tsb,
  };
}

// ── Sleep Planner (tonight) ──────────────────────────────────────────────────

export function scorePlanner(f: Fold, d: Day, sleep: SleepRow, tz: string) {
  const { day, main } = d;
  if (main) {
    f.wakeNights.push({ day, wakeMin: localMinutes(main.end, tz), efficiency: main.efficiency, latencyMin: main.latencyMin ?? null, inBedMin: main.inBedMin });
    f.nights.push({ day, hours: main.asleepMin / 60 });
  }
  const tonightNeed = personalizedNeedHours(f.nights.slice(-28).map((n) => n.hours), d.age.whole);
  const plan = sleepPlan({
    baselineNeedHours: tonightNeed,
    strain: d.s1.effort == null ? null : toStrainScale(d.s1.effort),
    debtMin: sleep.debtMin,
    napMin: d.naps.reduce((a, n) => a + n.asleepMin, 0),
    nights: f.wakeNights,
    wakeDay: addDays(day, 1),
  });
  f.prevPlan = { wakeDay: addDays(day, 1), needMin: plan.needMin };
  const row: SleepPlannerRow =
    f.wakeNights.length < minNeedNights
      ? { reason: "calibrating", nightsLeft: minNeedNights - f.wakeNights.length, needMin: plan.needMin }
      : { reason: null, wakeDay: addDays(day, 1), nights: Math.min(f.wakeNights.length, 14), ...plan };
  return { row, plan, tonightNeed };
}

/** Tomorrow's Recovery forecast; needs 14 scored days. */
export const forecastOf = (f: Fold, d: Day, rec: RecoveryRow, plan: SleepPlan, tonightNeed: number) =>
  rec.value != null && f.recoveries.length >= 14
    ? recoveryForecast({
        recentCharge: f.recoveries,
        recentEffort: f.efforts.filter((e): e is number => e != null).slice(-14),
        todayEffort: d.s1.effort,
        plannedSleepHours: plan.needMin / 60,
        needHours: tonightNeed,
        needNights: f.nights.length,
      })
    : null;

// ── Stress (baseline from earlier days' aggregates) ──────────────────────────

export function scoreStress(f: Fold, d: Day, inputs: Inputs) {
  const { start, end } = d;
  const baseline = foldDaytimeBaseline(f.aggregates);
  f.aggregates.push(d.s1.dayAggregate);
  const still = inputs.stillHr.get(d.day) ?? [];
  const st = stress({
    start,
    end,
    hr: still.flatMap((bpm, m) => (bpm == null ? [] : [{ ts: start + m * 60, bpm }])),
    steps: [],
    excluded: [],
    baseline,
  });
  const last = st.minutes.findLastIndex((v) => v != null);
  const row: StressRow = {
    provisional: st.provisional,
    average: st.average,
    lowMin: st.lowMin,
    mediumMin: st.mediumMin,
    highMin: st.highMin,
    latest: last < 0 ? null : { ts: start + last * 60, value: st.minutes[last]! },
    longestHigh: longestRun(st.minutes, (v) => v != null && v >= 2, start),
    referenceHr: st.referenceHr,
  };
  return { row, minutes: st.minutes, series: st.minutes.map((v) => (v == null ? null : round(v, 2))) };
}

function longestRun(xs: (number | null)[], hit: (v: number | null) => boolean, start: number) {
  let best: { start: number; minutes: number } | null = null;
  let runStart = -1;
  for (let m = 0; m <= xs.length; m++) {
    if (m < xs.length && hit(xs[m])) {
      if (runStart < 0) runStart = m;
    } else if (runStart >= 0) {
      if (!best || m - runStart > best.minutes) best = { start: start + runStart * 60, minutes: m - runStart };
      runStart = -1;
    }
  }
  return best;
}

// ── HRV Status (Garmin-style, version 19) ──────────────────────────────────

/** HRV Status from the nights to today (hrvStatus.ts); its history feeds Training Status. */
export function scoreHrvStatus(f: Fold, rec: RecoveryRow): HrvStatusRow {
  f.hrvNights.push(rec.inputs.hrv);
  const row = hrvStatus(f.hrvNights.slice(-67));
  f.hrvStatusHist.push({ status: row.status, direction: row.status ? row.direction : null });
  return row;
}

// ── Training: Training Effect, Recovery Time, Training Readiness and Status (Garmin-style, version 19) ──

export function scoreTraining(
  data: Data,
  f: Fold,
  d: Day,
  rec: RecoveryRow,
  sleep: SleepRow,
  tl: TrainingLoadRow,
  stressRow: StressRow,
  stressMinutes: (number | null)[],
  hrv: HrvStatusRow,
  opts: PipelineOptions,
): TrainingRow {
  const { day, start, end, main, s1, dm } = d;
  // Activity class: the higher of the class from VO2max (Jackson's model on age, BMI and sex) and from the last 4 weeks'
  // training hours. BMI from the latest weight and the profile's height, else 25 (guess: no weight is known).
  if (dm?.weightKg != null) f.lastWeight = dm.weightKg;
  const h = opts.profile.heightCm;
  const bmi = f.lastWeight != null && h ? f.lastWeight / (h / 100) ** 2 : 25;
  let trainingSec = 0;
  for (let k = 0; k < 28; k++) for (const e of data.exercisesByDay.get(addDays(day, -k)) ?? []) trainingSec += e.endTs - e.startTs;
  const exs = new Map((data.exercisesByDay.get(day) ?? []).map((e) => [e.id, e]));
  const vo2ForClass = d.cache.activities.find((a) => a.vo2max != null)?.vo2max ?? dm?.vo2maxRun ?? dm?.vo2maxDaily ?? f.vo2Hist.at(-1)?.value ?? null;
  const ac = round(activityClass(vo2ForClass ?? 35, d.age.years, bmi, opts.profile.sex === "male", trainingSec / 3600 / 4), 2);
  const sessions: TrainingSession[] = [];
  for (const a of d.cache.activities) {
    const e = exs.get(a.id);
    if (!e || a.epocPeak == null) continue;
    const te = aerobicTE(a.epocPeak, ac);
    sessions.push({
      id: a.id,
      te,
      label: teLabel(te),
      benefit: primaryBenefit(te, a.maxHrSeconds ?? { below80: 0, from80: 0, above90: 0 }),
      epoc: a.epocPeak,
      recoveryHours: round(sessionRecoveryHours(te), 1),
      end: e.endTs,
    });
  }
  sessions.sort((x, y) => x.end - y.end || (x.id < y.id ? -1 : 1));

  // Recovery Time, minute by minute from midnight (carried on from yesterday's end): sessions add at their end; it counts
  // down faster asleep after a good night, slower in a stressed hour or after a poor night.
  const carried = f.recoveryTime?.day === addDays(day, -1) ? f.recoveryTime.hours : 0;
  f.recoveryTime = null;
  const full = day < data.last;
  const until = full ? end : s1.lastHrTs != null ? Math.min(end, s1.lastHrTs + 60) : end;
  const n = Math.max(0, Math.round((until - start) / 60));
  const asleepIn = (ts: number) => {
    if (main && ts >= main.start && ts < main.end) return "main" as const;
    const tonight = data.mainOf.get(addDays(day, 1));
    if (tonight && ts >= tonight.startTs && ts < tonight.endTs) return "tonight" as const;
    return d.naps.some((x) => ts >= x.start && ts < x.end) ? ("nap" as const) : null;
  };
  const hourStress = (m: number) => {
    const xs = stressMinutes.slice(Math.floor(m / 60) * 60, Math.floor(m / 60) * 60 + 60).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const stressByHour = new Map<number, number | null>();
  let left = carried;
  let atWake = main && main.end <= start ? carried : null;
  let si = 0;
  for (let m = 0; m < n; m++) {
    const ts = start + m * 60;
    if (atWake === null && main && ts >= main.end) atWake = left;
    while (si < sessions.length && sessions[si].end <= ts) {
      left = addRecovery(left, sessions[si].recoveryHours, tl.acwr);
      si++;
    }
    const where = asleepIn(ts);
    const hour = Math.floor(m / 60);
    if (!stressByHour.has(hour)) stressByHour.set(hour, hourStress(m));
    const rate = countdownRate({
      asleep: where !== null,
      nightPerformance: where === "tonight" || where === "nap" ? null : sleep.performance,
      stress: where ? null : stressByHour.get(hour)!,
    });
    left = Math.max(0, left - rate / 60);
  }
  for (; si < sessions.length; si++) left = addRecovery(left, sessions[si].recoveryHours, tl.acwr);
  if (full) f.recoveryTime = { day, hours: left };
  const rt = { atWake: round(atWake ?? left, 1), now: round(left, 1), until };

  // Training Readiness at wake (yesterday's load ratio, the recovery time left at wake) and now.
  f.sleepPerfHist.push(sleep.performance);
  const hoursAwake = main && f.lastWake != null ? (main.start - f.lastWake) / 3600 : null;
  if (main) f.lastWake = main.end;
  const base: Omit<TrainingReadinessInput, "recoveryHours" | "loadRatio"> = {
    sleep: sleep.performance,
    hrvStatus: hrv.status ? { status: hrv.status, direction: hrv.direction } : null,
    sleepHistory: f.sleepPerfHist.slice(-3),
    stressHistory: f.stressHist.slice(-3),
    hoursAwake,
  };
  const now = trainingReadiness({ ...base, recoveryHours: rt.now, loadRatio: tl.acwr });
  const wake = main ? trainingReadiness({ ...base, recoveryHours: rt.atWake, loadRatio: tl.acwrPrior }) : null;
  f.stressHist.push(stressRow.average);

  // Training Status from the VO2max trend, the load and HRV Status.
  const vo2Today = dm?.vo2maxRun ?? dm?.vo2maxDaily ?? null;
  if (vo2Today != null) f.vo2Hist.push({ day, value: vo2Today });
  f.acuteHist.push(tl.acute ?? null);
  const since = (k: number) => addDays(day, -k);
  const vo2 = f.vo2Hist.filter((v) => v.day > since(trainingStatusConfig.vo2Days)).map((v) => ({ daysAgo: daysApart(v.day, day), value: v.value }));
  const status = trainingStatus({
    vo2,
    loadRatio: tl.acwr,
    acute: tl.acute ?? null,
    acuteWeekAgo: f.acuteHist.length > 7 ? f.acuteHist[f.acuteHist.length - 8] : null,
    acuteHistory: f.acuteHist.slice(-trainingStatusConfig.medianDays),
    hrv: f.hrvStatusHist.slice(-trainingStatusConfig.strainedHrvDays),
    hasRecentVo2: f.vo2Hist.some((v) => v.day > since(30)),
  });

  return {
    activityClass: ac,
    sessions,
    recoveryTime: rt,
    readiness: now ? { reason: null, ...now, atWake: wake } : { reason: s1.hrCount === 0 && !main ? "band_not_worn" : "calibrating" },
    status: status ? { reason: null, ...status } : { reason: tl.acwr == null ? "calibrating" : "no_data" },
  };
}

/** Whole days from a to b (yyyy-MM-dd). */
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// ── Health Monitor (nightly rows, oldest first) ──────────────────────────────

export function scoreHealthMonitor(f: Fold, d: Day, inputs: Inputs, rec: RecoveryRow): HealthMonitorRow {
  const { hrv, rhr, resp, skinTempDev } = rec.inputs;
  const spo2 = d.dm?.spo2Pct ?? null;
  f.monitorRows.push({ day: d.day, rhr, hrv, resp, spo2, skinTempDev });
  const hasVitals = rhr != null || hrv != null || resp != null || d.dm?.spo2Pct != null || skinTempDev != null;
  const yesterday = addDays(d.day, -1);
  const bp = d.bpLatest
    ? {
        systolic: d.bpLatest.systolicMmhg,
        diastolic: d.bpLatest.diastolicMmhg,
        category: classifyBloodPressure(d.bpLatest.systolicMmhg, d.bpLatest.diastolicMmhg),
        readingId: d.bpLatest.id,
        ts: d.bpLatest.ts,
      }
    : null;
  return !hasVitals
    ? { reason: d.mainSession ? "no_data" : "band_not_worn", bloodPressure: bp }
    : {
        reason: null,
        stale: rec.stale,
        bloodPressure: bp,
        ...healthMonitor(f.monitorRows, {
          alcohol: inputs.tagOn(yesterday, "alcohol"),
          sauna: inputs.tagOn(yesterday, "sauna"),
          travelPhaseJump: inputs.tagOn(yesterday, "travel"),
          alreadyUnwell: inputs.tagOn(yesterday, "illness"),
        }, googleRanges(d)),
      };
}

/**
 * Google's ranges for last night: resting HR and HRV from its personal-range roll-ups, skin temperature as
 * ± 2 of its 30-night SD around the baseline (the deviation's zero). A vital without one keeps Pulse's.
 */
function googleRanges(d: Day): Partial<Record<VitalKey, { low: number; high: number }>> {
  const m = d.dm;
  const out: Partial<Record<VitalKey, { low: number; high: number }>> = {};
  if (m?.rhrRangeLow != null && m.rhrRangeHigh != null) out.restingHr = { low: m.rhrRangeLow, high: m.rhrRangeHigh };
  if (m?.hrvRangeLow != null && m.hrvRangeHigh != null) out.hrv = { low: m.hrvRangeLow, high: m.hrvRangeHigh };
  if (m?.tempBaselineC != null && m.tempSdC != null && m.tempSdC > 0) {
    const half = healthMonitorConfig.rangeSigmas * m.tempSdC;
    out.skinTempDev = { low: -half, high: half };
  }
  return out;
}

// ── Healthspan ───────────────────────────────────────────────────────────────

/** Minutes with heart rate a day needs before its zone, strength and step counts count toward Pulse Age (12 h). */
export const HEALTHSPAN_MIN_HR_MINUTES = 720;

/** Pace of Aging is published on Mondays (WHOOP: weekly), once this many of the last 31 days have a Recovery score. */
export const PACE_MIN_RECOVERIES = 21;
export const PACE_RECOVERY_WINDOW_DAYS = 31;

export function scoreHealthspan(data: Data, f: Fold, d: Day, sleep: SleepRow, opts: PipelineOptions, rec?: RecoveryRow): HealthspanRow {
  const { day, dm, main, worn, s1 } = d;
  const strengthMin = (data.exercisesByDay.get(day) ?? [])
    .filter((e) => HEALTHSPAN_STRENGTH_TYPES.test(e.type))
    .reduce((a, e) => a + (e.endTs - e.startTs) / 60, 0);
  // Zone, strength and step counts need a day with most of its heart rate (mobile; the web takes any worn day): on a day
  // with a few hours of HR they read near 0 and cost years, when they are really unknown. SRI's coverage rule: 12 h of
  // minutes with HR.
  const covered = worn && s1.hrMinutesAm + s1.hrMinutesPm >= HEALTHSPAN_MIN_HR_MINUTES;
  // Zone time inside workouts or in bouts of 10+ minutes (stage 1): zones 1–3 from 40 % of the reserve (WHOOP's Zone 1
  // and ACSM's moderate floor, so an unfit person's brisk walk counts), zones 4–5 from 80 %. Each minute counts once, as
  // WHOOP's Healthspan counts time in zone (version 18; a minute at 60–80 % counted twice before, as moderate-equivalent
  // minutes). Unknown on rows stored before the bout rule.
  const bouts = covered ? s1.boutZoneSeconds : undefined;
  const zone13Sec = bouts ? (bouts.length === 3 ? bouts[0] + bouts[1] : bouts[0]) : null;
  const zone45Sec = bouts ? (bouts.length === 3 ? bouts[2] : bouts[1]) : null;
  const row: HealthspanDay = {
    day,
    sleepHours: main ? main.asleepMin / 60 : null,
    sri: sleep.sri,
    sriPair: f.sriPair,
    zone13Min: zone13Sec === null ? null : zone13Sec / 60,
    zone45Min: zone45Sec === null ? null : zone45Sec / 60,
    strengthMin: covered ? strengthMin : null,
    steps: covered ? (dm?.steps ?? null) : null,
    vo2maxRun: dm?.vo2maxRun ?? null,
    vo2maxDaily: dm?.vo2maxDaily ?? null,
    restingHr: dm?.rhrBpm ?? null,
    weightKg: dm?.weightKg ?? null,
    bodyFatPct: dm?.bodyFatPct ?? null,
  };
  f.hsRows.push(row);
  // Fitness Age and Pulse's own VO2max estimate from the last 7 days (fitnessLevel.ts, after noop's FitnessAgeEngine).
  // Pulse Age reads the estimate only when there is no measured or Fitbit VO2max. Its activity index takes real minutes
  // (active minutes a day, the share at 80 %+): the doubled 60–80 % minutes above are Pulse Age's dose only, and fed
  // here they made more days "active", lengthened them and shrank the vigorous share.
  const activeSec = bouts ? (bouts.length === 3 ? bouts[0] + bouts[1] : bouts[0]) : null;
  f.fitnessDays.push({ restingHr: row.restingHr, zone13Min: activeSec === null ? null : activeSec / 60, zone45Min: row.zone45Min });
  const fitnessEstimate = fitnessEstimateOf(f.fitnessDays.slice(-7), {
    age: d.age.years,
    sex: opts.profile.sex,
    maxHr: opts.profile.maxHr,
    waistCm: opts.profile.waistCm ?? null,
  });
  row.vo2maxEstimated = fitnessEstimate?.vo2max ?? null;
  const hs = healthspan(f.hsRows, { age: d.age.years, sex: opts.profile.sex, heightCm: opts.profile.heightCm ?? null }, day);
  // Pace of Aging, WHOOP's way (Healthspan pages, 2026-01-21 and 2026-04-23): updated weekly, once 21 of the last 31 days
  // have a Recovery. The daily value is computed every day and published on Monday's row; the week's other days carry it.
  const from = addDays(day, 1 - PACE_RECOVERY_WINDOW_DAYS);
  const recoveries = f.outcomes.filter((o) => o.day >= from && o.recovery != null).length + (rec?.value != null ? 1 : 0);
  if (isMonday(day)) f.weeklyPace = { day, value: hs && recoveries >= PACE_MIN_RECOVERIES ? hs.paceOfAging : null };
  const weekly = f.weeklyPace && f.weeklyPace.day > addDays(day, -7) ? f.weeklyPace : null;
  return hs
    ? { reason: null, age: d.age.years, ...hs, paceDaily: hs.paceOfAging, paceOfAging: weekly?.value ?? null, paceAsOf: weekly?.day ?? null, paceDays: recoveries, fitnessEstimate }
    : {
        reason: "calibrating",
        dataDays: f.hsRows.filter((r) => Object.entries(r).some(([k, v]) => k !== "day" && k !== "vo2maxEstimated" && v != null)).length,
        fitnessEstimate,
      };
}

// ── Fitness level: latest run VO2max in 90 days, else the latest daily value ──

export function scoreFitness(f: Fold, d: Day, opts: PipelineOptions): FitnessRow {
  const age = d.age.years;
  const cutoff = addDays(d.day, -89);
  const run = f.hsRows.findLast((r) => r.vo2maxRun != null && r.day >= cutoff);
  const daily = f.hsRows.findLast((r) => r.vo2maxDaily != null);
  const pick = run
    ? { v: run.vo2maxRun!, source: "run" as const, sourceDay: run.day }
    : daily
      ? { v: daily.vo2maxDaily!, source: "daily" as const, sourceDay: daily.day }
      : null;
  if (!pick) return { reason: "no_data" };
  return { reason: null, vo2max: pick.v, source: pick.source, sourceDay: pick.sourceDay, age, ...fitnessLevel(pick.v, age, opts.profile.sex) };
}

// ── Journal outcomes and the reports' day rows ───────────────────────────────

export function recordOutcomes(f: Fold, d: Day, rec: RecoveryRow, sleep: SleepRow, tl: TrainingLoadRow) {
  const { day, main, s1, dm } = d;
  f.outcomes.push({ day, recovery: rec.value, hrvZ: rec.hrvZ, sleepPerf: sleep.performance });
  f.reportRows.push({
    day,
    recovery: rec.value,
    // Daily Strain on the Pulse engine, a percent.
    strain: s1.engine?.strain?.value ?? null,
    sleepPerf: sleep.performance,
    sleepHours: main ? (main.asleepMin + d.naps.reduce((a, n) => a + n.asleepMin, 0)) / 60 : null,
    hrv: rec.inputs.hrv,
    rhr: rec.inputs.rhr ?? dm?.rhrBpm ?? null,
    acwr: tl.cardio?.ratio ?? null,
    loadStatus: tl.cardio?.status ?? null,
    sleepConsistency: sleep.consistency,
  });
}
