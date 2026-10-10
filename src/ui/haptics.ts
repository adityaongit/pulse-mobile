import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Haptics follow each platform's own vocabulary (Apple's HIG feedback generators on iOS; Android's system haptic
// constants, which expo-haptics recommends over raw vibration). Use them sparingly: a deliberate choice or a finished
// save, never every tap. Failures (no vibrator, an emulator) are ignored.

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
  /** A save went through. */
  success: () => (ios ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore) : android(Haptics.AndroidHaptics.Confirm)),
};
