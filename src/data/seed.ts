// Demo seed (KTD2, KTD3): a deterministic demo person written straight into the Store. Ported from Pulse's
// src/server/sources/seed/{generate,scenario}.ts; the generator's maths is the web's, only the writes changed
// (and the heart-rhythm records, which the Store has no slot for, are gone).
//
// Every day is a pure function of (anchor day, day index, time zone, max HR). Randomness comes from
// mulberry32 keyed by the day index and a stream name, so any day regenerates identically and the scenario (an
// illness week, a band-off day) looks the same whatever date the seed starts on. Rows are upserts, so a later
// seed with a later `now` adds what has happened since and never changes earlier days.
//
// mulberry32 and the shaping (HR follows steps, a workout lifts both, sleep HR sits under the day's
// resting figure) are adapted from Hælan's packages/core/src/testing/seed.ts (AGPL-3.0).
import { hash, mulberry32 } from "@/core/algorithms/journalImpact";
import { addDays, localDay, localMidnight } from "@/lib/time";
import { resolveMaxHr } from "@/pipeline/index";
import type { Store } from "./store";
import type { BloodPressureReadingRow, DailyValue, Exercise, HrvSample, Metrics, Profile, Segment, Session } from "./types";

// ---------------------------------------------------------------------------------------------
// The demo person's story (scenario.ts). Day indices are 0-based from the first seeded day (the anchor), so the
// first "today" is index SEED_DAYS - 1. Days past it are ordinary days on the same weekly rhythm.

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

/** The Journal's default behaviours (Pulse's src/server/journalTags.ts). */
export const DEFAULT_JOURNAL_TAGS = [
  { tag: "alcohol", label: "Alcohol" },
  { tag: "late_caffeine", label: "Late caffeine" },
  { tag: "late_meal", label: "Late meal" },
  { tag: "screen_in_bed", label: "Screen in bed" },
  { tag: "meditation", label: "Meditation" },
  { tag: "stretching", label: "Stretching" },
  { tag: "sauna", label: "Sauna" },
  { tag: "travel", label: "Travel" },
  { tag: "illness", label: "Illness" },
] as const;

export type Tag = (typeof DEFAULT_JOURNAL_TAGS)[number]["tag"];

/** Daily chance of each default behaviour; the generator adds the scripted days. */
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

// ---------------------------------------------------------------------------------------------
// Randomness and time

/**
 * One stream per (day index, purpose), so extra draws in one never move another. Keyed by the index, not the date:
 * the scenario then reads the same whenever the seed starts (the illness week always raises its alert).
 */
function rng(i: number, stream: string) {
  const next = mulberry32(hash(`${i}:${stream}`));
  return {
    u: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    /** About N(0, 1), bounded to ±3.5 (Irwin–Hall), so clamps rarely bind. */
    g: () => (next() + next() + next() + next() - 2) * Math.sqrt(3),
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, dp = 0) => Math.round(x * 10 ** dp) / 10 ** dp;
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export type SeedCtx = {
  anchor: string;
  timeZone: string;
  maxHr: number;
  /** Memo for the pure per-day functions a seed run asks for many times over (googleDerived reads 30 nights per day). */
  memo?: { behaviour: Map<number, Behaviour>; night: Map<number, Night> };
};
type Ctx = SeedCtx;

const dayOf = (ctx: Ctx, i: number) => addDays(ctx.anchor, i);
/** 0 → 1 across the seeded range, then flat: slow fitness and body-composition trends. */
const progress = (i: number) => Math.min(1, i / SEED_DAYS);
const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

// ponytail: clock hours are added to local midnight, so on a DST-change day events land an hour off.
/** Unix seconds at `hours` past local midnight of day i (negative: the evening before), on the minute. */
const at = (ctx: Ctx, i: number, hours: number) => localMidnight(dayOf(ctx, i), ctx.timeZone) + Math.round(hours * 60) * 60;

const memoized = <T>(map: Map<number, T> | undefined, i: number, f: () => T): T => {
  if (!map) return f();
  const hit = map.get(i);
  if (hit !== undefined) return hit;
  const v = f();
  map.set(i, v);
  return v;
};

// ---------------------------------------------------------------------------------------------
// The person, day by day

type Workout = { kind: WorkoutKind; start: number; minutes: number; intensity: number };
type Behaviour = { weekend: boolean; tags: Record<Tag, boolean>; workouts: Workout[]; hardness: number };

/** What the person did on day i: journal behaviours and workouts. */
const behaviour = (ctx: Ctx, i: number): Behaviour => memoized(ctx.memo?.behaviour, i, () => behaviourOf(ctx, i));
function behaviourOf(ctx: Ctx, i: number): Behaviour {
  const day = dayOf(ctx, i);
  const weekday = weekdayOf(day);
  const weekend = isWeekend(weekday);
  const r = rng(i, "behaviour");
  const tags = Object.fromEntries(DEFAULT_JOURNAL_TAGS.map(({ tag }) => [tag, r.chance(TAG_ODDS[tag])])) as Record<Tag, boolean>;
  if (weekday === 5 || weekday === 6) tags.alcohol ||= r.chance(ALCOHOL_WEEKEND_ODDS);
  if (illnessSeverity(i) > 0) tags.alcohol = false;
  tags.illness = illnessSeverity(i) >= 0.3;
  tags.travel ||= isBandOffDay(i);

  const week = blockWeek(i);
  const keys = plannedWorkouts(i, weekday).filter(() => !r.chance(0.1));
  const workouts: Workout[] = keys.map((key, n) => {
    const kind = WORKOUTS[key];
    // Weekend sessions after the late wake; weekday ones in the evening, or 07:30 for the first of two.
    const hour = weekend ? r.u(9.5, 10) : keys.length > 1 && n === 0 ? r.u(7.4, 7.6) : r.u(18.5, 19.1);
    return {
      kind,
      start: at(ctx, i, hour),
      minutes: Math.round(r.u(...kind.minutes) * (1 + 0.1 * week)),
      intensity: r.u(...kind.intensity) + 0.02 * week,
    };
  });
  /** Training stress felt the next night: minutes above easy effort. */
  const hardness = workouts.reduce((s, w) => s + (w.minutes * Math.max(0, w.intensity - 0.3)) / 20, 0);
  return { weekend, tags, workouts, hardness };
}

type Stage = "awake" | "light" | "deep" | "rem";
type StageSpan = { start: number; end: number; stage: Stage };

/** ~90-minute cycles: deep early, REM growing later, short wakes between. Alcohol halves early REM. */
function sleepStages(r: Rng, bed: number, wake: number, restless: number, alcohol: boolean): StageSpan[] {
  const total = Math.round((wake - bed) / 60);
  const finalAwake = Math.round(r.u(1, 6));
  const parts: [Stage, number][] = [];
  let planned = 0;
  const plan = (stage: Stage, minutes: number) => {
    parts.push([stage, minutes]);
    planned += minutes;
  };
  plan("awake", r.u(4, 14) + 10 * restless);
  for (let k = 0; planned < total; k++) {
    const deep = Math.max(0, 34 - 9 * k) * r.u(0.7, 1.2);
    const rem = Math.min(35, 8 + 7 * k) * r.u(0.75, 1.25) * (alcohol && k < 2 ? 0.75 : 1);
    const light = r.u(85, 100) - deep - rem;
    plan("light", light * 0.6);
    plan("deep", deep);
    plan("light", light * 0.4);
    plan("rem", rem);
    if (r.chance(0.35 + 0.4 * restless)) plan("awake", r.u(1, 4) + 6 * restless);
  }
  const segments: StageSpan[] = [];
  let t = 0;
  const push = (stage: Stage, minutes: number) => {
    if (minutes <= 0) return;
    const last = segments.at(-1);
    if (last?.stage === stage) last.end += minutes * 60;
    else segments.push({ start: bed + t * 60, end: bed + (t + minutes) * 60, stage });
    t += minutes;
  };
  for (const [stage, minutes] of parts) push(stage, Math.min(Math.round(minutes), total - finalAwake - t));
  push("awake", total - t);
  return segments;
}

type NightMetrics = { hrvMs: number | null; hrvDeepMs: number | null; rhrBpm: number; respBpm: number; nightlyTempC: number | null; spo2Pct: number };
type Night = {
  bed: number;
  wake: number;
  segments: StageSpan[];
  summary: { asleepMin: number; awakeMin: number; deepMin: number; lightMin: number; remMin: number };
  rhr: number;
  metrics: NightMetrics;
} | null;

/** The main sleep ending on the morning of day i, with that night's metrics; null when the band was off. */
const night = (ctx: Ctx, i: number): Night => memoized(ctx.memo?.night, i, () => nightOf(ctx, i));
function nightOf(ctx: Ctx, i: number): Night {
  if (isBandOffNight(i)) return null;
  const day = dayOf(ctx, i);
  const r = rng(i, "night");
  const prev = behaviour(ctx, i - 1);
  const alcohol = prev.tags.alcohol;
  const sev = illnessSeverity(i);
  const weekend = isWeekend(weekdayOf(day));

  let bedH = weekend ? r.u(-0.5, 0.4) : r.u(-1.15, -0.55);
  let wakeH = weekend ? r.u(7.9, 8.9) : r.u(6.6, 7.1);
  if (alcohol) bedH += 0.5;
  if (isShortSleep(i)) [bedH, wakeH] = [r.u(0.75, 1.2), r.u(6.25, 6.5)];
  if (sev > 0) [bedH, wakeH] = [r.u(-1.3, -1), r.u(8, 8.4)];
  if (i === SCENARIO.bandOff.untilDay + 1) bedH = Math.max(bedH, r.u(0.25, 0.4));
  const bed = at(ctx, i, bedH);
  const wake = at(ctx, i, wakeH);

  const restless = sev > 0 ? 1 : alcohol ? 0.6 : r.u(0, 0.2);
  const segments = sleepStages(r, bed, wake, restless, alcohol);
  const minutesIn = (stage: Stage) => segments.reduce((n, s) => n + (s.stage === stage ? (s.end - s.start) / 60 : 0), 0);
  const summary = {
    asleepMin: minutesIn("light") + minutesIn("deep") + minutesIn("rem"),
    awakeMin: minutesIn("awake"),
    deepMin: minutesIn("deep"),
    lightMin: minutesIn("light"),
    remMin: minutesIn("rem"),
  };

  // Couplings: short sleep lowers HRV and raises RHR; yesterday's training and alcohol carry into tonight.
  const shortBy = Math.max(0, 7 - summary.asleepMin / 60);
  const trend = progress(i);
  const ill = EFFECTS.illness;
  const hrv = clamp(
    52 *
      (1 + 0.06 * trend) *
      (1 - fatigue(i)) *
      (1 + ill.hrv * sev) *
      (alcohol ? EFFECTS.alcohol.hrv : 1) *
      (prev.tags.meditation ? EFFECTS.meditation.hrv : 1) *
      (1 - 0.02 * prev.hardness) *
      (1 - 0.04 * shortBy) *
      Math.exp(0.15 * r.g()),
    20,
    120,
  );
  const rhr = clamp(
    56 - 1.5 * trend + 20 * fatigue(i) + ill.rhr * sev + (alcohol ? EFFECTS.alcohol.rhr : 0) + 1.2 * shortBy + 0.4 * prev.hardness + 1.2 * r.g(),
    45,
    75,
  );
  const noHrv = i === SCENARIO.noHrvNight;
  const metrics: NightMetrics = {
    hrvMs: noHrv ? null : round(hrv, 1),
    hrvDeepMs: noHrv ? null : round(hrv * r.u(1.04, 1.14), 1),
    rhrBpm: Math.round(rhr),
    respBpm: round(14.6 + ill.resp * sev + (alcohol ? EFFECTS.alcohol.resp : 0) + 0.25 * r.g(), 1),
    nightlyTempC: hasSkinTemp(i) ? round(34.3 + ill.tempC * sev + (alcohol ? EFFECTS.alcohol.tempC : 0) + 0.12 * r.g(), 2) : null,
    spo2Pct: round(clamp(96.7 + ill.spo2 * sev + 0.5 * r.g(), 90, 99.5), 1),
  };
  return { bed, wake, segments, summary, rhr, metrics };
}

/** RMSSD relative to the night's mean by stage: higher in deep sleep, lower awake (demo values). */
const HRV_STAGE: Record<Stage, number> = { deep: 1.15, light: 1.0, rem: 0.92, awake: 0.8 };

/**
 * The night's HRV samples, one every 5 minutes from bed to wake as Fitbit writes them to Health Connect, around the
 * night's mean by stage. Its own random stream, so the rest of the seed reads the same as before it existed.
 */
function hrvSamples(i: number, n: NonNullable<Night>): HrvSample[] {
  if (n.metrics.hrvMs == null) return [];
  const r = rng(i, "hrv");
  const out: HrvSample[] = [];
  for (let t = n.bed; t < n.wake; t += 300) {
    const stage = n.segments.find((g) => t >= g.start && t < g.end)?.stage ?? "light";
    out.push({ ts: t, ms: round(clamp(n.metrics.hrvMs * HRV_STAGE[stage] * Math.exp(0.12 * r.g()), 5, 250), 1) });
  }
  return out;
}

/** Karvonen shares of heart-rate reserve where LIGHT, MODERATE, VIGOROUS and PEAK start (demo values). */
const ZONE_HRR = [0.4, 0.55, 0.7, 0.85];

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const sd = (xs: number[], m = mean(xs)) => Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);

/**
 * Google-shaped daily derivations for the night ending on day i, from the 30 seeded nights up to it (never later):
 * the day's zone bounds, the skin-temperature baseline (30-night median) and its SD, and personal ranges for
 * resting HR and HRV (mean ± 2 SD, once 14 nights exist).
 */
function googleDerived(ctx: Ctx, i: number, rhr: number) {
  const nights = Array.from({ length: Math.min(30, i + 1) }, (_, k) => night(ctx, i - k)?.metrics).filter((m) => m != null);
  const temps = nights.flatMap((m) => (m.nightlyTempC == null ? [] : [m.nightlyTempC]));
  // Like Fitbit after a long gap, no baseline until 4 of the last 14 nights have a reading, so the demo also
  // shows Pulse's own fallback baseline (and its stale state after the skin-temperature gap).
  const recent = nights.slice(0, 14).filter((m) => m.nightlyTempC != null).length;
  const sorted = [...temps].sort((a, b) => a - b);
  const median = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null;
  const range = (xs: number[]): [number | null, number | null] => {
    if (xs.length < 14) return [null, null];
    const m = mean(xs);
    const s = sd(xs, m);
    return [round(m - 2 * s, 1), round(m + 2 * s, 1)];
  };
  const [rhrRangeLow, rhrRangeHigh] = range(nights.map((m) => m.rhrBpm));
  const [hrvRangeLow, hrvRangeHigh] = range(nights.flatMap((m) => (m.hrvMs == null ? [] : [m.hrvMs])));
  return {
    hrZones: [...ZONE_HRR.map((p) => Math.round(rhr + p * (ctx.maxHr - rhr))), ctx.maxHr] as number[] | null,
    tempBaselineC: recent >= 4 ? round(median!, 2) : null,
    tempSdC: recent >= 4 ? round(sd(temps.map((t) => t - median!)), 2) : null,
    rhrRangeLow,
    rhrRangeHigh,
    hrvRangeLow,
    hrvRangeHigh,
  };
}

/** An afternoon nap on day i, more likely when ill or short on sleep. Naps carry no stages. */
function nap(ctx: Ctx, i: number) {
  if (isBandOffDay(i)) return null;
  const day = dayOf(ctx, i);
  const r = rng(i, "nap");
  const sev = illnessSeverity(i);
  const odds = sev >= 0.5 ? 0.9 : isShortSleep(i) ? 0.6 : isWeekend(weekdayOf(day)) ? 0.15 : 0.06;
  if (!r.chance(odds)) return null;
  const start = at(ctx, i, r.u(13.5, 15));
  const minutes = Math.round(sev > 0 ? r.u(45, 80) : r.u(20, 40));
  const awakeMin = Math.round(r.u(2, 5));
  return { start, end: start + minutes * 60, asleepMin: minutes - awakeMin, awakeMin };
}

/** Share of heart-rate reserve k minutes into a workout. */
function workoutIntensity(w: Workout, k: number) {
  let a = w.intensity + 0.04 * (k / w.minutes); // cardiac drift
  if (w.kind.intervals && k >= 10 && k < w.minutes - 5) a += (k - 10) % 5 < 3 ? 0.26 : -0.04; // 3 min hard, 2 easy
  if (w.kind.type === "STRENGTH_TRAINING") a += 0.1 * Math.sin((Math.PI * k) / 2); // sets
  return 0.3 + (a - 0.3) * Math.min(1, (k + 1) / 6); // warm-up
}

const HR_CADENCE_S = 15;
const BMR_KCAL = 1700;
/** Sleep HR relative to the night's resting HR, by stage. */
const STAGE_HR: Record<Stage, number> = { awake: 6, light: -2, deep: -4, rem: 1 };
const NO_NIGHT = {
  hrvMs: null,
  hrvDeepMs: null,
  rhrBpm: null,
  respBpm: null,
  nightlyTempC: null,
  spo2Pct: null,
  vo2maxDaily: null,
  hrZones: null as number[] | null,
  tempBaselineC: null,
  tempSdC: null,
  rhrRangeLow: null,
  rhrRangeHigh: null,
  hrvRangeLow: null,
  hrvRangeHigh: null,
};

type SeedSleep = { availableAt: number; row: Session; segments: Segment[] };

/** Everything that happens on local day i, before any "now" cut. Pure: same inputs, same output. */
export function generateDay(ctx: Ctx, i: number) {
  const day = dayOf(ctx, i);
  const start = localMidnight(day, ctx.timeZone);
  const end = localMidnight(addDays(day, 1), ctx.timeZone);
  const n = (end - start) / 60;
  const r = rng(i, "day");
  const b = behaviour(ctx, i);
  const lastNight = night(ctx, i);
  const tonight = night(ctx, i + 1);
  const napToday = nap(ctx, i);
  const sev = illnessSeverity(i);
  const rhr = lastNight?.rhr ?? 56;
  const effort = (a: number) => rhr + a * (ctx.maxHr - rhr);

  // Per minute: target HR, steps, activity kcal, asleep, band worn.
  const target = new Float32Array(n);
  const steps = new Uint8Array(n);
  const kcal = new Float32Array(n);
  const asleep = new Uint8Array(n);
  const worn = new Uint8Array(n).fill(1);
  /** Runs fn for each minute of the day inside [from, to); k is minutes since `from`. */
  const span = (from: number, to: number, fn: (m: number, k: number) => void) => {
    for (let m = Math.max(0, Math.ceil((from - start) / 60)); m < Math.min(n, Math.ceil((to - start) / 60)); m++) {
      fn(m, m - (from - start) / 60);
    }
  };

  // Awake: a daytime lift peaking mid-afternoon, plus pottering steps. Later layers override earlier ones.
  const base = (m: number) =>
    rhr + 13 + 5 * Math.max(0, Math.sin((Math.PI * (m / 60 - 7)) / 15)) + 6 * sev + (isShortSleep(i) ? 3 : 0);
  for (let m = 0; m < n; m++) {
    target[m] = base(m);
    if (r.chance(sev > 0 ? 0.05 : 0.14)) {
      steps[m] = Math.round(r.u(8, 60));
      target[m] += steps[m] * 0.1;
    }
  }
  const walk = (from: number, minutes: number, cadence: number, a: number) =>
    span(from, from + minutes * 60, (m) => {
      steps[m] = Math.round(cadence + r.u(-4, 4));
      target[m] = Math.max(target[m], effort(a));
    });
  const stressed = (from: number, minutes: number, lift: number) =>
    span(from, from + minutes * 60, (m) => {
      steps[m] = 0;
      target[m] = base(m) + lift;
    });
  if (sev === 0 && !b.weekend) {
    walk(at(ctx, i, r.u(8.6, 8.75)), r.u(12, 18), r.u(100, 112), r.u(0.28, 0.34)); // commute
    walk(at(ctx, i, r.u(17.6, 17.8)), r.u(12, 18), r.u(100, 112), r.u(0.28, 0.34));
    // Still, stressed desk time (HR up, no steps): what the Stress Monitor picks up.
    stressed(at(ctx, i, r.u(10, 11.5)), r.u(20, 45), r.u(12, 20));
    if (r.chance(isShortSleep(i) ? 1 : 0.5)) stressed(at(ctx, i, r.u(16, 16.8)), r.u(15, 30), r.u(10, 16));
  }
  // Stairs or a hurry; only a short errand when ill. This is the day's Edwards zone-1 time.
  walk(at(ctx, i, r.u(10, 20)), sev > 0 ? r.u(3, 5) : r.u(6, 12), r.u(112, 124), r.u(0.5, 0.56));

  const exerciseRows: Exercise[] = b.workouts.map((w, nth) => {
    const { type, name } = w.kind;
    const cadence = type === "RUNNING" ? r.u(160, 172) : type === "WALKING" ? r.u(108, 120) : 0;
    const endTs = w.start + w.minutes * 60;
    let calories = 0;
    span(w.start, endTs, (m, k) => {
      const a = workoutIntensity(w, k);
      target[m] = effort(a);
      steps[m] = Math.round(cadence ? cadence + r.u(-3, 3) : r.u(0, 12));
      kcal[m] = 3 + 14 * a;
      calories += kcal[m];
    });
    const metresPerMin = { RUNNING: 80 + 125 * w.intensity, BIKING: 250 + 300 * w.intensity, WALKING: 85, STRENGTH_TRAINING: 0 }[type];
    return {
      id: `seed-ex-${day}-${nth}`,
      day,
      startTs: w.start,
      endTs,
      type,
      name,
      calories: Math.round(calories),
      distanceM: metresPerMin ? Math.round(metresPerMin * w.minutes) : null,
    };
  });

  const sleepIn = (from: number, to: number, hr: (k: number) => number) =>
    span(from, to, (m, k) => {
      steps[m] = 0;
      kcal[m] = 0;
      asleep[m] = 1;
      target[m] = hr(k);
    });
  if (napToday) sleepIn(napToday.start, napToday.end, () => rhr + 2);
  for (const s of [lastNight, tonight]) {
    for (const g of s?.segments ?? []) {
      // HR settles over the first hour asleep.
      sleepIn(g.start, g.end, (k) => s!.rhr + STAGE_HR[g.stage] + 4 * Math.exp(-((g.start - s!.bed) / 60 + k) / 60));
    }
  }

  if (isBandOffDay(i)) {
    const { bandOff } = SCENARIO;
    const from = i === bandOff.day ? at(ctx, i, bandOff.hour) : start;
    span(from, i === bandOff.untilDay ? at(ctx, i, bandOff.untilHour) : end, (m) => {
      worn[m] = 0;
      steps[m] = 0;
    });
  }
  // Fitbit-style activity level per awake, worn minute (1 sedentary, 2 light, 3 moderate or vigorous) and Active
  // Zone Minutes (fat burn 1, cardio and peak 2), from the share of heart-rate reserve before sample noise.
  const level = new Uint8Array(n);
  const azm = new Uint8Array(n);
  for (let m = 0; m < n; m++) {
    if (!kcal[m]) kcal[m] = steps[m] * 0.04;
    if (worn[m] && !asleep[m]) {
      const a = (target[m] - rhr) / (ctx.maxHr - rhr);
      level[m] = a >= 0.4 || steps[m] >= 100 ? 3 : steps[m] > 0 || a >= 0.3 ? 2 : 1;
      azm[m] = a >= 0.6 ? 2 : a >= 0.4 ? 1 : 0;
    }
    target[m] += (asleep[m] ? 0.7 : 1.5) * r.g();
  }

  // HR every 15 s: eases toward the minute's target (fast up, slower down, which gives the
  // post-workout recovery curve), plus sample noise. 0 marks "not worn".
  const bpm = new Uint8Array((n * 60) / HR_CADENCE_S);
  const rise = 1 - Math.exp(-HR_CADENCE_S / 30);
  const fall = 1 - Math.exp(-HR_CADENCE_S / 130);
  let hr = target[0];
  for (let s = 0; s < bpm.length; s++) {
    const m = Math.floor((s * HR_CADENCE_S) / 60);
    if (!worn[m]) {
      hr = target[m];
      continue;
    }
    hr += (target[m] - hr) * (target[m] > hr ? rise : fall);
    bpm[s] = Math.round(clamp(hr + r.g(), 38, ctx.maxHr));
  }

  const sleeps: SeedSleep[] = [];
  if (lastNight) {
    const id = `seed-sleep-${day}`;
    sleeps.push({
      availableAt: lastNight.wake + SLEEP_SYNC_DELAY_S,
      row: { id, day, startTs: lastNight.bed, endTs: lastNight.wake, isMain: true, processed: true, stagesStatus: "SUCCEEDED", ...lastNight.summary },
      segments: lastNight.segments.map((g) => ({ sessionId: id, startTs: g.start, endTs: g.end, stage: g.stage })),
    });
  }
  if (napToday) {
    const { start: startTs, end: endTs, asleepMin, awakeMin } = napToday;
    sleeps.push({
      availableAt: endTs,
      row: { id: `seed-nap-${day}`, day, startTs, endTs, isMain: false, processed: true, stagesStatus: null, asleepMin, awakeMin, deepMin: null, lightMin: null, remMin: null },
      segments: [],
    });
  }

  const vo2 = 43 + 2.2 * progress(i) + (i > SCENARIO.trainingBlock.end ? 0.6 : 0);
  const run = exerciseRows.findLast((e) => e.type === "RUNNING");
  const weighAt = (lastNight?.wake ?? at(ctx, i, 7.5)) + 20 * 60;
  // Its own stream, so these draws move nothing else.
  const x = rng(i, "extras");
  return {
    day,
    start,
    end,
    /** One reading per 15 s from `start`; 0 = band not worn. */
    bpm,
    /** Per minute from `start`. */
    steps,
    kcal,
    level,
    azm,
    /** The day's floors, climbed in step with the steps. */
    floors: Math.round(clamp((sev > 0 ? 2 : b.weekend ? 9 : 7) + 3 * x.g(), 0, 30)),
    worn: worn.includes(1),
    sleeps,
    exercises: exerciseRows,
    nightly: lastNight && {
      availableAt: lastNight.wake + SLEEP_SYNC_DELAY_S,
      /** Last night's 5-minute HRV samples, synced with the night. */
      hrv: hrvSamples(i, lastNight),
      // Weekly, like Fitbit's resting-HR-based estimate.
      values: { ...lastNight.metrics, vo2maxDaily: i % 7 === 6 ? round(vo2 - 0.8 + 0.3 * r.g(), 1) : null, ...googleDerived(ctx, i, lastNight.rhr) },
    },
    runVo2: run && { at: run.endTs, value: round(vo2 + 0.4 * r.g(), 1) },
    weighIn: i % 30 === 2 && {
      at: weighAt,
      values: { weightKg: round(78.6 - 1.6 * progress(i) + 0.25 * r.g(), 1), bodyFatPct: round(21.5 - 1.6 * progress(i) + 0.3 * r.g(), 1) },
    },
    /** Written once the day is over; null on a missed check-in. */
    journal: r.chance(MISSED_CHECK_IN_ODDS) ? null : b.tags,
  };
}

export type SeedDay = ReturnType<typeof generateDay>;

// ---------------------------------------------------------------------------------------------
// Writing

/** The day's daily_metrics row as of `now`: today's steps and calories are running totals. */
function metricsAt(g: SeedDay, now: number): Metrics {
  const minutesDone = Math.min(g.steps.length, Math.floor((now - g.start) / 60));
  let steps = 0;
  let kcal = 0;
  for (let m = 0; m < minutesDone; m++) {
    steps += g.steps[m];
    kcal += g.kcal[m];
  }
  const night = g.nightly && g.nightly.availableAt <= now ? g.nightly.values : NO_NIGHT;
  const temp = g.nightly && g.nightly.availableAt + SKIN_TEMP_LAG_S <= now;
  return {
    day: g.day,
    ...night,
    // The temperature record carries its baseline and SD, so they land together.
    nightlyTempC: temp ? night.nightlyTempC : null,
    tempBaselineC: temp && night.nightlyTempC != null ? night.tempBaselineC : null,
    tempSdC: temp && night.nightlyTempC != null ? night.tempSdC : null,
    ...timeInZones(g, night.hrZones, now),
    vo2maxRun: g.runVo2 && g.runVo2.at <= now ? g.runVo2.value : null,
    steps: g.worn ? steps : null,
    calories: Math.round(BMR_KCAL * Math.min(1, (now - g.start) / (g.end - g.start)) + kcal),
    ...(g.weighIn && g.weighIn.at <= now ? g.weighIn.values : { weightKg: null, bodyFatPct: null }),
  };
}

/** Google's all-day time in zones as of `now`, from the day's samples and its zones; none without zones. */
function timeInZones(g: SeedDay, zones: number[] | null, now: number) {
  if (!zones) return { lightModerateMin: null, vigorousPeakMin: null };
  const [light, , vigorous] = zones;
  let lm = 0;
  let vp = 0;
  for (let s = 0; s < g.bpm.length && g.start + (s + 1) * HR_CADENCE_S <= now; s++) {
    const b = g.bpm[s];
    if (b >= vigorous) vp++;
    else if (b >= light) lm++;
  }
  const min = (n: number) => round((n * HR_CADENCE_S) / 60, 1);
  return { lightModerateMin: min(lm), vigorousPeakMin: min(vp) };
}

/** Fitbit's daily roll-ups (Pulse's src/lib/extraMetrics.ts keys) as of `now`; none on a day the band was off all day. */
export function extrasAt(g: SeedDay, now: number): [string, number][] {
  const done = Math.min(g.steps.length, Math.floor((now - g.start) / 60));
  if (!g.worn || done <= 0) return [];
  let steps = 0;
  let total = 0;
  let metres = 0;
  let kcal = 0;
  let azm = 0;
  const minutes = [0, 0, 0, 0];
  for (let m = 0; m < g.steps.length; m++) {
    total += g.steps[m];
    if (m >= done) continue;
    steps += g.steps[m];
    metres += g.steps[m] * (g.steps[m] >= 140 ? 1.1 : 0.75); // running stride, else walking
    kcal += g.kcal[m];
    azm += g.azm[m];
    minutes[g.level[m]]++;
  }
  let beats = 0;
  let samples = 0;
  for (let s = 0; s < (done * 60) / HR_CADENCE_S; s++) {
    if (g.bpm[s]) {
      beats += g.bpm[s];
      samples++;
    }
  }
  const floors = Math.round((g.floors * steps) / Math.max(1, total));
  return [
    ["distance", round(metres / 1000, 2)],
    ["floors", floors],
    ["elevation", Math.round(floors * 3.05)],
    ["active_minutes", minutes[3]],
    ["light_minutes", minutes[2]],
    ["sedentary_minutes", minutes[1]],
    ["azm", azm],
    ["active_calories", Math.round(kcal)],
    ...(samples ? [["avg_hr", Math.round(beats / samples)] as [string, number]] : []),
  ];
}

/** Writes what has happened on days `gs` by `now`. `checkedIn` holds the days the user already journaled, left alone. */
async function writeDays(store: Store, gs: SeedDay[], now: number, checkedIn: Set<string>) {
  const hr: { ts: number; bpm: number }[] = [];
  const steps: { ts: number; v: number }[] = [];
  const dirty: string[] = [];
  for (const g of gs) {
    const before = hr.length + steps.length;
    for (let s = 0; s < g.bpm.length && g.start + s * HR_CADENCE_S < now; s++) {
      if (g.bpm[s]) hr.push({ ts: g.start + s * HR_CADENCE_S, bpm: g.bpm[s] });
    }
    for (let m = 0; m < g.steps.length && g.start + (m + 1) * 60 <= now; m++) {
      if (g.steps[m]) steps.push({ ts: g.start + m * 60, v: g.steps[m] });
    }
    if (hr.length + steps.length > before) dirty.push(g.day);
  }
  await store.putHr(hr);
  await store.putSteps(steps);
  await store.putHrv(gs.flatMap((g) => (g.nightly && g.nightly.availableAt <= now ? g.nightly.hrv : [])));
  await store.markIntradayDirty(dirty);

  const sleeps = gs.flatMap((g) => g.sleeps.filter((s) => s.availableAt <= now));
  await store.upsertSessions(
    sleeps.map((s) => s.row),
    sleeps.flatMap((s) => s.segments),
  );
  await store.upsertExercises(gs.flatMap((g) => g.exercises.filter((e) => e.endTs <= now)));
  const values: DailyValue[] = gs.flatMap((g) => extrasAt(g, now).map(([key, value]) => ({ day: g.day, key, value })));
  await store.upsertDailyValues(values);
  await store.upsertMetrics(gs.map((g) => metricsAt(g, now)));

  // Never touch a day the user already checked in for.
  for (const g of gs) {
    if (!g.journal || now < g.end || checkedIn.has(g.day)) continue;
    for (const [tag, yes] of Object.entries(g.journal)) await store.setJournal({ day: g.day, tag, value: Number(yes) });
  }
}

/** The demo person: 36 in 2026, max HR estimated (183). Settings › Profile can change it like any profile. */
export const DEMO_PROFILE = { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null } as const;

export type SeedOptions = {
  /** The last seeded day (local). */
  today: string;
  timeZone: string;
  /** Days to seed, ending today. The scenario is written for 180. */
  days?: number;
  /**
   * The instant the seed is "as of" (unix seconds): today is cut there, so its totals are partial like a real sync.
   * Default: the clock when `today` is the current local day, else 14:00 on `today` (deterministic for tests).
   */
  now?: number;
};

/** Days generated and written per batch: bounds memory (a day holds ~5,760 HR samples). */
const BATCH_DAYS = 30;

/**
 * Fills the Store with the demo person's data: `days` days ending `today`, as of `now`. Writes the demo profile
 * and returns it; marks days with HR or steps intraday-dirty, so the next pipeline run scores them. Rows are upserts:
 * seeding again with a later `now` adds what has happened since.
 */
export async function seedDemo(store: Store, opts: SeedOptions): Promise<Profile> {
  const { today, timeZone, days = SEED_DAYS } = opts;
  const nowS = Math.floor(Date.now() / 1000);
  const now = opts.now ?? (localDay(nowS, timeZone) === today ? nowS : localMidnight(today, timeZone) + 14 * 3600);
  const profile: Profile = { ...DEMO_PROFILE, timeZone };
  const ctx: Ctx = { anchor: addDays(today, 1 - days), timeZone, maxHr: resolveMaxHr(profile, today), memo: { behaviour: new Map(), night: new Map() } };
  const checkedIn = new Set((await store.allJournal()).map((e) => e.day));
  for (let i = 0; i < days; i += BATCH_DAYS) {
    const batch = Array.from({ length: Math.min(BATCH_DAYS, days - i) }, (_, k) => generateDay(ctx, i + k));
    await writeDays(store, batch, now, checkedIn);
  }
  const cuffRows: BloodPressureReadingRow[] = [];
  for (const offset of [60, 30, 5] as const) {
    if (offset >= days) continue;
    const anchorDay = days > 180 ? addDays(ctx.anchor, 179 - offset) : addDays(today, -offset);
    const tsSec = localMidnight(anchorDay, timeZone) + 8 * 3600;
    if (tsSec > now) continue;
    let sbp = 118;
    let dbp = 76;
    if (offset === 60) {
      sbp = 119;
      dbp = 77;
    } else if (offset === 30) {
      sbp = 121;
      dbp = 78;
    }
    cuffRows.push({
      id: `seed-bp-${anchorDay}`,
      timestampMs: tsSec * 1000,
      date: anchorDay,
      systolicMmHg: sbp,
      diastolicMmHg: dbp,
      pulseBpm: 58,
      posture: "sitting",
      source: "health_connect",
    });
  }
  if (cuffRows.length) await store.upsertBloodPressureReadings(cuffRows);
  await store.setProfile(profile);
  await store.setSyncState({ lastSyncTs: now, firstDay: ctx.anchor, lastError: null });
  return profile;
}
