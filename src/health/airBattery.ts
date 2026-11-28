// The Fitbit Air's battery for the header's band (src/ui/shells/SyncStatus.tsx), read over the band's private Bluetooth
// channel (modules/pulse-air). Each read opens a secure session that leaves Google Health's Alarms and band settings
// unable to sync for about a minute, so Pulse tries at most once an hour, after a sync, and only when a Fitbit Air is
// paired and Nearby devices is already granted (it never asks from here). The last reading is kept in AsyncStorage
// and shown for 12 hours; it is device status, not health data, and never goes to SQLite or telemetry.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { report } from "@/lib/telemetry";
import { hasAir, readBattery } from "../../modules/pulse-air";

export type AirBattery = { percent: number; charging: boolean | null; at: number };
type Saved = { reading: AirBattery | null; triedAt: number };

export const KEY = "pulse.air.battery";
/** Between attempts, successful or not. */
export const READ_EVERY_MS = 60 * 60_000;
/** An older reading is not shown (the header falls back to the sync age). */
export const SHOW_FOR_MS = 12 * 60 * 60_000;
export const LOW_PERCENT = 20;
/** Failures that say nothing is wrong with Pulse: not reported. */
const EXPECTED = new Set(["AIR_NOT_FOUND", "BLUETOOTH_OFF", "BUSY", "UNAVAILABLE"]);

export const dueForRead = (s: Saved | null, now: number) => !s || now - s.triedAt >= READ_EVERY_MS;
/** The reading to show, or null when there is none or it is too old to trust. */
export const shownBattery = (r: AirBattery | null, now: number) => (r && now - r.at < SHOW_FOR_MS ? r : null);

let saved: Saved | null = null;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Fills `saved` from AsyncStorage once (a save before it finishes wins). */
function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => (raw ? (JSON.parse(raw) as Saved) : null))
    .catch(() => null)
    .then((s) => {
      saved ??= s;
      listeners.forEach((f) => f());
    });
  return loaded;
}

async function save(s: Saved) {
  saved = s;
  listeners.forEach((f) => f());
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}

function subscribe(f: () => void) {
  listeners.add(f);
  void load();
  return () => listeners.delete(f);
}

/** The last reading (any age: pass it through shownBattery with the current time). */
export function useAirBattery(): AirBattery | null {
  return useSyncExternalStore(subscribe, () => saved?.reading ?? null);
}

let inflight: Promise<void> | null = null;

/** Reads the battery when an hour has passed since the last try. Never throws, never asks for a permission. */
export function refreshAirBattery(): Promise<void> {
  inflight ??= (async () => {
    try {
      if (Platform.OS !== "android") return;
      const now = Date.now();
      await load();
      if (!dueForRead(saved, now)) return;
      // Below Android 12 Bluetooth is an install-time permission.
      const granted = (Platform.Version as number) < 31 || (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT));
      if (!granted || !hasAir()) return;
      await save({ reading: saved?.reading ?? null, triedAt: now });
      try {
        const r = await readBattery();
        await save({ reading: { percent: r.percent, charging: r.charging ?? null, at: Date.now() }, triedAt: now });
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        const reason = typeof code === "string" ? code : "unknown";
        if (!EXPECTED.has(reason)) void report("air.battery.failed", { reason });
      }
    } catch {
      // Device status only: a failure leaves the header on the sync age.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
