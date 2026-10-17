import type { ReactNode, Ref } from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { interpolate, type SharedValue, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { cn } from "./cn";
import { DURATION, EASE } from "./motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The web's `duration-150 ease-standard` (globals.css `--ease-standard`). */
const TIMING = { duration: DURATION.fast, easing: EASE.standard };
/**
 * iOS's own scroll views wait about this long before a touch counts as a press (`delaysContentTouches`). Android shows
 * the press at touch-down and cancels it when a scroll takes the touch: a delay there lets a tap end before any feedback,
 * so the tap feels unregistered.
 */
const PRESS_DELAY_MS = Platform.OS === "ios" ? 150 : 0;

export type PressProps = Omit<PressableProps, "style" | "children"> & {
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  ref?: Ref<View>;
  /** Pressed scale, the web's `active:scale-[x]`. */
  activeScale?: number;
  /** Pressed fill as a background class, the web's `active:bg-*` ("bg-accent", "bg-fill-hover" for its bg-foreground/8). */
  activeBg?: string;
  /** Pressed opacity, for the few text links that dim instead of scaling. */
  activeOpacity?: number;
};

/**
 * The kit's pressable: the web's `transition-[scale,background-color] duration-150 ease-standard` with `active:` states,
 * run on the UI thread. On iOS a touch only counts as pressed after PRESS_DELAY_MS, so a finger that lands on a card and
 * then scrolls never shows the press; a tap shorter than that still plays the full press in and out.
 *
 * React Native cannot ease a background class, so the pressed fill is a view behind the children in that class, faded
 * in; it copies the pressable's `rounded-*` classes to keep its shape.
 *
 * A Press with no pressed state is a plain Pressable: each animated style is a UI-thread mapper that is set up when the
 * page mounts and torn down when it unmounts, and a page holds dozens of presses.
 */
export function Press(props: PressProps) {
  const { activeScale = 1, activeBg, activeOpacity = 1, className, ...rest } = props;
  if (activeScale !== 1 || activeBg || activeOpacity !== 1) return <AnimatedPress {...props} />;
  return <Pressable unstable_pressDelay={PRESS_DELAY_MS} className={className} {...rest} />;
}

function AnimatedPress({ className, style, activeScale = 1, activeBg, activeOpacity = 1, onPressIn, onPressOut, children, ...props }: PressProps) {
  const p = useSharedValue(0);
  // Only the animated properties: an opacity of 1 here would override a class's `opacity-disabled`.
  const animated = useAnimatedStyle(() => ({
    ...(activeOpacity !== 1 && { opacity: interpolate(p.value, [0, 1], [1, activeOpacity]) }),
    ...(activeScale !== 1 && { transform: [{ scale: interpolate(p.value, [0, 1], [1, activeScale]) }] }),
  }));
  return (
    <AnimatedPressable
      unstable_pressDelay={PRESS_DELAY_MS}
      onPressIn={(e) => {
        p.set(withTiming(1, TIMING));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // A quick tap gets its press-in at release (after the delay): finish going in, then come back out.
        p.set(withSequence(withTiming(1, { ...TIMING, duration: TIMING.duration * (1 - p.get()) }), withTiming(0, TIMING)));
        onPressOut?.(e);
      }}
      className={className}
      style={[style, animated]}
      {...props}
    >
      {!!activeBg && <PressFill p={p} className={className} activeBg={activeBg} />}
      {children}
    </AnimatedPressable>
  );
}

function PressFill({ p, className, activeBg }: { p: SharedValue<number>; className?: string; activeBg: string }) {
  const fill = useAnimatedStyle(() => ({ opacity: p.value }));
  const rounded = className?.split(/\s+/).filter((k) => /^(?:[\w-]+:)?rounded/.test(k)).join(" ");
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fill]}>
      <View className={cn("flex-1", rounded, activeBg)} />
    </Animated.View>
  );
}
