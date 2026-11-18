// Location tracking for the timeline (docs/timeline.md). Two tasks, defined at the entry (index.ts) so a headless
// launch finds them:
//
// - The geofence task: Play Services holds one fence per saved place and wakes Pulse on an arrival or a departure,
//   with no polling. Every mode but Off runs it.
// - The fix task: Balanced asks for a fix every 5 minutes with no notification, and Android hands a background app a
//   few an hour; Precise runs a foreground service with its notification for a fix every 90 s.
//
// Android limits: a force-stopped app is not restarted for either, and Doze or a vendor task killer can drop events. A
// missing departure shows as a capped visit (src/core/places/stays.ts), never as a made-up time.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { i18n } from "@/i18n/config";
import { reportError } from "@/lib/telemetry";
import type { Fix, Place, PlaceEvent, TrackingMode } from "@/core/places/types";
import { newId } from "@/lib/ids";
import { localDay } from "@/lib/time";
import { backgroundStore } from "./runSync";
import { maintainTimeline } from "./timeline";

export const GEOFENCE_TASK = "pulse.places.geofence";
export const FIX_TASK = "pulse.places.fixes";
/** The office fence of earlier builds: defined so a pending event lands somewhere, and stopped at the first sync. */
const OFFICE_TASK = "pulse.office.geofence";

// ── Who hears about new rows ────────────────────────────────────────────────────────────────────────────────────

const listeners = new Set<(kind: "event" | "fix") => void>();
/** The app subscribes to refresh the timeline screens when a task writes while it is up (src/state/places.ts). */
export function onPlacesWrite(l: (kind: "event" | "fix") => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const emit = (kind: "event" | "fix") => {
  for (const l of listeners) l(kind);
};

// ── The tasks ───────────────────────────────────────────────────────────────────────────────────────────────────

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType, region } = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
  try {
    const store = await backgroundStore();
    const profile = await store.getProfile();
    if (!profile || !region?.identifier) return;
    const ts = Math.floor(Date.now() / 1000);
    const event: PlaceEvent = {
      id: newId(),
      placeId: region.identifier,
      kind: eventType === Location.GeofencingEventType.Enter ? "enter" : "exit",
      ts,
      day: localDay(ts, profile.timeZone),
    };
    await store.addPlaceEvent(event);
    emit("event");
  } catch (e) {
    void reportError("places.event_failed", e);
  }
});

let lastUpkeep = 0;

TaskManager.defineTask(FIX_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations?.length) return;
  try {
    const store = await backgroundStore();
    const fixes = locations.map(
      (l): Fix => ({ ts: Math.floor(l.timestamp / 1000), latitude: l.coords.latitude, longitude: l.coords.longitude, accuracyM: l.coords.accuracy ?? null }),
    );
    await store.addLocationFixes(fixes);
    emit("fix");
    // A phone that is never opened still freezes its days and drops old fixes, at most once an hour.
    const now = Math.floor(Date.now() / 1000);
    if (now - lastUpkeep > 3600) {
      lastUpkeep = now;
      const profile = await store.getProfile();
      if (profile) await maintainTimeline(store, profile.timeZone, now);
    }
  } catch (e) {
    void reportError("places.fix_failed", e, { count: locations.length });
  }
});

TaskManager.defineTask(OFFICE_TASK, async () => {});

// ── Matching the saved places and mode ──────────────────────────────────────────────────────────────────────────

/** What is running, for Settings › Places. */
export type TrackingStatus = "off" | "no_places" | "no_permission" | "needs_background" | "running" | "failed";

const regionOf = (p: Place): Location.LocationRegion => ({
  identifier: p.id,
  latitude: p.latitude,
  longitude: p.longitude,
  radius: p.radiusM,
  notifyOnEnter: true,
  notifyOnExit: true,
});

/** The fix task's options per mode. distanceInterval 0: a still phone keeps reporting, which is what finds a stop. */
function fixOptions(mode: "balanced" | "precise"): Location.LocationTaskOptions {
  if (mode === "balanced") return { accuracy: Location.Accuracy.Balanced, timeInterval: 5 * 60_000, distanceInterval: 0, mayShowUserSettingsDialog: false };
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: 90_000,
    distanceInterval: 0,
    mayShowUserSettingsDialog: false,
    foregroundService: {
      notificationTitle: i18n.t("places:tracking.serviceTitle"),
      notificationBody: i18n.t("places:tracking.serviceBody"),
      notificationColor: "#0f1113",
      killServiceOnDestroy: false,
    },
  };
}

/**
 * The mode the fix task was last started with, kept across launches: a change restarts it (the service comes or goes),
 * and an unchanged one is left running, so Precise's notification does not flicker at every app start.
 */
const RUNNING_KEY = "pulse.places.runningMode";
const readRunning = () => AsyncStorage.getItem(RUNNING_KEY).catch(() => null);
const writeRunning = (mode: TrackingMode | null) => (mode ? AsyncStorage.setItem(RUNNING_KEY, mode) : AsyncStorage.removeItem(RUNNING_KEY)).catch(() => {});

const stopped = async (task: string, started: (t: string) => Promise<boolean>, stop: (t: string) => Promise<void>) => {
  if (await started(task).catch(() => false)) await stop(task);
};

async function stopAll(): Promise<void> {
  await stopped(GEOFENCE_TASK, Location.hasStartedGeofencingAsync, Location.stopGeofencingAsync);
  await stopped(FIX_TASK, Location.hasStartedLocationUpdatesAsync, Location.stopLocationUpdatesAsync);
  await writeRunning(null);
}

/**
 * Makes the fences and the fix task match the saved places and mode. Android refuses both without "Allow all the
 * time", so that case only clears what is stale; Settings › Places asks for it. Call it from the app (a foreground
 * service cannot start from the background). Never throws.
 */
export async function syncPlaceTracking(): Promise<TrackingStatus> {
  try {
    await stopped(OFFICE_TASK, Location.hasStartedGeofencingAsync, Location.stopGeofencingAsync).catch(() => {});
    const store = await backgroundStore();
    const [places, { mode }] = await Promise.all([store.places(), store.getTimelineState()]);
    if (mode === "off" || !places.length) {
      await stopAll();
      return mode === "off" ? "off" : "no_places";
    }
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) {
      await stopAll();
      return "no_permission";
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) {
      await stopAll();
      return "needs_background";
    }
    // Android holds at most 100 fences per app.
    await Location.startGeofencingAsync(GEOFENCE_TASK, places.slice(0, 100).map(regionOf));
    if (mode === "saver") {
      await stopped(FIX_TASK, Location.hasStartedLocationUpdatesAsync, Location.stopLocationUpdatesAsync);
      await writeRunning(mode);
      return "running";
    }
    const started = await Location.hasStartedLocationUpdatesAsync(FIX_TASK).catch(() => false);
    const was = await readRunning();
    if (started && was !== mode) await Location.stopLocationUpdatesAsync(FIX_TASK);
    if (!started || was !== mode) await Location.startLocationUpdatesAsync(FIX_TASK, fixOptions(mode));
    await writeRunning(mode);
    return "running";
  } catch (e) {
    void reportError("places.sync_failed", e);
    return "failed";
  }
}
