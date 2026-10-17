// Heart rate's hero while the band shares heart rate over Bluetooth (from halo src/screens/health/HeartRate.tsx,
// `LiveHero` and the hero's Go live button). Today, while live or reconnecting, the live section takes the hero: the
// band's bpm with a beating heart, the "Live · Fitbit Air" pill, the last 2 minutes and the live RMSSD. Otherwise the
// day's hero stays, with "Go live" under it today, which opens Settings › Live heart rate to find the band.
// Live readings are display-only; the chart and zones below stay Health Connect's.
import type { ReactNode } from "react";
import { View } from "react-native";
import { MISSING } from "@/lib/format";
import { useLiveBle, useLiveBleControl } from "@/state/liveBle";
import { BeatingHeart, GoLiveButton, LivePill, LiveTrace, StopLiveButton } from "@/ui/metrics/LiveHeartRate";
import { CAPTION, ValueUnit } from "@/ui/metrics/primitives";
import { push } from "@/ui/navigate";
import { Text } from "@/ui/Text";

/** Settings › Live heart rate, scanning on arrival (the go-live flow). */
export const GO_LIVE_HREF = "/settings?s=live&go=1";

/** "HRV 42 ms · RMSSD, last minute", "HRV: measuring…" while too few clean beats, or null without RR. */
function rmssdLine(rmssd: number | null, rrCount: number): string | null {
  if (rmssd !== null) return `HRV ${Math.round(rmssd)} ms · RMSSD, last minute`;
  return rrCount ? "HRV: measuring…" : null;
}

/** The live section. It reads the per-beat data itself, so only it re-renders with each flush (≤ 4 a second). */
function LiveHero() {
  const live = useLiveBle();
  const lost = live.status !== "live";
  const bpm = live.bpm;
  const hrv = rmssdLine(live.rmssd, live.rrMs.length);
  return (
    <View className="w-full max-w-[360px] items-center gap-3 py-4">
      <View
        accessible
        accessibilityLabel={`${lost ? "Reconnecting. Last live reading" : "Live heart rate"} ${bpm ?? "unknown"} beats per minute${live.device?.name ? ` from ${live.device.name}` : ""}`}
        className="flex-row items-center gap-3"
      >
        <BeatingHeart bpm={bpm ?? 60} live={!lost} size={30} />
        <ValueUnit
          value={bpm === null ? MISSING : String(bpm)}
          unit="bpm"
          className="font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.02em]"
          unitClassName="text-xl font-semibold leading-7 text-foreground-secondary"
        />
      </View>
      <LivePill name={live.device?.name ?? null} lost={lost} className="self-center" />
      {live.contact === false && <Text className="text-[13px] font-medium leading-[18px] text-recovery-red-text">No skin contact: wear the band snug.</Text>}
      <LiveTrace history={live.history} />
      {!!hrv && <Text className={CAPTION}>{hrv}</Text>}
      <StopLiveButton onPress={() => void live.disconnect()} className="mt-1" />
    </View>
  );
}

/** Today and live: the live section. Otherwise `children` (the day's hero), with Go live under it today. */
export function LiveHeartRateHero({ isToday, children }: { isToday: boolean; children: ReactNode }) {
  const { status } = useLiveBleControl();
  if (isToday && (status === "live" || status === "lost")) return <LiveHero />;
  return (
    <View className="w-full items-center">
      {children}
      {isToday && <GoLiveButton status={status} onPress={() => push(GO_LIVE_HREF)} />}
    </View>
  );
}
