// Breathe's circle (halo src/screens/breathe/BreathCircle.tsx): fills as you breathe in, holds, empties as you breathe
// out. One number a frame on the UI thread, the level from the session's start time (src/live/breath.ts's levelAt), and
// the two discs follow it as a scale and an opacity: no geometry is redrawn, so a frame is a few composited layers. The
// label and the haptics the JS side runs read the same clock, so nothing drifts and no frame waits for JS.
import { useCallback, useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type FrameInfo } from "react-native-reanimated";
import { levelAt, type BreathStage } from "@/live/breath";
import { alpha } from "@/ui/color";
import { EASE } from "@/ui/motion";

/** The circle's smallest size as a share of its largest (empty lungs). */
const MIN_SCALE = 0.42;
/** The glow reaches this much past the core at full. */
const HALO = 1.14;

type Props = {
  stages: readonly BreathStage[];
  /** Epoch ms the session started; null while idle (the circle rests empty). */
  startAt: number | null;
  size: number;
  color: string;
  /** Drawn over the circle, unscaled: the phase and its count. */
  children?: ReactNode;
};

export function BreathCircle({ stages, startAt, size, color, children }: Props) {
  // Reduced motion: each stage's size is held from its start (a step, not a glide).
  const reduce = useReducedMotion();
  const level = useSharedValue(0);
  // What the frame callback reads, as one shared value, so the callback itself never changes (a new one re-registers).
  const params = useSharedValue({ ms: [] as number[], levels: [] as number[], start: 0, stepped: false });
  const tick = useCallback(
    (_f: FrameInfo) => {
      "worklet";
      const p = params.get();
      level.set(levelAt(p.ms, p.levels, Date.now() - p.start, p.stepped));
    },
    [params, level],
  );
  const frame = useFrameCallback(tick, false);

  useEffect(() => {
    if (startAt === null) {
      frame.setActive(false);
      // Stopped mid-breath: let the circle settle back to empty.
      level.set(reduce ? 0 : withTiming(0, { duration: 800, easing: EASE.standard }));
      return;
    }
    params.set({ ms: stages.map((s) => s.ms), levels: stages.map((s) => s.level), start: startAt, stepped: reduce });
    frame.setActive(true);
    return () => frame.setActive(false);
    // `frame` is the same ref object on every render, so listing it never re-runs the effect.
  }, [startAt, stages, reduce, params, level, frame]);

  const core = useAnimatedStyle(() => ({ transform: [{ scale: MIN_SCALE + (1 - MIN_SCALE) * level.value }] }));
  const glow = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * level.value,
    transform: [{ scale: (MIN_SCALE + (1 - MIN_SCALE) * level.value) * HALO }],
  }));

  const disc = { position: "absolute", width: size, height: size, borderRadius: size / 2 } as const;
  return (
    <View style={{ width: size * HALO, height: size * HALO, alignItems: "center", justifyContent: "center" }}>
      {/* The full breath's outline, so the circle shows where it is filling to. */}
      <View style={[disc, { borderWidth: 1.5, borderColor: alpha(color, 0.28) }]} />
      <Animated.View style={[disc, { backgroundColor: alpha(color, 0.1) }, glow]} />
      <Animated.View style={[disc, { backgroundColor: alpha(color, 0.26), borderWidth: 2, borderColor: alpha(color, 0.85) }, core]} />
      <View style={{ position: "absolute", alignItems: "center", justifyContent: "center", width: size * MIN_SCALE * 1.6 }}>{children}</View>
    </View>
  );
}
