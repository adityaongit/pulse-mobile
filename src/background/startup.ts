// At app start (src/state/app.tsx's boot) and after a settings change: the task registration and the check-in
// schedule made to match the settings. Idempotent, never throws.
import { parseTime } from "./decide";
import { cancelCheckIn, installNotificationHandler, notificationPermission, scheduleCheckIn } from "./notify";
import { readSettings, type BackgroundSettings } from "./settings";
import { syncRegistration } from "./task";

export async function startBackground(): Promise<void> {
  try {
    installNotificationHandler();
    const s = await readSettings();
    await syncRegistration(s.backgroundSync);
    await applyCheckIn(s);
  } catch (e) {
    console.warn("[background] start", e instanceof Error ? e.message : String(e));
  }
}

/** The daily reminder on the system's schedule, or off, as the settings say. */
export async function applyCheckIn(s: Pick<BackgroundSettings, "checkIn" | "checkInTime">): Promise<void> {
  try {
    const t = parseTime(s.checkInTime);
    if (s.checkIn && t && (await notificationPermission()) === "granted") await scheduleCheckIn(t.hour, t.minute);
    else await cancelCheckIn();
  } catch (e) {
    console.warn("[background] check-in", e instanceof Error ? e.message : String(e));
  }
}
