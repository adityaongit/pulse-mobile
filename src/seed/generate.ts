// The demo person (ported from pulse src/server/sources/seed/generate.ts): a deterministic generator whose days are written
// straight into the normalized tables through the repositories. No users, passwords or Source wrapper here: the phone
// holds one person, and src/seed/load.ts drives it.
//
// Every day is a pure function of (anchor day, day index, time zone, max HR). Randomness comes from
// mulberry32 keyed by the day index and a stream name, so any day regenerates identically and the scenario (an
// illness week, a band-off day) looks the same whatever date the seed starts on. Only what has happened by "now" is
// written, so today is a partial day.
//
// mulberry32 and the shaping (HR follows steps, a workout lifts both, sleep HR sits under the day's
// resting figure) are adapted from Hælan's packages/core/src/testing/seed.ts (AGPL-3.0).
import { hash, mulberry32 } from "@/core/algorithms/journalImpact";
import type { ExtraKey } from "@/lib/extraMetrics";
import type { Repos } from "../data/repos";
import type { DailyMetricsPatch } from "../data/repos/daily";
import { addDays, localDay, localMidnight } from "../time";
import {
  ALCOHOL_WEEKEND_ODDS,
  blockWeek,
  DEFAULT_JOURNAL_TAGS,
  EFFECTS,
  fatigue,
  hasSkinTemp,
  illnessSeverity,
  isBandOffDay,
  isBandOffNight,
  isShortSleep,
  MISSED_CHECK_IN_ODDS,
  plannedWorkouts,
  SCENARIO,
  SEED_DAYS,
  SKIN_TEMP_LAG_S,
  SLEEP_SYNC_DELAY_S,
  TAG_ODDS,
  type Tag,
  type WorkoutKind,
  WORKOUTS,
} from "./scenario";

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

export { localDay, localMidnight };

export type Ctx = { anchor: string; timeZone: string; maxHr: number };

const dayOf = (ctx: Ctx, i: number) => addDays(ctx.anchor, i);
/** 0 → 1 across the seeded range, then flat: slow fitness and body-composition trends. */
const progress = (i: number) => Math.min(1, i / SEED_DAYS);
const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

// ponytail: clock hours are added to local midnight, so on a DST-change day events land an hour off.
/** Unix seconds at `hours` past local midnight of day i (negative: the evening before), on the minute. */
const at = (ctx: Ctx, i: number, hours: number) => localMidnight(dayOf(ctx, i), ctx.timeZone) + Math.round(hours * 60) * 60;

// ---------------------------------------------------------------------------------------------
// The person, day by day

type Workout = { kind: WorkoutKind; start: number; minutes: number; intensity: number };

/** What the person did on day i: journal behaviours and workouts. */
function behaviour(ctx: Ctx, i: number) {
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
type Segment = { start: number; end: number; stage: Stage };

/** ~90-minute cycles: deep early, REM growing later, short wakes between. Alcohol halves early REM. */
function sleepStages(r: Rng, bed: number, wake: number, restless: number, alcohol: boolean): Segment[] {
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
  const segments: Segment[] = [];
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

/** The main sleep ending on the morning of day i, with that night's metrics; null when the band was off. */
function night(ctx: Ctx, i: number) {
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
  const metrics = {
    hrvMs: noHrv ? null : round(hrv, 1),
    hrvDeepMs: noHrv ? null : round(hrv * r.u(1.04, 1.14), 1),
    rhrBpm: Math.round(rhr),
    rhrMethod: "WITH_SLEEP",
    respBpm: round(14.6 + ill.resp * sev + (alcohol ? EFFECTS.alcohol.resp : 0) + 0.25 * r.g(), 1),
    nightlyTempC: hasSkinTemp(i) ? round(34.3 + ill.tempC * sev + (alcohol ? EFFECTS.alcohol.tempC : 0) + 0.12 * r.g(), 2) : null,
    spo2Pct: round(clamp(96.7 + ill.spo2 * sev + 0.5 * r.g(), 90, 99.5), 1),
  };
  return { bed, wake, segments, summary, rhr, metrics };
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
  const range = (xs: number[]) => {
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
  rhrMethod: null,
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

  const exerciseRows = b.workouts.map((w, nth) => {
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
      source: "seed",
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

  const sleeps = [];
  if (lastNight) {
    const id = `seed-sleep-${day}`;
    sleeps.push({
      availableAt: lastNight.wake + SLEEP_SYNC_DELAY_S,
      row: { id, day, startTs: lastNight.bed, endTs: lastNight.wake, isMain: true, processed: true, stagesStatus: "SUCCEEDED", ...lastNight.summary, source: "seed" },
      segments: lastNight.segments.map((g) => ({ sessionId: id, startTs: g.start, endTs: g.end, stage: g.stage })),
    });
  }
  if (napToday) {
    const { start: startTs, end: endTs, asleepMin, awakeMin } = napToday;
    sleeps.push({
      availableAt: endTs,
      row: { id: `seed-nap-${day}`, day, startTs, endTs, isMain: false, processed: true, stagesStatus: null, asleepMin, awakeMin, source: "seed" },
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

export type Day = ReturnType<typeof generateDay>;

// ---------------------------------------------------------------------------------------------
// Writing

/** The day's daily_metrics row as of `now`: today's steps and calories are running totals. */
function metricsAt(g: Day, now: number): DailyMetricsPatch {
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
    source: "seed",
  };
}

/** Google's all-day time in zones as of `now`, from the day's samples and its zones; none without zones. */
function timeInZones(g: Day, zones: number[] | null, now: number) {
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

/** Fitbit's daily roll-ups (src/lib/extraMetrics.ts) as of `now`; none on a day the band was off all day. */
export function extrasAt(g: Day, now: number): [ExtraKey, number][] {
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
    ...(samples ? [["avg_hr", Math.round(beats / samples)] as [ExtraKey, number]] : []),
  ];
}

/**
 * Inserts what has happened on days `gs` by `now`. A fresh seed only (pulse's later pulls, which topped a seeded user up
 * to the next tick, do not exist here), so there is no "synced through" cut. Marks days with HR or steps intraday_dirty.
 * Returns the number of rows written. Pulse's `inChunks` (Postgres's 65,535-parameter cap) is the repositories' own job now.
 */
export async function writeDays(store: Repos, gs: Day[], now: number) {
  const hr: { ts: number; v: number }[] = [];
  const steps: { ts: number; v: number }[] = [];
  const dirty: string[] = [];
  for (const g of gs) {
    const before = hr.length + steps.length;
    for (let s = 0; s < g.bpm.length && g.start + s * HR_CADENCE_S < now; s++) {
      const ts = g.start + s * HR_CADENCE_S;
      if (g.bpm[s]) hr.push({ ts, v: g.bpm[s] });
    }
    for (let m = 0; m < g.steps.length && g.start + (m + 1) * 60 <= now; m++) {
      if (g.steps[m]) steps.push({ ts: g.start + m * 60, v: g.steps[m] });
    }
    if (hr.length + steps.length > before) dirty.push(g.day);
  }
  if (hr.length) await store.samples.writeSamples("hr", hr);
  if (steps.length) await store.samples.writeSamples("steps", steps);
  if (dirty.length) await store.scores.markDirty(dirty);
  let n = hr.length + steps.length;

  const sleeps = gs.flatMap((g) => g.sleeps.filter((s) => s.availableAt <= now));
  // A nap carries no stage minutes: the table's own null.
  n += (await store.sessions.upsertSleepSessions(sleeps.map((s) => ({ deepMin: null, lightMin: null, remMin: null, ...s.row })))).length;
  await store.sessions.replaceSegments(sleeps.map((s) => s.row.id), sleeps.flatMap((s) => s.segments));
  n += sleeps.reduce((k, s) => k + s.segments.length, 0);
  n += (await store.sessions.upsertExercises(gs.flatMap((g) => g.exercises.filter((e) => e.endTs <= now)))).length;
  n += await store.daily.upsertDailyValues(gs.flatMap((g) => extrasAt(g, now).map(([key, value]) => ({ day: g.day, key, value }))));
  n += (await store.daily.upsertDailyMetrics(gs.map((g) => metricsAt(g, now)))).length;

  // A fresh database has no check-ins, so pulse's "never touch a day the user already checked in for" read is not needed.
  for (const g of gs.filter((g) => g.journal && now >= g.end)) {
    for (const [tag, yes] of Object.entries(g.journal!)) if (await store.journal.saveEntry({ day: g.day, tag, value: Number(yes), detail: null })) n++;
  }
  return n;
}

/** The phone's own time zone, else pulse's demo zone. */
const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
};

/** The demo person: 36 in 2026, max HR estimated (183). Settings › Profile can change it like any profile. The zone is the phone's (pulse's is Asia/Kolkata). */
export const DEMO_PROFILE = { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null, timeZone: phoneZone() } as const;
