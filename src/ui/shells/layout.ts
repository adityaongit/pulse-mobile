import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The round check-in button is 62 px. */
export const FAB_SIZE = 62;
/** The gap between the button and the edge it floats over (the tab bar, or the screen's foot), and to the page's edge. */
export const FAB_GAP = 12;

/**
 * The room a scrolling screen leaves at its foot so its last content clears the check-in button (the web's `main`
 * padding-bottom). Call it below <ScreenScroll>'s own SafeAreaProvider: there `insets.bottom` is the platform's, which
 * on a tab screen includes the native tab bar (iOS) or leaves it outside the screen (Android), so this needs no
 * tab-bar height, which Expo Router's native tabs do not expose.
 */
export function useBottomClearance() {
  return useSafeAreaInsets().bottom + FAB_SIZE + 2 * FAB_GAP;
}
