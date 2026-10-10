import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, type DerivedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { router, type Href } from "expo-router";
import { UserRound } from "lucide-react-native";
import { BAND_WORD, recoveryBand } from "@/lib/bands";
import { formatValue } from "@/lib/format";
import { Icon } from "../Icon";
import { MiniRing, type MiniRingVariant } from "../metrics/MiniRing";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { DateSwitcher, useSelectedDay } from "./DateSwitcher";
import { HEADER_ROW, HeaderFrame } from "./Header";
import { useShellCalendar } from "./ShellStatus";

export type HeaderRing = { value: number | null; href: string };
/** The day's three scores for the ring row (the dials' own view model), with their detail links. */
export type HeaderRings = Record<MiniRingVariant, HeaderRing>;

const RING_ORDER: { key: MiniRingVariant; label: string }[] = [
  { key: "sleep", label: "Sleep" },
  { key: "recovery", label: "Recovery" },
  { key: "strain", label: "Strain" },
];
/** The ring row is 40 px tall. */
const RING_ROW = 40;

function ringLabel(key: MiniRingVariant, label: string, value: number | null) {
  if (value === null) return `${label}: no score. Open ${label}`;
  if (key === "recovery") return `Recovery ${formatValue("int", value)} percent, ${BAND_WORD[recoveryBand(value)].toLowerCase()}. Open Recovery`;
  if (key === "sleep") return `Sleep performance ${formatValue("int", value)} percent. Open Sleep`;
  return `Strain ${formatValue("decimal1", value)} of 21. Open Strain`;
}

/** The reference app's streak flame: the emoji-like two-tone fire, a red-orange body lit toward its tip with an orange-yellow core (the --flame-* tokens). */
function StreakFlame({ height }: { height: number }) {
  const { c } = useTheme();
  return (
    <Svg viewBox="0 0 20 24" width={(height * 20) / 24} height={height}>
      <Defs>
        <LinearGradient id="flame-body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c["flame-tip"]} />
          <Stop offset="0.45" stopColor={c["flame-body"]} />
          <Stop offset="1" stopColor={c["flame-edge"]} />
        </LinearGradient>
        <LinearGradient id="flame-core" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c["flame-core-top"]} />
          <Stop offset="1" stopColor={c["flame-core-bottom"]} />
        </LinearGradient>
      </Defs>
      <Path fill="url(#flame-body)" d="M10.4 0.6c.6 3.8 3.2 5.6 5.1 8.3 1.6 2.3 2.5 4.6 2.5 7.2 0 4.6-3.6 7.6-8 7.6s-8-3-8-7.4c0-3 1.4-5.2 3-7 .3 1.6 1 2.8 2.1 3.5-.3-3.6.9-6.6 3.3-12.2z" />
      <Path fill="url(#flame-core)" d="M10.2 11.4c.5 2 2 2.9 2.9 4.4.6 1 .9 1.9.9 2.9 0 2.3-1.8 3.9-4 3.9s-4-1.5-4-3.7c0-1.6.8-2.7 1.8-3.6.2.8.6 1.4 1.1 1.7-.1-2 .3-3.7 1.3-5.6z" />
    </Svg>
  );
}

/**
 * Home's collapsing header (spec §4.3). The top row always stays: the avatar and the streak, the date pill, the sync
 * status. Once the dials have scrolled under it (`progress` 1, from PageShell) a ring row of mini Sleep / Recovery / Strain rings
 * eases in below. This is the web's discrete swap (what it does on a laptop or under reduced motion); the scroll-linked morph
 * that shrinks each dial into its ring is not ported: it measures and animates DOM boxes with a ScrollTimeline.
 */
export function HomeHeader({ rings, progress, right, streak }: { rings?: HeaderRings; progress: DerivedValue<number>; right?: React.ReactNode; streak?: number }) {
  const { today } = useShellCalendar();
  const [d] = useSelectedDay();
  const expanded = useDerivedValue(() => RING_ROW * progress.value);
  // The ring row is invisible until the dials have scrolled away, and takes no taps until then either.
  const row = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: 6 * (1 - progress.value) }], pointerEvents: progress.value > 0.5 ? "auto" : "none" }));
  return (
    <HeaderFrame expanded={expanded} extra={RING_ROW}>
      {/* As tall as both rows, so the ring row is inside its parent's bounds (Android only delivers touches there); the empty part passes taps through. */}
      <View pointerEvents="box-none" style={{ height: HEADER_ROW + RING_ROW }} className="px-4">
        {/* Equal side tracks keep the pill centred; each is at least its content. */}
        <View className="h-11 flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center">
            <Pressable accessibilityRole="link" accessibilityLabel="Settings" onPress={() => router.push("/settings" as Href)} className="size-[34px] items-center justify-center rounded-full bg-secondary active:scale-[0.96]" style={{ zIndex: 1 }}>
              <Icon icon={UserRound} size={20} tone="foreground-secondary" strokeWidth={1.5} />
            </Pressable>
            {/* Starts under the avatar so the avatar sits on the pill's left end (spec §11 M6). Past days show no streak. */}
            {!!streak && d === today && (
              <View accessible accessibilityLabel={`${streak}-day streak`} className="-ml-[19px] h-[27px] flex-row items-center gap-2 rounded-full bg-foreground/[0.045] pl-6 pr-2.5">
                <StreakFlame height={15} />
                <Text className="font-numeric text-[13px] font-bold leading-none tabular-nums">{streak}</Text>
              </View>
            )}
          </View>
          <DateSwitcher mode="day" narrow />
          <View className="flex-1 flex-row items-center justify-end">{right}</View>
        </View>
        <Animated.View style={[row, { position: "absolute", left: 0, right: 0, top: HEADER_ROW, height: RING_ROW, flexDirection: "row", paddingHorizontal: 16 }]}>
          {RING_ORDER.map(({ key, label }) => {
            const ring = rings?.[key];
            const value = ring?.value ?? null;
            return (
              <View key={key} className="flex-1 items-center">
                <Pressable accessibilityRole="link" accessibilityLabel={ringLabel(key, label, value)} onPress={() => router.push((ring?.href ?? `/${key}`) as Href)} className="h-10 flex-row items-center justify-center gap-2 rounded-full px-2 active:scale-[0.96]">
                  <MiniRing variant={key} value={value} />
                  {/* 11 px, the reference app's ring-row label (spec §11 F5). */}
                  <Text className="text-[11px] font-bold uppercase leading-4 tracking-[0.1em]">{label}</Text>
                </Pressable>
              </View>
            );
          })}
        </Animated.View>
      </View>
    </HeaderFrame>
  );
}
