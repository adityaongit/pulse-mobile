// Dual-Mode Blood Pressure & Vascular Load Corridor Engine (PR-14 / Issue #19).
// Pure TypeScript only: no database, no network, no clock reads, no React.
//
// Scientific grounding (peer-reviewed cardiovascular physiology):
// 1. Cuff-anchored calibration + exponential uncertainty growth:
//    Hoshide S et al. (2023), Hypertension Research 46, 819-830;
//    Mukkamala R et al. (2021), Hypertension 78(5), 1161-1174 (AAMI/ESH/ISO 81060-2 ±8 mmHg SD criterion).
//    sigma_t = min(14, round(4 + (t / 28) * 6)),fresh <=7d, aging 8-28d, expired >28d.
// 2. Autonomic-vascular coupling (RHR + ln(RMSSD)):
//    Palatini P et al. (2006), Hypertension 48(2), 213-220;
//    Thayer JF et al. (2010), Int J Cardiol 141(2), 122-131;
//    beta_SBP,RHR = +0.55 mmHg/bpm, beta_DBP,RHR = +0.40 mmHg/bpm;
//    beta_SBP,HRV = -3.8 mmHg/ln(ms), beta_DBP,HRV = -2.5 mmHg/ln(ms).
// 3. Sleep restriction & sleep debt sympathetic pressor response:
//    Tochikubo O et al. (1996), Hypertension 27(6), 1318-1324;
//    Lusardi P et al. (1999), Am J Hypertens 12(1), 63-68;
//    beta_SBP,debt = +0.45 mmHg/hr, beta_DBP,debt = +0.30 mmHg/hr (clamped to [0, 12] hrs).
// 4. Training load ratio (ACWR) post-exercise hypotension vs overreaching:
//    Cornelissen VA & Smart NA (2013), J Am Heart Assoc 2(1), e004473;
//    MacDonald JR (2002), J Hum Hypertens 16(4), 225-236;
//    gamma_SBP = -1.2 mmHg when ACWR in [0.8, 1.3], +2.5 * (ACWR - 1.5) when ACWR > 1.5.
// 5. BMI vascular stiffness adjustment (calibrated mode only, relative to anchor-day BMI):
//    Hall JE et al. (2015), Circ Res 116(6), 991-1006;
//    delta_SBP,BMI = +0.70 * (BMI_D - BMI_anchor), delta_DBP,BMI = +0.45 * (BMI_D - BMI_anchor).
// 6. AHA/ACC 2017 Blood Pressure Categories:
//    Whelton PK et al. (2018), Hypertension 71(6), e13-e115.

import type {
  BloodPressureAhaCategory,
  BloodPressureReadingRow,
  VascularCalibrationStatus,
} from "@/data/types";
import type { VascularCorridorDay } from "@/pipeline/types";
import { daysBetween } from "@/lib/time";
import { clamp, mean, popStats, roundHalfAway } from "./math";

export interface VascularDailyFeatureInput {
  date: string; // YYYY-MM-DD
  rhrBpm: number | null;
  hrvRmssdMs: number | null;
  sleepDurationHours: number | null;
  sleepEfficiencyPct: number | null;
  sleepDebtHours: number | null;
  strainPct: number | null; // 0-129
  respiratoryRateBrpm: number | null;
  skinTempDeltaC: number | null;
  bmi: number | null;
}

export const VASCULAR_WARMUP_MIN_DAYS = 14;
export const VASCULAR_BASELINE_WINDOW_DAYS = 28;
export const VASCULAR_CALIBRATION_FRESH_DAYS = 7;
export const VASCULAR_CALIBRATION_EXPIRY_DAYS = 28;

const BETA_SBP_RHR = 0.55;
const BETA_DBP_RHR = 0.40;
const BETA_SBP_HRV = -3.8;
const BETA_DBP_HRV = -2.5;
const BETA_SBP_DEBT = 0.45;
const BETA_DBP_DEBT = 0.30;
const BETA_SBP_BMI = 0.70;
const BETA_DBP_BMI = 0.45;

/**
 * Classifies systolic and diastolic blood pressure according to the 2017 ACC/AHA guideline.
 */
export function classifyAhaBloodPressure(
  sbp: number,
  dbp: number,
): BloodPressureAhaCategory {
  if (sbp > 180 || dbp > 120) return "hypertensive_crisis";
  if (sbp >= 140 || dbp >= 90) return "stage2_hypertension";
  if ((sbp >= 130 && sbp <= 139) || (dbp >= 80 && dbp <= 89)) return "stage1_hypertension";
  if (sbp >= 120 && sbp <= 129 && dbp < 80) return "elevated";
  return "normal";
}

/**
 * Computes calibration status and half-width sigma_t (mmHg) from days elapsed since the anchor cuff reading.
 */
export function calibrationHalfWidthMmHg(daysSinceCalibration: number): {
  status: VascularCalibrationStatus;
  halfWidthMmHg: number;
} {
  const t = Math.max(0, daysSinceCalibration);
  const halfWidthMmHg = Math.min(14, roundHalfAway(4 + (t / VASCULAR_CALIBRATION_EXPIRY_DAYS) * 6, 0));
  const status: VascularCalibrationStatus =
    t <= VASCULAR_CALIBRATION_FRESH_DAYS
      ? "fresh"
      : t <= VASCULAR_CALIBRATION_EXPIRY_DAYS
        ? "aging"
        : "expired";
  return { status, halfWidthMmHg };
}

function computeAcwrAtIndex(days: readonly VascularDailyFeatureInput[], index: number): number | null {
  const acuteSlice: number[] = [];
  for (let j = Math.max(0, index - 6); j <= index; j++) {
    const s = days[j]?.strainPct;
    if (s != null && Number.isFinite(s)) acuteSlice.push(s);
  }
  const chronicSlice: number[] = [];
  for (let j = Math.max(0, index - 27); j <= index; j++) {
    const s = days[j]?.strainPct;
    if (s != null && Number.isFinite(s)) chronicSlice.push(s);
  }
  if (acuteSlice.length < 3 || chronicSlice.length < 7) return null;
  const acuteMean = mean(acuteSlice);
  const chronicMean = mean(chronicSlice);
  if (acuteMean == null || chronicMean == null || chronicMean <= 1e-6) return null;
  return roundHalfAway(acuteMean / chronicMean, 2);
}

function acwrPressorTerms(acwr: number | null): { gammaSbp: number; gammaDbp: number } {
  if (acwr == null || !Number.isFinite(acwr)) return { gammaSbp: 0, gammaDbp: 0 };
  if (acwr >= 0.8 && acwr <= 1.3) {
    return { gammaSbp: -1.2, gammaDbp: -0.8 };
  }
  if (acwr > 1.5) {
    const excess = acwr - 1.5;
    return {
      gammaSbp: 2.5 * excess,
      gammaDbp: 1.6 * excess,
    };
  }
  return { gammaSbp: 0, gammaDbp: 0 };
}

interface DayAutonomicFeatures {
  validBaseline: boolean;
  provisionalBaseline: boolean;
  rhrDeltaBpm: number | null;
  lnRmssdDelta: number | null;
  sleepDebtHours: number | null;
  acwr: number | null;
  bmi: number | null;
  sbpAutonomicOffset: number | null;
  dbpAutonomicOffset: number | null;
}

function computeAutonomicFeaturesAtDay(
  days: readonly VascularDailyFeatureInput[],
  index: number,
): DayAutonomicFeatures {
  const cur = days[index];
  // Strictly causal: baseline folds from earlier nights only [max(0, index - 28), index - 1].
  const priorRhr: number[] = [];
  const priorLnHrv: number[] = [];
  const startIdx = Math.max(0, index - VASCULAR_BASELINE_WINDOW_DAYS);
  for (let j = startIdx; j < index; j++) {
    const d = days[j];
    if (d.rhrBpm != null && Number.isFinite(d.rhrBpm) && d.rhrBpm > 0) {
      priorRhr.push(d.rhrBpm);
    }
    if (d.hrvRmssdMs != null && Number.isFinite(d.hrvRmssdMs) && d.hrvRmssdMs > 0) {
      priorLnHrv.push(Math.log(d.hrvRmssdMs));
    }
  }

  const validCount = Math.min(priorRhr.length, priorLnHrv.length);
  const validBaseline =
    validCount >= VASCULAR_WARMUP_MIN_DAYS &&
    cur.rhrBpm != null &&
    Number.isFinite(cur.rhrBpm) &&
    cur.rhrBpm > 0 &&
    cur.hrvRmssdMs != null &&
    Number.isFinite(cur.hrvRmssdMs) &&
    cur.hrvRmssdMs > 0;
  const provisionalBaseline = validCount < VASCULAR_BASELINE_WINDOW_DAYS;

  const sleepDebtHours =
    cur.sleepDebtHours != null && Number.isFinite(cur.sleepDebtHours)
      ? roundHalfAway(clamp(cur.sleepDebtHours, 0, 12), 2)
      : null;
  const acwr = computeAcwrAtIndex(days, index);
  const bmi = cur.bmi != null && Number.isFinite(cur.bmi) ? roundHalfAway(cur.bmi, 1) : null;

  if (!validBaseline) {
    return {
      validBaseline: false,
      provisionalBaseline: true,
      rhrDeltaBpm: null,
      lnRmssdDelta: null,
      sleepDebtHours,
      acwr,
      bmi,
      sbpAutonomicOffset: null,
      dbpAutonomicOffset: null,
    };
  }

  const rhrStats = popStats(priorRhr)!;
  const lnHrvStats = popStats(priorLnHrv)!;
  const rhrDelta = clamp(cur.rhrBpm! - rhrStats.mean, -15, 15);
  const lnRmssdDelta = clamp(Math.log(cur.hrvRmssdMs!) - lnHrvStats.mean, -0.8, 0.8);
  const debtVal = sleepDebtHours ?? 0;
  const { gammaSbp, gammaDbp } = acwrPressorTerms(acwr);

  const sbpOffset =
    BETA_SBP_RHR * rhrDelta +
    BETA_SBP_HRV * lnRmssdDelta +
    BETA_SBP_DEBT * debtVal +
    gammaSbp;
  const dbpOffset =
    BETA_DBP_RHR * rhrDelta +
    BETA_DBP_HRV * lnRmssdDelta +
    BETA_DBP_DEBT * debtVal +
    gammaDbp;

  return {
    validBaseline: true,
    provisionalBaseline,
    rhrDeltaBpm: roundHalfAway(rhrDelta, 2),
    lnRmssdDelta: roundHalfAway(lnRmssdDelta, 3),
    sleepDebtHours,
    acwr,
    bmi,
    sbpAutonomicOffset: sbpOffset,
    dbpAutonomicOffset: dbpOffset,
  };
}

interface ResolvedAnchor {
  date: string;
  lastCalibratedAtMs: number;
  anchorSbp: number;
  anchorDbp: number;
  anchorDayIndex: number | null;
}

/**
 * Resolves the most recent valid cuff calibration anchor on or before `date` (causal).
 * Same-day multiple readings within a 15-minute sitting window are averaged; otherwise the latest day on or before `date` is used.
 */
function resolveCausalAnchor(
  date: string,
  sortedCuffRows: readonly BloodPressureReadingRow[],
  dayIndexByDate: ReadonlyMap<string, number>,
): ResolvedAnchor | null {
  const eligible = sortedCuffRows.filter(
    (r) =>
      r.date <= date &&
      Number.isFinite(r.systolicMmHg) &&
      Number.isFinite(r.diastolicMmHg) &&
      r.systolicMmHg >= 60 &&
      r.systolicMmHg <= 260 &&
      r.diastolicMmHg >= 30 &&
      r.diastolicMmHg <= 160 &&
      r.systolicMmHg > r.diastolicMmHg,
  );
  if (!eligible.length) return null;

  const latestDate = eligible[eligible.length - 1].date;
  const onLatestDate = eligible.filter((r) => r.date === latestDate);
  const latestReading = onLatestDate[onLatestDate.length - 1];
  const windowMs = 15 * 60 * 1000;
  const cluster = onLatestDate.filter(
    (r) => Math.abs(r.timestampMs - latestReading.timestampMs) <= windowMs,
  );
  const sample = cluster.length > 0 ? cluster : [latestReading];
  const anchorSbp = roundHalfAway(mean(sample.map((r) => r.systolicMmHg))!, 1);
  const anchorDbp = roundHalfAway(mean(sample.map((r) => r.diastolicMmHg))!, 1);

  return {
    date: latestDate,
    lastCalibratedAtMs: latestReading.timestampMs,
    anchorSbp,
    anchorDbp,
    anchorDayIndex: dayIndexByDate.get(latestDate) ?? null,
  };
}

/**
 * Computes the longitudinal VascularCorridorDay series across `days` strictly causally:
 * for each day D, only wearable features on or before D and cuff readings with `r.date <= D` are inspected.
 */
export function computeVascularCorridorSeries(
  days: readonly VascularDailyFeatureInput[],
  cuffReadings: readonly BloodPressureReadingRow[],
): Map<string, VascularCorridorDay> {
  const sortedDays = days.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sortedCuffs = cuffReadings
    .slice()
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.timestampMs - b.timestampMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const dayIndexByDate = new Map<string, number>();
  sortedDays.forEach((d, idx) => dayIndexByDate.set(d.date, idx));

  const featuresByIdx = sortedDays.map((_, idx) => computeAutonomicFeaturesAtDay(sortedDays, idx));
  const out = new Map<string, VascularCorridorDay>();

  for (let i = 0; i < sortedDays.length; i++) {
    const d = sortedDays[i];
    const feat = featuresByIdx[i];
    const anchor = resolveCausalAnchor(d.date, sortedCuffs, dayIndexByDate);

    const drivers: VascularCorridorDay["drivers"] = {
      rhrDeltaBpm: feat.rhrDeltaBpm,
      lnRmssdDelta: feat.lnRmssdDelta,
      sleepDebtHours: feat.sleepDebtHours,
      acwr: feat.acwr,
      bmi: feat.bmi,
    };

    const autonomicDelta: VascularCorridorDay["autonomicDelta"] = feat.validBaseline
      ? {
          sbpDeltaMmHg: roundHalfAway(feat.sbpAutonomicOffset!, 1),
          dbpDeltaMmHg: roundHalfAway(feat.dbpAutonomicOffset!, 1),
          reason: null,
          provisional: feat.provisionalBaseline,
        }
      : {
          sbpDeltaMmHg: null,
          dbpDeltaMmHg: null,
          reason: "baseline_warming_up",
          provisional: true,
        };

    if (!anchor) {
      out.set(d.date, {
        mode: "uncalibrated",
        systolic: {
          value: null,
          lower: null,
          upper: null,
          reason: "calibration_required",
          provisional: true,
        },
        diastolic: {
          value: null,
          lower: null,
          upper: null,
          reason: "calibration_required",
          provisional: true,
        },
        pulsePressure: {
          value: null,
          reason: "calibration_required",
          provisional: true,
        },
        meanArterialPressure: {
          value: null,
          reason: "calibration_required",
          provisional: true,
        },
        autonomicDelta,
        calibration: {
          status: "uncalibrated",
          lastCalibratedAtMs: null,
          daysSinceCalibration: null,
          halfWidthMmHg: null,
          anchorSystolicMmHg: null,
          anchorDiastolicMmHg: null,
        },
        drivers,
        ahaCategory: null,
      });
      continue;
    }

    const daysSinceCalibration = Math.max(0, daysBetween(anchor.date, d.date));
    const { status: calStatus, halfWidthMmHg } = calibrationHalfWidthMmHg(daysSinceCalibration);

    // Relative autonomic change between Day D and Anchor Day t0 (zero on anchor day itself).
    const anchorFeat =
      anchor.anchorDayIndex != null ? featuresByIdx[anchor.anchorDayIndex] : null;
    let deltaSbp = 0;
    let deltaDbp = 0;
    if (d.date !== anchor.date && feat.validBaseline) {
      const baseSbp = anchorFeat?.validBaseline ? anchorFeat.sbpAutonomicOffset! : 0;
      const baseDbp = anchorFeat?.validBaseline ? anchorFeat.dbpAutonomicOffset! : 0;
      deltaSbp = feat.sbpAutonomicOffset! - baseSbp;
      deltaDbp = feat.dbpAutonomicOffset! - baseDbp;
      if (feat.bmi != null && anchorFeat?.bmi != null) {
        const bmiDiff = clamp(feat.bmi - anchorFeat.bmi, -5, 5);
        deltaSbp += BETA_SBP_BMI * bmiDiff;
        deltaDbp += BETA_DBP_BMI * bmiDiff;
      }
    }

    const sbpMid = roundHalfAway(clamp(anchor.anchorSbp + deltaSbp, 70, 240), 0);
    const dbpMid = roundHalfAway(clamp(anchor.anchorDbp + deltaDbp, 40, Math.min(140, sbpMid - 15)), 0);
    const ppVal = sbpMid - dbpMid;
    const mapVal = roundHalfAway(dbpMid + ppVal / 3, 0);

    const calReason = calStatus === "expired" ? "calibration_expired" : null;
    const isProvisional = calStatus !== "fresh" || !feat.validBaseline || feat.provisionalBaseline;

    out.set(d.date, {
      mode: "calibrated",
      systolic: {
        value: sbpMid,
        lower: sbpMid - halfWidthMmHg,
        upper: sbpMid + halfWidthMmHg,
        reason: calReason,
        provisional: isProvisional,
      },
      diastolic: {
        value: dbpMid,
        lower: dbpMid - halfWidthMmHg,
        upper: dbpMid + halfWidthMmHg,
        reason: calReason,
        provisional: isProvisional,
      },
      pulsePressure: {
        value: ppVal,
        reason: calReason,
        provisional: isProvisional,
      },
      meanArterialPressure: {
        value: mapVal,
        reason: calReason,
        provisional: isProvisional,
      },
      autonomicDelta,
      calibration: {
        status: calStatus,
        lastCalibratedAtMs: anchor.lastCalibratedAtMs,
        daysSinceCalibration,
        halfWidthMmHg,
        anchorSystolicMmHg: roundHalfAway(anchor.anchorSbp, 0),
        anchorDiastolicMmHg: roundHalfAway(anchor.anchorDbp, 0),
      },
      drivers,
      ahaCategory: classifyAhaBloodPressure(sbpMid, dbpMid),
    });
  }

  return out;
}
