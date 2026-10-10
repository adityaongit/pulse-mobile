// The demo person's story. Day indices are 0-based from the first seeded day (the anchor), so the
// first "today" is index SEED_DAYS - 1. Days past it are ordinary days on the same weekly rhythm.
// generate.ts turns this into rows; nothing here draws randomness.
import { DEFAULT_JOURNAL_TAGS } from "../journalTags";

export const SEED_DAYS = 180;

/** The main sleep and its nightly metrics sync this long after waking, so "awaiting sleep sync" also shows just after wake. */
export const SLEEP_SYNC_DELAY_S = 30 * 60;
/** Skin temperature lands this long after the rest of the night, so this morning's Recovery gains a term ("Updated"). */
export const SKIN_TEMP_LAG_S = 90 * 60;

export const SCENARIO = {
  /** Recovery needs 7 accepted prior nights: days 0–6 are calibrating, day 7 is the first (provisional) score. */
  calibratingDays: 7,
  /** Fitbit reports skin temperature from the 4th night. */
  skinTempFromDay: 3,
  /** Weeks 8–10: harder sessions every day (ACWR above 1.3), then a deload week. */
  trainingBlock: { start: 49, end: 69 },
  deload: { start: 70, end: 76 },
  /** 15 nights without skin temperature, so its baseline goes stale (14 missing) and day 100 resumes against it. */
  skinTempGap: { start: 85, end: 99 },
  /** Wake days of the illness; severity per day below. No workouts until the day after it ends. */
  illness: { start: 118, end: 124 },
  /** The battery dies after waking on `day`; the band is back on at `untilHour` on `untilDay`. */
  bandOff: { day: 155, hour: 9, untilDay: 157, untilHour: 23 + 52 / 60 },
  /** A normal night whose HRV never computes. */
  noHrvNight: 164,
  /** Five nights of about 5 h asleep: sleep debt. */
  shortSleep: { start: 168, end: 172 },
} as const;

const ILLNESS_SEVERITY = [0.4, 0.85, 1, 1, 0.9, 0.6, 0.3];

/** 0–1 for the night ending on day i and the day itself; 1 is the plan's peak illness shift. */
export const illnessSeverity = (i: number) => ILLNESS_SEVERITY[i - SCENARIO.illness.start] ?? 0;

/** Peak effects of illness, alcohol and meditation on the next night. */
export const EFFECTS = {
  illness: { hrv: -0.25, rhr: 8, resp: 1.5, tempC: 0.6, spo2: -3 },
  alcohol: { hrv: 0.88, rhr: 3, resp: 0.3, tempC: 0.15 },
  meditation: { hrv: 1.05 },
};

/** Accumulated training fatigue: rises through the block, gone 10 days after it. Lowers HRV by this share. */
export function fatigue(i: number) {
  const { start, end } = SCENARIO.trainingBlock;
  if (i < start) return 0;
  if (i <= end) return (0.08 * (i - start + 1)) / (end - start + 1);
  return Math.max(0, 0.08 * (1 - (i - end) / 10));
}

export const isBandOffNight = (i: number) => i > SCENARIO.bandOff.day && i <= SCENARIO.bandOff.untilDay;
export const isBandOffDay = (i: number) => i >= SCENARIO.bandOff.day && i <= SCENARIO.bandOff.untilDay;
export const isShortSleep = (i: number) => i >= SCENARIO.shortSleep.start && i <= SCENARIO.shortSleep.end;
export const hasSkinTemp = (i: number) =>
  i >= SCENARIO.skinTempFromDay && (i < SCENARIO.skinTempGap.start || i > SCENARIO.skinTempGap.end);

export type ExerciseType = "RUNNING" | "BIKING" | "STRENGTH_TRAINING" | "WALKING";
export type WorkoutKind = {
  type: ExerciseType;
  name: string;
  minutes: [number, number];
  /** Share of heart-rate reserve held. */
  intensity: [number, number];
  intervals?: true;
};

export const WORKOUTS = {
  easyRun: { type: "RUNNING", name: "Easy run", minutes: [35, 45], intensity: [0.62, 0.7] },
  tempoRun: { type: "RUNNING", name: "Tempo run", minutes: [40, 50], intensity: [0.74, 0.8] },
  intervals: { type: "RUNNING", name: "Intervals", minutes: [48, 55], intensity: [0.62, 0.66], intervals: true },
  longRun: { type: "RUNNING", name: "Long run", minutes: [70, 85], intensity: [0.68, 0.72] },
  ride: { type: "BIKING", name: "Ride", minutes: [60, 80], intensity: [0.56, 0.64] },
  longRide: { type: "BIKING", name: "Long ride", minutes: [100, 120], intensity: [0.6, 0.65] },
  strength: { type: "STRENGTH_TRAINING", name: "Strength", minutes: [40, 55], intensity: [0.38, 0.48] },
  walk: { type: "WALKING", name: "Walk", minutes: [35, 55], intensity: [0.3, 0.38] },
} satisfies Record<string, WorkoutKind>;

export type WorkoutKey = keyof typeof WORKOUTS;

// Sessions by weekday, 0 = Sunday. Weekday sessions are in the evening, weekend ones in the morning.
const NORMAL_WEEK: WorkoutKey[][] = [["walk"], ["strength"], ["easyRun"], [], ["tempoRun"], [], ["ride"]];
const BLOCK_WEEK: WorkoutKey[][] = [
  ["longRun"],
  ["strength", "easyRun"],
  ["intervals"],
  ["ride"],
  ["tempoRun"],
  ["easyRun"],
  ["longRide"],
];
const DELOAD_WEEK: WorkoutKey[][] = [[], [], ["easyRun"], [], [], [], ["ride"]];

/** The sessions planned for day i (before the occasional skipped one). */
export function plannedWorkouts(i: number, weekday: number): WorkoutKey[] {
  const { illness, trainingBlock: block, deload } = SCENARIO;
  if ((i >= illness.start && i <= illness.end + 1) || isBandOffDay(i)) return [];
  if (i >= block.start && i <= block.end) return BLOCK_WEEK[weekday];
  if (i >= deload.start && i <= deload.end) return DELOAD_WEEK[weekday];
  return NORMAL_WEEK[weekday];
}

/** Block weeks get longer and harder: 0, 1, 2 inside the block, otherwise 0. */
export function blockWeek(i: number) {
  const { start, end } = SCENARIO.trainingBlock;
  return i >= start && i <= end ? Math.floor((i - start) / 7) : 0;
}

export { DEFAULT_JOURNAL_TAGS };

export type Tag = (typeof DEFAULT_JOURNAL_TAGS)[number]["tag"];

/** Daily chance of each default behaviour; generate.ts adds the scripted days. */
export const TAG_ODDS: Record<Tag, number> = {
  alcohol: 0.07,
  late_caffeine: 0.12,
  late_meal: 0.15,
  screen_in_bed: 0.3,
  meditation: 0.4,
  stretching: 0.35,
  sauna: 0.06,
  travel: 0.02,
  illness: 0,
};

/** Friday and Saturday drinks are likelier. */
export const ALCOHOL_WEEKEND_ODDS = 0.55;
/** Share of past days without a journal check-in. */
export const MISSED_CHECK_IN_ODDS = 0.08;
