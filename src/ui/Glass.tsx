import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { Platform, View, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { alpha } from "./color";
import { Gradient } from "./Gradient";
import { useTheme } from "./theme";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

/**
 * Android can only blur what is inside a `BlurTargetView` (expo-blur). ScreenScroll wraps the scrolling page in one and
 * puts its ref here, so a <Glass> floating over that page can blur it. iOS needs no target.
 */
export const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * Glass material (spec §2.6), for chrome that floats over scrolling content only: the round check-in action. Real blur
 * (expo-blur: UIVisualEffectView on iOS, a RenderNode blur on Android 12+) under the sampled translucent gradient fill, a
 * lit top edge, a faint rim and a soft lower shadow. Where Android has no blur target or is older than 12, the fill's own
 * 80-90 % opacity is the web's fallback (the same solid colours).
 */
export function Glass({ radius, action, children, style, ...props }: ViewProps & { radius: number; /** The indigo-tinted fill of the round action. */ action?: boolean; children?: ReactNode }) {
  const { c, scheme } = useTheme();
  const target = useContext(BlurTargetContext);
  const shadow = scheme === "dark" ? "0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)" : "0 10px 30px rgba(16, 21, 24, 0.12), 0 2px 6px rgba(16, 21, 24, 0.08)";
  const rim = action ? alpha(c["action-rim-from"], 0.25) : c["glass-rim"];
  return (
    <View style={[{ borderRadius: radius, boxShadow: shadow }, style]} {...props}>
      <View style={{ ...FILL, borderRadius: radius, overflow: "hidden" }}>
        {(Platform.OS !== "android" || target) && <BlurView blurTarget={target ?? undefined} blurMethod="dimezisBlurViewSdk31Plus" intensity={50} tint={scheme} style={FILL} />}
        <Gradient from={action ? c["glass-action-top"] : c["glass-top"]} to={action ? c["glass-action-bottom"] : c["glass-bottom"]} angle="y" />
      </View>
      {/* The lit top edge and the faint rim, over the fill. */}
      <View pointerEvents="none" style={{ ...FILL, borderRadius: radius, boxShadow: `inset 0 1px 0 ${c["glass-edge"]}, inset 0 0 0 1px ${rim}` }} />
      {children}
    </View>
  );
}
