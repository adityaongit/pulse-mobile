// The Fitbit Air's battery over its private Bluetooth channel (android/…/AirBattery.kt). Without the native module
// (tests, web, Expo Go) there is no Air and every read fails with UNAVAILABLE.
import { requireOptionalNativeModule } from "expo";

export type AirBatteryReading = { percent: number; charging?: boolean; millivolts?: number };
type Native = { hasAir(): boolean; readBattery(): Promise<AirBatteryReading> };
const native = requireOptionalNativeModule<Native>("PulseAir");

/** A Fitbit Air is paired with this phone. False without the module or the Nearby devices permission. */
export function hasAir(): boolean {
  try {
    return native?.hasAir() ?? false;
  } catch {
    return false;
  }
}

/** Opens a short secure session (a few seconds, longer while Google Health syncs). Rejects with an error whose `code` is stable. */
export function readBattery(): Promise<AirBatteryReading> {
  if (!native) return Promise.reject(Object.assign(new Error("No native module."), { code: "UNAVAILABLE" }));
  return native.readBattery();
}
