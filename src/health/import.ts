// Pure mapping from Health Connect records to Pulse rows. No native imports: `react-native-health-connect` is
// referenced for its types only, and the two enum tables it exports are copied here (checked against the
// library's declarations at compile time) so this file and its tests run in plain Node.
//
// The rules mirror how the web app maps Google Health:
//   sleep   → one Session per SleepSession, `day` = local wake day, segments only for a full hypnogram; a staged
//             night with a stage Pulse can't place keeps its stage minutes as a summary
//   HR      → one HrSample per sample, deduped by second
//   steps   → interval counts spread over the minutes they cover, MAX across sources per minute, never the sum;
//             the day's total is the largest source's own total
//   metrics → one row per civil day, nightly values taken inside that day's main sleep
//   workouts→ one Exercise per ExerciseSession with active kcal and distance overlapping it
//   extras  → one DailyValue per day and catalogue key (floors, elevation, water, food, glucose, temperature)
//   log     → water, food and cycle records as read-only logged entries ("Logged in Fitbit")
import type { ReadType } from "@/health/connect";
import type {
  ExerciseType as LibExerciseType,
  MealType as LibMealType,
  MenstruationFlow as LibMenstruationFlow,
  OvulationTestResult as LibOvulationTestResult,
  RecordResult,
  SleepStageType as LibSleepStageType,
  Vo2MaxMeasurementMethod as LibVo2MaxMeasurementMethod,
} from "react-native-health-connect";

import type { LoggedEntryRow } from "@/data/store";
import type { DailyValue, Exercise, HrSample, HrvSample, Metrics, Segment, Session, Stage, StepsMinute } from "@/data/types";
import { emptyMetrics } from "@/data/types";
import { addDays, localDay, localMidnight } from "@/lib/time";
import { finish, PAUSE_EVERY, type Steps } from "@/lib/yield";

// ───────────────────────────── enum tables (copied; tsc checks they match the library) ─────────────────────────────

export const SleepStageType = {
  UNKNOWN: 0,
  AWAKE: 1,
  SLEEPING: 2,
  OUT_OF_BED: 3,
  LIGHT: 4,
  DEEP: 5,
  REM: 6,
} as const;

export const ExerciseType = {
  OTHER_WORKOUT: 0,
  BACK_EXTENSION: 1,
  BADMINTON: 2,
  BARBELL_SHOULDER_PRESS: 3,
  BASEBALL: 4,
  BASKETBALL: 5,
  BENCH_PRESS: 6,
  BENCH_SIT_UP: 7,
  BIKING: 8,
  BIKING_STATIONARY: 9,
  BOOT_CAMP: 10,
  BOXING: 11,
  BURPEE: 12,
  CALISTHENICS: 13,
  CRICKET: 14,
  CRUNCH: 15,
  DANCING: 16,
  DEADLIFT: 17,
  DUMBBELL_CURL_LEFT_ARM: 18,
  DUMBBELL_CURL_RIGHT_ARM: 19,
  DUMBBELL_FRONT_RAISE: 20,
  DUMBBELL_LATERAL_RAISE: 21,
  DUMBBELL_TRICEPS_EXTENSION_LEFT_ARM: 22,
  DUMBBELL_TRICEPS_EXTENSION_RIGHT_ARM: 23,
  DUMBBELL_TRICEPS_EXTENSION_TWO_ARM: 24,
  ELLIPTICAL: 25,
  EXERCISE_CLASS: 26,
  FENCING: 27,
  FOOTBALL_AMERICAN: 28,
  FOOTBALL_AUSTRALIAN: 29,
  FORWARD_TWIST: 30,
  FRISBEE_DISC: 31,
  GOLF: 32,
  GUIDED_BREATHING: 33,
  GYMNASTICS: 34,
  HANDBALL: 35,
  HIGH_INTENSITY_INTERVAL_TRAINING: 36,
  HIKING: 37,
  ICE_HOCKEY: 38,
  ICE_SKATING: 39,
  JUMPING_JACK: 40,
  JUMP_ROPE: 41,
  LAT_PULL_DOWN: 42,
  LUNGE: 43,
  MARTIAL_ARTS: 44,
  PADDLING: 46,
  PARAGLIDING: 47,
  PILATES: 48,
  PLANK: 49,
  RACQUETBALL: 50,
  ROCK_CLIMBING: 51,
  ROLLER_HOCKEY: 52,
  ROWING: 53,
  ROWING_MACHINE: 54,
  RUGBY: 55,
  RUNNING: 56,
  RUNNING_TREADMILL: 57,
  SAILING: 58,
  SCUBA_DIVING: 59,
  SKATING: 60,
  SKIING: 61,
  SNOWBOARDING: 62,
  SNOWSHOEING: 63,
  SOCCER: 64,
  SOFTBALL: 65,
  SQUASH: 66,
  SQUAT: 67,
  STAIR_CLIMBING: 68,
  STAIR_CLIMBING_MACHINE: 69,
  STRENGTH_TRAINING: 70,
  STRETCHING: 71,
  SURFING: 72,
  SWIMMING_OPEN_WATER: 73,
  SWIMMING_POOL: 74,
  TABLE_TENNIS: 75,
  TENNIS: 76,
  UPPER_TWIST: 77,
  VOLLEYBALL: 78,
  WALKING: 79,
  WATER_POLO: 80,
  WEIGHTLIFTING: 81,
  WHEELCHAIR: 82,
  YOGA: 83,
} as const;

export const MealType = {
  UNKNOWN: 0,
  BREAKFAST: 1,
  LUNCH: 2,
  DINNER: 3,
  SNACK: 4,
} as const;

export const MenstruationFlow = {
  UNKNOWN: 0,
  LIGHT: 1,
  MEDIUM: 2,
  HEAVY: 3,
} as const;

export const OvulationTestResult = {
  INCONCLUSIVE: 0,
  POSITIVE: 1,
  HIGH: 2,
  NEGATIVE: 3,
} as const;

export const Vo2MaxMeasurementMethod = {
  OTHER: 0,
  METABOLIC_CART: 1,
  HEART_RATE_RATIO: 2,
  COOPER_TEST: 3,
  MULTISTAGE_FITNESS_TEST: 4,
  ROCKPORT_FITNESS_TEST: 5,
} as const;

/**
 * VO2max methods that measure it (a lab's metabolic cart, or a field test: Cooper, multistage, Rockport), stored as
 * `vo2maxRun` and counted in full by Pulse Age. Heart-rate ratio and "other" (how a watch estimates it, Fitbit's
 * Cardio Fitness Score among them) are estimates, stored as `vo2maxDaily` and counted at half weight.
 */
const MEASURED_VO2_METHODS = new Set<number>([
  Vo2MaxMeasurementMethod.METABOLIC_CART,
  Vo2MaxMeasurementMethod.COOPER_TEST,
  Vo2MaxMeasurementMethod.MULTISTAGE_FITNESS_TEST,
  Vo2MaxMeasurementMethod.ROCKPORT_FITNESS_TEST,
]);

// Compile-time drift guards: every table must be identical to the library's (values are never emitted).
const _sleepStagesMatch: typeof LibSleepStageType = SleepStageType;
const _exerciseTypesMatch: typeof LibExerciseType = ExerciseType;
const _mealTypesMatch: typeof LibMealType = MealType;
const _flowsMatch: typeof LibMenstruationFlow = MenstruationFlow;
const _ovulationResultsMatch: typeof LibOvulationTestResult = OvulationTestResult;
const _vo2MethodsMatch: typeof LibVo2MaxMeasurementMethod = Vo2MaxMeasurementMethod;
void _vo2MethodsMatch;
void _sleepStagesMatch;
void _exerciseTypesMatch;
void _mealTypesMatch;
void _flowsMatch;
void _ovulationResultsMatch;

export type ExerciseTypeName = keyof typeof ExerciseType;

const exerciseTypeNames = new Map<number, ExerciseTypeName>(
  (Object.keys(ExerciseType) as ExerciseTypeName[]).map((k) => [ExerciseType[k], k]),
);

/** The `ExerciseType` key for a numeric exercise type; unknown codes read as OTHER_WORKOUT. */
export const exerciseTypeName = (code: number): ExerciseTypeName => exerciseTypeNames.get(code) ?? "OTHER_WORKOUT";

// ───────────────────────────── input ─────────────────────────────

export type SleepSessionRecord = RecordResult<"SleepSession">;
export type HeartRateRecord = RecordResult<"HeartRate">;
export type RestingHeartRateRecord = RecordResult<"RestingHeartRate">;
export type HrvRecord = RecordResult<"HeartRateVariabilityRmssd">;
export type RespiratoryRateRecord = RecordResult<"RespiratoryRate">;
export type OxygenSaturationRecord = RecordResult<"OxygenSaturation">;
export type SkinTemperatureRecord = RecordResult<"SkinTemperature">;
export type StepsRecord = RecordResult<"Steps">;
export type DistanceRecord = RecordResult<"Distance">;
export type ExerciseSessionRecord = RecordResult<"ExerciseSession">;
export type TotalCaloriesRecord = RecordResult<"TotalCaloriesBurned">;
export type ActiveCaloriesRecord = RecordResult<"ActiveCaloriesBurned">;
export type Vo2MaxRecord = RecordResult<"Vo2Max">;
export type WeightRecord = RecordResult<"Weight">;
export type BodyFatRecord = RecordResult<"BodyFat">;
export type FloorsClimbedRecord = RecordResult<"FloorsClimbed">;
export type ElevationGainedRecord = RecordResult<"ElevationGained">;
export type HydrationRecord = RecordResult<"Hydration">;
export type NutritionRecord = RecordResult<"Nutrition">;
export type BloodGlucoseRecord = RecordResult<"BloodGlucose">;
export type BodyTemperatureRecord = RecordResult<"BodyTemperature">;
/**
 * The library types it as instantaneous (`time`), but Health Connect's MenstruationPeriodRecord is an interval and the
 * native bridge sends `startTime`/`endTime`; both shapes are read.
 */
export type MenstruationPeriodRecord = Partial<RecordResult<"MenstruationPeriod">> & { startTime?: string; endTime?: string };
export type MenstruationFlowRecord = RecordResult<"MenstruationFlow">;
export type IntermenstrualBleedingRecord = RecordResult<"IntermenstrualBleeding">;
export type OvulationTestRecord = RecordResult<"OvulationTest">;

/** Everything one sync read, keyed by record type. Every list is optional so callers (and tests) pass what they have. */
export type HealthInput = {
  SleepSession?: SleepSessionRecord[];
  HeartRate?: HeartRateRecord[];
  RestingHeartRate?: RestingHeartRateRecord[];
  HeartRateVariabilityRmssd?: HrvRecord[];
  RespiratoryRate?: RespiratoryRateRecord[];
  OxygenSaturation?: OxygenSaturationRecord[];
  SkinTemperature?: SkinTemperatureRecord[];
  Steps?: StepsRecord[];
  Distance?: DistanceRecord[];
  ExerciseSession?: ExerciseSessionRecord[];
  TotalCaloriesBurned?: TotalCaloriesRecord[];
  ActiveCaloriesBurned?: ActiveCaloriesRecord[];
  Vo2Max?: Vo2MaxRecord[];
  Weight?: WeightRecord[];
  BodyFat?: BodyFatRecord[];
  FloorsClimbed?: FloorsClimbedRecord[];
  ElevationGained?: ElevationGainedRecord[];
  Hydration?: HydrationRecord[];
  Nutrition?: NutritionRecord[];
  BloodGlucose?: BloodGlucoseRecord[];
  BodyTemperature?: BodyTemperatureRecord[];
  MenstruationPeriod?: MenstruationPeriodRecord[];
  MenstruationFlow?: MenstruationFlowRecord[];
  IntermenstrualBleeding?: IntermenstrualBleedingRecord[];
  OvulationTest?: OvulationTestRecord[];
};

export type MappedRecords = {
  metrics: Metrics[];
  sessions: Session[];
  segments: Segment[];
  exercises: Exercise[];
  hr: HrSample[];
  hrv: HrvSample[];
  steps: StepsMinute[];
  dailyValues: DailyValue[];
  /** Water, food and cycle records as read-only log entries (`source: "health_connect"`). */
  externalEntries: LoggedEntryRow[];
};

// ───────────────────────────── helpers ─────────────────────────────

/** Unix seconds from an ISO instant (Health Connect gives millisecond precision). */
export const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export const MIN_SLEEP_SEC = 20 * 60;
export const MIN_EXERCISE_SEC = 2 * 60;

type Interval = { startTs: number; endTs: number };

const interval = (r: { startTime: string; endTime: string }): Interval => ({ startTs: ts(r.startTime), endTs: ts(r.endTime) });

/** Seconds that [a) and [b) share. */
const overlapSec = (a: Interval, b: Interval) => Math.max(0, Math.min(a.endTs, b.endTs) - Math.max(a.startTs, b.startTs));

/** Share of `r` inside `window` (1 for a zero-length record that starts inside it). */
function overlapShare(r: Interval, window: Interval) {
  const len = r.endTs - r.startTs;
  if (len <= 0) return r.startTs >= window.startTs && r.startTs < window.endTs ? 1 : 0;
  return overlapSec(r, window) / len;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** `{ day, share }` for every local day an interval touches, shares summing to 1. */
function spreadOverDays(r: Interval, tz: string): { day: string; share: number }[] {
  const first = localDay(r.startTs, tz);
  if (r.endTs <= r.startTs) return [{ day: first, share: 1 }];
  const out: { day: string; share: number }[] = [];
  for (let day = first; ; day = addDays(day, 1)) {
    const window = { startTs: localMidnight(day, tz), endTs: localMidnight(addDays(day, 1), tz) };
    const share = overlapShare(r, window);
    if (share > 0) out.push({ day, share });
    if (window.endTs >= r.endTs) break;
  }
  return out;
}

/** The local window [00:00, 12:00) of `day`: where a night's readings land when no sleep session exists. */
function morningWindow(day: string, tz: string): Interval {
  const startTs = localMidnight(day, tz);
  return { startTs, endTs: startTs + 12 * 3600 };
}

const inside = (t: number, w: Interval) => t >= w.startTs && t < w.endTs;

// The loops that grow with the records read (a day's heart-rate samples, a window of per-minute calorie records) are
// generators that pause at a `yield` every PAUSE_EVERY items, so the sync can give the JS thread back between pauses
// (sync.ts runs them with sliced(), src/lib/yield.ts). The exported functions run them straight through with finish(),
// so the results are the same either way.

// ───────────────────────────── sleep ─────────────────────────────

/** Health Connect's STAGE_TYPE_AWAKE_IN_BED (API 34+); the library's constants stop at REM. */
export const AWAKE_IN_BED = 7;

// Out of bed and awake in bed are both awake time in a full hypnogram (Fitbit writes them inside staged nights), so
// they keep the night staged; only SLEEPING (no stage known) and UNKNOWN make it a summary-only night.
const stageNames: Partial<Record<number, Stage>> = {
  [SleepStageType.AWAKE]: "awake",
  [SleepStageType.OUT_OF_BED]: "awake",
  [AWAKE_IN_BED]: "awake",
  [SleepStageType.LIGHT]: "light",
  [SleepStageType.DEEP]: "deep",
  [SleepStageType.REM]: "rem",
};

/** Stages that count as awake when the hypnogram is incomplete. */
const awakeLike = new Set<number>([SleepStageType.AWAKE, SleepStageType.OUT_OF_BED, AWAKE_IN_BED]);

export function mapSleep(records: SleepSessionRecord[], tz: string): { sessions: Session[]; segments: Segment[] } {
  const sessions: Session[] = [];
  const segments: Segment[] = [];

  for (const r of records) {
    const { startTs, endTs } = interval(r);
    if (endTs - startTs < MIN_SLEEP_SEC) continue;
    const id = r.metadata?.id ?? `hc-sleep-${startTs}-${endTs}`;
    const stages = (r.stages ?? []).filter((s) => ts(s.endTime) > ts(s.startTime));
    const full = stages.length > 0 && stages.every((s) => stageNames[s.stage] !== undefined);

    const base = { id, day: localDay(endTs, tz), startTs, endTs, isMain: false, processed: true };
    if (full) {
      const sec: Record<Stage, number> = { awake: 0, light: 0, deep: 0, rem: 0 };
      for (const s of stages) {
        const stage = stageNames[s.stage] as Stage;
        const a = ts(s.startTime);
        const b = ts(s.endTime);
        sec[stage] += b - a;
        segments.push({ sessionId: id, startTs: a, endTs: b, stage });
      }
      const m = (k: Stage) => Math.round(sec[k] / 60);
      sessions.push({
        ...base,
        stagesStatus: "SUCCEEDED",
        asleepMin: m("light") + m("deep") + m("rem"),
        awakeMin: m("awake"),
        deepMin: m("deep"),
        lightMin: m("light"),
        remMin: m("rem"),
      });
    } else {
      let asleepSec = 0;
      let awakeSec = 0;
      const sec = { light: 0, deep: 0, rem: 0 };
      for (const s of stages) {
        const d = ts(s.endTime) - ts(s.startTime);
        if (awakeLike.has(s.stage)) awakeSec += d;
        else asleepSec += d;
        const named = stageNames[s.stage];
        if (named === "light" || named === "deep" || named === "rem") sec[named] += d;
      }
      // A night the source did stage (it has deep or REM) but with a stage Pulse can't place (SLEEPING, UNKNOWN) is
      // what the web gets from Google as stagesStatus SUCCEEDED with an unreadable stage: no hypnogram (no segments),
      // but the stage minutes stay as the night's summary and the night still gets a Recovery. Dropping them made the
      // whole night unstaged: its restorative part scored 0 and Recovery said "no HRV" over one stray segment.
      const staged = sec.deep > 0 || sec.rem > 0;
      const m = (x: number) => (staged ? Math.round(x / 60) : null);
      sessions.push({
        ...base,
        stagesStatus: staged ? "SUCCEEDED" : null,
        asleepMin: Math.round((stages.length ? asleepSec : endTs - startTs) / 60),
        awakeMin: Math.round(awakeSec / 60),
        deepMin: m(sec.deep),
        lightMin: m(sec.light),
        remMin: m(sec.rem),
      });
    }
  }

  // The longest session of each wake day is the night's sleep; the rest are naps.
  const longest = new Map<string, Session>();
  for (const s of sessions) {
    const cur = longest.get(s.day);
    if (!cur || s.endTs - s.startTs > cur.endTs - cur.startTs) longest.set(s.day, s);
  }
  for (const s of longest.values()) s.isMain = true;

  sessions.sort((a, b) => a.startTs - b.startTs);
  return { sessions, segments };
}

// ───────────────────────────── heart rate ─────────────────────────────

/**
 * Every HRV reading (RMSSD, ms), one per second, last wins, in time order: the Pulse engine labels each by sleep stage
 * (Recovery's sleep-window mean, Stress during sleep), so the nightly mean on Metrics is not enough.
 */
export function mapHrv(records: HrvRecord[]): HrvSample[] {
  const bySecond = new Map<number, number>();
  for (const r of records) if (Number.isFinite(r.heartRateVariabilityMillis) && r.heartRateVariabilityMillis > 0) bySecond.set(ts(r.time), r.heartRateVariabilityMillis);
  return [...bySecond].sort((a, b) => a[0] - b[0]).map(([t, ms]) => ({ ts: t, ms }));
}

/** One sample per second, last wins; `clip` keeps only samples with clip.startTs <= ts < clip.endTs. */
export function mapHr(records: HeartRateRecord[], clip?: Interval): HrSample[] {
  return finish(mapHrSteps(records, clip));
}

/** mapHr, pausing as it goes. */
export function* mapHrSteps(records: HeartRateRecord[], clip?: Interval): Steps<HrSample[]> {
  const byTs = new Map<number, number>();
  let n = 0;
  for (const r of records) {
    for (const s of r.samples ?? []) {
      if (++n % PAUSE_EVERY === 0) yield;
      if (!(s.beatsPerMinute > 0)) continue;
      const t = ts(s.time);
      if (clip && !inside(t, clip)) continue;
      byTs.set(t, s.beatsPerMinute);
    }
  }
  return [...byTs].map(([t, bpm]) => ({ ts: t, bpm })).sort((a, b) => a.ts - b.ts);
}

// ───────────────────────────── steps ─────────────────────────────

/**
 * A record's source: its app and its device, as Pulse's web keys steps by platform, device and package. One app can
 * write from two devices (a band and the phone), which count the same walk. Measured totals (steps, distance, calories,
 * floors, elevation) take the largest source, never the sum of sources.
 */
type Sourced = { metadata?: { dataOrigin?: string; device?: { manufacturer?: string; model?: string; type?: number } } };

const sourceOf = (r: Sourced) => {
  const d = r.metadata?.device;
  return [r.metadata?.dataOrigin ?? "", d?.manufacturer ?? "", d?.model ?? "", d?.type ?? ""].join("|");
};

/** Per source, each record's count split evenly over the whole minutes it touches and summed per minute. */
function stepsBySource(records: StepsRecord[], clip?: Interval): Map<string, Map<number, number>> {
  const perSource = new Map<string, Map<number, number>>();
  for (const r of records) {
    if (!(r.count > 0)) continue;
    const { startTs, endTs } = interval(r);
    const first = Math.floor(startTs / 60) * 60;
    const last = endTs > startTs ? Math.ceil(endTs / 60) * 60 - 60 : first;
    const n = (last - first) / 60 + 1;
    const share = r.count / n;
    const source = sourceOf(r);
    let mins = perSource.get(source);
    if (!mins) perSource.set(source, (mins = new Map()));
    for (let m = first; m <= last; m += 60) {
      if (clip && !inside(m, clip)) continue;
      mins.set(m, (mins.get(m) ?? 0) + share);
    }
  }
  return perSource;
}

/**
 * Like Pulse's mapStepsMinutes: each record's count is split evenly over the whole minutes it touches, summed
 * within a source (app and device), then the MAX across sources is taken per minute (phone and watch both count the
 * same steps). Only for movement gating and the derived minutes, as on the web: the day's total is stepsPerDay.
 * `clip` keeps only minutes with clip.startTs <= ts < clip.endTs.
 */
export function mapSteps(records: StepsRecord[], clip?: Interval): StepsMinute[] {
  const best = new Map<number, number>();
  for (const mins of stepsBySource(records, clip).values()) {
    for (const [m, v] of mins) best.set(m, Math.max(best.get(m) ?? 0, v));
  }
  return [...best].map(([t, v]) => ({ ts: t, v })).sort((a, b) => a.ts - b.ts);
}

/**
 * The per-minute steps of the source with the most steps inside `clip` (ties: the first source key in byte order), for
 * the derived activity minutes (derive.ts). Unlike mapSteps' max across sources, a coarse source can't spread its
 * counts over minutes the main one saw as still. Read a day at a time, this is the source stepsPerDay counts for it.
 */
export function largestSourceSteps(records: StepsRecord[], clip?: Interval): StepsMinute[] {
  let best: { key: string; total: number; mins: Map<number, number> } | null = null;
  for (const [key, mins] of [...stepsBySource(records, clip)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    let total = 0;
    for (const v of mins.values()) total += v;
    if (!best || total > best.total) best = { key, total, mins };
  }
  return best ? [...best.mins].filter(([, v]) => v > 0).map(([t, v]) => ({ ts: t, v })).sort((a, b) => a.ts - b.ts) : [];
}

/**
 * Steps per civil day: the largest source's own total for the day, as the web takes Fitbit's daily roll-up. Summing
 * the per-minute maxima instead over-counts whenever sources split steps differently: a band's 600 steps in five
 * minutes against the phone's same 600 as one hourly record read as 5 × 120 + 55 × 10 = 1,150. Pass the same `clip` as
 * to mapSteps when reading a day at a time.
 */
export function stepsPerDay(records: StepsRecord[], tz: string, clip?: Interval): Map<string, number> {
  return finish(stepsPerDaySteps(records, tz, clip));
}

/** stepsPerDay, pausing as it goes: a local day per minute is an Intl call each. */
export function* stepsPerDaySteps(records: StepsRecord[], tz: string, clip?: Interval): Steps<Map<string, number>> {
  const out = new Map<string, number>();
  let n = 0;
  for (const mins of stepsBySource(records, clip).values()) {
    const days = new Map<string, number>();
    for (const [m, v] of mins) {
      if (++n % PAUSE_EVERY === 0) yield;
      const day = localDay(m, tz);
      days.set(day, (days.get(day) ?? 0) + v);
    }
    for (const [day, v] of days) out.set(day, Math.max(out.get(day) ?? 0, v));
  }
  return out;
}

// ───────────────────────────── exercises ─────────────────────────────

export function mapExercises(
  sessions: ExerciseSessionRecord[],
  activeCalories: ActiveCaloriesRecord[] = [],
  distance: DistanceRecord[] = [],
  tz: string,
): Exercise[] {
  return finish(mapExercisesSteps(sessions, activeCalories, distance, tz));
}

/** mapExercises, pausing as it goes: every workout reads every calorie and distance record. */
export function* mapExercisesSteps(
  sessions: ExerciseSessionRecord[],
  activeCalories: ActiveCaloriesRecord[] = [],
  distance: DistanceRecord[] = [],
  tz: string,
): Steps<Exercise[]> {
  const out: Exercise[] = [];
  let n = 0;
  for (const r of sessions) {
    const w = interval(r);
    if (w.endTs - w.startTs < MIN_EXERCISE_SEC) continue;
    // The workout's share of each record, summed within a source; the largest source wins (band and phone both measure).
    const largest = function* <T extends { startTime: string; endTime: string } & Sourced>(records: T[], value: (r: T) => number): Steps<number | null> {
      const bySource = new Map<string, number>();
      for (const r of records) {
        if (++n % PAUSE_EVERY === 0) yield;
        const share = overlapShare(interval(r), w);
        if (share > 0) bySource.set(sourceOf(r), (bySource.get(sourceOf(r)) ?? 0) + value(r) * share);
      }
      return bySource.size ? Math.max(...bySource.values()) : null;
    };
    const kcal = yield* largest(activeCalories, (c) => c.energy.inKilocalories);
    const metres = yield* largest(distance, (d) => d.distance.inMeters);
    out.push({
      id: r.metadata?.id ?? `hc-exercise-${w.startTs}-${w.endTs}`,
      day: localDay(w.startTs, tz),
      startTs: w.startTs,
      endTs: w.endTs,
      type: exerciseTypeName(r.exerciseType),
      name: r.title?.trim() || null,
      calories: kcal === null ? null : Math.round(kcal),
      distanceM: metres === null ? null : Math.round(metres),
    });
  }
  return out.sort((a, b) => a.startTs - b.startTs);
}

// ───────────────────────────── daily values ─────────────────────────────

/**
 * Per-day totals of interval records, each record pro-rated over the local days it spans. `measured`: a quantity
 * several sources measure at once (distance, calories, floors, elevation), so each source is totalled on its own and
 * the largest wins, as for steps; otherwise (logged water and food) every record adds.
 */
function* sumPerDay<T extends { startTime: string; endTime: string } & Sourced>(
  records: T[],
  value: (r: T) => number,
  tz: string,
  measured = false,
): Steps<Map<string, number>> {
  const bySource = new Map<string, Map<string, number>>();
  let n = 0;
  for (const r of records) {
    if (++n % PAUSE_EVERY === 0) yield;
    const v = value(r);
    if (!(v > 0)) continue;
    const key = measured ? sourceOf(r) : "";
    let days = bySource.get(key);
    if (!days) bySource.set(key, (days = new Map()));
    for (const { day, share } of spreadOverDays(interval(r), tz)) days.set(day, (days.get(day) ?? 0) + v * share);
  }
  const out = new Map<string, number>();
  for (const days of bySource.values()) for (const [day, v] of days) out.set(day, Math.max(out.get(day) ?? 0, v));
  return out;
}

/** Per-day means of instantaneous readings (glucose, temperature); readings at or below zero are bad data and skipped. */
function meanPerDay<T extends { time: string }>(records: T[], value: (r: T) => number, tz: string) {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of records) {
    const v = value(r);
    if (!(v > 0)) continue;
    const day = localDay(ts(r.time), tz);
    const a = acc.get(day) ?? { sum: 0, n: 0 };
    a.sum += v;
    a.n++;
    acc.set(day, a);
  }
  return new Map([...acc].map(([day, a]) => [day, a.sum / a.n]));
}

/**
 * The web's extra-metric keys and units (its EXTRA map over Google's roll-ups): distance km (2 dp), active calories
 * kcal, floors, elevation m, water ml, calories eaten kcal, protein / carbs / fat g, glucose mg/dL and core temperature
 * °C as day means. Interval records are pro-rated over the local days they span; measured totals take the largest
 * source (sumPerDay); a nutrient a food log lacks (the bridge sends 0 for it) adds nothing.
 */
export function mapDailyValues(input: HealthInput, tz: string): DailyValue[] {
  return finish(mapDailyValuesSteps(input, tz));
}

/** mapDailyValues, pausing as it goes. */
/** The daily keys mapDailyValuesSteps writes, each with the Health Connect type it sums: a sync replaces a key over its window when it read that type, so a day the source emptied loses its value. */
export const SOURCE_DAILY_KEYS: Readonly<Record<string, ReadType>> = {
  distance: "Distance",
  active_calories: "ActiveCaloriesBurned",
  floors: "FloorsClimbed",
  elevation: "ElevationGained",
  water: "Hydration",
  calories_in: "Nutrition",
  protein: "Nutrition",
  carbs: "Nutrition",
  fat: "Nutrition",
  glucose: "BloodGlucose",
  core_temp: "BodyTemperature",
};

export function* mapDailyValuesSteps(input: HealthInput, tz: string): Steps<DailyValue[]> {
  const out: DailyValue[] = [];
  const push = (days: Map<string, number>, key: string, fmt: (v: number) => number) => {
    for (const [day, v] of days) out.push({ day, key, value: fmt(v) });
  };
  const nutrition = input.Nutrition ?? [];
  push(yield* sumPerDay(input.Distance ?? [], (r) => r.distance.inMeters, tz, true), "distance", (v) => Math.round(v / 10) / 100);
  push(yield* sumPerDay(input.ActiveCaloriesBurned ?? [], (r) => r.energy.inKilocalories, tz, true), "active_calories", Math.round);
  push(yield* sumPerDay(input.FloorsClimbed ?? [], (r) => r.floors, tz, true), "floors", round1);
  push(yield* sumPerDay(input.ElevationGained ?? [], (r) => r.elevation.inMeters, tz, true), "elevation", round1);
  push(yield* sumPerDay(input.Hydration ?? [], (r) => r.volume.inMilliliters, tz), "water", Math.round);
  push(yield* sumPerDay(nutrition, (r) => r.energy?.inKilocalories ?? 0, tz), "calories_in", Math.round);
  push(yield* sumPerDay(nutrition, (r) => r.protein?.inGrams ?? 0, tz), "protein", round1);
  push(yield* sumPerDay(nutrition, (r) => r.totalCarbohydrate?.inGrams ?? 0, tz), "carbs", round1);
  push(yield* sumPerDay(nutrition, (r) => r.totalFat?.inGrams ?? 0, tz), "fat", round1);
  push(meanPerDay(input.BloodGlucose ?? [], (r) => r.level.inMilligramsPerDeciliter, tz), "glucose", round1);
  push(meanPerDay(input.BodyTemperature ?? [], (r) => r.temperature.inCelsius, tz), "core_temp", round2);
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
}

// ───────────────────────────── logged entries from Health Connect ─────────────────────────────

/** A record's stable id: Health Connect's own (it survives a re-read), else the kind and the record's time. */
const recordId = (r: { metadata?: { id?: string } }, kind: string, t: number) => `hc-${kind}-${r.metadata?.id ?? t}`;

/** Pulse's log vocabulary (src/queries/log.ts) for Health Connect's codes; unknown codes fall back as noted. */
const MEAL_NAME: Record<number, "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK"> = {
  [MealType.BREAKFAST]: "BREAKFAST",
  [MealType.LUNCH]: "LUNCH",
  [MealType.DINNER]: "DINNER",
  [MealType.SNACK]: "SNACK",
};
const FLOW_NAME: Record<number, "LIGHT" | "MEDIUM" | "HEAVY"> = {
  [MenstruationFlow.LIGHT]: "LIGHT",
  [MenstruationFlow.MEDIUM]: "MEDIUM",
  [MenstruationFlow.HEAVY]: "HEAVY",
};
// POSITIVE is the LH peak; HIGH the rise in estrogen or LH before it (Health Connect's doc); the rest as named.
const OVULATION_NAME: Record<number, "POSITIVE" | "ESTROGEN_SURGE" | "NEGATIVE" | "INDETERMINATE"> = {
  [OvulationTestResult.POSITIVE]: "POSITIVE",
  [OvulationTestResult.HIGH]: "ESTROGEN_SURGE",
  [OvulationTestResult.NEGATIVE]: "NEGATIVE",
  [OvulationTestResult.INCONCLUSIVE]: "INDETERMINATE",
};

/** Longest a period record is walked day by day (a bad interval must not spin). */
export const MAX_PERIOD_DAYS = 60;

/**
 * Water, food and cycle records as rows of Pulse's log, `source: "health_connect"` (the Journal shows them as
 * "Logged in Fitbit", read-only). Shapes match the Journal's own LogData (src/queries/log.ts):
 *   Hydration → hydration-log { ml }, on the record's start time.
 *   Nutrition → nutrition-log { name, meal, kcal, protein, carbs, fat }: one row per record (Fitbit logs one per food);
 *               a nutrient the record lacks is null; a meal Health Connect doesn't know is "UNKNOWN".
 *   MenstruationPeriod → menstrual-period { start, end, flow }, one per record, flow the heaviest MenstruationFlow of
 *               its days; flow days no period record covers are grouped into periods by consecutive days.
 *   IntermenstrualBleeding → a one-day menstrual-period with flow SPOTTING and `spotting: true` ("Spotting").
 *   OvulationTest → ovulation-test { result }.
 * Ids are Health Connect's record ids, so a re-read replaces rather than duplicates.
 */
export function mapExternalEntries(input: HealthInput, tz: string): LoggedEntryRow[] {
  const out: LoggedEntryRow[] = [];
  const row = (id: string, type: string, t: number, data: unknown, day = localDay(t, tz)): LoggedEntryRow => ({
    id,
    type,
    ts: t,
    day,
    data,
    createdAt: t,
    source: "health_connect",
  });

  for (const r of input.Hydration ?? []) {
    const ml = Math.round(r.volume.inMilliliters);
    if (!(ml > 0)) continue;
    const t = ts(r.startTime);
    out.push(row(recordId(r, "water", t), "hydration-log", t, { ml }));
  }

  for (const r of input.Nutrition ?? []) {
    const t = ts(r.startTime);
    const grams = (m: { inGrams: number } | undefined) => (m && m.inGrams > 0 ? round1(m.inGrams) : null);
    const data = {
      name: r.name?.trim() || null,
      meal: MEAL_NAME[r.mealType] ?? "UNKNOWN",
      kcal: Math.max(0, Math.round(r.energy?.inKilocalories ?? 0)),
      protein: grams(r.protein),
      carbs: grams(r.totalCarbohydrate),
      fat: grams(r.totalFat),
    };
    if (!data.name && data.kcal === 0 && data.protein === null && data.carbs === null && data.fat === null) continue; // says nothing
    out.push(row(recordId(r, "food", t), "nutrition-log", t, data));
  }

  // Flow per day (heaviest wins), then the periods: the source's own records first, then runs of uncovered flow days.
  const flowDays = new Map<string, number>();
  for (const r of input.MenstruationFlow ?? []) {
    const day = localDay(ts(r.time), tz);
    flowDays.set(day, Math.max(flowDays.get(day) ?? 0, r.flow ?? 0));
  }
  const periods: { id: string; start: string; end: string }[] = [];
  for (const r of input.MenstruationPeriod ?? []) {
    const startIso = r.startTime ?? r.time;
    if (!startIso) continue;
    const a = ts(startIso);
    const b = Math.max(a, ts(r.endTime ?? startIso) - 1); // an interval ending at midnight ends the day before
    periods.push({ id: recordId(r, "period", a), start: localDay(a, tz), end: localDay(b, tz) });
  }
  const covered = (day: string) => periods.some((p) => p.start <= day && day <= p.end);
  let run: string[] = [];
  const flush = () => {
    if (run.length) periods.push({ id: `hc-period-${run[0]}`, start: run[0], end: run[run.length - 1] });
    run = [];
  };
  for (const day of [...flowDays.keys()].filter((d) => !covered(d)).sort()) {
    if (run.length && addDays(run[run.length - 1], 1) !== day) flush();
    run.push(day);
  }
  flush();
  for (const p of periods) {
    let heaviest = 0;
    for (let d = p.start, i = 0; d <= p.end && i < MAX_PERIOD_DAYS; d = addDays(d, 1), i++) heaviest = Math.max(heaviest, flowDays.get(d) ?? 0);
    out.push(row(p.id, "menstrual-period", localMidnight(p.start, tz), { start: p.start, end: p.end, flow: FLOW_NAME[heaviest] ?? null }, p.start));
  }

  for (const r of input.IntermenstrualBleeding ?? []) {
    const t = ts(r.time);
    const day = localDay(t, tz);
    out.push(row(recordId(r, "spotting", t), "menstrual-period", t, { start: day, end: day, flow: "SPOTTING", spotting: true }, day));
  }

  for (const r of input.OvulationTest ?? []) {
    const t = ts(r.time);
    out.push(row(recordId(r, "ovulation", t), "ovulation-test", t, { result: OVULATION_NAME[r.result] ?? "INDETERMINATE" }));
  }

  return out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

// ───────────────────────────── metrics ─────────────────────────────

export type MetricsInput = Pick<
  HealthInput,
  | "RestingHeartRate"
  | "HeartRateVariabilityRmssd"
  | "RespiratoryRate"
  | "OxygenSaturation"
  | "SkinTemperature"
  | "TotalCaloriesBurned"
  | "Vo2Max"
  | "Weight"
  | "BodyFat"
>;

/**
 * One Metrics row per civil day that has anything. Nightly readings (HRV, respiration, SpO2, skin temperature)
 * are taken inside the day's main sleep session; without one, HRV falls back to 00:00–12:00 local and the others
 * to the whole day. `stepsByDay` comes from `stepsPerDay`.
 */
export function mapMetrics(input: MetricsInput, sessions: Session[], stepsByDay: Map<string, number>, tz: string): Metrics[] {
  return finish(mapMetricsSteps(input, sessions, stepsByDay, tz));
}

/** mapMetrics, pausing as it goes. */
export function* mapMetricsSteps(input: MetricsInput, sessions: Session[], stepsByDay: Map<string, number>, tz: string): Steps<Metrics[]> {
  const rows = new Map<string, Metrics>();
  const row = (day: string) => {
    let m = rows.get(day);
    if (!m) rows.set(day, (m = emptyMetrics(day)));
    return m;
  };
  const mainSleep = new Map<string, Interval>();
  for (const s of sessions) if (s.isMain) mainSleep.set(s.day, { startTs: s.startTs, endTs: s.endTs });

  // Days with anything nightly: a main sleep, or any instantaneous reading.
  const days = new Set<string>(mainSleep.keys());
  const instant = <T extends { time: string }>(xs: T[] | undefined) =>
    (xs ?? []).map((r) => ({ r, t: ts(r.time), day: localDay(ts(r.time), tz) })).sort((a, b) => a.t - b.t);
  const hrv = instant(input.HeartRateVariabilityRmssd);
  const rhr = instant(input.RestingHeartRate);
  const resp = instant(input.RespiratoryRate);
  const spo2 = instant(input.OxygenSaturation);
  const vo2 = instant(input.Vo2Max);
  const weight = instant(input.Weight);
  const fat = instant(input.BodyFat);
  for (const xs of [hrv, rhr, resp, spo2, vo2, weight, fat]) for (const x of xs) days.add(x.day);
  const skin = (input.SkinTemperature ?? []).map((r) => ({ r, w: interval(r) }));
  for (const { w } of skin) days.add(localDay(w.endTs, tz));

  for (const day of days) {
    yield;
    const night = mainSleep.get(day);
    const morning = morningWindow(day, tz);

    // Nightly readings: inside the main sleep, else a fallback window.
    const nightly = <T>(xs: { t: number; day: string; r: T }[], fallback: "morning" | "day") => {
      const inNight = night ? xs.filter((x) => inside(x.t, night)) : [];
      if (inNight.length) return inNight.map((x) => x.r);
      return xs.filter((x) => (fallback === "morning" ? inside(x.t, morning) : x.day === day)).map((x) => x.r);
    };
    const hrvMs = mean(nightly(hrv, "morning").map((r) => r.heartRateVariabilityMillis));
    const respBpm = mean(nightly(resp, "day").map((r) => r.rate));
    const spo2Pct = mean(nightly(spo2, "day").map((r) => r.percentage));
    const latestRhr = rhr.filter((x) => x.day === day).at(-1);
    const dayVo2 = vo2.filter((x) => x.day === day);
    const measuredVo2 = dayVo2.filter((x) => MEASURED_VO2_METHODS.has(x.r.measurementMethod)).at(-1);
    const estimatedVo2 = dayVo2.filter((x) => !MEASURED_VO2_METHODS.has(x.r.measurementMethod)).at(-1);
    // Weight and body fat: the latest reading of the local day, as the web maps Google's sample types.
    const latestWeight = weight.filter((x) => x.day === day).at(-1);
    const latestFat = fat.filter((x) => x.day === day).at(-1);

    // Skin temperature: records overlapping the main sleep (else the morning window), deltas pooled.
    const tempWindow = night ?? morning;
    const nightSkin = skin.filter(({ w }) => overlapSec(w, tempWindow) > 0 || (w.endTs === w.startTs && inside(w.startTs, tempWindow)));
    const deltas = nightSkin.flatMap(({ r }) => (r.deltas ?? []).map((d) => d.delta.inCelsius));
    const baseline = nightSkin.find(({ r }) => r.baseline)?.r.baseline?.inCelsius ?? null;
    const meanDelta = mean(deltas);
    let nightlyTempC: number | null = null;
    let tempBaselineC: number | null = null;
    if (meanDelta !== null || baseline !== null) {
      tempBaselineC = baseline ?? 0;
      nightlyTempC = tempBaselineC + (meanDelta ?? 0);
    }

    const has = hrvMs !== null || respBpm !== null || spo2Pct !== null || !!latestRhr || dayVo2.length > 0 || !!latestWeight || !!latestFat || nightlyTempC !== null;
    if (!has) continue;
    const m = row(day);
    m.hrvMs = hrvMs === null ? null : round1(hrvMs);
    m.rhrBpm = latestRhr ? latestRhr.r.beatsPerMinute : null;
    m.respBpm = respBpm === null ? null : round1(respBpm);
    m.spo2Pct = spo2Pct === null ? null : round1(spo2Pct);
    m.vo2maxDaily = estimatedVo2 ? round1(estimatedVo2.r.vo2MillilitersPerMinuteKilogram) : null;
    m.vo2maxRun = measuredVo2 ? round1(measuredVo2.r.vo2MillilitersPerMinuteKilogram) : null;
    m.weightKg = latestWeight ? round1(latestWeight.r.weight.inKilograms) : null;
    m.bodyFatPct = latestFat ? round1(latestFat.r.percentage) : null;
    m.nightlyTempC = nightlyTempC === null ? null : round2(nightlyTempC);
    m.tempBaselineC = tempBaselineC === null ? null : round2(tempBaselineC);
    m.tempSdC = null;
  }

  for (const [day, kcal] of yield* sumPerDay(input.TotalCaloriesBurned ?? [], (r) => r.energy.inKilocalories, tz, true)) {
    row(day).calories = Math.round(kcal);
  }
  for (const [day, steps] of stepsByDay) {
    if (steps > 0) row(day).steps = Math.round(steps);
  }

  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ───────────────────────────── everything ─────────────────────────────

/** Maps one sync's records to Pulse rows. `tz` is the person's IANA zone; civil days are local to it. */
export function mapRecords(input: HealthInput, tz: string): MappedRecords {
  const { sessions, segments } = mapSleep(input.SleepSession ?? [], tz);
  const hr = mapHr(input.HeartRate ?? []);
  const hrv = mapHrv(input.HeartRateVariabilityRmssd ?? []);
  const steps = mapSteps(input.Steps ?? []);
  const stepsByDay = stepsPerDay(input.Steps ?? [], tz);
  const exercises = mapExercises(input.ExerciseSession ?? [], input.ActiveCaloriesBurned, input.Distance, tz);
  const dailyValues = mapDailyValues(input, tz);
  const metrics = mapMetrics(input, sessions, stepsByDay, tz);
  const externalEntries = mapExternalEntries(input, tz);
  return { metrics, sessions, segments, exercises, hr, hrv, steps, dailyValues, externalEntries };
}
