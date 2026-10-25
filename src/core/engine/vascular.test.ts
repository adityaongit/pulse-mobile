import { describe, expect, it } from "vitest";
import type { BloodPressureReadingRow } from "@/data/types";
import { addDays } from "@/lib/time";
import {
  calibrationHalfWidthMmHg,
  classifyAhaBloodPressure,
  computeVascularCorridorSeries,
  type VascularDailyFeatureInput,
} from "./vascular";

function makeFeatureSeries(
  startDay: string,
  count: number,
  overrides: Partial<Record<number, Partial<VascularDailyFeatureInput>>> = {},
): VascularDailyFeatureInput[] {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(startDay, i);
    const base: VascularDailyFeatureInput = {
      date,
      rhrBpm: 56,
      hrvRmssdMs: 52,
      sleepDurationHours: 7.6,
      sleepEfficiencyPct: 89,
      sleepDebtHours: 0.4,
      strainPct: 48,
      respiratoryRateBrpm: 14.5,
      skinTempDeltaC: 0.0,
      bmi: 23.4,
    };
    return { ...base, ...(overrides[i] ?? {}) };
  });
}

describe("vascular engine (Dual-Mode Blood Pressure & Vascular Corridor)", () => {
  it("enforces strict causality: adding or mutating a future cuff anchor or future autonomic day never changes past days", () => {
    const days30 = makeFeatureSeries("2026-01-01", 30, {
      20: { rhrBpm: 62, hrvRmssdMs: 38, sleepDebtHours: 2.5 },
    });
    const earlyCuff: BloodPressureReadingRow = {
      id: "cuff-15",
      timestampMs: Date.parse("2026-01-16T08:00:00Z"),
      date: "2026-01-16",
      systolicMmHg: 118,
      diastolicMmHg: 76,
      pulseBpm: 58,
      posture: "sitting",
      source: "health_connect",
    };

    const baselineRun = computeVascularCorridorSeries(days30, [earlyCuff]);

    const days40 = [
      ...days30,
      ...makeFeatureSeries("2026-01-31", 10, {
        5: { rhrBpm: 72, hrvRmssdMs: 22, sleepDebtHours: 6.0, strainPct: 95 },
      }),
    ];
    const futureCuff: BloodPressureReadingRow = {
      id: "cuff-32",
      timestampMs: Date.parse("2026-02-02T08:00:00Z"),
      date: "2026-02-02",
      systolicMmHg: 145,
      diastolicMmHg: 94,
      pulseBpm: 70,
      posture: "sitting",
      source: "manual",
    };

    const extendedRun = computeVascularCorridorSeries(days40, [earlyCuff, futureCuff]);

    for (const d of days30) {
      expect(extendedRun.get(d.date)).toEqual(baselineRun.get(d.date));
    }
  });

  it("returns uncalibrated honest state with calibration_required and null mmHg values when no cuff anchor exists", () => {
    const days = makeFeatureSeries("2026-01-01", 25, {
      20: { rhrBpm: 61, hrvRmssdMs: 40, sleepDebtHours: 2.0 },
    });
    const series = computeVascularCorridorSeries(days, []);

    // Warmup days (< 14 prior nights) have baseline_warming_up for autonomicDelta
    const warmupDay = series.get("2026-01-10")!;
    expect(warmupDay.mode).toBe("uncalibrated");
    expect(warmupDay.systolic).toEqual({
      value: null,
      lower: null,
      upper: null,
      reason: "calibration_required",
      provisional: true,
    });
    expect(warmupDay.autonomicDelta).toEqual({
      sbpDeltaMmHg: null,
      dbpDeltaMmHg: null,
      reason: "baseline_warming_up",
      provisional: true,
    });

    // Day 21 (>= 14 prior nights) has valid autonomicDelta but still null absolute mmHg
    const activeUncalibrated = series.get("2026-01-21")!;
    expect(activeUncalibrated.mode).toBe("uncalibrated");
    expect(activeUncalibrated.systolic.value).toBeNull();
    expect(activeUncalibrated.diastolic.value).toBeNull();
    expect(activeUncalibrated.pulsePressure.value).toBeNull();
    expect(activeUncalibrated.meanArterialPressure.value).toBeNull();
    expect(activeUncalibrated.ahaCategory).toBeNull();
    expect(activeUncalibrated.autonomicDelta.sbpDeltaMmHg).toBeGreaterThan(0);
    expect(activeUncalibrated.autonomicDelta.dbpDeltaMmHg).toBeGreaterThan(0);
    expect(activeUncalibrated.autonomicDelta.reason).toBeNull();
  });

  it("widens calibration uncertainty sigma_t across fresh (<=7d), aging (8-28d), and expired (>28d) states", () => {
    expect(calibrationHalfWidthMmHg(0)).toEqual({ status: "fresh", halfWidthMmHg: 4 });
    expect(calibrationHalfWidthMmHg(7)).toEqual({ status: "fresh", halfWidthMmHg: 6 });
    expect(calibrationHalfWidthMmHg(14)).toEqual({ status: "aging", halfWidthMmHg: 7 });
    expect(calibrationHalfWidthMmHg(28)).toEqual({ status: "aging", halfWidthMmHg: 10 });
    expect(calibrationHalfWidthMmHg(35)).toEqual({ status: "expired", halfWidthMmHg: 12 });
    expect(calibrationHalfWidthMmHg(60)).toEqual({ status: "expired", halfWidthMmHg: 14 });

    const days = makeFeatureSeries("2026-01-01", 60);
    const cuffOnDay15: BloodPressureReadingRow = {
      id: "cuff-anchor",
      timestampMs: Date.parse("2026-01-16T08:00:00Z"),
      date: "2026-01-16",
      systolicMmHg: 120,
      diastolicMmHg: 78,
      pulseBpm: 56,
      posture: "sitting",
      source: "health_connect",
    };
    const series = computeVascularCorridorSeries(days, [cuffOnDay15]);

    const onAnchor = series.get("2026-01-16")!;
    expect(onAnchor.mode).toBe("calibrated");
    expect(onAnchor.calibration.status).toBe("fresh");
    expect(onAnchor.calibration.halfWidthMmHg).toBe(4);
    expect(onAnchor.systolic).toMatchObject({ value: 120, lower: 116, upper: 124, reason: null });
    expect(onAnchor.diastolic).toMatchObject({ value: 78, lower: 74, upper: 82, reason: null });
    expect(onAnchor.pulsePressure.value).toBe(42);
    expect(onAnchor.meanArterialPressure.value).toBe(92);

    const agingDay = series.get("2026-01-30")!; // 14 days after anchor
    expect(agingDay.calibration.status).toBe("aging");
    expect(agingDay.calibration.daysSinceCalibration).toBe(14);
    expect(agingDay.calibration.halfWidthMmHg).toBe(7);
    expect(agingDay.systolic.reason).toBeNull();
    expect(agingDay.systolic.provisional).toBe(true);

    const expiredDay = series.get("2026-02-20")!; // 35 days after anchor
    expect(expiredDay.calibration.status).toBe("expired");
    expect(expiredDay.calibration.daysSinceCalibration).toBe(35);
    expect(expiredDay.calibration.halfWidthMmHg).toBe(12);
    expect(expiredDay.systolic.reason).toBe("calibration_expired");
    expect(expiredDay.systolic.provisional).toBe(true);
  });

  it("shifts the calibrated corridor upward under elevated RHR, suppressed HRV, and sleep debt, and downward under recovery", () => {
    const days = makeFeatureSeries("2026-01-01", 32, {
      25: { rhrBpm: 63, hrvRmssdMs: 34, sleepDebtHours: 4.0 }, // High sympathetic load
      26: { rhrBpm: 52, hrvRmssdMs: 68, sleepDebtHours: 0.0 }, // Parasympathetic recovery
    });
    const cuff: BloodPressureReadingRow = {
      id: "cuff-20",
      timestampMs: Date.parse("2026-01-21T08:00:00Z"),
      date: "2026-01-21",
      systolicMmHg: 120,
      diastolicMmHg: 78,
      pulseBpm: 56,
      posture: "sitting",
      source: "manual",
    };

    const series = computeVascularCorridorSeries(days, [cuff]);
    const stressed = series.get("2026-01-26")!; // index 25
    const recovered = series.get("2026-01-27")!; // index 26

    expect(stressed.systolic.value!).toBeGreaterThan(120);
    expect(stressed.diastolic.value!).toBeGreaterThan(78);
    expect(recovered.systolic.value!).toBeLessThan(120);
    expect(recovered.diastolic.value!).toBeLessThan(78);
  });

  it("classifies AHA/ACC 2017 blood pressure categories accurately across all boundaries", () => {
    expect(classifyAhaBloodPressure(118, 76)).toBe("normal");
    expect(classifyAhaBloodPressure(120, 78)).toBe("elevated");
    expect(classifyAhaBloodPressure(129, 79)).toBe("elevated");
    expect(classifyAhaBloodPressure(130, 76)).toBe("stage1_hypertension");
    expect(classifyAhaBloodPressure(118, 80)).toBe("stage1_hypertension");
    expect(classifyAhaBloodPressure(140, 82)).toBe("stage2_hypertension");
    expect(classifyAhaBloodPressure(128, 90)).toBe("stage2_hypertension");
    expect(classifyAhaBloodPressure(181, 95)).toBe("hypertensive_crisis");
    expect(classifyAhaBloodPressure(150, 121)).toBe("hypertensive_crisis");
  });
});
