import { View, type ViewProps, type ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { cn } from "./cn";
import { Gradient } from "./Gradient";

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

/** A quiet sweep for background suggestions; reduced motion keeps the block still. */
export function Shimmer({ className }: { className?: string }) {
  const still = useReducedMotion();
  return (
    <View accessibilityState={{ busy: true }} className={cn("overflow-hidden bg-foreground/10", className)}>
      {!still && <Animated.View style={{ width: 160, height: "100%", animationName: { from: { transform: [{ translateX: -160 }] }, to: { transform: [{ translateX: 500 }] } }, animationDuration: "1.8s", animationIterationCount: "infinite", animationTimingFunction: "linear" } as unknown as ViewStyle}>
        <Gradient from="transparent" to="rgba(255,255,255,0.12)" />
      </Animated.View>}
    </View>
  );
}

export function SuggestionReveal({ children, index }: { children: React.ReactNode; index: number }) {
  const still = useReducedMotion();
  return <View style={{ position: "relative" }}>
    <Animated.View style={(!still ? { overflow: "hidden", animationName: { from: { maxWidth: "0%", opacity: 0 }, to: { maxWidth: "100%", opacity: 1 } }, animationDuration: "550ms", animationDelay: `${index * 160}ms`, animationFillMode: "both", animationTimingFunction: "ease-out" } : {}) as ViewStyle}>{children}</Animated.View>
    {!still && <Animated.View pointerEvents="none" style={{ position: "absolute", right: 0, top: 0, height: 20, overflow: "hidden", animationName: { from: { width: "100%" }, to: { width: "0%" } }, animationDuration: "550ms", animationDelay: `${index * 160}ms`, animationFillMode: "both", animationTimingFunction: "ease-out" } as ViewStyle}><Shimmer className="h-5 w-full rounded-md" /></Animated.View>}
  </View>;
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
