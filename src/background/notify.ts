// Local notifications through expo-notifications (SDK 57): the "Pulse" channel, the Android 13+ POST_NOTIFICATIONS
// request, sending one now, the daily check-in schedule and the bedtime reminder's. No push server: every notification is composed on the
// phone. No React in here, so the background task can import it; the tap → screen hook is in links.ts.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { i18n } from "@/i18n/config";
import { DEEP_LINK } from "./decide";

export const CHANNEL_ID = "pulse";
/** The daily reminder's fixed identifier: scheduling again replaces it. */
export const CHECK_IN_ID = "pulse.checkin";
/** The bedtime reminder's, re-planned after every run (smart.ts's planBedtime). */
export const BEDTIME_ID = "pulse.bedtime";

let handlerInstalled = false;
/** Shows notifications that arrive while Pulse is in the foreground too (expo-notifications drops them otherwise). */
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

let channel: Promise<void> | null = null;
/** Creates the "Pulse" channel once per process. Android 13 shows its permission prompt only once a channel exists. */
export function ensureChannel(): Promise<void> {
  channel ??=
    Platform.OS === "android"
      ? Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: "Pulse", importance: Notifications.AndroidImportance.DEFAULT }).then(() => undefined)
      : Promise.resolve();
  return channel;
}

export type NotificationPermission = "granted" | "denied" | "undetermined";

const permissionOf = (s: { granted: boolean; canAskAgain: boolean }): NotificationPermission => (s.granted ? "granted" : s.canAskAgain ? "undetermined" : "denied");

export async function notificationPermission(): Promise<NotificationPermission> {
  try {
    return permissionOf(await Notifications.getPermissionsAsync());
  } catch {
    return "denied";
  }
}

/** Shows the system prompt (Android 13+; granted outright on older versions). */
export async function askNotificationPermission(): Promise<NotificationPermission> {
  try {
    await ensureChannel();
    return permissionOf(await Notifications.requestPermissionsAsync());
  } catch {
    return "denied";
  }
}

export type Payload = { title: string; body: string; url: string };

/** Shows `payload` now; a tap opens `url`. Never throws; false when it couldn't be shown. */
export async function sendNow(p: Payload): Promise<boolean> {
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, data: { url: p.url } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
    return true;
  } catch (e) {
    console.warn("[notify]", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** (Re)schedules the daily check-in reminder at hour:minute, replacing any earlier one. */
export async function scheduleCheckIn(hour: number, minute: number): Promise<void> {
  await ensureChannel();
  await Notifications.cancelScheduledNotificationAsync(CHECK_IN_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: CHECK_IN_ID,
    content: { title: i18n.t("notifications:checkIn.title"), body: i18n.t("notifications:checkIn.body"), data: { url: DEEP_LINK.journal } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID },
  });
}

export async function cancelCheckIn(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(CHECK_IN_ID).catch(() => {});
}

/** Whether the reminder is on the system's schedule (Settings shows it). */
export async function isCheckInScheduled(): Promise<boolean> {
  try {
    return (await Notifications.getAllScheduledNotificationsAsync()).some((n) => n.identifier === CHECK_IN_ID);
  } catch {
    return false;
  }
}

/** (Re)schedules the bedtime reminder for `at` (unix seconds), replacing any earlier one. Never throws; false when it couldn't. */
export async function scheduleBedtime(p: Payload & { at: number }): Promise<boolean> {
  try {
    await ensureChannel();
    await Notifications.cancelScheduledNotificationAsync(BEDTIME_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: BEDTIME_ID,
      content: { title: p.title, body: p.body, data: { url: p.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at * 1000, channelId: CHANNEL_ID },
    });
    return true;
  } catch (e) {
    console.warn("[notify] bedtime", e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function cancelBedtime(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(BEDTIME_ID).catch(() => {});
}
