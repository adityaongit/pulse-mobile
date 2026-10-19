// Thin wrapper over react-native-health-connect: availability, permissions and paginated range reads.
// Everything Pulse needs is read-only; the Google Health app writes the Fitbit data into Health Connect.
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  type BackgroundAccessPermission,
  type Permission,
  type ReadHealthDataHistoryPermission,
  type ReadRecordsOptions,
  type RecordResult,
  type RecordType,
} from "react-native-health-connect";
import { PermissionsAndroid, Platform } from "react-native";

/** Record types Pulse reads, in the order the permission sheet lists them. */
export const READ_TYPES = [
  "SleepSession",
  "HeartRate",
  "RestingHeartRate",
  "HeartRateVariabilityRmssd",
  "RespiratoryRate",
  "OxygenSaturation",
  "SkinTemperature",
  "Steps",
  "Distance",
  "ExerciseSession",
  "TotalCaloriesBurned",
  "ActiveCaloriesBurned",
  "Vo2Max",
  "Weight",
  "BodyFat",
  // Extras the Fitbit app shows (floors, elevation, water, food, glucose, temperature) and the cycle log. Each is
  // optional: a type the person doesn't grant is skipped by the sync and listed as "Not allowed" in Settings.
  "FloorsClimbed",
  "ElevationGained",
  "Hydration",
  "Nutrition",
  "BloodGlucose",
  "BloodPressure",
  "BodyTemperature",
  "MenstruationPeriod",
  "MenstruationFlow",
  "IntermenstrualBleeding",
  "OvulationTest",
] as const satisfies readonly RecordType[];
export type ReadType = (typeof READ_TYPES)[number];

const readPermissions: Permission[] = READ_TYPES.map((recordType) => ({ accessType: "read", recordType }));
/** Without it Health Connect only serves the 30 days before the grant; baselines want 180. */
const historyPermission: ReadHealthDataHistoryPermission = { accessType: "read", recordType: "ReadHealthDataHistory" };
/** Lets a closed Pulse read Health Connect (READ_HEALTH_DATA_IN_BACKGROUND), for the background sync task (src/background/task.ts); without it the task skips. */
const backgroundPermission: BackgroundAccessPermission = { accessType: "read", recordType: "BackgroundAccessPermission" };

export type Availability = "available" | "update_required" | "unavailable";

export async function availability(): Promise<Availability> {
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update_required";
  return "unavailable";
}

let initialized: Promise<boolean> | null = null;
/** Idempotent; the native client is created once per process. */
export function ensureInitialized(): Promise<boolean> {
  initialized ??= initialize();
  return initialized;
}

export type PermissionState = {
  granted: ReadType[];
  missing: ReadType[];
  history: boolean;
  /** Background reads allowed (the background sync task needs it). */
  background: boolean;
};

/**
 * react-native-health-connect 4.1.3's getGrantedPermissions never reports READ_HEALTH_DATA_HISTORY back (its
 * mapPermissionResult handles only the record types, exercise routes and background access), so a granted history
 * permission always read as missing and the first import was capped at 30 days. On Android 14+ health permissions
 * are platform permissions, so ask Android directly.
 */
async function historyGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    return await PermissionsAndroid.check("android.permission.health.READ_HEALTH_DATA_HISTORY" as Permission_);
  } catch {
    return false;
  }
}
type Permission_ = Parameters<typeof PermissionsAndroid.check>[0];

export async function permissionState(): Promise<PermissionState> {
  await ensureInitialized();
  const granted = await getGrantedPermissions();
  const has = (t: string) => granted.some((p) => p.accessType === "read" && p.recordType === t);
  return {
    granted: READ_TYPES.filter(has),
    missing: READ_TYPES.filter((t) => !has(t)),
    history: has("ReadHealthDataHistory") || (await historyGranted()),
    background: has("BackgroundAccessPermission"),
  };
}

/** Shows the system sheet. Returns what the person granted; they may grant a subset. */
export async function askPermissions(): Promise<PermissionState> {
  await ensureInitialized();
  await requestPermission([...readPermissions, historyPermission, backgroundPermission]);
  return permissionState();
}

/** Asks only for background access (Settings › Notifications & background › Allow background access). */
export async function askBackgroundPermission(): Promise<PermissionState> {
  await ensureInitialized();
  await requestPermission([backgroundPermission]);
  return permissionState();
}

export { openHealthConnectSettings };

export type Range = { start: Date; end: Date };

/**
 * Every record of `type` in the range, following page tokens. Ascending by time. `origins` limits the read to those
 * apps' records (Health Connect's dataOriginFilter; see sourcePolicy.ts).
 */
export async function readAll<T extends ReadType>(type: T, range: Range, pageSize = 1000, origins?: string[]): Promise<RecordResult<T>[]> {
  await ensureInitialized();
  const out: RecordResult<T>[] = [];
  let pageToken: string | undefined;
  do {
    const options: ReadRecordsOptions = {
      timeRangeFilter: { operator: "between", startTime: range.start.toISOString(), endTime: range.end.toISOString() },
      ...(origins?.length && { dataOriginFilter: origins }),
      ascendingOrder: true,
      pageSize,
      pageToken,
    };
    const page = await readRecords(type, options);
    out.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}
