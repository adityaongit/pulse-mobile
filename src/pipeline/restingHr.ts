// The resting HR a day's zones, Strain and minute load sit on, when the day has neither Fitbit's daily value nor a
// sleep-session estimate (mobile addition; the web falls straight back to 60 bpm). Health Connect often carries heart
// rate without resting HR or sleep, and 60 bpm put an unfit person's zones far too low: at a true resting HR of 78 and
// max 189, Zone 1 started at 124.5 bpm instead of 133.5, so an hour's brisk walk at 128 bpm counted as 60 zone minutes and
// Strain 9.7 instead of nothing.
//
// The chain: the day's daily record → its session estimate → the newest of either in the 30 days before (resting HR
// moves slowly) → an estimate from the day's own HR → 60 bpm.
import { addDays } from "@/lib/time";
import { restingHRCfg } from "@/core/scoring/baselines";

/** Days a known resting HR is carried forward. */
export const RESTING_HR_CARRY_DAYS = 30;
/** Length of the rolling window the day's own estimate takes its lowest mean over, minutes. */
export const RESTING_WINDOW_MIN = 30;
/** Resting minutes (with HR, still) a window needs before its mean counts. */
export const RESTING_WINDOW_MIN_MINUTES = 20;
/** A minute is still when it and the minutes this far either side have no steps (the Stress Monitor's rule). */
export const STILL_WINDOW_MIN = 2;

export type RestingHrSource = "daily" | "session" | "carried" | "estimated" | "default";

/** The newest resting HR in the RESTING_HR_CARRY_DAYS before `day`, from `known` (day → bpm), or null. */
export function carriedRestingHr(day: string, known: ReadonlyMap<string, number>): number | null {
  for (let k = 1; k <= RESTING_HR_CARRY_DAYS; k++) {
    const v = known.get(addDays(day, -k));
    if (v != null) return v;
  }
  return null;
}

/**
 * The day's resting HR from its own heart rate: the lowest mean over any 30-minute window of still minutes (a mean HR,
 * no steps within 2 minutes, outside workouts), counting a window only with 20 such minutes; rounded, and null when no
 * window qualifies or the result is outside resting HR's plausible 30–120 bpm. Sleep minutes count (they are the most
 * restful), so on a day with a night of heart rate but no sleep session it reads close to the sleeping resting HR; from
 * awake minutes alone it reads a few bpm high, which errs towards fewer zone minutes, not more.
 * @param minuteHr mean HR per minute from `start` (minuteMeanHr), null without a sample.
 * @param steps steps per minute on the same grid; missing entries count as 0.
 * @param exercises workouts, unix seconds.
 */
export function estimateRestingHr(
  minuteHr: (number | null)[],
  steps: ArrayLike<number | undefined>,
  start: number,
  exercises: { start: number; end: number }[],
): number | null {
  const n = minuteHr.length;
  const blocked = new Uint8Array(n);
  for (const { start: s, end: e } of exercises) {
    for (let m = Math.max(0, Math.floor((s - start) / 60)); m < Math.min(n, Math.ceil((e - start) / 60)); m++) blocked[m] = 1;
  }
  for (let m = 0; m < n; m++) {
    if (!steps[m]) continue;
    for (let j = Math.max(0, m - STILL_WINDOW_MIN); j <= Math.min(n - 1, m + STILL_WINDOW_MIN); j++) blocked[j] = 1;
  }
  let best: number | null = null;
  let sum = 0;
  let count = 0;
  const add = (m: number, sign: 1 | -1) => {
    const v = minuteHr[m];
    if (v == null || blocked[m]) return;
    sum += sign * v;
    count += sign;
  };
  for (let m = 0; m < n; m++) {
    add(m, 1);
    if (m >= RESTING_WINDOW_MIN) add(m - RESTING_WINDOW_MIN, -1);
    if (m >= RESTING_WINDOW_MIN - 1 && count >= RESTING_WINDOW_MIN_MINUTES) {
      const mean = sum / count;
      if (best == null || mean < best) best = mean;
    }
  }
  if (best == null) return null;
  const bpm = Math.round(best);
  return bpm >= restingHRCfg.minVal && bpm <= restingHRCfg.maxVal ? bpm : null;
}

/**
 * The day's own resting heart rate, the one every score and screen uses: Fitbit's daily value from Health Connect (Fitbit
 * reads it from still periods, sleep included), else Pulse's estimate from the night's sleep session (the lowest steady
 * 5 minutes). The carried and estimated steps of the chain below only place a day's zones; they are never shown as the
 * day's value.
 */
export const dayRestingHr = (daily: number | null | undefined, session: number | null | undefined): number | null => daily ?? session ?? null;

/** The day's resting HR and where it came from (see the file comment for the chain). */
export function resolveRestingHr(
  daily: number | null,
  session: number | null,
  carried: number | null,
  estimate: () => number | null,
  fallback: number,
): { restingHr: number; source: RestingHrSource } {
  if (daily != null) return { restingHr: daily, source: "daily" };
  if (session != null) return { restingHr: session, source: "session" };
  if (carried != null) return { restingHr: carried, source: "carried" };
  const e = estimate();
  return e != null ? { restingHr: e, source: "estimated" } : { restingHr: fallback, source: "default" };
}
