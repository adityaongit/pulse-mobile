import { PAUSE_EVERY, type Steps } from "@/lib/yield";

export const MIN_EXERCISE_SEC = 2 * 60;

/** How far apart two apps' copies of one workout can start or end and still be the same session (issue #15). */
const WINDOW_TOLERANCE_MS = 5 * 60_000;
/** How much of the longer interval the two copies must share. */
const MIN_OVERLAP = 0.7;

type ExerciseRecord = {
  metadata?: { id?: string; dataOrigin?: string; device?: { manufacturer?: string; model?: string; type?: number } };
  startTime: string;
  endTime: string;
  exerciseType: number;
  title?: string;
};

/**
 * The codes a watch and its companion app use for the same sport. Health Connect's types differ (a treadmill run is not
 * a road run, and a strength session can be "weightlifting", "strength training" or one named after a lift), but a
 * workout copied to two apps keeps its window. A generic "other workout" can name any of them.
 */
const STRENGTH = 70;
const SPORT_FAMILIES: Record<number, number> = {
  1: STRENGTH, // BACK_EXTENSION
  3: STRENGTH, // BARBELL_SHOULDER_PRESS
  6: STRENGTH, // BENCH_PRESS
  7: STRENGTH, // BENCH_SIT_UP
  8: 8, // BIKING
  9: 8, // BIKING_STATIONARY
  15: STRENGTH, // CRUNCH
  17: STRENGTH, // DEADLIFT
  18: STRENGTH, // DUMBBELL_CURL_LEFT_ARM
  19: STRENGTH, // DUMBBELL_CURL_RIGHT_ARM
  20: STRENGTH, // DUMBBELL_FRONT_RAISE
  21: STRENGTH, // DUMBBELL_LATERAL_RAISE
  22: STRENGTH, // DUMBBELL_TRICEPS_EXTENSION_LEFT_ARM
  23: STRENGTH, // DUMBBELL_TRICEPS_EXTENSION_RIGHT_ARM
  24: STRENGTH, // DUMBBELL_TRICEPS_EXTENSION_TWO_ARM
  42: STRENGTH, // LAT_PULL_DOWN
  43: STRENGTH, // LUNGE
  49: STRENGTH, // PLANK
  53: 53, // ROWING
  54: 53, // ROWING_MACHINE
  56: 56, // RUNNING
  57: 56, // RUNNING_TREADMILL
  67: STRENGTH, // SQUAT
  68: 68, // STAIR_CLIMBING
  69: 68, // STAIR_CLIMBING_MACHINE
  70: STRENGTH, // STRENGTH_TRAINING
  73: 73, // SWIMMING_OPEN_WATER
  74: 73, // SWIMMING_POOL
  81: STRENGTH, // WEIGHTLIFTING
};
const OTHER_WORKOUT = 0;
const sameSport = (a: number, b: number) => {
  if (a === b || a === OTHER_WORKOUT || b === OTHER_WORKOUT) return true;
  const fa = SPORT_FAMILIES[a];
  const fb = SPORT_FAMILIES[b];
  // Two codes the map does not know are not evidence of a shared sport: `undefined === undefined` must not merge them.
  return fa !== undefined && fa === fb;
};

/** App plus device, the same source key the steps importer uses: a band and a phone from one app are different sources. */
const sourceOf = (r: ExerciseRecord) => {
  const app = r.metadata?.dataOrigin?.trim() ?? "";
  const d = r.metadata?.device;
  return { app, key: [app, d?.manufacturer ?? "", d?.model ?? "", d?.type ?? ""].join("|") };
};

/** Cross-source copies of one workout need matching sports and nearly the same interval; an app's own sessions stay. */
export function* uniqueExercises<T extends ExerciseRecord>(records: readonly T[]): Steps<T[]> {
  const ranked = records.map((record) => {
    const start = Date.parse(record.startTime);
    const end = Date.parse(record.endTime);
    return { record, start, end, eligible: Math.floor(end / 1000) - Math.floor(start / 1000) >= MIN_EXERCISE_SEC };
  });
  ranked.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) ||
    Number(!!b.record.title?.trim()) - Number(!!a.record.title?.trim()) ||
    (b.end - b.start) - (a.end - a.start) ||
    (a.record.metadata?.dataOrigin ?? "").localeCompare(b.record.metadata?.dataOrigin ?? "") ||
    (a.record.metadata?.id ?? "").localeCompare(b.record.metadata?.id ?? ""),
  );
  const kept: typeof ranked = [];
  let comparisons = 0;
  for (const candidate of ranked) {
    if (++comparisons % PAUSE_EVERY === 0) yield;
    const source = sourceOf(candidate.record);
    let duplicate = false;
    if (source.app) for (const other of kept) {
      if (++comparisons % PAUSE_EVERY === 0) yield;
      const otherSource = sourceOf(other.record);
      // Two sessions from the same app on the same device can be real; only a different source is a copy.
      if (!otherSource.app || otherSource.key === source.key) continue;
      if (!sameSport(candidate.record.exerciseType, other.record.exerciseType)) continue;
      if (Math.abs(candidate.start - other.start) > WINDOW_TOLERANCE_MS || Math.abs(candidate.end - other.end) > WINDOW_TOLERANCE_MS) continue;
      const duration = Math.max(candidate.end - candidate.start, other.end - other.start);
      const overlap = Math.min(candidate.end, other.end) - Math.max(candidate.start, other.start);
      if (duration > 0 && overlap / duration >= MIN_OVERLAP) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start).map(({ record }) => record);
}
