// Own algorithm: Pulse Age and Pace of Aging, rebuilt on WHOOP's Healthspan method (WHOOP Age white paper, 2025). Each
// of nine inputs maps to a log hazard ratio (ln HR) of all-cause mortality through a dose-response curve pinned from a
// cited paper, taken against a reference profile (WHOOP's recommendations where it publishes them), and the weighted sum
// turns into years at `yearsPerLnHr`. A missing input counts as no effect. The overall shape (curves, reference, sum,
// clamp, a 30-day pace) follows noop's VitalityEngine.kt; the curves, references and constants are documented below.
import { isoEpochDay } from "../scoring/baselines";
import { piecewiseLinear, type Knots, type Sex } from "./fitnessLevel";
import { poolPairs, sriOf, type SriPair } from "./sleepRegularity";

/**
 * Health Connect exercise types (src/health/import.ts's ExerciseType names) whose minutes count as strength: strength
 * training, weightlifting, calisthenics and HIIT. Also the strength icon (queries).
 */
export const STRENGTH_TYPES = /STRENGTH|WEIGHT|CALISTHENICS|HIGH_INTENSITY_INTERVAL/;

/**
 * The types Halo Age counts as strength activity (version 18): STRENGTH_TYPES plus Pilates, yoga and boot camp, as
 * WHOOP's Healthspan list counts them (published: WHOOP Healthspan white paper, 2025-09-04: Strength Trainer,
 * weightlifting, powerlifting, barre, Pilates, yoga, hot yoga, functional fitness, HIIT, box fitness …). Health Connect's
 * EXERCISE_CLASS says nothing about the class, so it is left out. The strength icon and the weekly plan keep STRENGTH_TYPES.
 */
export const HEALTHSPAN_STRENGTH_TYPES = new RegExp(`${STRENGTH_TYPES.source}|PILATES|YOGA|BOOT_CAMP`);

/** One day's inputs. A null or absent field means no data that day. */
export interface HealthspanDay {
  /** yyyy-MM-dd */
  day: string;
  /** Main-sleep asleep hours. */
  sleepHours?: number | null;
  /** Trailing 7-day SRI on [−100, 100], from sleepRegularityIndex. */
  sri?: number | null;
  /**
   * The newest pair of that 7-day window (last night against the night before): minutes in the same state, of those
   * compared. With these, the window's SRI pools every pair once (−100 + 200 · same / compared); averaging the daily
   * 7-day SRIs instead counts a night in up to six of them, so with a few days of data the first nights outweighed the
   * rest and Pulse Age's consistency differed from the Sleep screen's over the very same nights.
   */
  sriPair?: SriPair | null;
  /**
   * Minutes at 40–80 % of heart-rate reserve (WHOOP's Zones 1–3), counted only inside a workout or in a bout of 10 minutes
   * or more (zoneBoutSeconds), each minute once as WHOOP counts time in zone (since version 18; a minute at 60–80 % counted
   * twice before). Null on a day without 12 h of heart rate.
   */
  zone13Min?: number | null;
  /** Minutes at 80 % of heart-rate reserve and above, same rule. */
  zone45Min?: number | null;
  /** Strength-workout minutes (HEALTHSPAN_STRENGTH_TYPES); 0 on a covered day without one. */
  strengthMin?: number | null;
  /** Daily steps; null on a day without 12 h of heart rate. */
  steps?: number | null;
  /** Measured VO2max, mL/kg/min: Health Connect's lab and field-test methods (stored as `vo2max_run`). */
  vo2maxRun?: number | null;
  /** Estimated VO2max from Fitbit or another app: Health Connect's heart-rate-ratio and "other" methods. */
  vo2maxDaily?: number | null;
  /** Pulse's own estimate (fitnessLevel.ts fitnessEstimate), used only when neither of the above exists. */
  vo2maxEstimated?: number | null;
  /** Fitbit's daily resting HR, bpm. */
  restingHr?: number | null;
  weightKg?: number | null;
  /** Body fat, 0–100 %. */
  bodyFatPct?: number | null;
}

export interface HealthspanProfile {
  /** Chronological age in years on the evaluation day (fractional is fine). */
  age: number;
  sex: Sex;
  /** For body fat from BMI when only weight is logged, and the lean and fat mass indices shown beside the term. */
  heightCm?: number | null;
}

/** [x, HR] rows → [x, ln HR] knots: ln HR is linear between knots and flat beyond the ends. */
const lnHr = (rows: [number, number][]): Knots => rows.map(([x, hr]) => [x, Math.log(hr)] as const);

/** Dose-response curves in each input's units. Only differences from the reference matter. */
export const curves = {
  // mL/kg/min. Kodama 2009 JAMA: RR 0.87 per 1 MET (3.5 mL/kg/min) higher, log-linear.
  vo2max: lnHr([[10, 1], [80, 0.87 ** (70 / 3.5)]]),
  // bpm. Zhang 2016 CMAJ: RR 1.09 per 10 bpm above 45, log-linear.
  restingHr: lnHr([[45, 1], [105, 1.09 ** 6]]),
  // Steps/day, under 60. Paluch 2022 Lancet Public Health, Fig 2 (age < 60): quartile medians, HR vs Q1; no further
  // gain past Q3 (Q4's 0.60 is no lower), so flat from 8,911. 60 and over: STEPS_FROM_60.
  steps: lnHr([[4849, 1], [7245, 0.59], [8911, 0.51]]),
  // Hours. Saint-Maurice 2024: short sleep HR 1.29 at 5 h against 7 h; flat from 7 h, with no long-sleep penalty.
  sleepHours: lnHr([[5, 1.29], [7, 1]]),
  // SRI. Windred 2024 Sleep, Tables 1–2 (full model): quintile medians, HR vs Q1.
  sri: lnHr([[65.1, 1], [75.62, 0.8], [80.99, 0.75], [85.22, 0.72], [89.8, 0.7]]),
  // Min/week at 40–80 % of reserve. Arem 2015 JAMA Intern Med: HR at 0, 1–2×, 3–5× and 8× the 150 MET-min guideline.
  zone13: lnHr([[0, 1], [75, 0.8], [225, 0.69], [375, 0.63], [600, 0.61]]),
  // Min/week at 80 % of reserve or more. Ahmadi 2022 Eur Heart J: vigorous minutes, HR 1 at the 2.2 min/week median of
  // the lowest group, 0.82 at 15, 0.64 at 53.6.
  zone45: lnHr([[2.2, 1], [15, 0.82], [53.6, 0.64]]),
  // Min/week. Momma 2022 BJSM: RR 0.83 at 40 min/week. Flat after (WHOOP): no extra benefit, no penalty for more.
  strength: lnHr([[0, 1], [40, 0.83]]),
} satisfies Record<string, Knots>;

/** Steps/day at 60 and over. Paluch 2022, Fig 2 (age ≥ 60): quartile medians, HR vs Q1. */
const STEPS_FROM_60 = lnHr([[2841, 1], [5217, 0.62], [7116, 0.52], [10501, 0.43]]);

/** The curve for `key` at `age`: steps use Paluch's age-specific curves (age interaction p = 0.012). */
const curveOf = (key: keyof typeof curves, age: number): Knots => (key === "steps" && age >= 60 ? STEPS_FROM_60 : curves[key]);

export type HealthspanInput = keyof typeof curves | "leanMass" | "bloodPressure";

/** Pulse Age's nine base inputs, in contribution order. */
const TERMS: readonly Exclude<HealthspanInput, "bloodPressure">[] = [...(Object.keys(curves) as (keyof typeof curves)[]), "leanMass"];
/** How many terms Pulse Age has in all (9). */
export const HEALTHSPAN_TERM_COUNT = TERMS.length;

/**
 * WHOOP's minimum recommended VO2max by age (white paper, Figure 4), mL/kg/min at ages 20, 25 … 100; linear between,
 * flat beyond the ends.
 */
export const WHOOP_VO2MAX_REFERENCE: Record<Sex, readonly number[]> = {
  male: [46, 46, 44, 42, 40, 37, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21],
  female: [40, 40, 38, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21, 20, 19, 18],
};

export const healthspanConfig = {
  /**
   * Years per unit of Σ w·ln HR. WHOOP's effective age is t = ln HR / ln(HR per year of age) = 10 × ln HR (white paper:
   * mortality rises about 10 % a year of age). WHOOP then removes the overlap between correlated inputs with a
   * structural equation model fit to its members' data; Pulse can't refit that, so one overlap factor was fit by least
   * squares to WHOOP's four Table 2 profiles: 0.477, so 10 × 0.477 ≈ 4.77 (they land at 5.98, −0.58, 7.67 and −0.68
   * against WHOOP's 6, −1.6, 7.5 and −1.6). It was 0.6 with Paluch's all-ages step curve; the age-specific one (no gain
   * past ~8,900 steps under 60) credits WHOOP's 11,000-step members less, which is where the remaining gap is. Summing
   * separate meta-analyses' ln HRs overstates a joint effect (Li 2018 Circulation: five healthy factors together HR
   * 0.26, while their single-factor HRs sum to about 2.3× that ln HR), so a factor well under 1 is expected.
   */
  yearsPerLnHr: 4.77,
  /** Pulse Age = age ± at most this. */
  clampYears: 15,
  /** Pace = 1 + (Δ30d − Δ6mo) / 0.5: the 30-day Pulse Age held for 6 months, against 6 months of calendar time (WHOOP). */
  paceScaleYears: 0.5,
  paceMin: -1,
  paceMax: 3,
  /** Pace shows only with at least this many of the last 30 days with data. */
  paceMinDays: 21,
  /** Weight of an estimated input: Fitbit's or Pulse's VO2max, body fat from BMI. */
  estimateWeight: 0.5,
  runVo2maxLookbackDays: 90,
  ageWindowDays: 180,
  paceWindowDays: 30,
  /** Fewer days with any input → provisional. */
  minDays: 20,
  /** Fewer terms → no result. */
  minTerms: 5,
  /** Fewer terms → provisional. */
  provisionalBelowTerms: 7,
  /**
   * Lean mass % (Jayedi 2022 Int J Obes, body fat % and all-cause mortality): HR 1.11 per 10 points of body fat above
   * the reference, log-linear and continuous. Credit stops 5 points under the reference, and the term has no effect
   * from 60 (WHOOP: lower body fat stops predicting lower mortality in older adults).
   */
  bodyFat: { hrPer10Points: 1.11, maxCreditPoints: 5, noEffectFromAge: 60 },
  /** The reference profile: Pulse Age = age when every input sits here (WHOOP's recommendations unless noted). */
  reference: {
    restingHr: { male: 60, female: 64 },
    sleepHours: 7,
    /** Windred 2024's second-quintile median, the point where most of the benefit is reached. */
    sri: 75.6,
    steps: { under60: 8_000, from60: 5_600 },
    /** Weekly minutes, falling linearly from the first age to the second and flat outside. */
    zone13: { at: [30, 70], minutes: [100, 70] },
    zone45: { at: [30, 70], minutes: [10, 7] },
    strength: 40,
    /** Body fat %, the lean-mass term's reference (lean mass 80 % for men, 67 % for women). */
    bodyFatPct: { male: 20, female: 33 },
  },
};

/** Deurenberg 1991 (Br J Nutr 65:105): body fat % = 1.20·BMI + 0.23·age − 10.8·(1 if male) − 5.4. */
export const deurenbergBodyFat = (bmi: number, age: number, sex: Sex) => 1.2 * bmi + 0.23 * age - 10.8 * (sex === "male" ? 1 : 0) - 5.4;

const byAge = (age: number, r: { at: number[]; minutes: number[] }) =>
  piecewiseLinear([[r.at[0], r.minutes[0]], [r.at[1], r.minutes[1]]], age);

/** The profile that scores Pulse Age = chronological age. `leanMass` is lean mass %, 100 − the body-fat reference. */
export function referenceProfile(age: number, sex: Sex): Record<Exclude<HealthspanInput, "bloodPressure">, number> {
  const r = healthspanConfig.reference;
  return {
    vo2max: piecewiseLinear(WHOOP_VO2MAX_REFERENCE[sex].map((v, i) => [20 + 5 * i, v] as const), age),
    restingHr: r.restingHr[sex],
    steps: age < 60 ? r.steps.under60 : r.steps.from60,
    sleepHours: r.sleepHours,
    sri: r.sri,
    zone13: byAge(age, r.zone13),
    zone45: byAge(age, r.zone45),
    strength: r.strength,
    leanMass: 100 - r.bodyFatPct[sex],
  };
}

/** ln HR of a lean mass % against the reference, at an age: 0 at the reference, never below −5 points of credit. */
export function leanMassLnHr(leanPct: number, age: number, sex: Sex): number {
  const b = healthspanConfig.bodyFat;
  if (age >= b.noEffectFromAge) return 0;
  const above = 100 - leanPct - healthspanConfig.reference.bodyFatPct[sex];
  return (Math.log(b.hrPer10Points) * Math.max(above, -b.maxCreditPoints)) / 10;
}

export interface HealthspanContribution {
  key: HealthspanInput;
  /** The window's value in the term's units (weekly minutes for zones and strength, lean mass % for lean mass). */
  value: number;
  reference: number;
  /** Signed years added to Pulse Age; they sum to the unclamped Δage. */
  years: number;
  /** An estimate counted at half weight: Fitbit's or Pulse's VO2max, or body fat from BMI. */
  estimated?: boolean;
}

/** What the lean-mass term rests on, for display (window means). Masses need weight; indices need height too. */
export interface BodyComposition {
  bodyFatPct: number;
  /** Body fat from BMI (Deurenberg), no body-fat reading in the window. */
  estimated: boolean;
  weightKg: number | null;
  leanKg: number | null;
  fatKg: number | null;
  /** Fat-free and fat mass index, kg/m². */
  ffmi: number | null;
  fmi: number | null;
}

export type Vo2maxSource = "run" | "daily" | "estimate";

export interface HealthspanResult {
  pulseAge: number;
  /** Pulse Age − age, clamped to ±clampYears. */
  deltaYears: number;
  /** Null with fewer than paceMinDays of the last 30 days with data. */
  paceOfAging: number | null;
  /** Days of the last 30 with any input. */
  paceDays: number;
  /** For the 6-month window. */
  contributions: HealthspanContribution[];
  vo2maxSource: Vo2maxSource | null;
  bodyComposition: BodyComposition | null;
  /** Days in the 6-month window with any input. */
  dataDays: number;
  /** Terms present in the 6-month window, of 9; a missing one counts as no effect. */
  termsUsed: number;
  /** Fewer than minDays days with data, or fewer than provisionalBelowTerms terms. */
  provisional: boolean;
  /** True until the data spans the full 6-month window. */
  paceProvisional: boolean;
}

type Term = { value: number; weight: number; estimated: boolean };
type Summary = Partial<Record<Exclude<HealthspanInput, "bloodPressure">, Term>>;
/** How the 6-month window got its VO2max and body fat; the 30-day window reads the same sources. */
type Sources = { vo2: Vo2maxSource | null; bodyFat: "measured" | "bmi" | null };

const mean = (xs: (number | null | undefined)[]): number | undefined => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

const VO2_FIELD = { run: "vo2maxRun", daily: "vo2maxDaily", estimate: "vo2maxEstimated" } as const;

/** The window's SRI from its days' newest pairs, each pair once; undefined without pair counts (then the 7-day SRIs' mean). */
function pooledSri(days: HealthspanDay[]): number | undefined {
  const all = poolPairs(days.map((d) => d.sriPair));
  return all === null ? undefined : sriOf(all.same, all.pairs);
}

/** Window means as terms; minutes become weekly (mean daily × 7). Inputs without data are absent. */
function summarize(days: HealthspanDay[], p: HealthspanProfile, src: Sources): Summary {
  const cfg = healthspanConfig;
  const measured = (v: number | undefined): Term | undefined => (v == null ? undefined : { value: v, weight: 1, estimated: false });
  const week = (xs: (number | null | undefined)[]) => {
    const m = mean(xs);
    return measured(m == null ? undefined : m * 7);
  };
  const vo2 = src.vo2 && mean(days.map((d) => d[VO2_FIELD[src.vo2!]]));
  const s: Summary = {
    vo2max: vo2 == null ? undefined : { value: vo2, weight: src.vo2 === "run" ? 1 : cfg.estimateWeight, estimated: src.vo2 !== "run" },
    restingHr: measured(mean(days.map((d) => d.restingHr))),
    steps: measured(mean(days.map((d) => d.steps))),
    sleepHours: measured(mean(days.map((d) => d.sleepHours))),
    sri: measured(pooledSri(days) ?? mean(days.map((d) => d.sri))),
    zone13: week(days.map((d) => d.zone13Min)),
    zone45: week(days.map((d) => d.zone45Min)),
    strength: week(days.map((d) => d.strengthMin)),
  };
  const fat = bodyFatOf(days, p, src.bodyFat);
  if (fat) s.leanMass = { value: 100 - fat.pct, weight: fat.estimated ? cfg.estimateWeight : 1, estimated: fat.estimated };
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v != null));
}

/** Mean body fat % over the weigh-ins with one, else (`bmi`) from mean weight, height and age (Deurenberg). */
function bodyFatOf(days: HealthspanDay[], p: HealthspanProfile, mode: Sources["bodyFat"]) {
  if (mode === "measured") {
    const pct = mean(days.map((d) => d.bodyFatPct));
    return pct == null ? null : { pct, estimated: false };
  }
  const kg = mean(days.map((d) => d.weightKg));
  if (mode !== "bmi" || kg == null || !p.heightCm) return null;
  return { pct: deurenbergBodyFat(kg / (p.heightCm / 100) ** 2, p.age, p.sex), estimated: true };
}

/** Unclamped Δage and its per-input years, or null below minTerms. A missing term adds nothing. */
function deltaAge(s: Summary, p: HealthspanProfile, ref: Record<Exclude<HealthspanInput, "bloodPressure">, number>) {
  const cfg = healthspanConfig;
  const present = TERMS.filter((k) => s[k] != null);
  if (present.length < cfg.minTerms) return null;
  const contributions = present.map((key): HealthspanContribution => {
    const t = s[key]!;
    const lnHazard =
      key === "leanMass"
        ? leanMassLnHr(t.value, p.age, p.sex)
        : piecewiseLinear(curveOf(key, p.age), t.value) - piecewiseLinear(curveOf(key, p.age), ref[key]);
    return { key, value: t.value, reference: ref[key], years: cfg.yearsPerLnHr * t.weight * lnHazard, ...(t.estimated && { estimated: true }) };
  });
  return { years: contributions.reduce((a, c) => a + c.years, 0), contributions, terms: present.length };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A day with any input of its own (Pulse's VO2max estimate is carried from earlier days, so it isn't one). */
const hasInput = (d: HealthspanDay) => Object.entries(d).some(([k, v]) => k !== "day" && k !== "vo2maxEstimated" && v != null);

/** Lean and fat mass for display, from the window's mean weight and the term's body fat. */
function bodyComposition(days: HealthspanDay[], p: HealthspanProfile, lean: Term | undefined): BodyComposition | null {
  if (!lean) return null;
  const bodyFatPct = 100 - lean.value;
  const weightKg = mean(days.map((d) => d.weightKg)) ?? null;
  const h2 = p.heightCm ? (p.heightCm / 100) ** 2 : null;
  const leanKg = weightKg == null ? null : weightKg * (1 - bodyFatPct / 100);
  const fatKg = weightKg == null ? null : (weightKg * bodyFatPct) / 100;
  return {
    bodyFatPct,
    estimated: lean.estimated,
    weightKg,
    leanKg,
    fatKg,
    ffmi: leanKg == null || h2 == null ? null : leanKg / h2,
    fmi: fatKg == null || h2 == null ? null : fatKg / h2,
  };
}

/**
 * Pulse Age over the 6 months to `asOf`, and Pace of Aging from the last 30 days against those 6 months, both at today's
 * age. Null when the 6-month window has fewer than minTerms inputs.
 */
export function healthspan(days: HealthspanDay[], profile: HealthspanProfile, asOf: string): HealthspanResult | null {
  const cfg = healthspanConfig;
  const today = isoEpochDay(asOf);
  if (today == null) return null;
  const within = (n: number) =>
    days.filter((d) => {
      const e = isoEpochDay(d.day);
      return e != null && e <= today && today - e < n;
    });
  const sixMonths = within(cfg.ageWindowDays);
  const lastMonth = within(cfg.paceWindowDays);
  const has = (k: keyof HealthspanDay) => sixMonths.some((d) => d[k] != null);
  // A measured VO2max from the last 90 days at full weight, else Fitbit's estimate, else Pulse's, both at half weight.
  const sources: Sources = {
    vo2: within(cfg.runVo2maxLookbackDays).some((d) => d.vo2maxRun != null) ? "run" : has("vo2maxDaily") ? "daily" : has("vo2maxEstimated") ? "estimate" : null,
    bodyFat: has("bodyFatPct") ? "measured" : "bmi",
  };
  const ref = referenceProfile(profile.age, profile.sex);
  const long = summarize(sixMonths, profile, sources);
  // A term with no data lately keeps its 6-month value.
  const short = { ...long, ...summarize(lastMonth, profile, sources) };
  const a = deltaAge(long, profile, ref);
  const b = deltaAge(short, profile, ref);
  if (!a || !b) return null;

  const deltaYears = clamp(a.years, -cfg.clampYears, cfg.clampYears);
  const withData = sixMonths.filter(hasInput);
  const paceDays = lastMonth.filter(hasInput).length;
  const first = Math.min(...within(Infinity).filter(hasInput).map((d) => isoEpochDay(d.day)!));
  return {
    pulseAge: profile.age + deltaYears,
    deltaYears,
    // Unclamped deltas, so a change still shows while Pulse Age sits at the clamp.
    paceOfAging: paceDays >= cfg.paceMinDays ? clamp(1 + (b.years - a.years) / cfg.paceScaleYears, cfg.paceMin, cfg.paceMax) : null,
    paceDays,
    contributions: a.contributions,
    vo2maxSource: long.vo2max ? sources.vo2 : null,
    bodyComposition: bodyComposition(sixMonths, profile, long.leanMass),
    dataDays: withData.length,
    termsUsed: a.terms,
    provisional: withData.length < cfg.minDays || a.terms < cfg.provisionalBelowTerms,
    paceProvisional: today - first + 1 < cfg.ageWindowDays,
  };
}

/**
 * Pulse Age's zone time for one day as [40–60 %, 60–80 %, ≥ 80 % of heart-rate reserve] seconds, from per-minute mean
 * HR (minute m starts at `start` + 60m). WHOOP counts zone time inside activities, so a minute counts only inside a
 * workout (`sessions`, unix seconds) or within a run of at least `minBoutMin` minutes at or above `bounds.moderate`. A
 * single minute without HR inside a run doesn't end it (and doesn't count); a minute under the floor does.
 */
export function zoneBoutSeconds(
  means: readonly (number | null)[],
  start: number,
  bounds: { moderate: number; brisk: number; vigorous: number },
  sessions: readonly { start: number; end: number }[],
  minBoutMin = 10,
): [number, number, number] {
  const n = means.length;
  const band = means.map((v) => (v == null ? null : v < bounds.moderate ? 0 : v < bounds.brisk ? 1 : v < bounds.vigorous ? 2 : 3));
  const counted = new Array<boolean>(n).fill(false);
  for (const s of sessions) {
    for (let m = Math.max(0, Math.floor((s.start - start) / 60)); m < n && start + m * 60 < s.end; m++) counted[m] = true;
  }
  let runStart = -1;
  let inBand = 0;
  for (let m = 0; m <= n; m++) {
    const b = m < n ? band[m] : 0;
    const gap = b === null && m + 1 < n && (band[m + 1] ?? 0) > 0 && runStart >= 0;
    if (b !== null && b > 0) {
      if (runStart < 0) runStart = m;
      inBand++;
    } else if (!gap && runStart >= 0) {
      if (inBand >= minBoutMin) for (let k = runStart; k < m; k++) counted[k] = true;
      runStart = -1;
      inBand = 0;
    }
  }
  const out: [number, number, number] = [0, 0, 0];
  for (let m = 0; m < n; m++) if (counted[m] && band[m]) out[band[m]! - 1] += 60;
  return out;
}
