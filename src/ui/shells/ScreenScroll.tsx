import { useCallback, useRef, useState, type ReactNode } from "react";
import { Platform, RefreshControl, StyleSheet, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { useFocusEffect, usePathname } from "expo-router";
import Animated, { useAnimatedScrollHandler, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { Ground } from "../Ground";
import { BlurTargetContext } from "../Glass";
import { haptic } from "../haptics";
import { useTheme } from "../theme";
import { FloatingCheckIn, showsCheckIn } from "./CheckInAction";
import { setFocusedBlurTarget } from "./blurTarget";
import { useBottomClearance } from "./layout";

/** A screen's scroll position as a shared value, and a 0-1 `collapsed` that eases to 1 once `threshold` is scrolled past. */
export function useCollapse(durationIn = 220, durationOut = 150) {
  const scrollY = useSharedValue(0);
  const threshold = useSharedValue(Number.POSITIVE_INFINITY);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const progress = useDerivedValue<number>(() => withTiming(scrollY.value >= threshold.value ? 1 : 0, { duration: scrollY.value >= threshold.value ? durationIn : durationOut }));
  return { scrollY, threshold, onScroll, progress };
}

export type ScreenScrollProps = {
  header: ReactNode;
  top: number;
  onScroll?: ReturnType<typeof useAnimatedScrollHandler>;
  bottomPad?: number;
  /** The flat Healthspan ground instead of the gradient. */
  healthspan?: boolean;
  /** Pull to refresh: called when the user pulls down; the spinner stays until the promise settles. Wire it to "sync now". Without it the screen has no pull-to-refresh. */
  onRefresh?: () => void | Promise<unknown>;
  children: ReactNode;
};

/**
 * The scroll container every shell uses: the ground behind, the content padded under the header (`top`) and clear of the
 * floating tab bar or check-in button (`bottom`), a header drawn over it (the header is absolute, so content scrolls under
 * its fade), the check-in button floating over the foot of a detail screen, and the platform's pull-to-refresh and
 * keyboard handling on the scroll view. The page sits in a blur target, so the glass floating over it blurs it on Android.
 */
export function ScreenScroll({ header, top, onScroll, bottomPad, healthspan, onRefresh, children }: ScreenScrollProps) {
  const { c } = useTheme();
  const clearance = useBottomClearance();
  const blurTarget = useRef<View>(null);
  const checkIn = showsCheckIn(usePathname());
  // The tab bar's glass blurs the screen in view (Android; see blurTarget.ts).
  useFocusEffect(
    useCallback(() => {
      setFocusedBlurTarget(blurTarget);
    }, []),
  );
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    haptic.tap();
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <View className="flex-1 bg-background">
      {/* What the check-in button's glass blurs on Android (iOS blurs what is behind it by itself). */}
      <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
        <Ground healthspan={healthspan} />
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: top, paddingBottom: bottomPad ?? clearance }}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          // Forms: a tap on a button while the keyboard is up goes through; iOS scrolls the focused input clear of the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets
          // The spinner starts below the header, which is drawn over the scroll view.
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={top} tintColor={c["muted-foreground"]} colors={[c.foreground]} progressBackgroundColor={c.card} /> : undefined}
        >
          {children}
        </Animated.ScrollView>
      </BlurTargetView>
      {header}
      {checkIn && (
        <BlurTargetContext.Provider value={blurTarget}>
          <FloatingCheckIn />
        </BlurTargetContext.Provider>
      )}
    </View>
  );
}
