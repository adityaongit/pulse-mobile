// Shared pieces of the WHOOP activity flow (docs/workout-tracker/whoop-ui.md). Every colour is a theme token
// (global.css / src/ui/palette.ts): classes where NativeWind can style, useTheme().c where a component takes a value.
import { useEffect, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { Bike, Dumbbell, Flame, Footprints, PersonStanding, Zap, type LucideIcon } from "lucide-react-native";
import { DATA_COLORS, ZONE_COLOR } from "@/lib/bands";
import { cn } from "@/ui/cn";
import { Text } from "@/ui/Text";
import { i18n } from "@/i18n/config";
import { zonePosition } from "@/live/activityView";
import type { WorkoutType } from "@/live/workout";

export const ACTIVITY_GLYPH: Record<WorkoutType, LucideIcon> = {
  walk: Footprints,
  run: PersonStanding,
  cycle: Bike,
  strength: Dumbbell,
  hiit: Zap,
  other: Flame,
};

export const activityName = (type: WorkoutType) => i18n.t(`workouts:recorder.types.${type}`);

/** Letter-spaced caps, WHOOP's label face. */
export const CAPS = "font-bold uppercase tracking-[0.12em]";

/** Zone 0 in the muted grey, then Pulse's zone colours (lib/bands ZONE_COLOR), as the activity detail draws them. */
const zoneBg = (zone: number) => (zone === 0 ? "bg-muted-foreground" : DATA_COLORS[ZONE_COLOR[zone]].bg);
const zoneText = (zone: number) => (zone === 0 ? "text-muted-foreground" : DATA_COLORS[ZONE_COLOR[zone]].text);

/**
 * WHOOP's zone bar: six equal segments, dimmed except the current one, a dot at the bpm's place within its zone, and
 * "Zone 0" … "Zone 5" under them, the current one in the foreground colour and bold.
 */
export function ZoneBar({ bpm, maxHr, compact = false }: { bpm: number | null; maxHr: number; compact?: boolean }) {
  const at = bpm !== null ? zonePosition(bpm, maxHr) : null;
  return (
    <View accessibilityLabel={at ? i18n.t("workouts:live.zoneA11y", { zone: at.zone }) : undefined}>
      <View className="flex-row gap-[3px]">
        {[0, 1, 2, 3, 4, 5].map((z) => {
          const on = at?.zone === z;
          return (
            <View key={z} className="h-3.5 flex-1 justify-center">
              <View className={cn("h-1.5 rounded-full", on && z === 0 ? "bg-foreground" : zoneBg(z), !on && "opacity-35")} />
              {on && <View className="absolute size-3.5 -ml-[7px] rounded-full bg-foreground" style={{ left: `${at.at * 100}%` }} />}
            </View>
          );
        })}
      </View>
      <View className="mt-2 flex-row gap-[3px]">
        {[0, 1, 2, 3, 4, 5].map((z) => {
          const on = at?.zone === z;
          return (
            <Text key={z} className={cn("flex-1 text-center", compact ? "text-[10px]" : "text-[12px]", on ? "font-bold text-foreground" : cn(zoneText(z), "opacity-55"))}>
              {i18n.t("workouts:live.zone", { zone: z })}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

/** A pulse for the heart-rate bubble: one beat per heartbeat, or a calm breath without one. */
export function usePulse(bpm: number | null) {
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const beat = bpm ? Math.max(300, 60_000 / bpm) : 2400;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: beat * 0.3, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: beat * 0.7, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bpm, scale]);
  return scale;
}

/** "00:46:46": WHOOP's bar always shows hours. */
export function barClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

