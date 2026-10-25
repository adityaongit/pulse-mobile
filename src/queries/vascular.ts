import type { Store } from "@/data/store";
import type {
  BloodPressureAhaCategory,
  BloodPressureReadingRow,
  VascularCalibrationStatus,
  VascularCorridorMode,
} from "@/data/types";
import type { VascularCorridorRow } from "@/pipeline/types";
import { reasonCopy, type ReasonCode } from "@/lib/reasons";
import { addDays } from "@/lib/time";
import { type QueryCtx, todayOf } from "./common";

export type VascularTrendRange = "7d" | "30d" | "90d";

export type VascularDriverKey = "rhr" | "hrv" | "sleepDebt" | "acwr" | "bmi";

export interface VascularDriverContributor {
  key: VascularDriverKey;
  rawDelta: number | null;
  sbpEffectMmHg: number | null;
  dbpEffectMmHg: number | null;
  direction: "raising" | "lowering" | "neutral";
}

export interface VascularTrendPoint {
  date: string;
  sbpValue: number | null;
  sbpLower: number | null;
  sbpUpper: number | null;
  dbpValue: number | null;
  dbpLower: number | null;
  dbpUpper: number | null;
  sbpDeltaMmHg: number | null;
  dbpDeltaMmHg: number | null;
  cuffSystolic: number | null;
  cuffDiastolic: number | null;
  cuffSource: "health_connect" | "manual" | null;
}

export interface VascularViewModel {
  available: boolean;
  day: string;
  mode: VascularCorridorMode;
  systolic: {
    value: number | null;
    lower: number | null;
    upper: number | null;
    reason: ReasonCode | null;
    reasonText: string | null;
    provisional: boolean;
  };
  diastolic: {
    value: number | null;
    lower: number | null;
    upper: number | null;
    reason: ReasonCode | null;
    reasonText: string | null;
    provisional: boolean;
  };
  pulsePressure: {
    value: number | null;
    reason: ReasonCode | null;
    reasonText: string | null;
    provisional: boolean;
  };
  meanArterialPressure: {
    value: number | null;
    reason: ReasonCode | null;
    reasonText: string | null;
    provisional: boolean;
  };
  autonomicDelta: {
    sbpDeltaMmHg: number | null;
    dbpDeltaMmHg: number | null;
    reason: ReasonCode | null;
    reasonText: string | null;
    provisional: boolean;
  };
  ahaCategory: BloodPressureAhaCategory | null;
  calibration: {
    status: VascularCalibrationStatus;
    lastCalibratedAtMs: number | null;
    daysSinceCalibration: number | null;
    halfWidthMmHg: number | null;
    anchorSystolicMmHg: number | null;
    anchorDiastolicMmHg: number | null;
  };
  drivers: VascularCorridorRow["drivers"];
  contributors: VascularDriverContributor[];
  cuffHistory: BloodPressureReadingRow[];
  series7d: VascularTrendPoint[];
  series30d: VascularTrendPoint[];
  series90d: VascularTrendPoint[];
}

function reasonTextOf(code: ReasonCode | null): string | null {
  if (!code) return null;
  return reasonCopy(code).long;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function directionOf(sbpEffect: number | null): "raising" | "lowering" | "neutral" {
  if (sbpEffect == null || Math.abs(sbpEffect) < 0.15) return "neutral";
  return sbpEffect > 0 ? "raising" : "lowering";
}

function buildContributors(drivers: VascularCorridorRow["drivers"]): VascularDriverContributor[] {
  const rhrSbp = drivers.rhrDeltaBpm != null ? round1(0.55 * drivers.rhrDeltaBpm) : null;
  const rhrDbp = drivers.rhrDeltaBpm != null ? round1(0.4 * drivers.rhrDeltaBpm) : null;

  const hrvSbp = drivers.lnRmssdDelta != null ? round1(-3.8 * drivers.lnRmssdDelta) : null;
  const hrvDbp = drivers.lnRmssdDelta != null ? round1(-2.5 * drivers.lnRmssdDelta) : null;

  const debtSbp = drivers.sleepDebtHours != null ? round1(0.45 * drivers.sleepDebtHours) : null;
  const debtDbp = drivers.sleepDebtHours != null ? round1(0.3 * drivers.sleepDebtHours) : null;

  let acwrSbp: number | null = null;
  let acwrDbp: number | null = null;
  if (drivers.acwr != null) {
    if (drivers.acwr >= 0.8 && drivers.acwr <= 1.3) {
      acwrSbp = -1.2;
      acwrDbp = -0.8;
    } else if (drivers.acwr > 1.5) {
      acwrSbp = round1(2.5 * (drivers.acwr - 1.5));
      acwrDbp = round1(1.6 * (drivers.acwr - 1.5));
    } else {
      acwrSbp = 0;
      acwrDbp = 0;
    }
  }

  return [
    {
      key: "rhr",
      rawDelta: drivers.rhrDeltaBpm,
      sbpEffectMmHg: rhrSbp,
      dbpEffectMmHg: rhrDbp,
      direction: directionOf(rhrSbp),
    },
    {
      key: "hrv",
      rawDelta: drivers.lnRmssdDelta,
      sbpEffectMmHg: hrvSbp,
      dbpEffectMmHg: hrvDbp,
      direction: directionOf(hrvSbp),
    },
    {
      key: "sleepDebt",
      rawDelta: drivers.sleepDebtHours,
      sbpEffectMmHg: debtSbp,
      dbpEffectMmHg: debtDbp,
      direction: directionOf(debtSbp),
    },
    {
      key: "acwr",
      rawDelta: drivers.acwr,
      sbpEffectMmHg: acwrSbp,
      dbpEffectMmHg: acwrDbp,
      direction: directionOf(acwrSbp),
    },
    {
      key: "bmi",
      rawDelta: drivers.bmi,
      sbpEffectMmHg: null,
      dbpEffectMmHg: null,
      direction: "neutral",
    },
  ];
}

export async function getVascularViewModel(
  store: Store,
  day: string,
  _tz = "UTC",
): Promise<VascularViewModel> {
  const from90 = addDays(day, -89);
  const [scoresRange, cuffHistory] = await Promise.all([
    store.scoresIn({ from: from90, to: day }),
    store.getBloodPressureReadings(day),
  ]);

  const byDay = new Map<string, VascularCorridorRow>();
  for (const row of scoresRange) {
    if (row.vascular_corridor) {
      byDay.set(row.day, row.vascular_corridor);
    }
  }

  const latestCuffByDay = new Map<string, BloodPressureReadingRow>();
  for (const r of cuffHistory) {
    const prev = latestCuffByDay.get(r.date);
    if (!prev || r.timestampMs >= prev.timestampMs) {
      latestCuffByDay.set(r.date, r);
    }
  }

  const buildSeries = (daysCount: number): VascularTrendPoint[] => {
    const start = addDays(day, -(daysCount - 1));
    return Array.from({ length: daysCount }, (_, i) => {
      const d = addDays(start, i);
      const vc = byDay.get(d);
      const cuff = latestCuffByDay.get(d);
      return {
        date: d,
        sbpValue: vc?.systolic.value ?? null,
        sbpLower: vc?.systolic.lower ?? null,
        sbpUpper: vc?.systolic.upper ?? null,
        dbpValue: vc?.diastolic.value ?? null,
        dbpLower: vc?.diastolic.lower ?? null,
        dbpUpper: vc?.diastolic.upper ?? null,
        sbpDeltaMmHg: vc?.autonomicDelta.sbpDeltaMmHg ?? null,
        dbpDeltaMmHg: vc?.autonomicDelta.dbpDeltaMmHg ?? null,
        cuffSystolic: cuff?.systolicMmHg ?? null,
        cuffDiastolic: cuff?.diastolicMmHg ?? null,
        cuffSource: cuff?.source ?? null,
      };
    });
  };

  const current = byDay.get(day);
  const sortedCuffHistory = [...cuffHistory].sort((a, b) => b.timestampMs - a.timestampMs);

  if (!current) {
    const emptyDrivers: VascularCorridorRow["drivers"] = {
      rhrDeltaBpm: null,
      lnRmssdDelta: null,
      sleepDebtHours: null,
      acwr: null,
      bmi: null,
    };
    return {
      available: false,
      day,
      mode: "uncalibrated",
      systolic: {
        value: null,
        lower: null,
        upper: null,
        reason: "no_data",
        reasonText: reasonTextOf("no_data"),
        provisional: true,
      },
      diastolic: {
        value: null,
        lower: null,
        upper: null,
        reason: "no_data",
        reasonText: reasonTextOf("no_data"),
        provisional: true,
      },
      pulsePressure: {
        value: null,
        reason: "no_data",
        reasonText: reasonTextOf("no_data"),
        provisional: true,
      },
      meanArterialPressure: {
        value: null,
        reason: "no_data",
        reasonText: reasonTextOf("no_data"),
        provisional: true,
      },
      autonomicDelta: {
        sbpDeltaMmHg: null,
        dbpDeltaMmHg: null,
        reason: "no_data",
        reasonText: reasonTextOf("no_data"),
        provisional: true,
      },
      ahaCategory: null,
      calibration: {
        status: "uncalibrated",
        lastCalibratedAtMs: null,
        daysSinceCalibration: null,
        halfWidthMmHg: null,
        anchorSystolicMmHg: null,
        anchorDiastolicMmHg: null,
      },
      drivers: emptyDrivers,
      contributors: buildContributors(emptyDrivers),
      cuffHistory: sortedCuffHistory,
      series7d: buildSeries(7),
      series30d: buildSeries(30),
      series90d: buildSeries(90),
    };
  }

  return {
    available: true,
    day,
    mode: current.mode,
    systolic: {
      ...current.systolic,
      reasonText: reasonTextOf(current.systolic.reason),
    },
    diastolic: {
      ...current.diastolic,
      reasonText: reasonTextOf(current.diastolic.reason),
    },
    pulsePressure: {
      ...current.pulsePressure,
      reasonText: reasonTextOf(current.pulsePressure.reason),
    },
    meanArterialPressure: {
      ...current.meanArterialPressure,
      reasonText: reasonTextOf(current.meanArterialPressure.reason),
    },
    autonomicDelta: {
      ...current.autonomicDelta,
      reasonText: reasonTextOf(current.autonomicDelta.reason),
    },
    ahaCategory: current.ahaCategory,
    calibration: current.calibration,
    drivers: current.drivers,
    contributors: buildContributors(current.drivers),
    cuffHistory: sortedCuffHistory,
    series7d: buildSeries(7),
    series30d: buildSeries(30),
    series90d: buildSeries(90),
  };
}

/** Context-bound query wrapper used by `src/state/app.ts` and `useScreen`. */
export async function getVascular(day: string | undefined, ctx: QueryCtx): Promise<VascularViewModel> {
  const targetDay = day ?? todayOf(ctx);
  return getVascularViewModel(ctx.store, targetDay, ctx.timeZone);
}
