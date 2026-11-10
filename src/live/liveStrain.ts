// Live Strain for Live Workout (`/workout-live`): the day's Strain building beat by beat from the band's Bluetooth
// heart rate, on the Pulse engine (src/core/engine/strain.ts): each reading's units (its zone weight on max HR × the
// seconds to the next reading, at most 2 minutes) add to the day's units, and Daily Strain is the percent of the day's
// awake steps and units. Today's stored units and steps are the base, so the live number carries on from the Strain on
// Home instead of starting from zero. The accumulator follows noop's analytics/LiveSessionEngine.kt (© 2026 NoopApp,
// PolyForm Noncommercial 1.0.0): one instance per session, time passed in with every sample so a session replays
// deterministically in tests, and impossible samples rejected before they count.
//
// Display-only: nothing here is written to the Store. The workout counts for real when Fitbit syncs it to Health
// Connect, so a beat never counts twice.
import { dayStrain, weight, workoutStrain, zoneOf, type Zones, zonesOf } from "@/core/engine/strain";
import { defaultRestingHR, JUMP_WINDOW_S, MAX_JUMP_BPM, MAX_PLAUSIBLE_BPM, maxSampleGapMin, MIN_PLAUSIBLE_BPM } from "@/core/scoring/strain";

export { MAX_JUMP_BPM, MAX_PLAUSIBLE_BPM, MIN_PLAUSIBLE_BPM };
/** A jump larger than MAX_JUMP_BPM within this of the last accepted reading is an artifact (noop: 45 bpm in 12 s). */
export const JUMP_WINDOW_MS = JUMP_WINDOW_S * 1000;
/** The window the current rate (units a minute) is read over, for "minutes to target". */
export const RATE_WINDOW_MS = 3 * 60_000;
/** Below this many units a minute (under zone 1 throughout) the rate is too low to reach a target. */
export const MIN_TARGET_RATE = 60;

/** Today's stored Daily Strain inputs: the units (waking plus workouts) and the steps taken awake. */
/** `maxHr`: the engine max HR the stored units were counted on. */
export type StrainBase = { units: number; steps: number; maxHr?: number };

/** Daily Strain (a percent) of a base; 0 without one. */
export const strainOfBase = (b: StrainBase | null): number => (b ? dayStrain(b.steps, b.units) : 0);

/** The units at which the day's Strain reaches `strain` with `steps` awake; Infinity when units alone can't get there. */
export function unitsForStrain(strain: number, steps: number): number {
  const x = (strain - 16 * Math.atan(steps / 7000)) / 66;
  if (x <= 0) return 0;
  return x >= Math.PI / 2 ? Infinity : 20000 * Math.tan(x);
}

export type LiveStrainConfig = {
  restingHr: number;
  maxHr: number;
  /** The profile's sex; the engine's units do not depend on it. */
  sex?: string;
  /** Today's stored Daily Strain inputs before the workout; null when there are none yet. */
  base: StrainBase | null;
};

export class LiveStrain {
  readonly restingHr: number;
  readonly maxHr: number;
  readonly sex: string;
  private readonly engineZones: Zones;
  /** The day's units and awake steps before the workout. */
  readonly base: StrainBase;
  /** The workout's units so far. */
  units = 0;
  /** Credited seconds below Zone 1 ([0]) and in Zones 1–5. */
  readonly zoneSeconds = [0, 0, 0, 0, 0, 0];
  maxBpm: number | null = null;
  private last: { t: number; bpm: number } | null = null;
  private hrSum = 0;
  private hrMin = 0;
  /** Credited units with the time they were credited, for the recent rate. */
  private credits: { t: number; units: number; min: number }[] = [];

  constructor(c: LiveStrainConfig) {
    this.restingHr = c.restingHr > 0 ? c.restingHr : defaultRestingHR;
    this.maxHr = c.maxHr;
    this.sex = c.sex ?? "male";
    // The engine's zones use its own max HR (220 − age without the profile's), as stage 1 stored it.
    this.engineZones = zonesOf(c.base?.maxHr ?? c.maxHr);
    this.base = c.base ?? { units: 0, steps: 0 };
  }

  /** Whether a reading at `t` (epoch ms) counts: in range and not an impossible jump from the last one. */
  plausible(t: number, bpm: number): boolean {
    if (!(bpm >= MIN_PLAUSIBLE_BPM && bpm <= MAX_PLAUSIBLE_BPM)) return false;
    const l = this.last;
    return !(l && t - l.t <= JUMP_WINDOW_MS && Math.abs(bpm - l.bpm) > MAX_JUMP_BPM);
  }

  /**
   * One reading. The reading before it is credited with the gap up to this one (at most 2 minutes) at its own zone
   * weight; this one waits for the next. False when it was rejected.
   */
  add(t: number, bpm: number): boolean {
    const l = this.last;
    if (l && t <= l.t) return false;
    if (!this.plausible(t, bpm)) return false;
    if (l) {
      const min = Math.min((t - l.t) / 60_000, maxSampleGapMin);
      const credit = weight(l.bpm, this.engineZones) * min * 60;
      this.units += credit;
      this.zoneSeconds[this.zoneOf(l.bpm)] += min * 60;
      this.hrSum += l.bpm * min;
      this.hrMin += min;
      this.credits.push({ t, units: credit, min });
      if (this.credits[0].t < t - RATE_WINDOW_MS) this.credits = this.credits.filter((c) => c.t >= t - RATE_WINDOW_MS);
    }
    this.last = { t, bpm };
    this.maxBpm = this.maxBpm === null ? bpm : Math.max(this.maxBpm, bpm);
    return true;
  }

  /** Starts a new run: the next reading is credited nothing for the gap before it (a pause or a reconnect). */
  restart(): void {
    this.last = null;
  }

  /** Heart-rate zone 1–5 of `bpm`, 0 below Zone 1 (the engine's zones: 50/60/70/80/90 % of max HR). */
  zoneOf(bpm: number): number {
    // The engine's zones (% of max HR), the ones the Strain screen shows: 0 below zone 1.
    return zoneOf(bpm, this.engineZones);
  }

  /** The workout's own Strain, a percent. */
  get sessionStrain(): number {
    return workoutStrain(this.units);
  }

  /** Day Strain before the workout, a percent. */
  get dayStartStrain(): number {
    return strainOfBase(this.base);
  }

  /** Day Strain now, a percent: the day's units before the workout plus the workout's, with the day's awake steps. */
  get dayStrain(): number {
    return dayStrain(this.base.steps, this.base.units + this.units);
  }

  /** Time-weighted mean bpm of the credited readings; null before two. */
  get avgHr(): number | null {
    return this.hrMin > 0 ? Math.round(this.hrSum / this.hrMin) : null;
  }

  /** Units a minute over the last RATE_WINDOW_MS of credited time before `now`; null with under a minute of it. */
  rate(now: number, windowMs = RATE_WINDOW_MS): number | null {
    const recent = this.credits.filter((c) => c.t >= now - windowMs);
    const min = recent.reduce((a, c) => a + c.min, 0);
    if (min < 1) return null;
    return recent.reduce((a, c) => a + c.units, 0) / min;
  }

  /**
   * Minutes at the current rate until Day Strain reaches `strain` (a percent): 0 when it already has; null when the
   * rate is unknown or too low to get there (under MIN_TARGET_RATE units a minute), or units alone can't reach it.
   */
  minutesTo(strain: number, now: number): number | null {
    const need = unitsForStrain(strain, this.base.steps) - (this.base.units + this.units);
    if (need <= 0) return 0;
    const r = this.rate(now);
    if (r === null || r < MIN_TARGET_RATE || !Number.isFinite(need)) return null;
    return need / r;
  }
}

/** A crossing of the target's edges between two Day Strain readings: "low" into the range, "high" past it. */
export function targetCrossing(prev: number, next: number, target: readonly [number, number] | null): "low" | "high" | null {
  if (!target) return null;
  if (prev < target[1] && next >= target[1]) return "high";
  if (prev < target[0] && next >= target[0]) return "low";
  return null;
}
