import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The tab bar and the round check-in action are 62 px tall (spec §4.2). */
export const TAB_BAR_HEIGHT = 62;
export const FAB_SIZE = TAB_BAR_HEIGHT;

/** The tab roots: the bar shows here, with the check-in action beside it. */
export const TAB_ROOTS = ["/", "/health", "/workout", "/journal", "/more"];

/** How far above the bottom edge the floating bar (and the lone action on detail screens) sits: the safe area less 6 px, never under 12. */
export function useTabBarBottom() {
  return Math.max(useSafeAreaInsets().bottom - 6, 12);
}

/** The room a scrolling screen leaves at its foot so its last content clears the floating bar (the web's `main` padding-bottom). */
export function useBottomClearance() {
  return TAB_BAR_HEIGHT + useTabBarBottom() + 24;
}

/**
 * The web's phone breakpoints, read off the window width: `max-[380px]:` is `lt380`, `min-[400px]:` is `!lt400`
 * (Tailwind 4: max-[N] is width < N, min-[N] is width >= N). Use these, not raw widths, so the two apps step together.
 */
export function useNarrow() {
  const { width } = useWindowDimensions();
  return { width, lt356: width < 356, lt380: width < 380, lt400: width < 400 };
}
