import { describe, expect, it } from "vitest";
import type { BloodPressureReading } from "@/data/types";
import { evaluateBloodPressureProtocol } from "./bloodPressureProtocol";
import { hazard, paceOf, PULSE_AGE_FACTORS, pulseAge, type PulseAgeDay, references } from "./pulseAge";
import { calculateBpYears, PULSE_AGE_BP_MANIFEST } from "./pulseAgeBp";

const day = (o: Partial<PulseAgeDay> = {}): PulseAgeDay => ({
  sleepHours: null,
  sri: null,
  steps: null,
  zone13Min: null,
  zone45Min: null,
  strengthMin: null,
  restingHr: null,
  ...o,
});

const bpReading = (
  id: string,
  dayStr: string,
  systolicMmhg: number,
  diastolicMmhg: number,
  overrides: Partial<BloodPressureReading> = {},
): BloodPressureReading => ({
  id,
  ts: Date.parse(`${dayStr}T08:00:00Z`) / 1000,
  day: dayStr,
  systolicMmhg,
  diastolicMmhg,
  bodyPosition: "sitting",
  measurementLocation: "left_upper_arm",
  quality: "direct",
  importedAt: 1700000000,
  ...overrides,
});

const protocolReadings = (
  systolic = 115,
  diastolic = 75,
  count = 12,
  days = ["2026-05-01", "2026-05-05", "2026-05-10"],
  overrides: Partial<BloodPressureReading> = {},
): BloodPressureReading[] =>
  Array.from({ length: count }, (_, i) => {
    const d = days[i % days.length];
    return bpReading(`bp-${i}`, d, systolic, diastolic, {
      ts: Date.parse(`${d}T08:00:00Z`) / 1000 + i * 60,
      ...overrides,
    });
  });

describe("hazards", () => {
  it("every factor's reference has a hazard ratio of 1", () => {
    const refs = references(35, "male");
    for (const f of PULSE_AGE_FACTORS) expect(hazard(f, refs[f], 35, "male"), f).toBeCloseTo(1, 4);
  });
  it("clamps", () => {
    expect(hazard("sleepHours", 3, 35, "male")).toBe(1.24608);
    expect(hazard("restingHr", 120, 35, "female")).toBe(1.2214);
    expect(hazard("vo2max", 80, 35, "male")).toBe(0.60653);
  });
});

describe("pulseAge", () => {
  const refs = references(35, "male");
  // Weekly minutes come from the 28-day sum × 0.25: a daily value of weekly / 7 on every day gives the weekly figure.
  const atRef = day({
    sleepHours: refs.sleepHours,
    sri: refs.sri,
    steps: refs.steps,
    zone13Min: refs.zone13 / 7,
    zone45Min: refs.zone45 / 7,
    strengthMin: refs.strength / 7,
    restingHr: refs.restingHr,
  });
  it("at every reference, Pulse Age is the age, with full confidence", () => {
    const r = pulseAge({ age: 35, sex: "male", days: Array(28).fill(atRef), vo2: [refs.vo2max], leanPct: [refs.leanMass] })!;
    expect(r.pulseAge).toBeCloseTo(35, 3);
    expect(r.present).toBe(9);
    expect(r.confidence).toBe(1);
  });
  it("renormalizes over the factors present (fix 9)", () => {
    // Five factors, one of them (resting HR 10 bpm high) worth 10·ln(e^0.12) = 1.2 years; the rest at reference.
    const d = day({ sleepHours: 7.5, sri: 70, steps: 8000, restingHr: refs.restingHr + 10, zone13Min: refs.zone13 / 7 });
    const r = pulseAge({ age: 35, sex: "male", days: Array(28).fill(d), vo2: [], leanPct: [] })!;
    expect(r.present).toBe(5);
    // The source would have added 1.2 years; scaled to nine factors it is 1.2 · 9/5.
    expect(r.deltaYears).toBeCloseTo((1.2 * 9) / 5, 3);
  });
  it("shows nothing below five factors", () => {
    expect(pulseAge({ age: 35, sex: "male", days: Array(28).fill(day({ sleepHours: 7, sri: 80, steps: 9000, restingHr: 60 })), vo2: [], leanPct: [] })).toBeNull();
  });
  it("pace is Pulse Age over age within 0.6–1.6", () => {
    expect(paceOf(30, 35)).toBeCloseTo(30 / 35);
    expect(paceOf(80, 35)).toBe(1.6);
  });
});

describe("Pulse Age Blood Pressure (PR-13)", () => {
  const refs = references(35, "male");
  const atRef = day({
    sleepHours: refs.sleepHours,
    sri: refs.sri,
    steps: refs.steps,
    zone13Min: refs.zone13 / 7,
    zone45Min: refs.zone45 / 7,
    strengthMin: refs.strength / 7,
    restingHr: refs.restingHr,
  });

  it("1. Flag-off bitwise identity: bpPulseAge=false produces identical Pulse Age regardless of BP data", () => {
    const bp = evaluateBloodPressureProtocol(protocolReadings(160, 100), "2026-05-12");
    expect(bp.eligible).toBe(true);
    const base = pulseAge({ age: 35, sex: "male", days: Array(28).fill(atRef), vo2: [refs.vo2max], leanPct: [refs.leanMass], bpEnabled: false })!;
    const withBp = pulseAge({ age: 35, sex: "male", days: Array(28).fill(atRef), vo2: [refs.vo2max], leanPct: [refs.leanMass], bp, bpEnabled: false })!;
    expect(withBp).toEqual(base);
  });

  it("2. Flag-on without BP data: evaluates eligible=false (reason: no_data) and matches base 9-factor model", () => {
    const bp = evaluateBloodPressureProtocol([], "2026-05-12");
    expect(bp).toEqual({ eligible: false, reason: "no_data", readingCount: 0, dayCount: 0 });
    const base = pulseAge({ age: 35, sex: "male", days: Array(28).fill(atRef), vo2: [refs.vo2max], leanPct: [refs.leanMass], bpEnabled: false })!;
    const withEmptyBp = pulseAge({ age: 35, sex: "male", days: Array(28).fill(atRef), vo2: [refs.vo2max], leanPct: [refs.leanMass], bp, bpEnabled: true })!;
    expect(withEmptyBp.pulseAge).toBe(base.pulseAge);
    expect(withEmptyBp.deltaYears).toBe(base.deltaYears);
    expect(withEmptyBp.present).toBe(base.present);
    expect(withEmptyBp.confidence).toBe(base.confidence);
    expect(withEmptyBp.factors.find((f) => f.key === "bloodPressure")?.years).toBeNull();
  });

  it("3. Insufficient readings (< 12): 11 readings across 4 days returns reason insufficient_readings", () => {
    const readings = protocolReadings(125, 80, 11, ["2026-05-01", "2026-05-03", "2026-05-05", "2026-05-07"]);
    const bp = evaluateBloodPressureProtocol(readings, "2026-05-12");
    expect(bp).toEqual({ eligible: false, reason: "insufficient_readings", readingCount: 11, dayCount: 4 });
  });

  it("4. Insufficient days (< 3): 15 readings across 2 days returns reason insufficient_days", () => {
    const readings = protocolReadings(125, 80, 15, ["2026-05-01", "2026-05-02"]);
    const bp = evaluateBloodPressureProtocol(readings, "2026-05-12");
    expect(bp).toEqual({ eligible: false, reason: "insufficient_days", readingCount: 15, dayCount: 2 });
  });

  it("5. Stale readings (> 90 days old): readings 95 days prior return reason stale", () => {
    const readings = protocolReadings(125, 80, 12, ["2026-01-01", "2026-01-03", "2026-01-05"]);
    const bp = evaluateBloodPressureProtocol(readings, "2026-05-12");
    expect(bp).toEqual({ eligible: false, reason: "stale", readingCount: 0, dayCount: 0 });
  });

  it("6. Derived/PPG-only exclusion: derived readings return reason derived_only", () => {
    const readings = protocolReadings(125, 80, 12, ["2026-05-01", "2026-05-05", "2026-05-10"], { quality: "derived" });
    const bp = evaluateBloodPressureProtocol(readings, "2026-05-12");
    expect(bp).toEqual({ eligible: false, reason: "derived_only", readingCount: 0, dayCount: 0 });
  });

  it("7. Incompatible modality exclusion: standing or wrist readings return reason incompatible_modality", () => {
    const wrist = protocolReadings(125, 80, 12, ["2026-05-01", "2026-05-05", "2026-05-10"], { measurementLocation: "left_wrist" });
    expect(evaluateBloodPressureProtocol(wrist, "2026-05-12")).toEqual({
      eligible: false,
      reason: "incompatible_modality",
      readingCount: 0,
      dayCount: 0,
    });
    const standing = protocolReadings(125, 80, 12, ["2026-05-01", "2026-05-05", "2026-05-10"], { bodyPosition: "standing_up" });
    expect(evaluateBloodPressureProtocol(standing, "2026-05-12")).toEqual({
      eligible: false,
      reason: "incompatible_modality",
      readingCount: 0,
      dayCount: 0,
    });
  });

  it("8. Protocol-grade valid evaluation: 12 readings across 4 days at 115/75 mmHg yields 0.0 years delta", () => {
    const readings = protocolReadings(115, 75, 12, ["2026-05-01", "2026-05-03", "2026-05-06", "2026-05-10"]);
    const bp = evaluateBloodPressureProtocol(readings, "2026-05-12");
    expect(bp).toEqual({
      eligible: true,
      systolicMean: 115,
      diastolicMean: 75,
      readingCount: 12,
      dayCount: 4,
      spanDays: 10,
      quality: "protocol_grade",
    });
    expect(calculateBpYears(bp)).toBeCloseTo(0, 5);
  });

  it("9. Monotonicity across SBP spectrum: years delta strictly non-decreasing from 95 to 180 mmHg", () => {
    const sbps = [95, 105, 115, 125, 135, 145, 165, 180];
    const deltas = sbps.map((sbp) => {
      const bp = evaluateBloodPressureProtocol(protocolReadings(sbp, 75), "2026-05-12");
      return calculateBpYears(bp);
    });
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeGreaterThanOrEqual(deltas[i - 1]);
    }
    expect(deltas[0]).toBeLessThan(0);
    expect(deltas[2]).toBeCloseTo(0, 5); // 115 mmHg reference
    expect(deltas.at(-1)).toBe(PULSE_AGE_BP_MANIFEST.maxPenaltyYears);
  });

  it("10. Saturation clamping at extremes: clamps at 90 mmHg (-1.5y) and 180 mmHg (+4.5y)", () => {
    const low = evaluateBloodPressureProtocol(protocolReadings(85, 55), "2026-05-12");
    const at90 = evaluateBloodPressureProtocol(protocolReadings(90, 60), "2026-05-12");
    expect(calculateBpYears(low)).toBe(calculateBpYears(at90));
    expect(calculateBpYears(low)).toBeGreaterThanOrEqual(PULSE_AGE_BP_MANIFEST.maxCreditYears);

    const high = evaluateBloodPressureProtocol(protocolReadings(210, 120), "2026-05-12");
    const at180 = evaluateBloodPressureProtocol(protocolReadings(180, 110), "2026-05-12");
    expect(calculateBpYears(high)).toBe(PULSE_AGE_BP_MANIFEST.maxPenaltyYears);
    expect(calculateBpYears(at180)).toBe(PULSE_AGE_BP_MANIFEST.maxPenaltyYears);
  });

  it("11. Base-factor renormalization isolation: adding BP with 6 of 9 base factors keeps scale at 9/6", () => {
    // 6 base factors present, one (restingHr +10 bpm) adds 1.2 raw years -> scaled by 9/6 = 1.8 years.
    const d = day({
      sleepHours: refs.sleepHours,
      sri: refs.sri,
      steps: refs.steps,
      zone13Min: refs.zone13 / 7,
      zone45Min: refs.zone45 / 7,
      restingHr: refs.restingHr + 10,
    });
    const withoutBp = pulseAge({ age: 35, sex: "male", days: Array(28).fill(d), vo2: [], leanPct: [], bpEnabled: true })!;
    expect(withoutBp.present).toBe(6);
    expect(withoutBp.deltaYears).toBeCloseTo(1.8, 3);

    const bp = evaluateBloodPressureProtocol(protocolReadings(135, 85), "2026-05-12");
    const expectedBpYears = calculateBpYears(bp);
    const withBp = pulseAge({ age: 35, sex: "male", days: Array(28).fill(d), vo2: [], leanPct: [], bp, bpEnabled: true })!;

    expect(withBp.present).toBe(6);
    expect(withBp.confidence).toBe(withoutBp.confidence);
    expect(withBp.deltaYears).toBeCloseTo(withoutBp.deltaYears + expectedBpYears, 4);
    for (const key of PULSE_AGE_FACTORS) {
      const fWithout = withoutBp.factors.find((f) => f.key === key)!;
      const fWith = withBp.factors.find((f) => f.key === key)!;
      expect(fWith.years).toBe(fWithout.years);
    }
  });

  it("12. Causality enforcement: future readings after asOfDay are ignored", () => {
    const past = protocolReadings(115, 75, 12, ["2026-05-01", "2026-05-05", "2026-05-10"]);
    const future = protocolReadings(175, 110, 12, ["2026-05-13", "2026-05-14", "2026-05-15"]);
    const evalPastOnly = evaluateBloodPressureProtocol(past, "2026-05-12");
    const evalWithFuture = evaluateBloodPressureProtocol([...past, ...future], "2026-05-12");
    expect(evalWithFuture).toEqual(evalPastOnly);
  });

  it("13. Manifest schema validation: PULSE_AGE_BP_MANIFEST has valid structure, hash, and strictly increasing knots", () => {
    expect(PULSE_AGE_BP_MANIFEST.model).toBe("pulse-age-bp");
    expect(PULSE_AGE_BP_MANIFEST.modelVersion).toBeGreaterThanOrEqual(1);
    expect(PULSE_AGE_BP_MANIFEST.bpFeatureVersion).toBeGreaterThanOrEqual(1);
    expect(PULSE_AGE_BP_MANIFEST.coefficientArtifactHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(PULSE_AGE_BP_MANIFEST.minSbpBound).toBeLessThan(PULSE_AGE_BP_MANIFEST.referenceSbp);
    expect(PULSE_AGE_BP_MANIFEST.referenceSbp).toBeLessThan(PULSE_AGE_BP_MANIFEST.maxSbpBound);
    expect(PULSE_AGE_BP_MANIFEST.maxCreditYears).toBeLessThan(0);
    expect(PULSE_AGE_BP_MANIFEST.maxPenaltyYears).toBeGreaterThan(0);
    const { knots, splineWeights, linearTerm } = PULSE_AGE_BP_MANIFEST.coefficients;
    expect(linearTerm).toBeGreaterThan(0);
    expect(knots.length).toBe(splineWeights.length);
    for (let i = 1; i < knots.length; i++) {
      expect(knots[i]).toBeGreaterThan(knots[i - 1]);
    }
    for (const w of splineWeights) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });
});
