import { describe, expect, it } from 'vitest';
import {
  computeVascularCorridor,
  type CuffReadingInput,
  type VascularDailyFeatures,
} from './vascularLoad';

function makeDay(
  dayIndex: number,
  overrides: Partial<VascularDailyFeatures> = {},
): VascularDailyFeatures {
  const d = new Date(Date.UTC(2026, 0, 1 + dayIndex));
  const date = d.toISOString().slice(0, 10);
  // Deterministic subtle variation around baseline so MAD > 0
  const wave = Math.sin(dayIndex * 1.1);
  return {
    date,
    rhrBpm: 58 + wave * 1.5,
    hrvRmssdMs: 52 + wave * 3,
    sleepMidpointMin: 180 + wave * 10, // 03:00 AM ± 10m
    sleepEfficiencyPct: 88,
    strainScore: 45 + wave * 5,
    vo2Max: 46,
    ageYears: 34,
    biologicalSex: 'male',
    bmi: 23.2,
    ...overrides,
  };
}

function makeHistory(days: number): VascularDailyFeatures[] {
  return Array.from({ length: days }, (_, i) => makeDay(i));
}

describe('computeVascularCorridor', () => {
  it('1. Causality invariance: future history and future cuff readings never alter targetDate', () => {
    const history30 = makeHistory(30);
    const targetDate = history30[19]!.date; // day 20

    const cuffPast: CuffReadingInput = {
      timestampMs: Date.UTC(2026, 0, 15, 8, 0),
      date: history30[14]!.date,
      systolicMmHg: 118,
      diastolicMmHg: 76,
      pulseBpm: 60,
      posture: 'sitting',
    };

    const cuffFuture: CuffReadingInput = {
      timestampMs: Date.UTC(2026, 0, 25, 8, 0),
      date: history30[24]!.date,
      systolicMmHg: 155,
      diastolicMmHg: 98,
      pulseBpm: 80,
      posture: 'sitting',
    };

    // Mutate days 21..30 with extreme values
    const mutatedHistory = history30.map((d, idx) =>
      idx > 19
        ? {
            ...d,
            rhrBpm: 95,
            hrvRmssdMs: 15,
            strainScore: 120,
            sleepMidpointMin: 500,
          }
        : d,
    );

    const outCausal = computeVascularCorridor(
      targetDate,
      history30.slice(0, 20),
      [cuffPast],
    );
    const outWithFuture = computeVascularCorridor(targetDate, mutatedHistory, [
      cuffPast,
      cuffFuture,
    ]);

    expect(outWithFuture).toEqual(outCausal);
  });

  it('2. Mode transitions: insufficient_data -> uncalibrated -> calibrated -> calibration_expired', () => {
    const history60 = makeHistory(60);

    // Day 4 (only 5 valid days in window < 7) -> insufficient_data / baseline_warming_up
    const warmOut = computeVascularCorridor(history60[4]!.date, history60, []);
    expect(warmOut.mode).toBe('insufficient_data');
    expect(warmOut.reason).toBe('baseline_warming_up');
    expect(warmOut.provisional).toBe(true);
    expect(warmOut.relativeSystolicDeltaMmHg).toBeNull();

    // Day 10 (11 valid days, >=7 and <14) -> uncalibrated, provisional=true
    const uncalProvisional = computeVascularCorridor(
      history60[10]!.date,
      history60,
      [],
    );
    expect(uncalProvisional.mode).toBe('uncalibrated');
    expect(uncalProvisional.reason).toBe('ok');
    expect(uncalProvisional.provisional).toBe(true);
    expect(uncalProvisional.relativeSystolicDeltaMmHg).not.toBeNull();
    expect(uncalProvisional.systolicRangeMmHg).toBeNull();

    // Day 20 with cuff anchor on Day 18 -> calibrated, provisional=false
    const cuffDay18: CuffReadingInput = {
      timestampMs: Date.UTC(2026, 0, 19, 8, 0),
      date: history60[18]!.date,
      systolicMmHg: 120,
      diastolicMmHg: 78,
      pulseBpm: 58,
      posture: 'sitting',
    };
    const calOut = computeVascularCorridor(history60[20]!.date, history60, [
      cuffDay18,
    ]);
    expect(calOut.mode).toBe('calibrated');
    expect(calOut.reason).toBe('ok');
    expect(calOut.provisional).toBe(false);
    expect(calOut.daysSinceLastCalibration).toBe(2);
    expect(calOut.systolicRangeMmHg).not.toBeNull();
    expect(calOut.diastolicRangeMmHg).not.toBeNull();
    expect(calOut.pulsePressureMmHg).not.toBeNull();
    expect(calOut.meanArterialPressureMmHg).not.toBeNull();

    // Day 52 (34 days since Day 18 cuff > 30 days) -> reverts to uncalibrated with calibration_expired
    const expiredOut = computeVascularCorridor(history60[52]!.date, history60, [
      cuffDay18,
    ]);
    expect(expiredOut.mode).toBe('uncalibrated');
    expect(expiredOut.reason).toBe('calibration_expired');
    expect(expiredOut.daysSinceLastCalibration).toBe(34);
    expect(expiredOut.systolicRangeMmHg).toBeNull();
    expect(expiredOut.relativeSystolicDeltaMmHg).not.toBeNull();
  });

  it('3. Physiological directionality: RHR spike + HRV drop shifts delta up; recovery shifts delta down', () => {
    const baseHistory = makeHistory(28);

    const stressedDay = makeDay(28, {
      rhrBpm: 68, // +10 bpm above baseline
      hrvRmssdMs: 28, // sharp drop below baseline
      strainScore: 85,
    });
    const stressedOut = computeVascularCorridor(
      stressedDay.date,
      [...baseHistory, stressedDay],
      [],
    );
    expect(stressedOut.relativeSystolicDeltaMmHg).toBeGreaterThan(2.5);
    expect(stressedOut.relativeDiastolicDeltaMmHg).toBeGreaterThan(1.5);
    expect(['elevated_drift', 'high_load']).toContain(
      stressedOut.vascularLoadStatus,
    );

    const recoveredDay = makeDay(28, {
      rhrBpm: 52, // well below baseline
      hrvRmssdMs: 74, // well above baseline
      sleepMidpointMin: 180, // right on median midpoint
      strainScore: 30,
      vo2Max: 49,
    });
    const recoveredOut = computeVascularCorridor(
      recoveredDay.date,
      [...baseHistory, recoveredDay],
      [],
    );
    expect(recoveredOut.relativeSystolicDeltaMmHg).toBeLessThan(0);
    expect(recoveredOut.relativeDiastolicDeltaMmHg).toBeLessThan(0);
    expect(recoveredOut.vascularLoadStatus).toBe('optimal');
  });

  it('4. Corridor width widening: confidence decays and corridor widens from day 0 to day 29', () => {
    const history45 = makeHistory(45);
    const anchorDate = history45[14]!.date;
    const cuff: CuffReadingInput = {
      timestampMs: Date.UTC(2026, 0, 15, 8, 0),
      date: anchorDate,
      systolicMmHg: 122,
      diastolicMmHg: 78,
      pulseBpm: 60,
      posture: 'sitting',
    };

    const day0Out = computeVascularCorridor(anchorDate, history45, [cuff]);
    const day29Out = computeVascularCorridor(
      history45[14 + 29]!.date,
      history45,
      [cuff],
    );

    expect(day0Out.mode).toBe('calibrated');
    expect(day29Out.mode).toBe('calibrated');
    expect(day0Out.confidenceScore).toBeGreaterThan(day29Out.confidenceScore);
    expect(day29Out.corridorHalfWidthSystolic).toBeGreaterThan(
      day0Out.corridorHalfWidthSystolic,
    );
    expect(day29Out.corridorHalfWidthDiastolic).toBeGreaterThan(
      day0Out.corridorHalfWidthDiastolic,
    );
  });

  it('5. Outlier clamping: extreme physiological anomalies never shift delta beyond ±18 / ±12 mmHg', () => {
    const baseHistory = makeHistory(28);
    const extremeHighDay = makeDay(28, {
      rhrBpm: 180,
      hrvRmssdMs: 2,
      sleepMidpointMin: 900,
      strainScore: 129,
      vo2Max: 15,
    });

    const outHigh = computeVascularCorridor(
      extremeHighDay.date,
      [...baseHistory, extremeHighDay],
      [],
    );
    expect(outHigh.relativeSystolicDeltaMmHg).toBeLessThanOrEqual(18);
    expect(outHigh.relativeDiastolicDeltaMmHg).toBeLessThanOrEqual(12);

    const extremeLowDay = makeDay(28, {
      rhrBpm: 30,
      hrvRmssdMs: 250,
      sleepMidpointMin: 180,
      strainScore: 0,
      vo2Max: 85,
    });
    const outLow = computeVascularCorridor(
      extremeLowDay.date,
      [...baseHistory, extremeLowDay],
      [],
    );
    expect(outLow.relativeSystolicDeltaMmHg).toBeGreaterThanOrEqual(-18);
    expect(outLow.relativeDiastolicDeltaMmHg).toBeGreaterThanOrEqual(-12);
  });

  it('6. Missing data resilience: null sleepMidpointMin or vo2Max still computes valid output from RHR + HRV', () => {
    const sparseHistory = Array.from({ length: 16 }, (_, i) =>
      makeDay(i, {
        sleepMidpointMin: null,
        vo2Max: null,
        strainScore: null,
      }),
    );
    const target = sparseHistory[15]!;
    const out = computeVascularCorridor(target.date, sparseHistory, []);

    expect(out.mode).toBe('uncalibrated');
    expect(out.reason).toBe('ok');
    expect(out.relativeSystolicDeltaMmHg).not.toBeNull();
    expect(out.relativeDiastolicDeltaMmHg).not.toBeNull();
    expect(out.drivers).toHaveLength(5);

    // When both RHR and HRV are missing on targetDate -> missing_autonomic_signals
    const noAutonomicDay = makeDay(16, {
      rhrBpm: null,
      hrvRmssdMs: null,
    });
    const outMissing = computeVascularCorridor(
      noAutonomicDay.date,
      [...sparseHistory, noAutonomicDay],
      [],
    );
    expect(outMissing.mode).toBe('insufficient_data');
    expect(outMissing.reason).toBe('missing_autonomic_signals');
  });
});
