import { describe, expect, it } from "vitest";
import { isoEpochDay } from "../scoring/baselines";
import { newFold, scoreHealthspan } from "@/pipeline/scores";
import type { PipelineOptions, SleepRow } from "@/pipeline/types";
import { fitnessEstimate, physicalActivityIndex, piecewiseLinear } from "./fitnessLevel";
import {
  curves,
  deurenbergBodyFat,
  healthspan,
  healthspanConfig,
  leanMassLnHr,
  referenceProfile,
  zoneBoutSeconds,
  type HealthspanDay,
  type HealthspanProfile,
} from "./healthspan";

const asOf = "2026-10-02";
const today = isoEpochDay(asOf)!;
const iso = (epochDay: number) => new Date(epochDay * 86_400_000).toISOString().slice(0, 10);
const K = healthspanConfig.yearsPerLnHr;
const profile: HealthspanProfile = { age: 35, sex: "male", heightCm: 180 };
const ref = referenceProfile(35, "male");

type Inputs = Omit<HealthspanDay, "day">;
/** A day exactly at a 35-year-old man's reference profile (body fat 20 %). */
const refDay = (): Inputs => ({
  sleepHours: ref.sleepHours,
  sri: ref.sri,
  zone13Min: ref.zone13 / 7,
  zone45Min: ref.zone45 / 7,
  strengthMin: ref.strength / 7,
  steps: ref.steps,
  vo2maxRun: ref.vo2max,
  restingHr: ref.restingHr,
  weightKg: 80,
  bodyFatPct: 20,
});
/** `n` days ending today; `f(ago)` overrides fields, where `ago` is days before today. */
const series = (n: number, f: (ago: number) => Partial<HealthspanDay> = () => ({}), base: () => Inputs = refDay): HealthspanDay[] =>
  Array.from({ length: n }, (_, i) => ({ day: iso(today - (n - 1 - i)), ...base(), ...f(n - 1 - i) }));
const run = (days: HealthspanDay[], p: HealthspanProfile = profile) => healthspan(days, p, asOf)!;
const yearsOf = (r: ReturnType<typeof run>, key: string) => r.contributions.find((c) => c.key === key)?.years;

/** Weekly minutes in, as a day's inputs (zones and strength per day). */
const weekly = (x: { sleep: number; sri: number; steps: number; z13: number; z45: number; str: number; vo2: number; rhr: number; fat: number }): Inputs => ({
  sleepHours: x.sleep,
  sri: x.sri,
  steps: x.steps,
  zone13Min: x.z13 / 7,
  zone45Min: x.z45 / 7,
  strengthMin: x.str / 7,
  vo2maxRun: x.vo2,
  restingHr: x.rhr,
  weightKg: 80,
  bodyFatPct: x.fat,
});

describe("Pulse Age against WHOOP's Table 2 (white paper; hs-calc/calc2.py)", () => {
  // Average US adults and average WHOOP members at 30, and WHOOP Age − age as the paper prints it.
  const TABLE_2 = [
    { name: "US man", sex: "male", whoop: 6, x: { sleep: 6.35, sri: 70, steps: 5200, z13: 69, z45: 0, str: 0, vo2: 42.4, rhr: 67, fat: 26.1 } },
    { name: "WHOOP man", sex: "male", whoop: -1.6, x: { sleep: 7.0, sri: 72, steps: 10900, z13: 141, z45: 6, str: 46, vo2: 46.8, rhr: 58, fat: 19 } },
    { name: "US woman", sex: "female", whoop: 7.5, x: { sleep: 6.35, sri: 70, steps: 5000, z13: 46, z45: 0, str: 0, vo2: 30.2, rhr: 72, fat: 37.8 } },
    { name: "WHOOP woman", sex: "female", whoop: -1.6, x: { sleep: 7.3, sri: 73, steps: 11500, z13: 124, z45: 7, str: 56, vo2: 40.0, rhr: 63, fat: 27 } },
  ] as const;

  // Within about a year: the evidence-based age-specific step curve (Paluch 2022) gives WHOOP's 11,000-step members
  // less credit than WHOOP's own (unpublished) curve does.
  it.each(TABLE_2)("$name lands within about a year of WHOOP's $whoop", ({ sex, whoop, x }) => {
    const r = run(series(180, () => weekly(x)), { age: 30, sex, heightCm: 170 });
    expect(r.termsUsed).toBe(9);
    expect(Math.abs(r.deltaYears - whoop)).toBeLessThan(1.1);
  });
});

describe("Pulse Age", () => {
  it("the reference profile scores Pulse Age = chronological age, with nine terms at 0", () => {
    const r = run(series(180));
    expect(r.pulseAge).toBeCloseTo(35, 10);
    expect(r.contributions).toHaveLength(9);
    for (const c of r.contributions) expect(c.years).toBeCloseTo(0, 10);
    expect(r.paceOfAging).toBeCloseTo(1, 10);
  });

  it("is K years per unit of ln HR: +10 bpm resting HR is K · ln 1.09", () => {
    const r = run(series(180, () => ({ restingHr: 70 })));
    expect(r.deltaYears).toBeCloseTo(K * Math.log(1.09), 10);
    expect(r.deltaYears).toBeCloseTo(K * Math.log(1.09), 2);
  });

  it("removing one input changes Δ by exactly that input's contribution (a missing term counts 0)", () => {
    const mixed = weekly({ sleep: 6.2, sri: 70, steps: 5200, z13: 69, z45: 3, str: 20, vo2: 41, rhr: 67, fat: 26 });
    const full = run(series(180, () => mixed));
    const drops: Record<string, (keyof HealthspanDay)[]> = {
      sleepHours: ["sleepHours"],
      sri: ["sri"],
      steps: ["steps"],
      zone13: ["zone13Min"],
      zone45: ["zone45Min"],
      strength: ["strengthMin"],
      vo2max: ["vo2maxRun"],
      restingHr: ["restingHr"],
      leanMass: ["bodyFatPct", "weightKg"],
    };
    for (const [key, fields] of Object.entries(drops)) {
      const r = run(series(180, () => ({ ...mixed, ...Object.fromEntries(fields.map((k) => [k, null])) })));
      expect(r.termsUsed, key).toBe(8);
      expect(full.deltaYears - r.deltaYears, key).toBeCloseTo(yearsOf(full, key)!, 10);
      // The other terms keep their years: nothing is rescaled.
      for (const c of r.contributions) expect(c.years, `${key}/${c.key}`).toBeCloseTo(yearsOf(full, c.key)!, 10);
    }
  });

  it("contributions sum to the unclamped Δage", () => {
    const r = run(series(180, () => ({ restingHr: 66, steps: 6000, sleepHours: 6, sri: 70 })));
    expect(r.contributions.reduce((a, c) => a + c.years, 0)).toBeCloseTo(r.deltaYears, 10);
  });

  it("clamps to ±15 years", () => {
    const awful = { vo2maxRun: 15, restingHr: 100, steps: 2000, sleepHours: 4, sri: 40, zone13Min: 0, zone45Min: 0, strengthMin: 0, bodyFatPct: 40 };
    const bad = run(series(180, () => awful));
    expect(bad.deltaYears).toBe(15);
    expect(bad.pulseAge).toBe(50);
    const old: HealthspanProfile = { age: 75, sex: "male", heightCm: 180 };
    const great = { vo2maxRun: 80, restingHr: 45, steps: 15000, sri: 95, zone13Min: 90, zone45Min: 15, strengthMin: 10 };
    expect(run(series(180, () => great), old).pulseAge).toBe(60);
  });

  it("is null below 5 terms, provisional below 7, and provisional below 20 days of data", () => {
    const keep = (fields: (keyof Inputs)[]) => () => Object.fromEntries((Object.keys(refDay()) as (keyof Inputs)[]).filter((k) => !fields.includes(k)).map((k) => [k, null]));
    expect(run(series(60, keep(["restingHr", "steps", "sleepHours", "sri", "zone13Min", "zone45Min", "strengthMin"])))).toMatchObject({ termsUsed: 7, provisional: false });
    expect(run(series(60, keep(["restingHr", "steps", "sleepHours", "sri", "zone13Min", "zone45Min"])))).toMatchObject({ termsUsed: 6, provisional: true });
    expect(run(series(60, keep(["restingHr", "steps", "sleepHours", "sri", "zone13Min"])))).toMatchObject({ termsUsed: 5, provisional: true });
    expect(healthspan(series(60, keep(["restingHr", "steps", "sleepHours", "sri"])), profile, asOf)).toBeNull();
    expect(healthspan(series(30), profile, "not-a-day")).toBeNull();
    expect(run(series(19)).provisional).toBe(true);
    expect(run(series(20))).toMatchObject({ provisional: false, dataDays: 20 });
    // Empty rows are not data.
    const padded = [...series(19), ...Array.from({ length: 5 }, (_, i) => ({ day: iso(today - 30 - i) }))];
    expect(run(padded).provisional).toBe(true);
  });

  it("ignores days after asOf and before the 6-month window", () => {
    const later = { day: iso(today + 1), ...refDay(), restingHr: 120 };
    const older = { day: iso(today - 200), ...refDay(), restingHr: 120 };
    expect(run([older, ...series(180), later]).deltaYears).toBeCloseTo(0, 10);
  });

  it("a 27-year-old man, 173 cm, 89.8 kg at 27 % body fat, resting HR 78, 4,770 steps, no strength: +3 to +9 years", () => {
    const p: HealthspanProfile = { age: 27, sex: "male", heightCm: 173 };
    const vo2 = fitnessEstimate(Array.from({ length: 7 }, () => ({ restingHr: 78, zone13Min: 40 / 7, zone45Min: 0 })), { age: 27, sex: "male", maxHr: 189 })!.vo2max;
    // The sparse-data fixture (src/pipeline/sparse.test.ts): a daily 30-minute walk in a bout, nothing vigorous.
    const sparse: Inputs = { restingHr: 78, steps: 4770, zone13Min: 30, zone45Min: 0.2, strengthMin: 0, weightKg: 89.8, bodyFatPct: 27 };
    const noSleep = run(series(180, () => sparse, () => ({})), p);
    // Without sleep, consistency or VO2max (missing terms count 0): about +4.5.
    expect(noSleep.termsUsed).toBe(6);
    expect(noSleep.deltaYears).toBeGreaterThan(3.5);
    expect(noSleep.deltaYears).toBeLessThan(5.5);
    // Typical for this person: 40 bouted minutes a week, 6.6 h of sleep, consistency 75, and Pulse's own VO2max
    // estimate at half weight.
    const typical = run(series(180, () => ({ ...sparse, zone13Min: 40 / 7, sleepHours: 6.6, sri: 75, vo2maxEstimated: vo2 }), () => ({})), p);
    expect(typical).toMatchObject({ termsUsed: 9, vo2maxSource: "estimate" });
    expect(typical.deltaYears).toBeGreaterThan(3);
    expect(typical.deltaYears).toBeLessThan(9);
    expect(typical.deltaYears).toBeGreaterThan(noSleep.deltaYears);
  });
});

describe("VO2max source rule", () => {
  const plus7 = ref.vo2max + 7;
  const full = K * 2 * Math.log(0.87);

  it("a measured value in the last 90 days is used at full weight", () => {
    const r = run(series(180, (ago) => ({ vo2maxRun: ago === 80 ? plus7 : null, vo2maxDaily: ref.vo2max })));
    expect(r.vo2maxSource).toBe("run");
    expect(yearsOf(r, "vo2max")).toBeCloseTo(full, 10);
    expect(r.contributions.find((c) => c.key === "vo2max")!.estimated).toBeUndefined();
  });

  it("with only Fitbit's estimate, the same value moves Pulse Age half as much", () => {
    const r = run(series(180, () => ({ vo2maxRun: null, vo2maxDaily: plus7 })));
    expect(r.vo2maxSource).toBe("daily");
    expect(r.deltaYears).toBeCloseTo(full / 2, 10);
    expect(r.contributions.find((c) => c.key === "vo2max")!.estimated).toBe(true);
  });

  it("Pulse's own estimate counts at half weight only when there is no measured or Fitbit value", () => {
    const own = run(series(180, () => ({ vo2maxRun: null, vo2maxEstimated: plus7 })));
    expect(own.vo2maxSource).toBe("estimate");
    expect(own.deltaYears).toBeCloseTo(full / 2, 10);
    const fitbit = run(series(180, () => ({ vo2maxRun: null, vo2maxDaily: ref.vo2max, vo2maxEstimated: plus7 })));
    expect(fitbit.vo2maxSource).toBe("daily");
    expect(fitbit.deltaYears).toBeCloseTo(0, 10);
    // The estimate is carried from earlier days, so a day with only it isn't a day of data.
    expect(run([...series(30), ...Array.from({ length: 5 }, (_, i) => ({ day: iso(today - 40 - i), vo2maxEstimated: 40 }))]).dataDays).toBe(30);
  });

  it("a measured value older than 90 days falls back to the estimate", () => {
    const r = run(series(180, (ago) => ({ vo2maxRun: ago === 100 ? plus7 : null, vo2maxDaily: ref.vo2max })));
    expect(r.vo2maxSource).toBe("daily");
    expect(r.deltaYears).toBeCloseTo(0, 10);
  });

  it("no VO2max at all leaves the term out", () => {
    const r = run(series(180, () => ({ vo2maxRun: null })));
    expect(r.vo2maxSource).toBeNull();
    expect(r.termsUsed).toBe(8);
  });

  it("the reference follows WHOOP's Figure 4, linear between ages and flat beyond the ends", () => {
    expect(referenceProfile(25, "male").vo2max).toBe(46);
    expect(referenceProfile(27.5, "male").vo2max).toBeCloseTo(45, 10);
    expect(referenceProfile(60, "male").vo2max).toBe(32);
    expect(referenceProfile(18, "female").vo2max).toBe(40);
    expect(referenceProfile(30, "female").vo2max).toBe(38);
    expect(referenceProfile(110, "female").vo2max).toBe(18);
  });
});

describe("Pace of Aging", () => {
  it("flat inputs give 1.0", () => {
    expect(run(series(180, () => ({ restingHr: 68, steps: 7000 }))).paceOfAging).toBeCloseTo(1, 10);
  });

  it("is 1 + (Δ30 − Δ180) / 0.5: a 30-day Pulse Age 0.25 years above the 6-month one is 1.5x", () => {
    // Resting HR x in the last 30 days and the reference before: Δ180 = c(x − 60)/6 and Δ30 = c(x − 60).
    const c = (K * Math.log(1.09)) / 10;
    const x = 60 + (0.25 * 6) / (5 * c);
    const r = run(series(180, (ago) => ({ restingHr: ago < 30 ? x : 60 })));
    expect(r.paceOfAging).toBeCloseTo(1.5, 10);
    expect(run(series(180, (ago) => ({ restingHr: ago < 30 ? 50 : 60 }))).paceOfAging).toBeLessThan(1);
  });

  it("an input missing in the last 30 days keeps its 6-month value, so flat stays 1.0", () => {
    const r = run(series(180, (ago) => (ago < 30 ? { weightKg: null, bodyFatPct: null } : {})));
    expect(r.termsUsed).toBe(9);
    expect(r.paceOfAging).toBeCloseTo(1, 10);
  });

  it("shows only with 21 of the last 30 days with data", () => {
    const gaps = (n: number) => (ago: number) => (ago < 30 && ago % 30 < 30 - n ? Object.fromEntries(Object.keys(refDay()).map((k) => [k, null])) : {});
    const r20 = run(series(180, gaps(20)));
    expect(r20).toMatchObject({ paceOfAging: null, paceDays: 20 });
    expect(r20.pulseAge).toBeCloseTo(35, 10);
    const r21 = run(series(180, gaps(21)));
    expect(r21.paceDays).toBe(21);
    expect(r21.paceOfAging).toBeCloseTo(1, 10);
  });

  it("stays within [−1, 3]", () => {
    const awful = { vo2maxRun: 15, restingHr: 100, steps: 2000, sleepHours: 4, sri: 40, zone13Min: 0, zone45Min: 0, strengthMin: 0 };
    const great = { vo2maxRun: 70, restingHr: 45, zone13Min: 60, zone45Min: 60, sri: 95 };
    expect(run(series(180, (ago) => (ago < 30 ? great : awful))).paceOfAging).toBe(-1);
    expect(run(series(180, (ago) => (ago < 30 ? awful : great))).paceOfAging).toBe(3);
  });

  it("is provisional until the data spans 6 months", () => {
    expect(run(series(179)).paceProvisional).toBe(true);
    expect(run(series(180)).paceProvisional).toBe(false);
  });
});

describe("dose-response curves", () => {
  const term = (inputs: Partial<HealthspanDay>, key: string, p = profile) => yearsOf(run(series(180, () => inputs), p), key)!;

  it("sleep: 9.5 h scores the same as 7 h; 5 h adds K · ln 1.29, and less sleep adds no more", () => {
    expect(term({ sleepHours: 9.5 }, "sleepHours")).toBeCloseTo(0, 12);
    expect(term({ sleepHours: 7 }, "sleepHours")).toBeCloseTo(0, 12);
    expect(term({ sleepHours: 5 }, "sleepHours")).toBeCloseTo(K * Math.log(1.29), 10);
    expect(term({ sleepHours: 5 }, "sleepHours")).toBeCloseTo(K * Math.log(1.29), 2);
    expect(term({ sleepHours: 4 }, "sleepHours")).toBeCloseTo(term({ sleepHours: 5 }, "sleepHours"), 12);
  });

  it("strength: 200 min a week scores the same as 40 (flat after the nadir, no penalty)", () => {
    expect(term({ strengthMin: 200 / 7 }, "strength")).toBeCloseTo(term({ strengthMin: 40 / 7 }, "strength"), 12);
    expect(term({ strengthMin: 200 / 7 }, "strength")).toBeCloseTo(0, 12);
    expect(term({ strengthMin: 0 }, "strength")).toBeCloseTo(-K * Math.log(0.83), 10);
  });

  it("lean mass: body fat 19.9 % and 20.1 % differ by under 0.05 years, and there is no step anywhere", () => {
    const at = (fat: number) => term({ bodyFatPct: fat }, "leanMass");
    expect(Math.abs(at(19.9) - at(20.1))).toBeLessThan(0.05);
    for (let fat = 5; fat < 50; fat += 0.5) expect(Math.abs(at(fat + 0.5) - at(fat))).toBeLessThan(0.05);
    // ln HR = ln 1.11 per 10 points above 20 %; credit stops 5 points under.
    expect(at(30)).toBeCloseTo(K * Math.log(1.11), 10);
    expect(at(10)).toBeCloseTo(at(15), 12);
    expect(at(15)).toBeCloseTo(-K * Math.log(1.11) * 0.5, 10);
    // Reported as lean mass %.
    expect(run(series(180, () => ({ bodyFatPct: 27 }))).contributions.find((c) => c.key === "leanMass")).toMatchObject({ value: 73, reference: 80 });
  });

  it("lean mass has no effect from 60, but still counts as a term", () => {
    const r = run(series(180, () => ({ bodyFatPct: 35 })), { age: 62, sex: "male", heightCm: 180 });
    expect(r.termsUsed).toBe(9);
    expect(yearsOf(r, "leanMass")).toBe(0);
    expect(leanMassLnHr(60, 59.9, "female")).toBeGreaterThan(0);
  });

  it("weight without body fat: Deurenberg's body fat from BMI, marked estimated, at half weight", () => {
    const p: HealthspanProfile = { age: 27, sex: "male", heightCm: 173 };
    const r = run(series(180, () => ({ weightKg: 89.8, bodyFatPct: null })), p);
    const fat = deurenbergBodyFat(89.8 / 1.73 ** 2, 27, "male");
    expect(fat).toBeCloseTo(26.0, 1);
    const c = r.contributions.find((x) => x.key === "leanMass")!;
    expect(c).toMatchObject({ estimated: true });
    expect(c.value).toBeCloseTo(100 - fat, 10);
    expect(c.years).toBeCloseTo(K * 0.5 * leanMassLnHr(100 - fat, 27, "male"), 10);
    expect(r.bodyComposition).toMatchObject({ estimated: true });
    // Without height there is no BMI: the term is missing.
    expect(run(series(180, () => ({ weightKg: 89.8, bodyFatPct: null })), { ...p, heightCm: null }).termsUsed).toBe(8);
  });

  it("keeps lean and fat mass in kg and per m² for display", () => {
    const r = run(series(180, () => ({ weightKg: 89.8, bodyFatPct: 27 })), { age: 27, sex: "male", heightCm: 173 });
    const b = r.bodyComposition!;
    expect(b).toMatchObject({ bodyFatPct: 27, estimated: false });
    expect(b.weightKg).toBeCloseTo(89.8, 10);
    expect(b.leanKg).toBeCloseTo(65.55, 2);
    expect(b.fatKg).toBeCloseTo(24.25, 2);
    expect(b.ffmi).toBeCloseTo(21.9, 1);
    expect(b.fmi).toBeCloseTo(8.1, 1);
  });

  it("zones: Arem 2015 and Ahmadi 2022 knots, references falling from 30 to 70", () => {
    expect(piecewiseLinear(curves.zone13, 75)).toBeCloseTo(Math.log(0.8), 12);
    expect(piecewiseLinear(curves.zone45, 53.6)).toBeCloseTo(Math.log(0.64), 12);
    expect(referenceProfile(25, "male")).toMatchObject({ zone13: 100, zone45: 10, steps: 8000, restingHr: 60, sleepHours: 7, sri: 75.6, strength: 40 });
    expect(referenceProfile(50, "female")).toMatchObject({ zone13: 85, zone45: 8.5, restingHr: 64, leanMass: 67 });
    expect(referenceProfile(70, "male")).toMatchObject({ zone13: 70, zone45: 7, steps: 5600 });
  });

  it.each(["vo2max", "steps", "sri", "zone13", "zone45", "strength", "sleepHours"] as const)("%s never raises hazard as it rises", (key) => {
    const k = curves[key];
    const lo = k[0][0] - 10;
    const hi = k[k.length - 1][0] * 1.5;
    for (let i = 0; i < 400; i++) {
      const x = lo + ((hi - lo) * i) / 400;
      expect(piecewiseLinear(k, x + (hi - lo) / 400)).toBeLessThanOrEqual(piecewiseLinear(k, x) + 1e-12);
    }
  });

  it("steps beyond the curve's last knot earn nothing more (no cap besides the curve)", () => {
    expect(term({ steps: 15_000 }, "steps")).toBeCloseTo(term({ steps: 10_901 }, "steps"), 12);
    expect(term({ steps: 9_000 }, "steps")).toBeLessThan(0);
  });
});

describe("zone time in bouts (WHOOP counts zone time in activities)", () => {
  const start = 1_000_000;
  const mins = (xs: (number | null)[]) => xs;
  // 40 %, 60 % and 80 % of the reserve.
  const b = { moderate: 120, brisk: 140, vigorous: 160 };

  it("counts a run of 10 or more minutes at 40 % of the reserve, not one of 9", () => {
    expect(zoneBoutSeconds(mins([...Array(9).fill(130), 90]), start, b, [])).toEqual([0, 0, 0]);
    expect(zoneBoutSeconds(mins([90, ...Array(10).fill(130), 90]), start, b, [])).toEqual([600, 0, 0]);
  });

  it("splits a bout's minutes into 40–60 %, 60–80 % and 80 %+ of the reserve", () => {
    expect(zoneBoutSeconds(mins([...Array(4).fill(130), ...Array(4).fill(150), ...Array(4).fill(170)]), start, b, [])).toEqual([240, 240, 240]);
  });

  it("counts any minute inside a workout, however short", () => {
    expect(zoneBoutSeconds(mins([90, 130, 150, 170, 90]), start, b, [{ start: start + 60, end: start + 240 }])).toEqual([60, 60, 60]);
  });

  it("bridges one minute without heart rate, not two, and never a minute under the floor", () => {
    expect(zoneBoutSeconds(mins([...Array(5).fill(130), null, ...Array(5).fill(130)]), start, b, [])).toEqual([600, 0, 0]);
    expect(zoneBoutSeconds(mins([...Array(5).fill(130), null, null, ...Array(5).fill(130)]), start, b, [])).toEqual([0, 0, 0]);
    expect(zoneBoutSeconds(mins([...Array(5).fill(130), 100, ...Array(5).fill(130)]), start, b, [])).toEqual([0, 0, 0]);
  });
});

describe("refinements from the source check", () => {
  it("steps use Paluch's under-60 curve: no further gain past about 9,000", () => {
    const at = (steps: number) => yearsOf(run(series(30, () => ({ steps }))), "steps")!;
    expect(at(12_000)).toBeCloseTo(at(9_000), 6);
    expect(at(4_800)).toBeGreaterThan(at(7_000));
  });

  it("60 and over use the 60+ curve, which keeps falling to about 10,500", () => {
    const at = (steps: number) => yearsOf(run(series(30, () => ({ steps })), { ...profile, age: 65 }), "steps")!;
    expect(at(10_000)).toBeLessThan(at(7_000));
  });
});

describe("scoreHealthspan's coverage gate", () => {
  /** A day as stage 2 hands it over: `full` has 12 h of heart rate. */
  const dayOf = (i: number, full: boolean) => {
    const day = iso(today - 29 + i);
    return {
      day,
      dm: { steps: full ? 5000 : 500, rhrBpm: 70, vo2maxRun: null, vo2maxDaily: null, weightKg: null, bodyFatPct: null },
      rhr: 70,
      main: null,
      worn: true,
      s1: { hrMinutesAm: full ? 600 : 300, hrMinutesPm: full ? 600 : 60, boutZoneSeconds: [1800, 0] as [number, number] },
      age: { whole: 35, years: 35 },
    } as unknown as Parameters<typeof scoreHealthspan>[2];
  };
  const opts: PipelineOptions = { timeZone: "UTC", profile: { birthDate: "1991-01-01", sex: "male", maxHr: 185, heightCm: 180 } };
  const data = { exercisesByDay: new Map() } as unknown as Parameters<typeof scoreHealthspan>[0];
  const sleep = { sri: null } as unknown as SleepRow;

  it("leaves steps (like zone and strength minutes) out of a day with under 12 h of heart rate", () => {
    const f = newFold();
    let row: ReturnType<typeof scoreHealthspan> | undefined;
    for (let i = 0; i < 30; i++) row = scoreHealthspan(data, f, dayOf(i, i % 3 !== 0), sleep, opts);
    for (const [i, r] of f.hsRows.entries()) {
      const full = i % 3 !== 0;
      expect(r.steps, r.day).toBe(full ? 5000 : null);
      expect(r.zone13Min, r.day).toBe(full ? 30 : null);
      expect(r.strengthMin, r.day).toBe(full ? 0 : null);
      expect(r.restingHr, r.day).toBe(70);
    }
    if (!row || row.reason !== null) throw new Error("no Pulse Age");
    // 5,000 a day on the covered days; the 500-step short days would have pulled the mean to 3,500.
    expect(row.contributions.find((c) => c.key === "steps")!.value).toBe(5000);
    // Pulse's own VO2max estimate (Uth, no waist) stands in for the missing VO2max, at half weight.
    expect(row.fitnessEstimate).toMatchObject({ method: "uth" });
    expect(row.vo2maxSource).toBe("estimate");
  });

  it("counts each zone minute once for Pulse Age (WHOOP's time in zone) and for Fitness Age", () => {
    // Every day: 25 bouted minutes at 60–80 % of the reserve and 10 at 80 % or more.
    const day = (i: number) => {
      const d = dayOf(i, true);
      return { ...d, s1: { ...d.s1, boutZoneSeconds: [0, 25 * 60, 10 * 60] as [number, number, number] } };
    };
    const f = newFold();
    let row: ReturnType<typeof scoreHealthspan> | undefined;
    for (let i = 0; i < 30; i++) row = scoreHealthspan(data, f, day(i), sleep, opts);
    if (!row || row.reason !== null) throw new Error("no Pulse Age");
    // Pulse Age: 25 minutes a day in zones 1–3, 175 a week (version 18; the 60–80 % minutes counted twice before, 350).
    expect(row.contributions.find((c) => c.key === "zone13")!.value).toBeCloseTo(175, 9);
    // Fitness Age: 35 active minutes a day, 10 vigorous (a share of 0.29): HUNT 5 × 2 × 0.75 = 7.5. Fed the doubled 60
    // minutes (a vigorous share of 0.17) it read 5 × 2 × 1.0 = 10.
    expect(row.fitnessEstimate!.activityIndex).toBeCloseTo(physicalActivityIndex(7, 35, 10 / 35), 9);
    expect(row.fitnessEstimate!.activityIndex).toBe(7.5);
  });
});

describe("Pulse Age's WHOOP definitions (version 18)", () => {
  const dayOf = (i: number, start = today - 59) => {
    const day = iso(start + i);
    return {
      day,
      dm: { steps: 9000 + 100 * (i % 7), rhrBpm: 58 + (i % 5), vo2maxRun: 45, vo2maxDaily: null, weightKg: null, bodyFatPct: null },
      main: null,
      worn: true,
      s1: { hrMinutesAm: 700, hrMinutesPm: 700, boutZoneSeconds: [1200 + 60 * (i % 4), 300, 120] as [number, number, number] },
      age: { whole: 35, years: 35 },
    } as unknown as Parameters<typeof scoreHealthspan>[2];
  };
  const opts: PipelineOptions = { timeZone: "UTC", profile: { birthDate: "1991-01-01", sex: "male", maxHr: 185, heightCm: 180 } };
  const sleep = { sri: null } as unknown as SleepRow;
  const recovered = { value: 60 } as Parameters<typeof scoreHealthspan>[5];

  it("counts yoga, Pilates and boot camp as strength, as WHOOP's Healthspan list does", () => {
    for (const type of ["YOGA", "PILATES", "BOOT_CAMP", "STRENGTH_TRAINING", "WEIGHTLIFTING"]) {
      const d = dayOf(0);
      const e = { type, startTs: 0, endTs: 2400 };
      const data = { exercisesByDay: new Map([[d.day, [e]]]) } as unknown as Parameters<typeof scoreHealthspan>[0];
      const f = newFold();
      scoreHealthspan(data, f, d, sleep, opts);
      expect(f.hsRows[0].strengthMin, type).toBe(40);
    }
    const run = { exercisesByDay: new Map([[dayOf(0).day, [{ type: "RUNNING", startTs: 0, endTs: 2400 }]]]) } as unknown as Parameters<typeof scoreHealthspan>[0];
    const f = newFold();
    scoreHealthspan(run, f, dayOf(0), sleep, opts);
    expect(f.hsRows[0].strengthMin).toBe(0);
  });

  it("publishes Pace of Aging on Mondays only, once 21 of the last 31 days have a Recovery", () => {
    const data = { exercisesByDay: new Map() } as unknown as Parameters<typeof scoreHealthspan>[0];
    const f = newFold();
    const rows: { day: string; pace: number | null; daily: number | null | undefined; asOf: string | null | undefined }[] = [];
    for (let i = 0; i < 60; i++) {
      const d = dayOf(i);
      const row = scoreHealthspan(data, f, d, sleep, opts, recovered);
      f.outcomes.push({ day: d.day, recovery: 60, hrvZ: null, sleepPerf: null });
      if (row.reason === null) rows.push({ day: d.day, pace: row.paceOfAging, daily: row.paceDaily, asOf: row.paceAsOf });
    }
    const published = rows.filter((r) => r.pace != null);
    expect(published.length).toBeGreaterThan(0);
    // Every published value is the daily value of the Monday it names, and holds until the next Monday.
    for (const r of published) {
      expect(new Date(`${r.asOf}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(r.pace).toBe(rows.find((x) => x.day === r.asOf)!.daily);
    }
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].pace !== rows[i - 1].pace) expect(new Date(`${rows[i].day}T00:00:00Z`).getUTCDay(), rows[i].day).toBe(1);
    }
    // No value before 21 days with a Recovery.
    expect(rows.slice(0, 20).every((r) => r.pace == null)).toBe(true);
  });

  it("without 21 Recovery days in 31 there is no Pace, whatever the data", () => {
    const data = { exercisesByDay: new Map() } as unknown as Parameters<typeof scoreHealthspan>[0];
    const f = newFold();
    let last: ReturnType<typeof scoreHealthspan> | undefined;
    for (let i = 0; i < 60; i++) last = scoreHealthspan(data, f, dayOf(i), sleep, opts);
    if (!last || last.reason !== null) throw new Error("no Pulse Age");
    expect(last.paceOfAging).toBeNull();
    expect(last.paceDays).toBe(0);
    expect(last.paceDaily).not.toBeNull();
  });
});

describe("sleep consistency pools pairs of nights", () => {
  it("counts each pair once: a few days of data match the latest 7-day SRI, not the mean of the daily ones", () => {
    // Four days: pairs scoring 100, 70 and 49 (same minutes of 1440). The daily 7-day SRIs are 100, 85 and 73; their mean
    // (86) counted the first pair three times. Pooled, every pair counts once: 73, the latest 7-day SRI.
    const same = (sri: number) => ((sri + 100) / 200) * 1440;
    const pairs = [null, { same: same(100), pairs: 1440 }, { same: same(70), pairs: 1440 }, { same: same(49), pairs: 1440 }];
    const daily = [null, 100, 85, 73];
    const days = series(30, (ago) => (ago < 4 ? { sri: daily[3 - ago], sriPair: pairs[3 - ago] } : { sri: null, sriPair: null }));
    expect(run(days).contributions.find((c) => c.key === "sri")!.value).toBeCloseTo(73, 10);
    // Without pair counts (older callers), the daily SRIs' mean.
    const means = series(30, (ago) => (ago < 4 ? { sri: daily[3 - ago] } : { sri: null }));
    expect(run(means).contributions.find((c) => c.key === "sri")!.value).toBeCloseTo((100 + 85 + 73) / 3, 10);
  });
});
