import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Haptics follow each platform's own vocabulary (Apple's HIG feedback generators on iOS; Android's system haptic
// constants, which expo-haptics recommends over raw vibration). Where they fire (the owner wants them felt, subtly):
//   tap      an action: a primary or sheet button, the check-in button, pull to refresh
//   select   a choice or a step: a tab, a segmented control, a day, each data point while scrubbing a chart
//   toggle   something opened or closed: a section, a switch
//   success  a save went through;  warning  a destructive confirm;  error  a save failed
// Not on navigation taps (a row that opens a screen) or scrolling. Failures (no vibrator, an emulator) are ignored.

const ios = Platform.OS === "ios";
const android = (type: Haptics.AndroidHaptics) => Haptics.performAndroidHapticsAsync(type).catch(() => {});
const ignore = () => {};

export const haptic = {
  /** A primary action that opens something (the round check-in button): a light tap. */
  tap: () => (ios ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore) : android(Haptics.AndroidHaptics.Context_Click)),
  /** A choice changed: a segmented control, a radio row. */
  select: () => (ios ? Haptics.selectionAsync().catch(ignore) : android(Haptics.AndroidHaptics.Segment_Tick)),
  /** Something switched on or off: a section opening or closing. */
  toggle: (on: boolean) => (ios ? Haptics.selectionAsync().catch(ignore) : android(on ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off)),
  /** A destructive confirm (delete, disconnect, delete everything). */
  warning: () => (ios ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore) : android(Haptics.AndroidHaptics.Long_Press)),
  /** A save or an action failed. */
  error: () => (ios ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(ignore) : android(Haptics.AndroidHaptics.Reject)),
  /** A save went through. */
  success: () => (ios ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore) : android(Haptics.AndroidHaptics.Confirm)),
};
