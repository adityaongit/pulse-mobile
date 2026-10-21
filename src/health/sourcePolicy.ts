// Which Health Connect records the import keeps (the person's choice, stored on the phone). Health Connect holds
// whatever every app wrote: the Google Health (Fitbit) app's band data, but also the phone's own step counting (from
// Google Health itself or another health app), which reads differently and doubled steps. The default keeps the band.
//
// How a record is classified:
//   • Its app is `metadata.dataOrigin`: a Fitbit record comes from one of FITBIT_PACKAGES (the Google Health app is the
//     renamed Fitbit app and kept its package).
//   • Its device is `metadata.device.type` (Health Connect's Device.TYPE_*). A Fitbit-app record measured by the phone
//     (TYPE_PHONE) is the phone, not the band. A record without device information, or of another type (watch, band,
//     ring, scale, chest strap), counts as Fitbit.
//   • Entries typed in (recordingMethod MANUAL_ENTRY), and the log-like types (weight, body fat, water, food, glucose,
//     temperature, cycle) are never dropped for their device: logging a weigh-in or a glass of water on the phone is
//     still the Fitbit app's record.
// Pulse's own logs (the Journal) never come from Health Connect and are unaffected.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeviceType as LibDeviceType, RecordingMethod as LibRecordingMethod } from "react-native-health-connect";
import type { ReadType } from "@/health/connect";
import { localDay } from "@/lib/time";
import { finish, PAUSE_EVERY, type Steps } from "@/lib/yield";
import { forgetChanges } from "./importState";

/** Apps whose records count as Fitbit: the Fitbit app, renamed Google Health in 2026 under the same package. */
export const FITBIT_PACKAGES: readonly string[] = ["com.fitbit.FitbitMobile"];

/** Health Connect's Device.TYPE_* (the library's enum lacks TYPE_WATCH = 1). */
export const DEVICE_TYPE = {
  TYPE_UNKNOWN: 0,
  TYPE_WATCH: 1,
  TYPE_PHONE: 2,
  TYPE_SCALE: 3,
  TYPE_RING: 4,
  TYPE_HEAD_MOUNTED: 5,
  TYPE_FITNESS_BAND: 6,
  TYPE_CHEST_STRAP: 7,
  TYPE_SMART_DISPLAY: 8,
} as const;
/** Health Connect's Metadata.RECORDING_METHOD_*. */
export const RECORDING_METHOD = {
  RECORDING_METHOD_UNKNOWN: 0,
  RECORDING_METHOD_ACTIVELY_RECORDED: 1,
  RECORDING_METHOD_AUTOMATICALLY_RECORDED: 2,
  RECORDING_METHOD_MANUAL_ENTRY: 3,
} as const;
// Compile-time drift guards against the library's declarations (values are never emitted).
const _deviceTypesMatch: typeof LibDeviceType = DEVICE_TYPE;
const _recordingMethodsMatch: typeof LibRecordingMethod = RECORDING_METHOD;
void _deviceTypesMatch;
void _recordingMethodsMatch;

export const DEVICE_NAME: Record<number, string> = {
  0: "unknown",
  1: "watch",
  2: "phone",
  3: "scale",
  4: "ring",
  5: "head_mounted",
  6: "fitness_band",
  7: "chest_strap",
  8: "smart_display",
};

export type SourcePolicy = "fitbit_only" | "fitbit_first" | "all";
export const SOURCE_POLICIES: readonly SourcePolicy[] = ["fitbit_only", "fitbit_first", "all"];
export const DEFAULT_SOURCE_POLICY: SourcePolicy = "fitbit_only";

/** What a settings screen shows for each choice. */
export const SOURCE_POLICY_LABELS: Record<SourcePolicy, { label: string; detail: string }> = {
  fitbit_only: { label: "Fitbit only", detail: "Only what your Fitbit device measured, through the Google Health app. Phone step counts and other apps are left out." },
  fitbit_first: { label: "Fitbit first", detail: "Your Fitbit device's data; on a day it has none of a kind, what your phone or other apps recorded." },
  all: { label: "All apps", detail: "Everything in Health Connect. Where apps overlap, Pulse takes the largest source rather than adding them up." },
};

export const SOURCE_POLICY_KEY = "pulse.sourcePolicy";

const isPolicy = (v: unknown): v is SourcePolicy => typeof v === "string" && (SOURCE_POLICIES as readonly string[]).includes(v);

export async function getSourcePolicy(): Promise<SourcePolicy> {
  try {
    const v = await AsyncStorage.getItem(SOURCE_POLICY_KEY);
    return isPolicy(v) ? v : DEFAULT_SOURCE_POLICY;
  } catch {
    return DEFAULT_SOURCE_POLICY;
  }
}

/** Stores the choice; a change makes the next sync re-import the whole history window under it. */
export async function setSourcePolicy(policy: SourcePolicy): Promise<void> {
  const before = await getSourcePolicy();
  await AsyncStorage.setItem(SOURCE_POLICY_KEY, policy);
  if (policy !== before) await forgetChanges();
}

/** Origins to pass to Health Connect's dataOriginFilter (cheaper than filtering after the read), or none. */
export const originFilter = (policy: SourcePolicy): string[] | undefined => (policy === "fitbit_only" ? [...FITBIT_PACKAGES] : undefined);

type Classified = {
  metadata?: { dataOrigin?: string; device?: { type?: number } | null; recordingMethod?: number };
  time?: string;
  startTime?: string;
  endTime?: string;
};

/** Types that are logs or scale readings: never dropped for the device they were entered on. */
const LOG_TYPES = new Set<ReadType>([
  "Weight",
  "BodyFat",
  "Hydration",
  "Nutrition",
  "BloodGlucose",
  "BloodPressure",
  "BodyTemperature",
  "MenstruationPeriod",
  "MenstruationFlow",
  "IntermenstrualBleeding",
  "OvulationTest",
]);

export type SourceDecision = {
  accepted: boolean;
  reason: "primary_source" | "blood_pressure_exemption" | "disabled_source" | "invalid_record";
};

export function decideSource(type: ReadType, r: Classified, policy: SourcePolicy, options?: { isValidRecord?: boolean }): SourceDecision {
  if (options?.isValidRecord === false) return { accepted: false, reason: "invalid_record" };
  if (type === "BloodPressure") {
    return isFitbit(type, r)
      ? { accepted: true, reason: "primary_source" }
      : { accepted: true, reason: "blood_pressure_exemption" };
  }
  if (policy === "all") return { accepted: true, reason: "primary_source" };
  if (policy === "fitbit_only") {
    return isFitbit(type, r) ? { accepted: true, reason: "primary_source" } : { accepted: false, reason: "disabled_source" };
  }
  return { accepted: true, reason: "primary_source" };
}

/** Measured by the phone rather than a band, watch or other device. */
export function isPhoneMeasured(type: ReadType, r: Classified): boolean {
  if (LOG_TYPES.has(type)) return false;
  if (r.metadata?.recordingMethod === RECORDING_METHOD.RECORDING_METHOD_MANUAL_ENTRY) return false;
  return r.metadata?.device?.type === DEVICE_TYPE.TYPE_PHONE;
}

/** From the Fitbit app and not measured by the phone (see the file comment). */
export function isFitbit(type: ReadType, r: Classified): boolean {
  return FITBIT_PACKAGES.includes(r.metadata?.dataOrigin ?? "") && !isPhoneMeasured(type, r);
}

/** The local day a record belongs to for "fitbit_first": a sleep session's wake day, else its (start) time. */
function dayOf(type: ReadType, r: Classified, tz: string): string | null {
  const iso = type === "SleepSession" ? r.endTime : (r.time ?? r.startTime);
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? localDay(Math.floor(ms / 1000), tz) : null;
}

/**
 * The records of one type the policy keeps. "fitbit_only": Fitbit records alone. "fitbit_first": per local day, the
 * Fitbit records when that day has any of this type, else all of that day's. "all": everything (the importer then
 * takes the largest source for measured totals).
 */
export function applySourcePolicy<T extends Classified>(type: ReadType, records: T[], policy: SourcePolicy, tz: string): T[] {
  return finish(applySourcePolicySteps(type, records, policy, tz));
}

/** applySourcePolicy, pausing as it goes (src/lib/yield.ts): "fitbit_first" reads a local day per record, an Intl call each. */
export function* applySourcePolicySteps<T extends Classified>(type: ReadType, records: T[], policy: SourcePolicy, tz: string): Steps<T[]> {
  // Blood pressure has a narrow exemption from source-name restrictions: validated cuffs write through third-party apps.
  if (type === "BloodPressure") return records;
  if (policy === "all") return records;
  if (policy === "fitbit_only") return records.filter((r) => isFitbit(type, r));
  const fitbitDays = new Set<string | null>();
  let n = 0;
  for (const r of records) {
    if (++n % PAUSE_EVERY === 0) yield;
    if (isFitbit(type, r)) fitbitDays.add(dayOf(type, r, tz));
  }
  const out: T[] = [];
  for (const r of records) {
    if (++n % PAUSE_EVERY === 0) yield;
    if (isFitbit(type, r) || !fitbitDays.has(dayOf(type, r, tz))) out.push(r);
  }
  return out;
}

/** "app/device: count" per origin and device type, most records first, for the diagnostics list. */
export function originBreakdown(records: Classified[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const t = r.metadata?.device?.type;
    const key = `${r.metadata?.dataOrigin || "unknown app"}/${t == null ? "no device" : (DEVICE_NAME[t] ?? `type ${t}`)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}: ${n}`);
}
