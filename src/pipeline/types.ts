// Stored shapes: the daily_scores JSON columns the queries read, and the options both stages take.
import type { ReasonCode } from "@/lib/reasons";
import type { ChargeDriver } from "@/core/scoring/drivers";
import type { RecoveryForecast } from "@/core/scoring/forecast";
import type { HrRecoveryResult } from "@/core/scoring/hrRecovery";
import type { BaselineState } from "@/core/scoring/types";
import type { BloodPressureProtocolReason } from "@/core/engine/bloodPressureProtocol";
import type { Drain, EnergyBand } from "@/core/engine/energyBank";
import type { FitnessCategory, FitnessEstimate } from "@/core/algorithms/fitnessLevel";
import type { HealthMonitorResult } from "@/core/algorithms/healthMonitor";
import type { BloodPressureCategory } from "@/core/scoring/bloodPressure";
import type { HealthspanResult } from "@/core/algorithms/healthspan";
import type { TagImpact } from "@/core/algorithms/journalImpact";
import type { SleepPlan } from "@/core/algorithms/sleepPlanner";
import type { Interval } from "@/core/algorithms/stress";
import type { HrvStatus } from "@/core/algorithms/hrvStatus";
import type { PrimaryBenefit, TeLabel } from "@/core/algorithms/trainingEffect";
import type { TrainingReadiness } from "@/core/algorithms/trainingReadiness";
import type { TrainingStatus } from "@/core/algorithms/trainingStatus";
import type { RestingHrSource } from "./restingHr";
import type { RecoveryBand } from "@/core/scoring/recovery";
import type { DayAggs } from "@/core/engine/days";
import type { LoadStatus } from "@/core/engine/strain";

/**
 * Bump on any scoring change; a mismatch at startup reruns both stages for every day.
 * 1: U5 scorers. 2: SRI consistency in sleep performance (U7), U10 pipeline. 3: one age helper
 * (healthspan and fitness age agree with whole years on birthdays). 4: local days open at the right instant
 * where DST starts at midnight (Santiago, Havana, Azores...), so the 23-hour day is the right one. 5: Pulse Age's
 * stored key is `pulseAge` (was a brand name), so stored healthspan rows rescore. 6: Google's inputs first (its daily
 * zones, resting HR, time in zones, skin-temperature baseline and personal ranges), four named zones. 7: five
 * display zones on heart-rate reserve (Strain's and WHOOP's 50/60/70/80/90%) in place of Google's four. 8: max HR
 * no longer from Google's PEAK zone (a flat 220), so zones and Strain use the person's own or Tanaka's.
 * 10 (mobile only; the web is at 9): resting HR carried up to 30 days, else estimated from the day's own still HR,
 * before the 60 bpm default (stage 1); Pulse Age's zone and strength terms only on days with 12 h of HR; Training
 * load leaves a day without an Effort out instead of counting 0; Pulse Age reports its term count, and its moderate-
 * activity input counts from 40 % of heart-rate reserve (stage 1's `moderateSeconds`), not from Zone 1's 50 %.
 * 11: Pulse Age rebuilt on WHOOP's Healthspan method (bout-counted zone minutes, `boutZoneSeconds`), and Fitness Age.
 * 12: its refinements (Paluch's step curves by age, a 60–80 % minute counted twice, 4.77 years per ln HR).
 * 13: Fitness Age's activity index reads real zone minutes, not Pulse Age's doubled ones; the sleep planner's wake times
 * are clock minutes on DST days (lib/time localMinutes).
 * 14: Pulse Age's sleep consistency pools its window's pairs of nights, each pair once, instead of averaging the daily
 * 7-day SRIs (which counted early nights several times).
 * 15 (WHOOP/Garmin alignment, docs/research/whoop-garmin.md, batch 1): zones on WHOOP's 2024 edges (Zone 1 from 40 % of
 * the reserve); Strain on continuous Banister TRIMP through 5.05 · ln(1 + 0.09 · TRIMP), with a waking floor for Day
 * Strain, 10-minute credit for quiet sparse readings and muscular load for strength-type sessions; max HR learned from
 * workout heart rate when the profile has none.
 * 16 (batch 2): Sleep Performance on WHOOP's 2025 four parts (hours against the night's full need, WHOOP-style 4-day
 * consistency, efficiency, Sleep Stress from sleeping heart rate); restorative sleep shown, not scored. Sleep need adds
 * WHOOP's patented strain sigmoid and a debt term capped at an hour (debt over 28 nights), within 6.5–11 h, and
 * bedtimes leave the typical minutes to fall asleep.
 * 17 (batch 3): Recovery on WHOOP's 2026 inputs: HRV z on ln(RMSSD) against a 21-night-half-life ln baseline, weights
 * 0.58 / 0.22 / 0.20, respiratory rate only lowering the score, skin temperature out (still in Health Monitor).
 * 18 (batch 4): Garmin's training load (linear TRIMP, a 10-day decaying acute load, a 28-day chronic load, ratio bands
 * 0.8 / 1.5 / 2.0; Strain Target's cap at 1.5); Energy Bank as a 24-hour Body Battery-style reserve (5–100, sleep charges
 * it, each day carries on from the last, a per-minute TRIMP drain); Halo Age counts zone minutes once, yoga, Pilates and
 * boot camp as strength, and publishes Pace of Aging on Mondays with 21 of 31 days scored for Recovery.
 * 19 (batch 5, new columns): HRV Status (`hrv_status`) and Garmin-style training (`training`: Aerobic Training Effect
 * from each workout's peak EPOC, which stage 1 now stores, Recovery Time, Training Readiness 1–100, Training Status);
 * VO2 max categories on Garmin's 40 / 60 / 80 / 95 percentiles; workouts auto-detected from 10 minutes (WHOOP, 2026).
 * 20 (the Pulse engine, docs/engine-plan.md Phase 3): Sleep Score, Sleep Bank, Consistency and Need, and Recovery from
 * every HRV and heart-rate sample labelled by sleep stage, against 60-day pooled baselines (src/core/engine); stage 1
 * keeps each day's aggregates (Stage1Day.engine).
 * 21 (Phase 4): Daily Strain as a percent (awake steps, waking units above zone 1, workouts' units), each workout's
 * units, TRIMP on the 60-day resting-HR baseline, EPOC and heart-rate recovery (Stage1Activity.engine), Cardio Load
 * (training_load.cardio) and Target Strain on the percent scale; the sleep need's strain term reads the new strain.
 * 22 (Phase 5): Stress on 0–100 from 6-minute slots on the local grid (heart rate against the 30-day awake distribution,
 * night HRV against its 30-day baseline), and Energy Bank as the engine's charge and drain machine, continuous across
 * midnight and shown from its eighth day; stage 1 keeps each day's HRV samples (Stage1Day.engine.hrv).
 * 23 (Phase 6): Pulse Age on the engine's nine hazard factors over the 28 days before each Monday, renormalized over the
 * factors present (at least 5); stage 1 keeps each day's zone seconds on % of max HR (engine.strain.zoneS).
 * 24 (Phase 7): Health Monitor's normal band is ±1 SD of the last 30 nights, the night shown included; journal impact is
 * the engine's pooled t-test (a 70 % interval) in place of the bootstrap.
 * 25: back in line with the reference study: the engine's zones on its own max HR (the profile's, else 220 − age, not
 * Tanaka's), and Pulse Age's weekly minutes as the 28-day sum × 0.25 over every day with data.
 * 26: Pulse Age stored on the week's Sunday (the screens show a week on its Sunday; same 28 days), and Health Monitor
 * without SpO2 (Health Connect has none).
 * 27: each workout keeps its zone seconds on the engine's zones (Stage1Activity.engine.zoneS), and the reports' training
 * balance is the engine's Training Load (Fatigue ÷ Fitness and its status).
 * 28: Pulse Age's steps are the day's step count, not Strain's awake steps (which left out walks and runs).
 * 29: Fitbit's values are the source of truth for every vital: Recovery, its baselines, Health Monitor, HRV Status,
 * Pulse Age and the reports read Fitbit's nightly HRV and the day's resting HR (dayRestingHr: Fitbit's daily value, else
 * the sleep-session estimate) instead of the engine's own aggregates of the night's samples.
 * 30: Pulse Age's VO2 max falls back to Pulse's own daily estimate when the 28 days have no Fitbit VO2 max.
 * 31: Blood pressure in Health Monitor (causal spot readings persisted in health_monitor, AHA/ACC classifications).
 * 32: Feature-gated blood pressure term in Pulse Age (protocol-grade evaluation over 90 days, manifest-driven spline).
 */
export const SCORING_VERSION = 32;

export type PipelineOptions = {
  timeZone: string;
  /** `waistCm` (mobile): optional, for the Nes 2011 VO2max estimate (fitnessLevel.ts). */
  profile: {
    birthDate: string;
    sex: "male" | "female";
    maxHr: number;
    /**
     * The Pulse engine's max HR (reference study, strain-load.md § Zone settings, shared-machinery.md § Profile): the
     * profile's own, else 220 − age; halo's `maxHr` (Tanaka, raised to the learned max) feeds halo's extras only.
     */
    engineMaxHr?: number;
    heightCm?: number | null;
    waistCm?: number | null;
    /** The profile's sleep goal, hours; null for the engine's 7.5 h. */
    sleepGoalHours?: number | null;
  };
};

export type BaselineSummary = { mean: number; sd: number; status: BaselineState["status"]; nValid: number } | null;

/** Stage 1, `daily_scores.strain`. */
export type Stage1Day = {
  /** Hash of the non-sample inputs; a change reruns stage 1 for the day. */
  key: string;
  hrCount: number;
  /** Minutes with HR before and after local noon (SRI coverage). */
  hrMinutesAm: number;
  hrMinutesPm: number;
  lastHrTs: number | null;
  restingHr: number;
  /**
   * Google's daily resting HR first, then Pulse's sleep-session estimate; then (mobile) the newest of either from the
   * 30 days before, an estimate from the day's own still HR, and 60 bpm (src/pipeline/restingHr.ts).
   */
  restingHrSource: RestingHrSource;
  maxHr: number;
  /** Effort 0–100 (Day Strain × 100 / 21), or null with too little HR. */
  effort: number | null;
  /**
   * The day's load in Banister TRIMP (version 15): heart rate above the waking floor outside workouts, all of it inside
   * them, plus the workouts' muscular load; what Day Strain maps and training load sums. Absent on older rows.
   */
  trimp?: number | null;
  /** This day's own median still waking heart rate as a share of the reserve (later days' floors read it); null with under 30 such minutes. */
  wakingHrr?: number | null;
  /** The waking floor Day Strain used, a share of the reserve (strain.ts). */
  floorHrr?: number;
  /** Zones 1–5 on heart-rate reserve: lower bounds (bpm) and seconds. */
  zoneLower: number[];
  zoneSeconds: number[];
  /** Seconds below Zone 1 ("Zone 0"); absent on days stored before version 9. */
  zoneBelowSeconds?: number;
  /**
   * Mobile, versions 10–14: seconds at 40–50 % of heart-rate reserve (ACSM moderate, then inside Zone 0), which Pulse
   * Age's moderate-activity input added to zones 1–3. Not written since version 15, whose Zone 1 starts at 40 %.
   */
  moderateSeconds?: number;
  /**
   * Mobile: Pulse Age's zone time as [40–80 %, ≥ 80 % of heart-rate reserve] seconds, counted only inside a workout or in
   * a bout of 10 minutes or more (healthspan.ts zoneBoutSeconds); absent on rows stored before the bout rule.
   */
  boutZoneSeconds?: [number, number] | [number, number, number];
  /**
   * Version 16: last night's Sleep Stress (sleepStress.ts), % of its asleep minutes with heart rate in a high-stress state,
   * and how many such minutes there were; null without stages or heart rate.
   */
  sleepStress?: { pct: number; minutes: number } | null;
  /** Stress Monitor's resting daytime HR for the day (independent of the baseline). */
  dayAggregate: number | null;
  stillMinutes: number;
  /**
   * Version 20: the Pulse engine's per-day aggregates from labelled samples (src/core/engine/days.ts): last night's HRV and
   * heart rate in sleep, the day's HRV and awake heart rate (with its histogram). Stage 2 pools them into baselines.
   */
  engine?: EngineDayAggs;
};

/**
 * The sample-based part of the engine's DayAggs (respiratory rate and temperature come from the daily row in stage 2),
 * and (version 21) Daily Strain, a percent (src/core/engine/strain.ts): steps taken awake, the waking units above zone 1
 * and the workouts' units; null on a day with no heart rate or steps.
 */
export type EngineDayAggs = Pick<DayAggs, "restingHRV" | "averageHRV" | "restingHR" | "inactiveHR"> & {
  /** `zoneS` (version 23): seconds in zones 0–5 on % of max HR, waking heart rate and workouts. */
  strain?: { value: number; steps: number; passiveUnits: number; workoutUnits: number; zoneS?: number[]; maxHr?: number } | null;
  /** Version 22: the day's HRV samples as [seconds after local midnight, ms], for Stress and Energy Bank in stage 2. */
  hrv?: [number, number][];
};

/**
 * Version 21: a workout on the Pulse engine: its cardio units and strain (a percent), Banister TRIMP on the 60-day
 * resting-HR baseline (null without one), peak EPOC and cardio focus, and heart-rate recovery (null below zone 4).
 */
export type EngineWorkout = {
  units: number;
  /** Version 27: seconds in zones 0–5 on % of max HR (the engine's zones). */
  zoneS?: number[];
  strain: number;
  trimp: number | null;
  epocPeak: number | null;
  focus: { lowAerobic: number; highAerobic: number; anaerobic: number } | null;
  hrr: { drop: number; startHr: number; endHr: number; startTs: number; endTs: number } | null;
};

/** Stage 1, `daily_scores.activities`. */
export type Stage1Activity = {
  id: string;
  /** Activity Strain as Effort 0–100: the session's cardio TRIMP (no waking floor) plus its muscular TRIMP. */
  effort: number | null;
  /** Version 15: the heart-rate part of the session's load, Banister TRIMP; null with too little HR. */
  cardioTrimp?: number | null;
  /** Version 15: the muscular part (strength-type sessions, strain.ts muscularTrimp); 0 for other types. */
  muscularTrimp?: number;
  /** Version 19: peak EPOC, ml/kg (trainingEffect.ts), on `vo2max`; null with too little HR. */
  epocPeak?: number | null;
  vo2max?: number;
  /** Version 19: seconds under 80 %, at 80 % and over, and over 90 % of max HR (Training Effect's primary benefit). */
  maxHrSeconds?: { below80: number; from80: number; above90: number } | null;
  hrCount: number;
  avgHr: number | null;
  maxHr: number | null;
  zoneSeconds: number[];
  zoneBelowSeconds?: number;
  hrr: HrRecoveryResult | null;
  /** Version 21: the workout on the Pulse engine. */
  engine?: EngineWorkout;
};

export type RecoveryRow = {
  value: number | null;
  reason: ReasonCode | null;
  nightsLeft?: number;
  provisional: boolean;
  /** Inputs whose baseline is stale today. */
  stale: string[];
  /** Terms the score used (respiratory rate counts only when raised; skin temperature not since version 17). */
  terms: string[];
  /** The score gained a term after it was first shown. */
  updated: boolean;
  inputs: { hrv: number | null; rhr: number | null; resp: number | null; sleepPerf: number | null; skinTempDev: number | null };
  baselines: { hrv: BaselineSummary; rhr: BaselineSummary; resp: BaselineSummary; skinTemp: BaselineSummary };
  /** Last night's HRV z as Recovery scored it: ln(ms) against the ln baseline since version 17. */
  hrvZ: number | null;
  drivers: ChargeDriver[];
  forecast: RecoveryForecast | null;
  forecastNightsLeft: number;
};

export type SleepRow = {
  reason: ReasonCode | null;
  main: {
    id: string;
    start: number;
    end: number;
    processed: boolean;
    staged: boolean;
    inBedMin: number;
    asleepMin: number;
    awakeMin: number;
    deepMin: number | null;
    remMin: number | null;
    lightMin: number | null;
    efficiency: number;
    wakeEvents: number | null;
    /** Version 16: minutes from getting into bed to the first sleep (staged nights), else null. */
    latencyMin?: number | null;
  } | null;
  naps: { id: string; start: number; end: number; asleepMin: number }[];
  /** 0–100: WHOOP's 2025 four parts (sleep.ts sleepPerformance) since version 16. */
  performance: number | null;
  /** Version 16: the four parts on 0–100 (null where the input was missing); null without a score. */
  parts?: { hours: number; consistency: number | null; efficiency: number; stress: number | null } | null;
  /** The personalised baseline need (upper quartile of 28 nights), hours; the debt ledger's need. */
  needHours: number;
  /** Version 16: the night's full need it was scored against (the evening's plan: baseline + strain + debt − naps), minutes. */
  needMin?: number;
  needNights: number;
  /** Main sleep plus yesterday's naps, the debt ledger's night. */
  creditedMin: number | null;
  debtMin: number;
  /** Raw SRI on [−100, 100] over the 7 nights ending on D (Pulse Age's sleep-regularity input). */
  sri: number | null;
  /**
   * 0–100: since version 16, WHOOP-style Sleep Consistency (the last 24 hours against each of the 4 days before,
   * sleepRegularity.ts laggedPairs); before, the 7-day SRI's display value.
   */
  consistency: number | null;
  /** Version 16: Sleep Stress, % of last night's asleep minutes in a high-stress state (sleepStress.ts); null without one. */
  stressPct?: number | null;
  /**
   * Version 20, the Pulse engine's Sleep Score inputs (src/core/engine/sleep.ts): asleep, deep and REM time as shares of
   * the need, the heart-rate dip, efficiency and the continuity factor; null where missing.
   */
  components?: Record<"asleep" | "deep" | "rem" | "hrDip" | "efficiency" | "continuity", number | null>;
  /** Version 20: the 7-day Sleep Bank, minutes, signed (debtMin is its negative part). */
  bankMin?: number;
};

export type StressRow = {
  provisional: boolean;
  average: number | null;
  lowMin: number;
  mediumMin: number;
  highMin: number;
  latest: { ts: number; value: number } | null;
  longestHigh: { start: number; minutes: number } | null;
  referenceHr: number | null;
};

export type EnergyBankRow =
  | { value: null; reason: ReasonCode; provisional: boolean }
  | {
      value: number;
      reason: null;
      provisional: boolean;
      /** The level at wake. */
      startLevel: number;
      wake: number;
      until: number;
      /** Points gained (sleep, calm minutes) and lost (negative), before the 5–100 clamp. */
      charged: number;
      drained: number;
      topDrains: Drain[];
      naps: Interval[];
      /** Version 18: where the curve starts (local midnight when it carries on from yesterday, else wake) and its level there. */
      from?: number;
      fromLevel?: number;
      /** Version 18: Garmin's Body Battery band of `value`. */
      band?: EnergyBand;
    };

export type TrainingLoadRow = {
  /** Acute ÷ chronic load (Garmin's Load Ratio, readiness.ts), or null. */
  acwr: number | null;
  /** Version 18: Garmin-style acute load (10-day decaying, normalised to 7 days) and chronic load (28-day mean of it), TRIMP. */
  acute?: number | null;
  chronic?: number | null;
  /** ACWR over the days before D (what Strain Target uses). */
  acwrPrior: number | null;
  monotony: number | null;
  level: string;
  state: string;
  contiguousDays: number;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** Version 21: Cardio Load on the Pulse engine. */
  cardio?: CardioLoadRow;
};

/**
 * Version 21, `training_load.cardio`: the Pulse engine's Cardio Load (src/core/engine/strain.ts): the day's TRIMP, ATL
 * and CTL, their ratio, how sure the status can be (0–1) and the status.
 */
export type CardioLoadRow = { load: number; atl: number; ctl: number; ratio: number | null; confidence: number; status: LoadStatus };

/**
 * Target Strain (version 21, the Pulse engine): today's range on the percent scale, the 14-day base it scales, the
 * Recovery band, and whether fewer than 14 days stood behind it. `acwrRule` is always null (halo's rule is gone).
 */
export type StrainTarget = { low: number; high: number; base: number | null; band: RecoveryBand; coldStart: boolean; acwrRule: null };

export type StrainTargetRow = ({ reason: null } & StrainTarget) | { reason: ReasonCode; nightsLeft?: number };

export type SleepPlannerRow =
  | ({ reason: null; wakeDay: string; nights: number } & SleepPlan)
  | { reason: ReasonCode; nightsLeft?: number; needMin: number };

export type HealthMonitorBP = {
  systolic: number;
  diastolic: number;
  category: BloodPressureCategory;
  readingId?: string;
  ts?: number;
};

export type HealthMonitorRow =
  | (HealthMonitorResult & { reason: null; stale: string[]; bloodPressure?: HealthMonitorBP | null })
  | { reason: ReasonCode; bloodPressure?: HealthMonitorBP | null };

export type HealthspanBloodPressureStatus = {
  eligible: boolean;
  reason?: BloodPressureProtocolReason | null;
  systolicMean?: number | null;
  diastolicMean?: number | null;
  readingCount: number;
  dayCount: number;
  spanDays?: number | null;
};

/**
 * `fitnessEstimate` (mobile): Fitness Age and Pulse's own VO2max estimate for the day, shown on Fitness. Since version 18
 * `paceOfAging` is the weekly value (published on Mondays, with 21 of the last 31 days scored for Recovery; `paceDays`
 * counts those days), `paceDaily` the day's own and `paceAsOf` the Monday it was published.
 */
export type HealthspanRow = ((HealthspanResult & {
  reason: null;
  age: number;
  paceDaily?: number | null;
  paceAsOf?: string | null;
  bloodPressureStatus?: HealthspanBloodPressureStatus | null;
}) | { reason: ReasonCode; dataDays: number }) & {
  fitnessEstimate?: FitnessEstimate | null;
};

export type FitnessRow =
  | { reason: null; vo2max: number; source: "run" | "daily"; sourceDay: string; percentile: number; category: FitnessCategory; age: number }
  | { reason: ReasonCode };

export type JournalImpactRow = { key: string; impacts: TagImpact[] };

/** Version 19: HRV Status (hrvStatus.ts), Garmin-style: the 7-day average against your baseline band. */
export type HrvStatusRow = HrvStatus;

/** Version 19: one workout's Garmin-style Aerobic Training Effect (trainingEffect.ts). */
export type TrainingSession = {
  id: string;
  /** 0–5, one decimal. */
  te: number;
  label: TeLabel;
  benefit: PrimaryBenefit;
  /** Peak EPOC, ml/kg. */
  epoc: number;
  /** Hours of Recovery Time it added on its own (before combining with what was left). */
  recoveryHours: number;
  /** Its end, unix seconds. */
  end: number;
};

/**
 * Version 19, `daily_scores.training`: Garmin-style training answers for the day. Recovery Time in hours at wake and at
 * `until` (the day's end, or the last heart rate today); Training Readiness at wake and now; Training Status.
 */
export type TrainingRow = {
  /** Activity class 0–10, what Training Effect is judged against. */
  activityClass: number;
  sessions: TrainingSession[];
  recoveryTime: { atWake: number; now: number; until: number };
  readiness: ({ reason: null; atWake: TrainingReadiness | null } & TrainingReadiness) | { reason: ReasonCode };
  status: ({ reason: null } & TrainingStatus) | { reason: ReasonCode };
};

/** One day's stage-2 columns, keyed by their daily_scores column name. */
export type Stage2Row = {
  recovery: RecoveryRow;
  sleep: SleepRow;
  training_load: TrainingLoadRow;
  strain_target: StrainTargetRow;
  sleep_planner: SleepPlannerRow;
  energy_bank: EnergyBankRow;
  stress: StressRow;
  health_monitor: HealthMonitorRow;
  healthspan: HealthspanRow;
  fitness: FitnessRow;
  journal_impact: JournalImpactRow;
  hrv_status: HrvStatusRow;
  training: TrainingRow;
};

/** Every Stage2Row key, once: `satisfies` fails the build when a column is added to one and not the other. */
export const STAGE2_COLUMNS = Object.keys({
  recovery: 1,
  sleep: 1,
  training_load: 1,
  strain_target: 1,
  sleep_planner: 1,
  energy_bank: 1,
  stress: 1,
  health_monitor: 1,
  healthspan: 1,
  fitness: 1,
  journal_impact: 1,
  hrv_status: 1,
  training: 1,
} satisfies Record<keyof Stage2Row, 1>) as (keyof Stage2Row)[];
