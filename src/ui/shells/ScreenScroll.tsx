import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useLocalSearchParams, usePathname } from "expo-router";
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useScrollViewOffset, useSharedValue, withTiming } from "react-native-reanimated";
import { Ground, HealthspanGround } from "../Ground";
import { useKeyboardInset, useRevealFocused } from "../keyboard";
import { useTheme } from "../theme";
import { FloatingCheckIn, showsCheckIn } from "./CheckInAction";
import { HEADER_FADE } from "./Header";
import { useBottomClearance } from "./layout";
import { usePullToSync } from "./PullToSync";
import { DURATION } from "../motion";

/** A screen's scroll position as a shared value, and a 0-1 `collapsed` that eases to 1 once `threshold` is scrolled past. */
export function useCollapse(durationIn: number = DURATION.collapse, durationOut: number = DURATION.fast) {
  const scrollY = useSharedValue(0);
  const threshold = useSharedValue(Number.POSITIVE_INFINITY);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // The ease starts only when the side of the threshold changes. A derived value returning withTiming started a new
  // animation on every scroll event (each frame at 120 Hz), and every style reading `progress` ran again with it.
  const progress = useSharedValue(0);
  useAnimatedReaction(
    () => scrollY.value >= threshold.value,
    (past, before) => {
      if (before === null) progress.value = past ? 1 : 0;
      else if (past !== before) progress.value = withTiming(past ? 1 : 0, { duration: past ? durationIn : durationOut });
    },
  );
  return { scrollY, threshold, onScroll, progress };
}

const AnchorContext = createContext<((id: string, node: View) => void) | null>(null);

/**
 * A place a link can land on (the web's `id` and `/sleep#planner`; Home's "Tonight's sleep" arrow opens `/sleep?section=planner`).
 * When the screen's `section` param names this id, <ScreenScroll> scrolls it to the top of the content once, when it first
 * appears (after the data loads: the web's HashScroll does the same). A section with an `id` in <SectionShell> is one.
 */
export function ScrollAnchor({ id, children }: { id: string; children: ReactNode }) {
  const register = useContext(AnchorContext);
  const node = useRef<View>(null);
  return (
    <View ref={node} collapsable={false} onLayout={() => node.current && register?.(id, node.current)}>
      {children}
    </View>
  );
}

export type ScreenScrollProps = {
  header: ReactNode;
  /** The header's solid part (status-bar inset plus its rows). The content starts below it AND its 24 px fade: the web's sticky header takes that fade in layout (`pb-6`), so nothing sits under it at rest. */
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
 * The scroll container every shell uses: the ground behind, the content padded below the header (`top` plus its fade) and clear of the
 * floating tab bar or check-in button (`bottom`), a header drawn over it (the header is absolute, so content scrolls under
 * it and its fade), the check-in button floating over the foot of a detail screen, the web's pull to sync, and the keyboard:
 * the scroll view ends at its top and brings the focused field into view.
 */
export function ScreenScroll({ header, top, onScroll, bottomPad, healthspan, onRefresh, children }: ScreenScrollProps) {
  const { c } = useTheme();
  const clearance = useBottomClearance();
  const checkIn = showsCheckIn(usePathname());
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollViewOffset(scroll);
  const pull = usePullToSync(offset, onRefresh);
  const { ref: keyboardRef, onLayout: measureKeyboard, inset: keyboardInset } = useKeyboardInset();
  const landed = useRef<string>(null);
  const content = useRef<View>(null);
  const reveal = useRevealFocused({ scroll, content, offset: () => offset.value, top: top + HEADER_FADE });
  // The anchor's place inside the content (which starts under the `top` padding, i.e. just below the header): scroll there.
  const register = useCallback(
    (id: string, node: View) => {
      if (!section || id !== section || landed.current === section || !content.current) return;
      landed.current = section;
      node.measureLayout(
        content.current,
        (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y), animated: false }),
        () => {
          landed.current = null;
        },
      );
    },
    [section, scroll],
  );
  return (
    <View ref={keyboardRef} onLayout={measureKeyboard} className="flex-1 bg-background" style={{ backgroundColor: c.background }}>
      {/* The scroll view ends at the keyboard's top, so a form's fields scroll clear of it (src/ui/keyboard.ts). */}
      <View style={[StyleSheet.absoluteFill, { bottom: keyboardInset }]}>
        <Ground healthspan={!!healthspan} />
        <GestureDetector gesture={Gesture.Simultaneous(pull.gesture, Gesture.Native())}>
        <Animated.ScrollView
          ref={scroll}
          {...reveal}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: top + HEADER_FADE, paddingBottom: bottomPad ?? clearance }}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          // Forms: a tap on a button while the keyboard is up goes through.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Pulling at the top syncs (usePullToSync), as on the web, where the page does not stretch (`overscroll-behavior: none`).
          overScrollMode="never"
          // Off-screen sections are detached from the native tree, so a push records only what shows. Measured on the
          // owner's phone: navigation's worst frames went from 65-77 ms to 32-36 ms (halo: 36 ms). The wrappers in
          // DetailShell pass it down; RN clips only children of views that set it.
          removeClippedSubviews
        >
          <AnchorContext.Provider value={register}>
            <View ref={content} collapsable={false} removeClippedSubviews>
              {children}
            </View>
          </AnchorContext.Provider>
        </Animated.ScrollView>
        </GestureDetector>
      </View>
      <HealthspanGround.Provider value={!!healthspan}>{header}</HealthspanGround.Provider>
      {pull.indicator}
      {checkIn && (
        <FloatingCheckIn />
      )}
    </View>
  );
}
