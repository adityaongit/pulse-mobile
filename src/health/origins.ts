// Health Connect's origin and device vocabulary, for the diagnostics list and the data check. Pulse keeps every app's
// records (the user picks sources in Health Connect's own settings); nothing is filtered by app or device.
import type { DeviceType as LibDeviceType, RecordingMethod as LibRecordingMethod } from "react-native-health-connect";

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

type Classified = { metadata?: { dataOrigin?: string; device?: { type?: number } | null } };

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
