/**
 * Vascular Load Engine (Dual-Mode Blood Pressure Corridor).
 *
 * Pure TypeScript, zero I/O, strictly causal.
 *
 * Estimates daily systolic and diastolic blood pressure corridors in two modes:
 * - Mode A (Uncalibrated): Relative Vascular Load delta (Δ mmHg) vs 28-day baseline.
 * - Mode B (Calibrated): Anchored absolute BP corridor (e.g. 122–128 / 78–82 mmHg)
 *   driven by cuff anchors in the last 30 days plus daily autonomic & load shifts.
 *
 * Reference study: pulse-gaps.md § Vascular Load & Blood Pressure Corridor.
 */

export interface VascularDailyFeatures {
  date: string; // YYYY-MM-DD
  rhrBpm: number | null;
  hrvRmssdMs: number | null;
  sleepMidpointMin: number | null; // minutes from midnight (wrapped around 00:00)
  sleepEfficiencyPct: number | null;
  strainScore: number | null; // 0..129
  vo2Max: number | null;
  ageYears: number | null;
  biologicalSex: 'male' | 'female' | 'other' | null;
  bmi: number | null;
}

export interface CuffReadingInput {
  timestampMs: number;
  date: string; // YYYY-MM-DD
  systolicMmHg: number;
  diastolicMmHg: number;
  pulseBpm: number | null;
  posture: 'sitting' | 'supine' | 'standing' | null;
}

export interface VascularDriverContribution {
  driver: 'rhr' | 'hrv' | 'sleep_regularity' | 'acute_load' | 'fitness_trend';
  deltaSystolicMmHg: number;
  deltaDiastolicMmHg: number;
  zScore: number;
}

export interface VascularCorridorOutput {
  date: string;
  mode: 'calibrated' | 'uncalibrated' | 'insufficient_data';
  reason:
    | 'ok'
    | 'missing_autonomic_signals'
    | 'baseline_warming_up'
    | 'calibration_expired';
  provisional: boolean;

  // Mode A: Uncalibrated Relative Vascular Load (always computed when baseline >= 7 days)
  relativeSystolicDeltaMmHg: number | null;
  relativeDiastolicDeltaMmHg: number | null;
  vascularLoadStatus: 'optimal' | 'elevated_drift' | 'high_load' | null;

  // Mode B: Calibrated Absolute Corridor (only when valid cuff anchor within 30 days)
  systolicRangeMmHg: [number, number] | null;
  diastolicRangeMmHg: [number, number] | null;
  pulsePressureMmHg: number | null;
  meanArterialPressureMmHg: number | null;

  // Confidence & Calibration Metadata
  confidenceScore: number; // 0.0 to 1.0
  corridorHalfWidthSystolic: number; // ± mmHg
  corridorHalfWidthDiastolic: number; // ± mmHg
  daysSinceLastCalibration: number | null;
  anchorCountInWindow: number;

  // Explainability
  drivers: VascularDriverContribution[];
}

const MS_PER_DAY = 86_400_000;
const BASELINE_WINDOW_DAYS = 28;
const ACUTE_STRAIN_WINDOW_DAYS = 7;
const CALIBRATION_WINDOW_DAYS = 30;
const CALIBRATION_HALFLIFE_DAYS = 14;
const CALIBRATION_DECAY_TAU = CALIBRATION_HALFLIFE_DAYS / Math.LN2;
const MIN_BASELINE_VALID_DAYS = 7;
const FULL_BASELINE_VALID_DAYS = 14;
const MIN_Z_DENOMINATOR = 0.5;
const Z_CLAMP = 3.0;
const MAX_SYSTOLIC_DRIFT_MMHG = 18.0;
const MAX_DIASTOLIC_DRIFT_MMHG = 12.0;

// Sensitivities (mmHg per 1 SD)
const BETA_SYS = {
  rhr: 2.4,
  hrv: 1.8, // applied to (-z_HRV)
  sleep: 1.2,
  strain: 1.5,
  vo2: -1.1,
} as const;

const BETA_DIA = {
  rhr: 1.6,
  hrv: 1.2, // applied to (-z_HRV)
  sleep: 0.8,
  strain: 0.9,
  vo2: -0.7,
} as const;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  const r = Math.round(val * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

function parseDayMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function diffDays(targetDate: string, earlierDate: string): number {
  return Math.round((parseDayMs(targetDate) - parseDayMs(earlierDate)) / MS_PER_DAY);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Circular distance in minutes on a 24-hour clock (1440 min).
 */
function circularMinutesDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 1440;
  return diff > 720 ? 1440 - diff : diff;
}

/**
 * Compute robust z-score using median and scaled MAD (1.4826 * MAD).
 */
function computeRobustZ(
  value: number,
  historyValues: readonly number[],
  distanceFn?: (a: number, b: number) => number,
): number {
  if (historyValues.length === 0) return 0;
  const med = median(historyValues);
  const absDevs = historyValues.map((v) =>
    distanceFn ? distanceFn(v, med) : Math.abs(v - med),
  );
  const mad = median(absDevs);
  const denom = Math.max(1.4826 * mad, MIN_Z_DENOMINATOR);
  const rawDiff = distanceFn ? distanceFn(value, med) : value - med;
  return clamp(rawDiff / denom, -Z_CLAMP, Z_CLAMP);
}

interface DriftResult {
  deltaSys: number;
  deltaDia: number;
  drivers: VascularDriverContribution[];
  completenessRatio: number;
}

/**
 * Compute physiological drift for `day` strictly against prior history (`historyBeforeDay`).
 */
function computeDailyDrift(
  day: VascularDailyFeatures,
  historyBeforeDay: readonly VascularDailyFeatures[],
): DriftResult {
  const baselineHistory = historyBeforeDay.filter((h) => {
    const d = diffDays(day.date, h.date);
    return d >= 1 && d <= BASELINE_WINDOW_DAYS;
  });

  const acuteHistory = historyBeforeDay.filter((h) => {
    const d = diffDays(day.date, h.date);
    return d >= 1 && d <= ACUTE_STRAIN_WINDOW_DAYS;
  });

  // 1. RHR z-score
  const rhrHist = baselineHistory
    .map((h) => h.rhrBpm)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const zRhr =
    day.rhrBpm !== null && Number.isFinite(day.rhrBpm) && rhrHist.length > 0
      ? computeRobustZ(day.rhrBpm, rhrHist)
      : 0;

  // 2. ln(HRV) z-score
  const hrvHist = baselineHistory
    .map((h) => (h.hrvRmssdMs !== null && h.hrvRmssdMs > 0 ? Math.log(h.hrvRmssdMs) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const zHrv =
    day.hrvRmssdMs !== null &&
    day.hrvRmssdMs > 0 &&
    Number.isFinite(day.hrvRmssdMs) &&
    hrvHist.length > 0
      ? computeRobustZ(Math.log(day.hrvRmssdMs), hrvHist)
      : 0;

  // 3. Sleep midpoint circular irregularity z-score (Always >= 0: irregularity is unsigned deviation from median midpoint)
  const sleepHist = baselineHistory
    .map((h) => h.sleepMidpointMin)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  let zSleep = 0;
  if (
    day.sleepMidpointMin !== null &&
    Number.isFinite(day.sleepMidpointMin) &&
    sleepHist.length > 0
  ) {
    const medMidpoint = median(sleepHist);
    const devToday = circularMinutesDistance(day.sleepMidpointMin, medMidpoint);
    const devHist = sleepHist.map((v) => circularMinutesDistance(v, medMidpoint));
    zSleep = clamp(computeRobustZ(devToday, devHist), 0, Z_CLAMP);
  }

  // 4. Acute strain load z-score (7d rolling mean vs 28d baseline)
  const strainBaseHist = baselineHistory
    .map((h) => h.strainScore)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const strainAcuteVals = [
    ...acuteHistory
      .map((h) => h.strainScore)
      .filter((v): v is number => v !== null && Number.isFinite(v)),
    ...(day.strainScore !== null && Number.isFinite(day.strainScore) ? [day.strainScore] : []),
  ];
  let zStrain = 0;
  if (strainAcuteVals.length > 0 && strainBaseHist.length > 0) {
    const acuteMean =
      strainAcuteVals.reduce((acc, v) => acc + v, 0) / strainAcuteVals.length;
    zStrain = computeRobustZ(acuteMean, strainBaseHist);
  }

  // 5. Fitness trend (VO2max) z-score
  const vo2Hist = baselineHistory
    .map((h) => h.vo2Max)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const zVo2 =
    day.vo2Max !== null && Number.isFinite(day.vo2Max) && vo2Hist.length > 0
      ? computeRobustZ(day.vo2Max, vo2Hist)
      : 0;

  const sysRhr = BETA_SYS.rhr * zRhr;
  const diaRhr = BETA_DIA.rhr * zRhr;

  const sysHrv = BETA_SYS.hrv * -zHrv;
  const diaHrv = BETA_DIA.hrv * -zHrv;

  const sysSleep = BETA_SYS.sleep * zSleep;
  const diaSleep = BETA_DIA.sleep * zSleep;

  const sysStrain = BETA_SYS.strain * zStrain;
  const diaStrain = BETA_DIA.strain * zStrain;

  const sysVo2 = BETA_SYS.vo2 * zVo2;
  const diaVo2 = BETA_DIA.vo2 * zVo2;

  const rawSys = sysRhr + sysHrv + sysSleep + sysStrain + sysVo2;
  const rawDia = diaRhr + diaHrv + diaSleep + diaStrain + diaVo2;

  const deltaSys = clamp(rawSys, -MAX_SYSTOLIC_DRIFT_MMHG, MAX_SYSTOLIC_DRIFT_MMHG);
  const deltaDia = clamp(rawDia, -MAX_DIASTOLIC_DRIFT_MMHG, MAX_DIASTOLIC_DRIFT_MMHG);

  const drivers: VascularDriverContribution[] = [
    {
      driver: 'rhr',
      deltaSystolicMmHg: round1(sysRhr),
      deltaDiastolicMmHg: round1(diaRhr),
      zScore: round1(zRhr),
    },
    {
      driver: 'hrv',
      deltaSystolicMmHg: round1(sysHrv),
      deltaDiastolicMmHg: round1(diaHrv),
      zScore: round1(zHrv),
    },
    {
      driver: 'sleep_regularity',
      deltaSystolicMmHg: round1(sysSleep),
      deltaDiastolicMmHg: round1(diaSleep),
      zScore: round1(zSleep),
    },
    {
      driver: 'acute_load',
      deltaSystolicMmHg: round1(sysStrain),
      deltaDiastolicMmHg: round1(diaStrain),
      zScore: round1(zStrain),
    },
    {
      driver: 'fitness_trend',
      deltaSystolicMmHg: round1(sysVo2),
      deltaDiastolicMmHg: round1(diaVo2),
      zScore: round1(zVo2),
    },
  ];

  // Completeness of today's signals
  let presentSignals = 0;
  if (day.rhrBpm !== null) presentSignals += 1;
  if (day.hrvRmssdMs !== null) presentSignals += 1;
  if (day.sleepMidpointMin !== null) presentSignals += 1;
  if (day.strainScore !== null) presentSignals += 1;
  if (day.vo2Max !== null) presentSignals += 1;
  const completenessRatio = presentSignals / 5;

  return { deltaSys, deltaDia, drivers, completenessRatio };
}

function classifyVascularLoadStatus(
  deltaSys: number,
  deltaDia: number,
): 'optimal' | 'elevated_drift' | 'high_load' {
  if (deltaSys > 6.5 || deltaDia > 4.5) {
    return 'high_load';
  }
  if (deltaSys > 2.5 || deltaDia > 1.5) {
    return 'elevated_drift';
  }
  return 'optimal';
}

/**
 * Compute daily Vascular Corridor output for `targetDate`.
 * Strictly causal: ignores any history or cuff readings after `targetDate`.
 */
export function computeVascularCorridor(
  targetDate: string,
  history: readonly VascularDailyFeatures[],
  cuffReadings: readonly CuffReadingInput[],
): VascularCorridorOutput {
  // Filter history strictly up to targetDate and sort chronologically
  const causalHistory = history
    .filter((h) => h.date <= targetDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayFeatures = causalHistory.find((h) => h.date === targetDate) ?? null;

  // Check if today has both autonomic signals missing
  const hasAutonomicToday =
    todayFeatures !== null &&
    ((todayFeatures.rhrBpm !== null && Number.isFinite(todayFeatures.rhrBpm)) ||
      (todayFeatures.hrvRmssdMs !== null &&
        Number.isFinite(todayFeatures.hrvRmssdMs) &&
        todayFeatures.hrvRmssdMs > 0));

  if (!todayFeatures || !hasAutonomicToday) {
    return {
      date: targetDate,
      mode: 'insufficient_data',
      reason: 'missing_autonomic_signals',
      provisional: false,
      relativeSystolicDeltaMmHg: null,
      relativeDiastolicDeltaMmHg: null,
      vascularLoadStatus: null,
      systolicRangeMmHg: null,
      diastolicRangeMmHg: null,
      pulsePressureMmHg: null,
      meanArterialPressureMmHg: null,
      confidenceScore: 0,
      corridorHalfWidthSystolic: 7,
      corridorHalfWidthDiastolic: 5,
      daysSinceLastCalibration: null,
      anchorCountInWindow: 0,
      drivers: [],
    };
  }

  // History strictly before targetDate within 28d window
  const priorHistory = causalHistory.filter((h) => h.date < targetDate);
  const validPriorDays = priorHistory.filter(
    (h) =>
      diffDays(targetDate, h.date) <= BASELINE_WINDOW_DAYS &&
      ((h.rhrBpm !== null && Number.isFinite(h.rhrBpm)) ||
        (h.hrvRmssdMs !== null && Number.isFinite(h.hrvRmssdMs) && h.hrvRmssdMs > 0)),
  );

  // Also check if targetDate itself counts toward the warming baseline check:
  // Spec: "Requires >= 7 valid days of RHR + HRV in the trailing 28-day window. If < 7 days -> mode: 'insufficient_data', reason: 'baseline_warming_up'".
  const trailingWindowValidDays = causalHistory.filter(
    (h) =>
      diffDays(targetDate, h.date) >= 0 &&
      diffDays(targetDate, h.date) < BASELINE_WINDOW_DAYS &&
      ((h.rhrBpm !== null && Number.isFinite(h.rhrBpm)) ||
        (h.hrvRmssdMs !== null && Number.isFinite(h.hrvRmssdMs) && h.hrvRmssdMs > 0)),
  );

  if (trailingWindowValidDays.length < MIN_BASELINE_VALID_DAYS) {
    return {
      date: targetDate,
      mode: 'insufficient_data',
      reason: 'baseline_warming_up',
      provisional: true,
      relativeSystolicDeltaMmHg: null,
      relativeDiastolicDeltaMmHg: null,
      vascularLoadStatus: null,
      systolicRangeMmHg: null,
      diastolicRangeMmHg: null,
      pulsePressureMmHg: null,
      meanArterialPressureMmHg: null,
      confidenceScore: 0,
      corridorHalfWidthSystolic: 7,
      corridorHalfWidthDiastolic: 5,
      daysSinceLastCalibration: null,
      anchorCountInWindow: 0,
      drivers: [],
    };
  }

  const provisional = trailingWindowValidDays.length < FULL_BASELINE_VALID_DAYS;

  // Compute today's physiological drift against strictly earlier days
  const todayDrift = computeDailyDrift(todayFeatures, priorHistory);
  const relSys = round1(todayDrift.deltaSys);
  const relDia = round1(todayDrift.deltaDia);
  const loadStatus = classifyVascularLoadStatus(relSys, relDia);

  // Evaluate cuff readings strictly on or before targetDate
  const causalCuff = cuffReadings
    .filter(
      (c) =>
        c.date <= targetDate &&
        c.systolicMmHg >= 70 &&
        c.systolicMmHg <= 250 &&
        c.diastolicMmHg >= 40 &&
        c.diastolicMmHg <= 150 &&
        c.systolicMmHg > c.diastolicMmHg,
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const activeAnchors = causalCuff.filter((c) => {
    const ageDays = diffDays(targetDate, c.date);
    return ageDays >= 0 && ageDays <= CALIBRATION_WINDOW_DAYS;
  });

  const latestCuff = causalCuff.length > 0 ? causalCuff[causalCuff.length - 1]! : null;
  const daysSinceLastCalibration = latestCuff ? diffDays(targetDate, latestCuff.date) : null;

  // If calibrated within 30 days -> Mode B ('calibrated')
  if (activeAnchors.length > 0 && daysSinceLastCalibration !== null && daysSinceLastCalibration <= CALIBRATION_WINDOW_DAYS) {
    let weightSum = 0;
    let weightedSysSum = 0;
    let weightedDiaSum = 0;

    for (const anchor of activeAnchors) {
      const ageDays = Math.max(0, diffDays(targetDate, anchor.date));
      const w = Math.exp(-ageDays / CALIBRATION_DECAY_TAU);

      // Compute physiological drift on anchor day k using history strictly prior to k
      const anchorDayFeatures = causalHistory.find((h) => h.date === anchor.date);
      let anchorDriftSys = 0;
      let anchorDriftDia = 0;
      if (anchorDayFeatures) {
        const priorToAnchor = causalHistory.filter((h) => h.date < anchor.date);
        const anchorDrift = computeDailyDrift(anchorDayFeatures, priorToAnchor);
        anchorDriftSys = anchorDrift.deltaSys;
        anchorDriftDia = anchorDrift.deltaDia;
      }

      const predSysFromAnchor = anchor.systolicMmHg + (todayDrift.deltaSys - anchorDriftSys);
      const predDiaFromAnchor = anchor.diastolicMmHg + (todayDrift.deltaDia - anchorDriftDia);

      weightedSysSum += w * predSysFromAnchor;
      weightedDiaSum += w * predDiaFromAnchor;
      weightSum += w;
    }

    const centerSys = weightedSysSum / weightSum;
    const centerDia = weightedDiaSum / weightSum;

    // Confidence score c_t in [0, 1]
    const freshnessFactor = Math.exp(-daysSinceLastCalibration / CALIBRATION_DECAY_TAU);
    const anchorCountFactor = Math.min(1, activeAnchors.length / 3);
    const confidenceScore = round1(
      clamp(
        0.55 * freshnessFactor + 0.25 * anchorCountFactor + 0.2 * todayDrift.completenessRatio,
        0.1,
        1.0,
      ),
    );

    const halfWidthSys = Math.round(3 + 4 * (1 - confidenceScore)); // ±3 to ±7 mmHg
    const halfWidthDia = Math.round(2 + 3 * (1 - confidenceScore)); // ±2 to ±5 mmHg

    const sysLow = Math.round(centerSys - halfWidthSys);
    const sysHigh = Math.round(centerSys + halfWidthSys);
    const diaLow = Math.round(centerDia - halfWidthDia);
    const diaHigh = Math.round(centerDia + halfWidthDia);

    const pp = Math.round(centerSys - centerDia);
    const map = Math.round(centerDia + (centerSys - centerDia) / 3);

    return {
      date: targetDate,
      mode: 'calibrated',
      reason: 'ok',
      provisional,
      relativeSystolicDeltaMmHg: relSys,
      relativeDiastolicDeltaMmHg: relDia,
      vascularLoadStatus: loadStatus,
      systolicRangeMmHg: [sysLow, sysHigh],
      diastolicRangeMmHg: [diaLow, diaHigh],
      pulsePressureMmHg: pp,
      meanArterialPressureMmHg: map,
      confidenceScore,
      corridorHalfWidthSystolic: halfWidthSys,
      corridorHalfWidthDiastolic: halfWidthDia,
      daysSinceLastCalibration,
      anchorCountInWindow: activeAnchors.length,
      drivers: todayDrift.drivers,
    };
  }

  // Mode A: Uncalibrated (either never calibrated or calibration > 30 days ago)
  const expired = daysSinceLastCalibration !== null && daysSinceLastCalibration > CALIBRATION_WINDOW_DAYS;
  const modeAConfidence = round1(
    clamp(
      0.5 * Math.min(1, validPriorDays.length / BASELINE_WINDOW_DAYS) +
        0.5 * todayDrift.completenessRatio,
      0.1,
      0.85,
    ),
  );
  const halfWidthSys = Math.round(3 + 4 * (1 - modeAConfidence));
  const halfWidthDia = Math.round(2 + 3 * (1 - modeAConfidence));

  return {
    date: targetDate,
    mode: 'uncalibrated',
    reason: expired ? 'calibration_expired' : 'ok',
    provisional,
    relativeSystolicDeltaMmHg: relSys,
    relativeDiastolicDeltaMmHg: relDia,
    vascularLoadStatus: loadStatus,
    systolicRangeMmHg: null,
    diastolicRangeMmHg: null,
    pulsePressureMmHg: null,
    meanArterialPressureMmHg: null,
    confidenceScore: modeAConfidence,
    corridorHalfWidthSystolic: halfWidthSys,
    corridorHalfWidthDiastolic: halfWidthDia,
    daysSinceLastCalibration,
    anchorCountInWindow: 0,
    drivers: todayDrift.drivers,
  };
}
