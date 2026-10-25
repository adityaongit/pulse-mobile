import { View, type ViewProps, type ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { cn } from "./cn";

// Skeletons reuse the component's own box (spec §5.19); these are only the bars inside it. A tint of the text colour, not
// bg-muted: in dark mode muted (#22282c) is the card's own colour (#232629), so a bar inside a card did not show.
const BAR = "rounded-md bg-foreground/10";

// The web's animate-pulse (Tailwind: opacity 1 → 0.5 → 1 over 2 s) as Reanimated's own CSS animation on the UI thread,
// not through NativeWind's experimental animation support. Reanimated takes only named curves as strings (a
// "cubic-bezier(…)" string throws), so ease-in-out (0.42, 0, 0.58, 1) stands in for Tailwind's (0.4, 0, 0.6, 1).
// Reduced motion holds it still.
const PULSE = {
  animationName: { "50%": { opacity: 0.5 } },
  animationDuration: "2s",
  animationIterationCount: "infinite" as const,
  animationTimingFunction: "ease-in-out",
};

function Bar({ className, style, ...props }: ViewProps) {
  const still = useReducedMotion();
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn(BAR, className)} style={[!still && (PULSE as unknown as ViewStyle), style]} {...props} />;
}

export function Skeleton(props: ViewProps) {
  return <Bar {...props} />;
}

/**
 * A text bar for one line of a type role. The web sizes it with `h-[1lh]` and a bar 0.72em tall; React Native has no
 * `lh` unit, so the role's line height `lh` and font size `fs` (px) are given. Width goes in `className` (w-40, w-full).
 */
export function SkeletonText({ lh = 16, fs = 12, className }: { lh?: number; fs?: number; className?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn("justify-center", className)} style={{ height: lh }}>
      <Bar className="w-full rounded-sm" style={{ height: Math.round(fs * 0.72) }} />
    </View>
  );
}
