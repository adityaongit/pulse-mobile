// The row shapes Pulse's pipeline and queries read. Field names and semantics mirror the web app's
// src/server/pipeline/data.ts and its Postgres schema, so the ported pipeline and queries stay line-for-line.
// All timestamps are unix seconds. `day` is a local civil date "YYYY-MM-DD".

import type { DisplayPrefs } from "@/lib/units";

export type Sex = "male" | "female";

export type Profile = {
  /** "YYYY-MM-DD" */
  birthDate: string;
  sex: Sex;
  /** The person's own max HR; null means Tanaka (208 − 0.7·age). */
  maxHr: number | null;
  heightCm: number | null;
  /** Waist circumference, cm (mobile, optional): sharpens Pulse's VO2max estimate (Nes 2011). Absent on older profiles. */
  waistCm?: number | null;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timeZone: string;
  /** The owner's display name (mobile, optional), for Home's avatar initials and Settings. */
  name?: string | null;
  /** The profile photo's file URI in the app's document directory (mobile, optional). The photo never leaves the phone. */
  photo?: string | null;
  /**
   * The sleep goal (Settings › Goals): hours, and how it was set, by hand or from the automatic estimate (reference
   * study, shared-machinery.md § Sleep goal). Absent: 7.5 h. Onboarding sets the age default, automatic.
   */
  sleepGoal?: { hours: number; method: "manual" | "automatic" } | null;
  /** Units and the clock (Settings › App). Absent: the phone's own (src/lib/units.ts deviceDisplayPrefs). */
  display?: DisplayPrefs | null;
};

/** One sleep session; `day` is the local wake day. */
export type Session = {
  id: string;
  day: string;
  startTs: number;
  endTs: number;
  isMain: boolean;
  processed: boolean;
  /** "SUCCEEDED" when a hypnogram exists; any other value (or null) scores from the summary minutes only. */
  stagesStatus: string | null;
  asleepMin: number | null;
  awakeMin: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
};

export type Stage = "awake" | "light" | "deep" | "rem";

export type Segment = { sessionId: string; startTs: number; endTs: number; stage: Stage };

/** One workout; `day` is the local start day. `type` is the source's exercise type name (e.g. "RUNNING"). */
export type Exercise = {
  id: string;
  day: string;
  startTs: number;
  endTs: number;
  type: string;
  name: string | null;
  calories: number | null;
  distanceM: number | null;
};

/** Daily aggregates for a civil day. Everything optional; null when the source has none. */
export type Metrics = {
  day: string;
  /** Nightly average RMSSD, ms. */
  hrvMs: number | null;
  /** Deep-sleep RMSSD, ms (shown, never scored). */
  hrvDeepMs: number | null;
  rhrBpm: number | null;
  respBpm: number | null;
  nightlyTempC: number | null;
  spo2Pct: number | null;
  vo2maxDaily: number | null;
  vo2maxRun: number | null;
  steps: number | null;
  calories: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  /** Source's zone bounds for the day (shown, never scored). */
  hrZones: number[] | null;
  lightModerateMin: number | null;
  vigorousPeakMin: number | null;
  /** Source's skin-temperature baseline and 30-night SD; the deviation is nightlyTempC − tempBaselineC. */
  tempBaselineC: number | null;
  tempSdC: number | null;
  rhrRangeLow: number | null;
  rhrRangeHigh: number | null;
  hrvRangeLow: number | null;
  hrvRangeHigh: number | null;
};

export const emptyMetrics = (day: string): Metrics => ({
  day,
  hrvMs: null,
  hrvDeepMs: null,
  rhrBpm: null,
  respBpm: null,
  nightlyTempC: null,
  spo2Pct: null,
  vo2maxDaily: null,
  vo2maxRun: null,
  steps: null,
  calories: null,
  weightKg: null,
  bodyFatPct: null,
  hrZones: null,
  lightModerateMin: null,
  vigorousPeakMin: null,
  tempBaselineC: null,
  tempSdC: null,
  rhrRangeLow: null,
  rhrRangeHigh: null,
  hrvRangeLow: null,
  hrvRangeHigh: null,
});

export type HrSample = { ts: number; bpm: number };
/** One heart-rate variability reading (RMSSD, ms) at `ts`: Fitbit writes one every 5 minutes through the night. */
export type HrvSample = { ts: number; ms: number };
/** Steps in the minute starting at `ts` (a whole minute, unix seconds). */
export type StepsMinute = { ts: number; v: number };

/** "Shown, never scored" extras keyed like Pulse's daily_values (e.g. "distance_m", "floors", "height_cm" on day "latest"). */
export type DailyValue = { day: string; key: string; value: number };

export type JournalEntry = { day: string; tag: string; value: number };

/**
 * An ECG reading or an irregular-rhythm notification (the web's health_records; only the Google Health API carries
 * them). `day` is the local day of `ts`, the start. `data` is `{ result, avgBpm }` for an ECG (never the waveform) and
 * `{ alertWindows, endTs }` for a notification.
 */
export type HealthRecord = { id: string; kind: "ecg" | "irn"; ts: number; day: string; data: Record<string, unknown> };

export type SyncState = {
  /** Unix seconds of the last completed import, or null before the first. */
  lastSyncTs: number | null;
  /** The earliest day imported so far. */
  firstDay: string | null;
  lastError: string | null;
};
