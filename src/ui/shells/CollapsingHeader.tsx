import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, type DerivedValue } from "react-native-reanimated";
import { cn } from "../cn";
import { Text } from "../Text";
import { DetailHeaderRow, type DetailHeaderProps } from "./DetailHeader";
import { HEADER_ROW, HeaderFrame } from "./Header";

export type HeaderStat = {
  /** Formatted already: "3.4", "-0.8x". */
  value: ReactNode;
  /** Caps label, written in sentence case: "Years younger". */
  label: string;
  /** Value colour; default foreground. */
  tone?: "optimal" | "warning";
};
export type HeaderStats = { left?: HeaderStat; right?: HeaderStat };

/** Row 2 is 62 px ([latest-healthspan-collapsed-2]); the band grows by it with a reveal, so nothing reflows. */
export const COLLAPSE_ROW = 62;

function Stat({ stat, progress }: { stat?: HeaderStat; progress: DerivedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: 4 * (1 - progress.value) }] }));
  if (!stat) return <View className="flex-1" />;
  return (
    <Animated.View style={[style, { flex: 1, alignItems: "center", gap: 2 }]}>
      <Text className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", stat.tone === "optimal" ? "text-optimal-text" : stat.tone === "warning" ? "text-warning-text" : "text-foreground")}>{stat.value}</Text>
      <Text className="text-center text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{stat.label}</Text>
    </Animated.View>
  );
}

/**
 * DetailShell's collapsing header (spec §4.3a, docs/design/sticky.md B3-B5). At rest it is the plain detail bar.
 * Once the hero has scrolled under it (`progress` 1, driven by DetailShell from the scroll offset), the title fades,
 * back and info stay, and a 62 px row grows over the content with the left stat, the hero's compact form and the
 * right stat. The in-flow height never changes.
 */
export function CollapsingHeader({ compact, stats, progress, onHeight, ...row }: DetailHeaderProps & { compact: ReactNode; stats?: HeaderStats; progress: DerivedValue<number>; onHeight?: (height: number) => void }) {
  const expanded = useDerivedValue(() => COLLAPSE_ROW * progress.value);
  const center = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const hero = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.85 + 0.15 * progress.value }] }));
  return (
    <HeaderFrame expanded={expanded} extra={COLLAPSE_ROW} onHeight={onHeight}>
      <View style={{ height: HEADER_ROW }}>
        <DetailHeaderRow {...row} centerStyle={center} />
        <View pointerEvents="none" className="absolute inset-x-0 flex-row items-center gap-2 px-4" style={{ top: HEADER_ROW, height: COLLAPSE_ROW }}>
          <Stat stat={stats?.left} progress={progress} />
          <Animated.View style={hero}>{compact}</Animated.View>
          <Stat stat={stats?.right} progress={progress} />
        </View>
      </View>
    </HeaderFrame>
  );
}
