// "● 2 minutes ago": the dot pulses while the reading is under 5 minutes old. Ported from pulse
// src/app/(app)/health/heart-rate/LiveHeartRate.tsx (LastReading). The web re-renders it from a shared minute clock;
// the app has no clock timer (screen-rules.md), so `now` is when the screen last loaded, or the live screen's last pull.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { ago } from "@/lib/format";
import { CAPTION } from "@/ui/metrics/primitives";
import { cn } from "@/ui/cn";
import { Text } from "@/ui/Text";

/** A reading this recent counts as live: the band, the phone and Google's cloud take a minute or three between them. */
export const LIVE_MS = 5 * 60_000;

/** Tailwind's `animate-ping` over 2 s (the ring grows to twice its size and fades in the first 75 %), on the UI thread. */
function Ping() {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    p.set(withRepeat(withSequence(withTiming(1, { duration: 1500, easing: Easing.bezier(0, 0, 0.2, 1) }), withTiming(1, { duration: 500 })), -1));
  }, [reduced, p]);
  const style = useAnimatedStyle(() => ({ opacity: 0.4 * (1 - p.value), transform: [{ scale: 1 + p.value }] }));
  return <Animated.View className="absolute inset-0 rounded-full bg-strain" style={style} />;
}

/** `now` is epoch ms from the screen's last load (or last live pull): rendering never reads the clock. */
export function LastReading({ t, now, className }: { t: number; now: number; className?: string }) {
  const fresh = now - t < LIVE_MS;
  return (
    <View className={cn("flex-row items-center gap-1.5", className)}>
      {fresh && (
        <View accessibilityElementsHidden className="size-2">
          <Ping />
          <View className="size-2 rounded-full bg-strain" />
        </View>
      )}
      <Text className={cn(CAPTION, "tabular-nums")} accessibilityLabel={`${fresh ? "Live, " : ""}${ago(t, now)}`}>
        {ago(t, now)}
      </Text>
    </View>
  );
}
