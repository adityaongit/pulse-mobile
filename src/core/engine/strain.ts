// The strain family: Daily Strain (a percent), workout units and TRIMP, Cardio Load, Target Strain, heart-rate recovery
// after a workout and EPOC. Reference study, strain-load.md, and other-calculators.md § EPOC and cardio focus.
import { roundHalfAway } from "./math";

/** Lower bounds of zones 1–5 (bpm) and the max HR that tops zone 5. */
export type Zones = { lowest: [number, number, number, number, number]; maxHr: number };

/** Zones on % of max HR: each lower bound ceil(round1(maxHr · p)) for p = 50, 60, 70, 80, 90 % (§ Zone settings). */
export function zonesOf(maxHr: number): Zones {
  const b = (p: number) => Math.ceil(roundHalfAway(maxHr * p, 1));
  return { lowest: [b(0.5), b(0.6), b(0.7), b(0.8), b(0.9)], maxHr };
}

/** 0 below zone 1, else the zone (5 at and above zone 5's lower bound). */
export function zoneOf(hr: number, z: Zones): number {
  if (hr >= 0 && hr < z.lowest[0]) return 0;
  for (let k = 1; k < 5; k++) if (hr < z.lowest[k]) return k;
  return 5;
}

/** (lower, upper) weight per zone 0–5, interpolated across each zone. */
const WEIGHTS: [number, number][] = [
  [0, 1],
  [2, 2],
  [3, 4],
  [4, 7],
  [7, 12],
  [12, 20],
];

/** Units per second at hr: the zone's weights interpolated over its bpm range (above max HR it extrapolates). */
export function weight(hr: number, z: Zones): number {
  const k = zoneOf(hr, z);
  const lo = k === 0 ? 0 : z.lowest[k - 1];
  const hi = k === 5 ? z.maxHr : z.lowest[k];
  const [wl, wu] = WEIGHTS[k];
  return lo === hi ? (wl + wu) / 2 : wl + ((hr - lo) / (hi - lo)) * (wu - wl);
}

export type Seg = { bpm: number; seconds: number };

/**
 * Heart-rate segments: each reading lasts until the next one (start to start), at most `cap` seconds; the last reading
 * has no successor and adds nothing. Workouts take no cap; the day's waking heart rate caps at 30 minutes.
 */
export function segmentsOf(xs: readonly { ts: number; bpm: number }[], cap = Infinity): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < xs.length; i++) out.push({ bpm: xs[i].bpm, seconds: Math.min(cap, Math.max(0, xs[i + 1].ts - xs[i].ts)) });
  return out;
}

/** Strain units of segments: Σ weight · seconds. `dropBelowZone1`: the day's waking (passive) pool leaves out zone 0. */
export function units(segs: readonly Seg[], z: Zones, dropBelowZone1 = false): number {
  let u = 0;
  for (const s of segs) if (!(dropBelowZone1 && s.bpm >= 0 && s.bpm < z.lowest[0])) u += weight(s.bpm, z) * s.seconds;
  return u;
}

/** Seconds per zone 0–5 over segments (the day's zone breakdown, Pulse Age's zone minutes). */
export function zoneSeconds(segs: readonly Seg[], z: Zones): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  for (const s of segs) out[zoneOf(s.bpm, z)] += s.seconds;
  return out;
}

/** Strength-type workouts (strength, weights, calisthenics, HIIT): Pulse Age's strength minutes. */
export const STRENGTH_TYPES = /STRENGTH|WEIGHT|CALISTHENICS|HIGH_INTENSITY_INTERVAL/;

/** The passive pool's gap cap, seconds. */
export const PASSIVE_GAP_S = 1800;

/**
 * Daily Strain, a percent: 16·atan(steps / 7000) + 66·atan(U / 20000), with steps taken awake and U the day's units
 * (waking heart rate above zone 1, and each workout's cardio units). 0–100 on most days, up to about 128.8.
 */
export const dayStrain = (steps: number, u: number) => 16 * Math.atan(steps / 7000) + 66 * Math.atan(u / 20000);

/** A workout's own strain from its units. */
export const workoutStrain = (u: number) => 66 * Math.atan(u / 20000);

/** The ring's share of a full turn: full at 100 and stays full above it (fix 2; the label shows the real value). */
export const strainRing = (v: number) => Math.min(1, Math.max(0, v / 100));

const BANISTER_B = { male: 1.92, female: 1.67 } as const;

/**
 * Banister TRIMP of a workout: Σ 0.64·e^(b·x)·x·minutes over its segments, x = (round(bpm) − rest) / (max − rest), at
 * least 0. Summed in time order in doubles (fix 16; the source summed per-bpm bins in hash order in Float32). `rest` is
 * the 60-day resting-HR baseline; null without one.
 */
export function trimp(segs: readonly Seg[], rest: number | null, maxHr: number, sex: "male" | "female"): number | null {
  if (rest == null || !segs.length) return null;
  const b = BANISTER_B[sex];
  const d = maxHr - rest;
  let total = 0;
  for (const s of segs) {
    let x = (roundHalfAway(s.bpm) - rest) / d;
    if (!Number.isFinite(x)) continue;
    if (x <= 0) x = 0;
    total += 0.64 * Math.exp(b * x) * x * (s.seconds / 60);
  }
  return Number.isFinite(total) ? total : 0;
}

export type CardioFocus = { lowAerobic: number; highAerobic: number; anaerobic: number };

/**
 * EPOC over a workout, its peak and the cardio focus (other-calculators.md § EPOC and cardio focus). Above 40 % of the
 * reserve EPOC grows 0.3·e^(4·(min(r, 1) − 0.4)) a minute; below resting HR it DECAYS 5 % a minute (fix 1: the source
 * added 5 %, a sign error, and credited it to low aerobic); in between it holds.
 */
export function epoc(segs: readonly Seg[], rest: number, maxHr: number): { peak: number; final: number; focus: CardioFocus } {
  let e = 0;
  let peak = 0;
  const focus: CardioFocus = { lowAerobic: 0, highAerobic: 0, anaerobic: 0 };
  for (const s of segs) {
    const r = (roundHalfAway(s.bpm) - rest) / (maxHr - rest);
    const perMin = r < 0 ? -0.05 * e : r <= 0.4 ? 0 : 0.3 * Math.exp(4 * (Math.min(r, 1) - 0.4));
    const inc = perMin * (s.seconds / 60);
    if (inc > 0) focus[r < 0.7 ? "lowAerobic" : r < 0.85 ? "highAerobic" : "anaerobic"] += inc;
    e = Math.max(0, e + inc);
    peak = Math.max(peak, e);
  }
  return { peak, final: e, focus };
}

/** Heart-rate recovery: the largest drop within any 120 s whose earlier reading is at or before the active end. */
export type HrRecovery = { drop: number; startHr: number; endHr: number; startTs: number; endTs: number };

/**
 * Over raw heart rate from the workout's start to 2 minutes after its active end (strain-load.md § Heart Rate Recovery):
 * null with under 2 readings, when the slice's max never reached zone 4, or when HR only rose.
 */
export function hrRecovery(xs: readonly { ts: number; bpm: number }[], activeEnd: number, z: Zones): HrRecovery | null {
  if (xs.length < 2) return null;
  // reduce, not Math.max(...): a long workout's readings overflow the stack as call arguments (#70).
  if (zoneOf(xs.reduce((m, x) => Math.max(m, x.bpm), -Infinity), z) < 4) return null;
  let best = Infinity;
  let bj = -1;
  let bk = -1;
  const dq: number[] = [];
  for (let j = 0; j < xs.length; j++) {
    while (dq.length && !(xs[j].ts - xs[dq[0]].ts <= 120 && xs[dq[0]].ts <= activeEnd)) dq.shift();
    if (dq.length) {
      const delta = xs[j].bpm - xs[dq[0]].bpm;
      if (delta < best) [best, bj, bk] = [delta, j, dq[0]];
    }
    if (xs[j].ts <= activeEnd) {
      while (dq.length && xs[dq[dq.length - 1]].bpm <= xs[j].bpm) dq.pop();
      dq.push(j);
    }
  }
  if (bk < 0 || -best < 0) return null;
  return { drop: -best, startHr: xs[bk].bpm, endHr: xs[bj].bpm, startTs: xs[bk].ts, endTs: xs[bj].ts };
}

// ── Cardio Load ─────────────────────────────────────────────────────────────

export type LoadStatus = "calibrating" | "detraining" | "maintaining" | "peaking" | "productive" | "fatigued" | "overtraining";

/** ATL and CTL after a day's load (the sum of its workouts' TRIMP): α 0.25 and 2/43, from a zero seed. */
export const loadStep = (prev: { atl: number; ctl: number }, load: number) => ({
  atl: prev.atl * 0.75 + load * 0.25,
  ctl: prev.ctl * (41 / 43) + load * (2 / 43),
});

/**
 * How sure the load status can be: min(training density, recency). Density: days over 5 TRIMP in the last 42, over
 * 28, at most 1. Recency: the last 28 loads before today, each active one in the last 16 days weighing 1 − ago/16, a
 * quarter of their sum, at most 1. `loads28` and `active42` include today.
 */
export function loadConfidence(loads28: readonly number[], active42: number): number {
  const density = Math.min(1, active42 / 28);
  const n = loads28.length;
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ago = n - 2 - i;
    if (loads28[i] > 5 && ago <= 15) acc += 1 - 0.0625 * ago;
  }
  return Math.min(density, n < 2 ? 0 : Math.min(1, acc * 0.25));
}

/**
 * The status: calibrating under 0.35 confidence; above 1.4 ATL/CTL overtraining; above 1 productive (fatigued with
 * Recovery under 20); at or below 1, by CTL's trend over the last 5 days against the 5 before (±5 %).
 */
export function loadStatus(a: { atl: number; ctl: number; confidence: number; ctlTrendPct: number | null; recovery: number | null }): LoadStatus {
  if (a.confidence < 0.35) return "calibrating";
  let ratio = a.atl / a.ctl;
  if (!Number.isFinite(ratio)) ratio = 0;
  const gate: LoadStatus = ratio > 1.4 ? "overtraining" : a.recovery == null || a.recovery >= 20 ? "productive" : "fatigued";
  if (ratio > 1) return gate;
  if (a.ctlTrendPct != null && a.ctlTrendPct > 5) return "peaking";
  if (a.ctlTrendPct != null && a.ctlTrendPct < -5) return "detraining";
  return "maintaining";
}

// ── Target Strain ───────────────────────────────────────────────────────────

/** The base: an EWMA (0.75 / 0.25) over the last 14 days' strain, oldest first, a missing day as 0. */
export function targetBase(history: readonly (number | null)[]): number {
  const h = history.slice(-14);
  if (!h.length) return 0;
  let b = h[0] ?? 0;
  for (const v of h) b = b * 0.75 + (v ?? 0) * 0.25;
  return b;
}

/** Today's range from the base and today's Recovery: scaled ±30 % by Recovery, widened with it; low 20–120, high 40–120. */
export function targetRange(base: number, recovery: number | null): { low: number; high: number } {
  const c = recovery == null ? base : base * (((recovery - 50) / 100) * 0.6 + 1);
  const r = (recovery ?? 50) / 100;
  return { low: Math.max(20, Math.min(120, c - 5 - 5 * r)), high: Math.max(40, Math.min(120, c + 10 + 20 * r)) };
}
