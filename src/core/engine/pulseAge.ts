// Pulse Age: chronological age plus the years nine physiological factors add or take away, each a hazard ratio from a
// 28-day window turned into years as 10·ln(HR). Reference study, biological-age-muscular.md § Physiological factors and
// § Composite. Nutrition, alcohol, smoking and blood (PhenoAge) are left out: Health Connect has no data for them.
// Fix 9: the source summed the factors present and let missing ones count as zero; the Pulse engine scales the sum to
// all nine (the mean present factor stands in for each missing one) and shows nothing below five factors.
import { clamp, mean } from "./math";
import type { Sex } from "./sleep";

export const PULSE_AGE_FACTORS = ["sleepHours", "sri", "steps", "zone13", "zone45", "strength", "restingHr", "vo2max", "leanMass"] as const;
export type PulseAgeFactor = (typeof PULSE_AGE_FACTORS)[number];
export const MIN_FACTORS = 5;
export const WINDOW_DAYS = 28;

/** One day of the window; null where the day has no value. */
export type PulseAgeDay = {
  sleepHours: number | null;
  /** Sleep Consistency, 0–100. */
  sri: number | null;
  steps: number | null;
  /** Minutes in zones 2–3 and 4–5, and strength-workout minutes. */
  zone13Min: number | null;
  zone45Min: number | null;
  strengthMin: number | null;
  restingHr: number | null;
};

type Row = [number, number, number, number];
/** [lower, upper) age rows: male, female. */
const RHR_REF: Row[] = [
  [0, 20, 64, 66],
  [20, 26, 61, 65],
  [26, 36, 61, 64],
  [36, 46, 62, 64],
  [46, 56, 63, 65],
  [56, 66, 61, 64],
];
const VO2_REF: Row[] = [
  [0, 20, 48, 37.6],
  [20, 30, 48, 37.6],
  [30, 40, 42.4, 30.2],
  [40, 50, 37.8, 26.7],
  [50, 60, 32.6, 23.4],
  [60, 70, 28.2, 20],
  [70, 80, 24.4, 18.3],
];
/** Body fat mean and SD: [lower, upper, male mean, male SD, female mean, female SD]. */
const BF_REF: [number, number, number, number, number, number][] = [
  [0, 20, 17, 7.78, 30, 6.82],
  [20, 40, 21.2, 6.82, 32.5, 7.71],
  [40, 60, 25.2, 5.19, 36.4, 6.45],
  [60, 80, 27.3, 5.26, 38.9, 5.41],
];
const ref = (rows: Row[], age: number, male: boolean, fallback: [number, number]) => {
  const r = rows.find(([lo, hi]) => lo <= age && age < hi);
  return r ? (male ? r[2] : r[3]) : male ? fallback[0] : fallback[1];
};

/** Each factor's reference: the value whose hazard ratio is 1. */
export function references(age: number, sex: Sex): Record<PulseAgeFactor, number> {
  const male = sex === "male";
  const bf = BF_REF.find(([lo, hi]) => lo <= age && age < hi) ?? [0, 0, 27.3, 4.89, 36.9, 5.56];
  return {
    sleepHours: 7.5,
    sri: 70,
    steps: age < 60 ? 8000 : 6000,
    zone13: 246 * Math.log(0.46 / 0.25),
    zone45: 20 * Math.log(0.08041 / 0.04877),
    strength: 15.14 * Math.log(0.3348 / 0.173),
    restingHr: ref(RHR_REF, age, male, [62, 64]),
    vo2max: ref(VO2_REF, age, male, [24.4, 18.3]),
    leanMass: 100 - (male ? bf[2] : bf[4]),
  };
}

/** The hazard ratio of each factor at x (biological-age-muscular.md § Per-factor kernels), clamped. */
export function hazard(f: PulseAgeFactor, x: number, age: number, sex: Sex): number {
  const male = sex === "male";
  switch (f) {
    case "sleepHours":
      return clamp(Math.exp(0.05 * (x - 7.5) * (x - 9)), 0.9802, 1.24608);
    case "sri":
      return clamp(Math.exp((70 - x) * (x > 70 ? 0.007 : 0.015)), 0.74082, 1.16183);
    case "steps": {
      const [target, cap] = age < 60 ? [8000, 10000] : [6000, 8000];
      return clamp((clamp(x, 1, cap) / target) ** -0.26, 0.90484, 1.24608);
    }
    case "zone13":
      return clamp(0.75 + 0.46 * Math.exp(-x / 246), 0.74082, 1.10517);
    case "zone45":
      return clamp(0.95123 + 0.08041 * Math.exp(-x / 20), 0.95123, 1.03045);
    case "strength":
      return clamp(0.827 + 0.3348 * Math.exp(-x / 15.14), 0.84366, 1.10517);
    case "restingHr":
      return clamp(Math.exp(0.012 * (x - ref(RHR_REF, age, male, [62, 64]))), 0.63763, 1.2214);
    case "vo2max":
      return clamp(Math.max(0.3, Math.exp(0.038 * (ref(VO2_REF, age, male, [24.4, 18.3]) - x))), 0.60653, 1.28403);
    case "leanMass": {
      const bf = BF_REF.find(([lo, hi]) => lo <= age && age < hi) ?? [0, 0, 27.3, 4.89, 36.9, 5.56];
      const [m, sd] = male ? [bf[2], bf[3]] : [bf[4], bf[5]];
      if (sd <= 0) return 1;
      const z = (m - (100 - x)) / sd;
      return clamp(z < 0 ? 1 + 0.12 * z * z : 1 - Math.max(0, 0.005 * (age - 35)) * z, 0.95123, 1.49182);
    }
  }
}

export type FactorResult = { key: PulseAgeFactor; value: number | null; hazard: number | null; years: number | null; confidence: number };

export type PulseAge = { pulseAge: number; deltaYears: number; confidence: number; present: number; factors: FactorResult[] };

/**
 * Pulse Age for the week starting W, from the 28 days before W (`days`, any order) and the VO2 max and lean-mass %
 * readings in them. `age` is chronological age at W in years (365.25-day years). Null below MIN_FACTORS factors.
 */
export function pulseAge(a: { age: number; sex: Sex; days: readonly PulseAgeDay[]; vo2: readonly number[]; leanPct: readonly number[] }): PulseAge | null {
  const daily = (k: keyof PulseAgeDay) => a.days.map((d) => d[k]).filter((v): v is number => v != null && Number.isFinite(v));
  // Weekly minutes: the 28-day sum × 0.25 (minutes per week), over the days with a value.
  const weekly = (k: keyof PulseAgeDay) => {
    const xs = daily(k);
    return { x: xs.length ? xs.reduce((s, v) => s + v, 0) * (7 / WINDOW_DAYS) : null, n: xs.length };
  };
  const meanOf = (k: keyof PulseAgeDay) => {
    const xs = daily(k);
    return { x: mean(xs), n: xs.length };
  };
  const inputs: Record<PulseAgeFactor, { x: number | null; conf: number }> = {} as never;
  const dayConf = (n: number) => Math.min(1, n / 20);
  for (const [f, k, how] of [
    ["sleepHours", "sleepHours", meanOf],
    ["sri", "sri", meanOf],
    ["steps", "steps", meanOf],
    ["zone13", "zone13Min", weekly],
    ["zone45", "zone45Min", weekly],
    ["strength", "strengthMin", weekly],
    ["restingHr", "restingHr", meanOf],
  ] as const) {
    const { x, n } = how(k);
    inputs[f] = { x, conf: x == null ? 0 : dayConf(n) };
  }
  const vo2 = mean(a.vo2.filter(Number.isFinite));
  const lean = mean(a.leanPct.filter(Number.isFinite));
  inputs.vo2max = { x: vo2, conf: vo2 == null ? 0 : 1 };
  inputs.leanMass = { x: lean, conf: lean == null ? 0 : 1 };

  const factors: FactorResult[] = PULSE_AGE_FACTORS.map((key) => {
    const { x, conf } = inputs[key];
    const hr = x == null ? null : hazard(key, x, a.age, a.sex);
    return { key, value: x, hazard: hr, years: hr == null ? null : 10 * Math.log(hr), confidence: conf };
  });
  const present = factors.filter((f) => f.years != null);
  if (present.length < MIN_FACTORS) return null;
  const scale = PULSE_AGE_FACTORS.length / present.length;
  for (const f of present) f.years = f.years! * scale;
  const delta = present.reduce((s, f) => s + f.years!, 0);
  const pulse = clamp(a.age + delta, 0, 150);
  return { pulseAge: pulse, deltaYears: pulse - a.age, confidence: mean(factors.map((f) => f.confidence))!, present: present.length, factors };
}

/** The projection rate: Pulse Age over age, within 0.6–1.6 (display only, the study's projection). */
export const paceOf = (pulse: number, age: number) => (age > 0 ? clamp(pulse / age, 0.6, 1.6) : 0.6);
