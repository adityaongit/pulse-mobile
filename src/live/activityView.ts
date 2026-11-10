// What the live activity screen and the recorded activity show (docs/workout-tracker/whoop-ui.md): the activity's own
// Strain and the day's on the Pulse engine (liveStrain.ts), heart rate, calories and where the bpm sits in its zone.
// Pure: the screen feeds it the recorder's samples and today's setup.
import { zoneOf, zonesOf } from "@/core/engine/strain";
import type { Sex } from "@/data/types";
import { LiveStrain, MAX_JUMP_BPM, type StrainBase } from "./liveStrain";
import { MAX_WORKOUT_GAP_MS, type WorkoutSample } from "./workout";

export type ActivityBody = { age: number; weightKg: number; sex: Sex };
export type ActivityStrainSetup = { restingHr: number; maxHr: number; base: StrainBase | null; sex: string };

export type ActivityView = {
  /** The activity's own Strain, a percent. */
  activityStrain: number;
  /** The day's Strain before the activity and now, percents. */
  dayBefore: number;
  dayNow: number;
  avgHr: number | null;
  maxHr: number | null;
  /** Estimated from heart rate (Keytel 2005); null without the body figures it needs. */
  kcal: number | null;
  /** Seconds below Zone 1 ([0]) and in Zones 1–5. */
  zoneSeconds: number[];
};

/**
 * Energy a minute from heart rate, Keytel et al. 2005 (J Sports Sci 23:289) without VO2max: kcal/min from bpm, weight
 * (kg) and age (years), by sex. Never negative: the equation is for exercise, and at rest it dips below zero.
 */
export function kcalPerMin(bpm: number, b: ActivityBody): number {
  const kj = b.sex === "female"
    ? -20.4022 + 0.4472 * bpm - 0.1263 * b.weightKg + 0.074 * b.age
    : -55.0969 + 0.6309 * bpm + 0.1988 * b.weightKg + 0.2017 * b.age;
  return Math.max(0, kj / 4.184);
}

/**
 * The samples' Strain, heart rate, zones and calories. A pause or a reconnect starts a new epoch, and a gap longer than
 * MAX_WORKOUT_GAP_MS breaks a run: nothing is credited across either, as summarizeWorkout does.
 */
export function activityView(samples: readonly WorkoutSample[], setup: ActivityStrainSetup, body: ActivityBody | null): ActivityView {
  const strain = new LiveStrain({ restingHr: setup.restingHr, maxHr: setup.maxHr, base: setup.base, sex: setup.sex });
  let kcal = 0;
  let previous: WorkoutSample | null = null;
  for (const s of withoutSpikes(samples)) {
    const run = previous !== null && s.epoch === previous.epoch && s.elapsedMs > previous.elapsedMs && s.elapsedMs - previous.elapsedMs <= MAX_WORKOUT_GAP_MS;
    if (!run) strain.restart();
    if (run && body) kcal += kcalPerMin(previous!.bpm, body) * (s.elapsedMs - previous!.elapsedMs) / 60_000;
    // Active elapsed time, not the wall clock, so a paused stretch never counts.
    previous = strain.add(s.elapsedMs, s.bpm) ? s : null;
  }
  return {
    activityStrain: strain.sessionStrain,
    dayBefore: strain.dayStartStrain,
    dayNow: strain.dayStrain,
    avgHr: strain.avgHr,
    maxHr: strain.maxBpm,
    kcal: body ? Math.round(kcal) : null,
    zoneSeconds: [...strain.zoneSeconds],
  };
}
/**
 * Drops a lone reading far from both its neighbours in the same run (a band reconnecting sends one stale value, e.g.
 * 113 bpm between 80s), so it never becomes the max. MAX_JUMP_BPM is the same bound LiveStrain uses within a run.
 */
export function withoutSpikes(samples: readonly WorkoutSample[]): WorkoutSample[] {
  const run = (a: WorkoutSample | undefined, b: WorkoutSample): a is WorkoutSample => a !== undefined && a.epoch === b.epoch;
  const far = (a: WorkoutSample, b: WorkoutSample) => Math.abs(a.bpm - b.bpm) > MAX_JUMP_BPM;
  return samples.filter((s, i) => {
    const [p2, p, n, n2] = [samples[i - 2], samples[i - 1], samples[i + 1], samples[i + 2]];
    const hasP = run(p, s);
    const hasN = run(n, s);
    // Between two readings it differs from both; at a run's edge, it differs from a neighbour that agrees with the next.
    if (hasP && hasN) return !(far(p, s) && far(n, s));
    if (hasN) return !(far(n, s) && run(n2, n) && !far(n2, n));
    if (hasP) return !(far(p, s) && run(p2, p) && !far(p2, p));
    return true;
  });
}

/** The bpm's zone 0–5 and how far through that zone it is (0–1), for the dot on the zone bar. */
export function zonePosition(bpm: number, maxHr: number): { zone: number; at: number } {
  const z = zonesOf(maxHr);
  const zone = zoneOf(bpm, z);
  // Zone 0 runs from 40 % of max HR up to Zone 1; Zone 5 up to max HR.
  const lo = zone === 0 ? Math.round(maxHr * 0.4) : z.lowest[zone - 1];
  const hi = zone === 5 ? maxHr : z.lowest[zone];
  return { zone, at: Math.min(1, Math.max(0, (bpm - lo) / Math.max(1, hi - lo))) };
}

export type StrainWord = "restorative" | "optimal" | "overreaching" | "light" | "moderate" | "strenuous" | "allOut";
/**
 * The word under the activity's Strain: with a target, where the day stands against it (WHOOP's Restorative / Optimal);
 * without one, the activity's Strain band (Pulse's Strain bands: ≤40 light, 41–60 moderate, 61–79 strenuous, 80+ all out).
 */
export function strainWord(activityStrain: number, dayNow: number, target: readonly [number, number] | null): StrainWord {
  if (target) return dayNow < target[0] ? "restorative" : dayNow <= target[1] ? "optimal" : "overreaching";
  const s = Math.round(activityStrain);
  return s >= 80 ? "allOut" : s >= 61 ? "strenuous" : s >= 41 ? "moderate" : "light";
}
