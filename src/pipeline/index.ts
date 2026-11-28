// The two-stage recompute (KTD6), as the web app runs it. Stage 1 (stage1.ts) reads the heavy per-sample
// buckets for the days whose inputs changed and caches per-day results; stage 2 (stage2.ts, scorers in scores.ts)
// folds every day, oldest first, over daily rows and those cached results. Every value for day D depends only on
// D and earlier days, except where a feature is defined over the evening that follows (Energy Bank stops at
// tonight's bedtime, Stress leaves out tonight's sleep), so adding a later night never changes an earlier day's
// scores.
//
// Determinism: the same Store gives byte-identical score rows, and writes only touch rows whose JSON differs,
// so an unchanged recompute writes nothing.
import type { Store } from "@/data/store";
import type { Profile } from "@/data/types";
import { addDays, daysBetween, localDay, wholeYears } from "@/lib/time";
import { estimateHRmax, exerciseHrForMax } from "@/core/scoring/strain";
import { load, type Progress } from "./data";
import { stage1 } from "./stage1";
import { stage2 } from "./stage2";
import type { PipelineOptions } from "./types";

export * from "./types";

/** What the last run did, for logs and tests. stage2From: the first day stage 2 replayed (checkpoint.ts). */
export const lastRun = { stage1Days: [] as string[], stage2From: "", ms: 0, stage1Ms: 0, stage2Ms: 0 };

/**
 * The person's own max HR; else Tanaka's estimate (208 − 0.7 × age), raised to the max HR learned from their workouts
 * (`learned`, learnedMaxHr) when that is higher.
 */
export const resolveMaxHr = (profile: Pick<Profile, "birthDate" | "maxHr">, today: string, learned: number | null = null) =>
  profile.maxHr ?? Math.max(Math.round(208 - 0.7 * wholeYears(profile.birthDate, today)), learned ?? 0);

/** The Pulse engine's max HR: the profile's own, else 220 − age (whole years on `today`). */
export const engineMaxHr = (profile: Pick<Profile, "birthDate" | "maxHr">, today: string) => profile.maxHr ?? 220 - wholeYears(profile.birthDate, today);

/** daily_values keys (on day "latest") holding the learned max HR and the day it was last checked (epoch days). */
export const LEARNED_MAX_HR_KEY = "learned_max_hr";
export const LEARNED_MAX_HR_CHECKED_KEY = "learned_max_hr_checked";
/** Workout heart rate from this many days back is read for the learned max HR. */
export const LEARNED_MAX_HR_DAYS = 365;
/** How often, in days, the learned max HR is checked again. */
export const LEARNED_MAX_HR_EVERY_DAYS = 7;
/** It moves only when the new estimate is at least this many bpm higher, so stage 1 (keyed on max HR) doesn't churn. */
export const LEARNED_MAX_HR_STEP = 2;

/**
 * Max HR learned from workout heart rate (WHOOP, "Calculating max heart rate", 2026-04-08: learned from your data,
 * starting from an age formula; Garmin auto-detects it upward, Forerunner 970 manual 2026), for a profile without its
 * own. Weekly, the 99.5th percentile of the last year's workout heart rate (artefacts dropped, at least 600 readings,
 * estimateHRmax), whole bpm; it only ever rises, and only by LEARNED_MAX_HR_STEP or more. Null until a workout shows
 * one, and with the profile's own max HR set.
 */
export async function learnedMaxHr(store: Store, profile: Profile, today: string): Promise<number | null> {
  if (profile.maxHr != null) return null;
  const latest = await store.dailyValues({ from: "latest", to: "latest" });
  const stored = latest.find((v) => v.key === LEARNED_MAX_HR_KEY)?.value ?? null;
  const checked = latest.find((v) => v.key === LEARNED_MAX_HR_CHECKED_KEY)?.value ?? null;
  const todayN = daysBetween("1970-01-01", today);
  if (checked != null && todayN - checked >= 0 && todayN - checked < LEARNED_MAX_HR_EVERY_DAYS) return stored;
  const from = addDays(today, 1 - LEARNED_MAX_HR_DAYS);
  const bpm: number[] = [];
  for (const e of await store.allExercises()) {
    if (e.day < from || e.day > today) continue;
    bpm.push(...exerciseHrForMax(await store.readHr(e.startTs, e.endTs + 1)));
  }
  const est = estimateHRmax(bpm, null);
  const observed = est.source === "observed" ? Math.round(est.hrmax) : null;
  const next = observed != null && (stored == null || observed >= stored + LEARNED_MAX_HR_STEP) ? observed : stored;
  await store.upsertDailyValues([
    ...(next != null ? [{ day: "latest", key: LEARNED_MAX_HR_KEY, value: next }] : []),
    { day: "latest", key: LEARNED_MAX_HR_CHECKED_KEY, value: todayN },
  ]);
  return next;
}

/** The scorers' profile: max HR resolved (with the learned one), and height from the profile or the source's latest reading. */
export async function pipelineOptions(store: Store, profile: Profile, today: string): Promise<PipelineOptions> {
  const [height, learned] = await Promise.all([profile.heightCm ?? sourceHeight(store), learnedMaxHr(store, profile, today)]);
  return {
    timeZone: profile.timeZone,
    profile: {
      birthDate: profile.birthDate,
      sex: profile.sex,
      maxHr: resolveMaxHr(profile, today, learned),
      engineMaxHr: engineMaxHr(profile, today),
      heightCm: height,
      waistCm: profile.waistCm ?? null,
      sleepGoalHours: profile.sleepGoal?.hours ?? null,
      hrZones: profile.hrZones ?? null,
    },
  };
}

/** The latest height the source sent (daily_values `height_cm` on day "latest"), as the web's googleHeight. */
const sourceHeight = async (store: Store) =>
  (await store.dailyValues({ from: "latest", to: "latest" })).find((v) => v.key === "height_cm")?.value ?? null;

/**
 * Runs both stages. Stage 1 redoes the days whose memo key changed, that the Store marked intraday-dirty, or
 * whose row carries another scoring version; stage 2 replays every day. Never run two at once for one Store.
 */
export async function runPipeline(
  store: Store,
  profile: Profile,
  opts: { today?: string; onProgress?: Progress } = {},
): Promise<{ days: number; stage1Reran: number }> {
  const t0 = Date.now();
  const today = opts.today ?? localDay(Math.floor(Date.now() / 1000), profile.timeZone);
  const po = await pipelineOptions(store, profile, today);
  const data = await load(store, po);
  if (!data) {
    Object.assign(lastRun, { stage1Days: [], stage2From: "", ms: Date.now() - t0, stage1Ms: 0, stage2Ms: 0 });
    return { days: 0, stage1Reran: 0 };
  }
  const dirty = await store.takeIntradayDirty();
  const t1 = Date.now();
  lastRun.stage1Days = await stage1(store, data, dirty, po, opts.onProgress);
  const t2 = Date.now();
  lastRun.stage2From = await stage2(store, data, po, opts.onProgress, lastRun.stage1Days);
  const t3 = Date.now();
  Object.assign(lastRun, { stage1Ms: t2 - t1, stage2Ms: t3 - t2, ms: t3 - t0 });
  return { days: data.days.length, stage1Reran: lastRun.stage1Days.length };
}
