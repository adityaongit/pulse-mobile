import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useDerivedValue, type DerivedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { BAND_WORD, recoveryBand } from "@/lib/bands";
import { formatValue } from "@/lib/format";
import { groundColorAt } from "../Ground";
import { MiniRing, type MiniRingVariant } from "../metrics/MiniRing";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { DateSwitcher, useSelectedDay } from "./DateSwitcher";
import { HEADER_ROW, HeaderFrame } from "./Header";
import { useShellCalendar } from "./ShellStatus";
import { useNarrow } from "./layout";
import { UserAvatar } from "./UserAvatar";
import { SyncStatus } from "./SyncStatus";
import { cn } from "../cn";
import { push } from "../navigate";
import { Press } from "../Press";

export type HeaderRing = { value: number | null; href: string };
/** The day's three scores for the ring row (the dials' own view model), with their detail links. */
export type HeaderRings = Record<MiniRingVariant, HeaderRing>;

const RING_ORDER: MiniRingVariant[] = ["sleep", "recovery", "strain"];
/** The ring row is 40 px tall. */
const RING_ROW = 40;

function ringLabel(key: MiniRingVariant, label: string, value: number | null) {
  if (value === null) return i18n.t("ui:rings.noScore", { label });
  if (key === "recovery") return i18n.t("ui:rings.recovery", { value: formatValue("int", value), band: BAND_WORD[recoveryBand(value)].toLowerCase() });
  if (key === "sleep") return i18n.t("ui:rings.sleep", { value: formatValue("int", value) });
  return i18n.t("ui:rings.strain", { value: formatValue("int", value) });
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
 * that shrinks each dial into its ring is not built here: it measures and animates DOM boxes with a ScrollTimeline.
 */
export function HomeHeader({ rings, progress, right, streak }: { rings?: HeaderRings; progress: DerivedValue<number>; right?: React.ReactNode; streak?: number }) {
  const { t } = useTranslation("ui");
  const { today } = useShellCalendar();
  const [d] = useSelectedDay();
  const expanded = useDerivedValue(() => RING_ROW * progress.value);
  // The ring row is invisible until the dials have scrolled away, and takes no taps until then either.
  const row = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: 6 * (1 - progress.value) }], pointerEvents: progress.value > 0.5 ? "auto" : "none" }));
  const { c } = useTheme();
  const top = useSafeAreaInsets().top;
  // The web's --u scales the avatar and streak pill as one, stepping down on narrow phones (spec §11 M4, M6).
  const { lt356, lt380, lt400 } = useNarrow();
  const u = !lt400 ? 0.76 : !lt356 ? 0.7 : 0.64;
  const streakShown = !!streak && d === today;
  return (
    <HeaderFrame expanded={expanded} extra={RING_ROW}>
      {/* As tall as both rows, so the ring row is inside its parent's bounds (Android only delivers touches there); the empty part passes taps through. */}
      <View pointerEvents="box-none" style={{ height: HEADER_ROW + RING_ROW }} className="px-4">
        {/* Equal side tracks keep the pill centred. Below 400 px the gaps tighten; below 380 px, on days without the streak
            (past days, whose labels run to "Mon, Sep 28"), the sync text gives way so the pill still fits centred (the web's
            max-[380px] rule, spec §11 M4). */}
        <View className={cn("h-11 flex-row items-center", lt400 ? "gap-1" : "gap-2")}>
          <View className="flex-1 flex-row items-center">
            {/* The avatar: the photo, initials or outline person glyph (UserAvatar) on a disc of the page ground (its 3 px ring cuts the streak pill where the
                reference app's does), over the pill's left end (the web's Avatar and Streak). */}
            <Press
              activeScale={0.96}
              accessibilityRole="link"
              accessibilityLabel={t("home.settings")}
              onPress={() => push("/settings")}
              className="items-center justify-center rounded-full"
              style={{ zIndex: 1, width: 46 * u, height: 46 * u, padding: 3 * u, marginLeft: -3 * u, backgroundColor: groundColorAt(c, top + HEADER_ROW / 2) }}
            >
              <UserAvatar size={40 * u} />
            </Press>
            {/* Past days show no streak. */}
            {streakShown && (
              <View
                accessible
                accessibilityLabel={t("home.streak", { count: streak })}
                className="flex-row items-center rounded-full bg-foreground/[0.045]"
                style={{ marginLeft: -19 * u, height: 36 * u, gap: 10 * u, paddingLeft: 32 * u, paddingRight: 12 * u }}
              >
                <StreakFlame height={20 * u} />
                <Text className="font-numeric font-bold tabular-nums" style={{ fontSize: 17 * u, lineHeight: 17 * u }}>
                  {streak}
                </Text>
              </View>
            )}
          </View>
          <DateSwitcher mode="day" narrow />
          <View className="flex-1 flex-row items-center justify-end">{right ?? <SyncStatus hideText={lt380 && !streakShown} />}</View>
        </View>
        <Animated.View style={[row, { position: "absolute", left: 0, right: 0, top: HEADER_ROW, height: RING_ROW, flexDirection: "row", paddingHorizontal: 16 }]}>
          {RING_ORDER.map((key) => {
            const label = t(`rings.${key}Label`);
            const ring = rings?.[key];
            const value = ring?.value ?? null;
            return (
              <View key={key} className="flex-1 items-center">
                <Press activeScale={0.96} accessibilityRole="link" accessibilityLabel={ringLabel(key, label, value)} onPress={() => push(ring?.href ?? `/${key}`)} className={cn("h-10 flex-row items-center justify-center rounded-full px-2", lt380 ? "gap-1.5" : "gap-2")}>
                  <MiniRing variant={key} value={value} />
                  {/* 11 px, the reference app's ring-row label (spec §11 F5). One word: it never wraps; at 320 px "Recovery"
                      overflows its third by 5 px a side into the neighbours' slack, as the web's column outgrows 1fr. */}
                  <Text className="whitespace-nowrap text-[11px] font-bold uppercase leading-4 tracking-[0.1em]">{label}</Text>
                </Press>
              </View>
            );
          })}
        </Animated.View>
      </View>
    </HeaderFrame>
  );
}
