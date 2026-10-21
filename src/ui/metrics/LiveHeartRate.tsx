import { useTranslation } from "react-i18next";
// Live heart rate over Bluetooth, the shared pieces (from halo src/screens/settings/liveHr.tsx, drawn with the kit):
// the beating heart, the "Live · Fitbit Air" pill, the 2-minute trace, and the Go live / Stop live buttons. They take
// plain props; the state is src/state/liveBle.tsx's.
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { Bluetooth, Heart, Square } from "lucide-react-native";
import { liveTrace } from "@/health/bleHr";
import type { LiveStatus } from "@/health/ble";
import { Button } from "../Button";
import { alpha } from "../color";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { Sparkline } from "./Sparkline";

const clampBpm = (bpm: number) => Math.min(220, Math.max(30, bpm || 60));

/**
 * A filled heart that beats at `bpm` while `live`: a 20 % swell over the first 30 % of each beat, back over the rest.
 * The phase runs on the UI thread and reads the current rate every frame, so a changing bpm changes the tempo without
 * restarting the beat. Still with reduced motion or when not live.
 */
export function BeatingHeart({ bpm, live, size = 22 }: { bpm: number; live: boolean; size?: number }) {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const period = useSharedValue(60_000 / clampBpm(bpm));
  const phase = useSharedValue(0);
  const beat = useFrameCallback((f) => {
    phase.set((phase.get() + (f.timeSincePreviousFrame ?? 0) / period.get()) % 1);
  }, false);
  useEffect(() => {
    period.set(60_000 / clampBpm(bpm));
  }, [bpm, period]);
  const on = live && !reduce;
  useEffect(() => {
    beat.setActive(on);
    if (!on) phase.set(0);
  }, [on, beat, phase]);
  const style = useAnimatedStyle(() => {
    const p = phase.get();
    // Out-quad up, in-out-quad down (halo's Animated.sequence).
    const up = p < 0.3 ? 1 - (1 - p / 0.3) ** 2 : null;
    const q = (p - 0.3) / 0.7;
    const down = q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;
    return { transform: [{ scale: 1 + 0.2 * (up ?? 1 - down) }] };
  });
  return (
    <Animated.View accessibilityElementsHidden style={style}>
      <Heart size={size} color={c["recovery-red"]} fill={c["recovery-red"]} strokeWidth={1.75} />
    </Animated.View>
  );
}

/** "● Live · Fitbit Air" in the heart red; "Reconnecting…" muted while the link is being rebuilt. */
export function LivePill({ name, lost = false, className }: { name: string | null; lost?: boolean; className?: string }) {
  const { c } = useTheme();
  const { t } = useTranslation("ui");
  const tint = lost ? c["muted-foreground"] : c["recovery-red-text"];
  return (
    <View
      accessible
      accessibilityLabel={lost ? t("live.reconnectingAria") : name ? t("live.liveFrom", { name }) : t("live.liveFromBand")}
      className={cn("h-6 max-w-full flex-row items-center gap-1.5 self-start rounded-full px-2.5", className)}
      style={{ backgroundColor: alpha(tint, 0.14) }}
    >
      <View className="size-1.5 rounded-full" style={{ backgroundColor: tint }} />
      <Text numberOfLines={1} className="shrink text-xs font-bold uppercase leading-4 tracking-[0.1em]" style={{ color: tint }}>
        {lost ? t("live.reconnecting") : t("live.pill", { name: name ?? t("live.band") })}
      </Text>
    </View>
  );
}

/**
 * The last 2 minutes of live bpm (2 s slots, ending at the newest beat, so a reconnecting link's trace holds still).
 * The path is drawn only when `history` changes: the provider flushes it at most every 250 ms. Keeps its height
 * while the first beats arrive.
 */
export function LiveTrace({ history, height = 88 }: { history: { t: number; bpm: number }[]; height?: number }) {
  const { c } = useTheme();
  const { t } = useTranslation("ui");
  const values = liveTrace(history, history.length ? history[history.length - 1].t : 0);
  return (
    <View style={{ height }} className="w-full" accessibilityLabel={t("live.traceAria")}>
      <Sparkline values={values} color={c["recovery-red"]} caption={t("live.traceCaption")} className="flex-1" />
    </View>
  );
}

/** "Go live", or what the link is doing while it works on it. */
export function GoLiveButton({ status, onPress, disabled, className }: { status: LiveStatus; onPress: () => void; disabled?: boolean; className?: string }) {
  const { c } = useTheme();
  const { t } = useTranslation("ui");
  const busy = status === "connecting" || status === "scanning" || status === "lost";
  const label = status === "connecting" ? t("live.connecting") : status === "scanning" ? t("live.searching") : status === "lost" ? t("live.reconnecting") : t("live.goLive");
  return (
    <Button onPress={onPress} disabled={disabled} className={className} accessibilityLabel={t("live.buttonAria", { label })}>
      {busy ? <ActivityIndicator size="small" color={c["primary-foreground"]} /> : <Icon icon={Bluetooth} size={16} tone="primary-foreground" strokeWidth={2.25} />}
      <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-primary-foreground">{label}</Text>
    </Button>
  );
}

/** Stops live heart rate now; it stays off (even after a restart) until the next Go live. */
export function StopLiveButton({ onPress, className }: { onPress: () => void; className?: string }) {
  const { t } = useTranslation("ui");
  return (
    <Button variant="outline" haptic onPress={onPress} className={className} accessibilityLabel={t("live.stopAria")}>
      <Icon icon={Square} size={12} tone="recovery-red-text" strokeWidth={2} />
      <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-recovery-red-text">{t("live.stop")}</Text>
    </Button>
  );
}
