import { i18n } from "@/i18n/config";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { agoShort, ago } from "@/lib/format";
import { BandIcon } from "../brand";
import { cn } from "../cn";
import { push } from "../navigate";
import { Text } from "../Text";
import { ring } from "../shadow";
import { useTheme } from "../theme";
import { useShellSync, type ShellSync } from "./ShellStatus";
import { Press } from "../Press";

/** The web's syncView (TopBar.tsx): the dot's colour and the spoken label for a sync state. */
function syncView(s: ShellSync, now: number): { dot: string; label: string } {
  const last = s.sync.lastSuccessAt;
  const rel = last ? ago(last, now) : null;
  if (s.connection === "auth_revoked" || s.sync.state === "error") return { dot: "bg-recovery-red", label: i18n.t("ui:sync.failed") };
  if (s.sync.state === "syncing") return { dot: "bg-coach", label: i18n.t("ui:sync.syncing") };
  if (s.sync.state === "stale") return { dot: "bg-warning", label: rel ? i18n.t("ui:sync.lastSync", { ago: rel }) : i18n.t("ui:sync.behind") };
  return { dot: "bg-optimal", label: rel ? i18n.t("ui:sync.syncedAgo", { ago: rel }) : i18n.t("ui:sync.synced") };
}

/** Re-renders once a minute, so "12m" stays true. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Sync freshness in the reference app's battery slot (the web's SyncStatus): "12m", the band icon and a status dot, at
 * the right of Home's top row and of the Health, Journal and More headers. The tap goes straight to
 * Settings › Data source (with Sync now). `hideText`: Home's top row drops the "12m" on
 * narrow phones (the band, its dot and the accessible name still carry it).
 */
export function SyncStatus({ hideText = false }: { hideText?: boolean }) {
  const s = useShellSync();
  const now = useMinute();
  const { c } = useTheme();
  if (!s) return null;
  const v = syncView(s, now);
  const short = s.sync.lastSuccessAt ? agoShort(s.sync.lastSuccessAt, now) : "";
  return (
    <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={v.label} onPress={() => push("/settings?s=source")} className="h-11 min-w-11 flex-row items-center justify-end gap-1.5 rounded-full pl-2 pr-0.5">
      {!hideText && <Text className="min-w-[3ch] whitespace-nowrap text-right font-numeric text-[15px] font-semibold leading-5 tabular-nums text-muted-foreground">{short}</Text>}
      {/* The band with its dot at the top right, ringed in the header's colour (the web's Band). */}
      <View className="ml-1 size-6 items-center justify-center">
        <BandIcon size={22} color={c.foreground} />
        {s.sync.state === "syncing" ? (
          <SyncRing color={c["strain-text"]} />
        ) : (
          <View className={cn("absolute -right-1.5 -top-1 size-2 rounded-full", v.dot)} style={{ boxShadow: ring(c["background-top"], { width: 2, inset: false }) }} />
        )}
      </View>
    </Press>
  );
}

/** The web's Band while a sync runs: a faint circle round the band with two opposite arcs turning every 1.4 s. */
function SyncRing({ color }: { color: string }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!reduce) turn.value = withRepeat(withTiming(360, { duration: 1400, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [reduce, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: -4, left: -4, width: 32, height: 32 }, spin]}>
      <Svg viewBox="0 0 36 36" width={32} height={32}>
        <Circle cx={18} cy={18} r={16} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={1.8} />
        {/* Two 25-unit arcs opposite each other on a 100.5-unit circumference. */}
        <Circle cx={18} cy={18} r={16} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="25 25.3" />
      </Svg>
    </Animated.View>
  );
}
