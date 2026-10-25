// Protocol-grade blood pressure evaluator for Pulse Age (pure TypeScript, zero I/O).
import type { BloodPressureReading } from "@/data/types";
import { mean } from "./math";

export type BloodPressureProtocolReason =
  | "no_data"
  | "insufficient_readings"
  | "insufficient_days"
  | "stale"
  | "derived_only"
  | "incompatible_modality";

export type BloodPressureProtocolResult =
  | {
      eligible: true;
      systolicMean: number;
      diastolicMean: number;
      readingCount: number;
      dayCount: number;
      spanDays: number;
      quality: "protocol_grade";
    }
  | {
      eligible: false;
      reason: BloodPressureProtocolReason;
      readingCount: number;
      dayCount: number;
    };

export type BloodPressureProtocolOptions = {
  minReadings?: number;
  minDays?: number;
  maxAgeDays?: number;
  asOfTs?: number;
};

const epochDay = (day: string): number | null => {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
};

const VALID_POSITIONS = new Set(["sitting_down", "sitting", "unknown"]);
const VALID_LOCATIONS = new Set(["left_upper_arm", "right_upper_arm", "upper_arm", "unknown"]);

const isCompatibleModality = (r: BloodPressureReading): boolean => {
  if (r.quality !== "direct" && r.quality !== "manual") return false;
  if (r.bodyPosition != null && r.bodyPosition !== "" && !VALID_POSITIONS.has(r.bodyPosition)) return false;
  if (r.measurementLocation != null && r.measurementLocation !== "" && !VALID_LOCATIONS.has(r.measurementLocation)) return false;
  return true;
};

const isPlausible = (r: BloodPressureReading): boolean =>
  Number.isFinite(r.systolicMmhg) &&
  Number.isFinite(r.diastolicMmhg) &&
  r.systolicMmhg >= 40 &&
  r.systolicMmhg <= 300 &&
  r.diastolicMmhg >= 20 &&
  r.diastolicMmhg <= 200 &&
  r.systolicMmhg > r.diastolicMmhg;

export function evaluateBloodPressureProtocol(
  readings: readonly BloodPressureReading[],
  asOfDay: string,
  options?: BloodPressureProtocolOptions,
): BloodPressureProtocolResult {
  const minReadings = options?.minReadings ?? 12;
  const minDays = options?.minDays ?? 3;
  const maxAgeDays = options?.maxAgeDays ?? 90;
  const asOf = epochDay(asOfDay);
  if (asOf === null) return { eligible: false, reason: "no_data", readingCount: 0, dayCount: 0 };

  const causal = readings.filter((r) => {
    if (!isPlausible(r)) return false;
    const d = epochDay(r.day);
    if (d === null || d > asOf) return false;
    if (options?.asOfTs !== undefined && r.ts > options.asOfTs) return false;
    return true;
  });

  if (causal.length === 0) {
    return { eligible: false, reason: "no_data", readingCount: 0, dayCount: 0 };
  }

  const nonDerived = causal.filter((r) => r.quality !== "derived");
  if (nonDerived.length === 0) {
    return { eligible: false, reason: "derived_only", readingCount: 0, dayCount: 0 };
  }

  const compatible = nonDerived.filter(isCompatibleModality);
  if (compatible.length === 0) {
    return { eligible: false, reason: "incompatible_modality", readingCount: 0, dayCount: 0 };
  }

  const fresh = compatible.filter((r) => {
    const d = epochDay(r.day)!;
    return asOf - d <= maxAgeDays;
  });
  if (fresh.length === 0) {
    return { eligible: false, reason: "stale", readingCount: 0, dayCount: 0 };
  }

  const days = new Set(fresh.map((r) => r.day));
  const readingCount = fresh.length;
  const dayCount = days.size;

  if (readingCount < minReadings) {
    return { eligible: false, reason: "insufficient_readings", readingCount, dayCount };
  }
  if (dayCount < minDays) {
    return { eligible: false, reason: "insufficient_days", readingCount, dayCount };
  }

  const dayEpochs = [...days].map((d) => epochDay(d)!);
  const spanDays = Math.max(...dayEpochs) - Math.min(...dayEpochs) + 1;
  const systolicMean = mean(fresh.map((r) => r.systolicMmhg))!;
  const diastolicMean = mean(fresh.map((r) => r.diastolicMmhg))!;

  return {
    eligible: true,
    systolicMean,
    diastolicMean,
    readingCount,
    dayCount,
    spanDays,
    quality: "protocol_grade",
  };
}
