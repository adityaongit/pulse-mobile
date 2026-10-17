// Heart rate `/health/heart-rate?d=`: the day's minutes (today up to now), resting heart rate and time in zones. Ported
// from pulse src/app/(app)/health/heart-rate/page.tsx, LiveHeartRate.tsx and loading.tsx. The web's poll of
// `/heart-rate` is the app's live ticker (src/state/liveHr.tsx, halo's): it reads Health Connect every minute, and when
// a read moved the samples (`liveVersion`) this screen re-reads today.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { dayLabel, MISSING } from "@/lib/format";
import { getHeartRate } from "@/queries/health";
import type { HeartRateVM } from "@/queries/types";
import { refreshLiveHr, useLiveHr } from "@/state/liveHr";
import { IntradayHrChart, IntradayHrChartSkeleton } from "@/ui/charts/IntradayHrChart";
import { ZoneBars, ZoneBarsSkeleton } from "@/ui/charts/ZoneBars";
import { cn } from "@/ui/cn";
import { CAPTION, LABEL, ValueUnit } from "@/ui/metrics/primitives";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useDayScreen } from "./day";
import { ErrorView } from "./ErrorView";
import { HEART_RATE_INFO } from "./info";
import { LastReading } from "./LastReading";
import { LiveHeartRateHero } from "./LiveHeartRateHero";
import { zoneBars } from "../_lib/view";

/**
 * Today: a live read as the screen comes into focus, and a re-read of the day whenever the ticker brought new samples.
 * Returns the time of the last live read (or of opening), which "2 minutes ago" is measured from.
 */
function useLiveDay(isToday: boolean, reload: () => void) {
  const { liveHr, liveVersion } = useLiveHr();
  const [opened] = useState(() => Date.now());
  const seen = useRef(liveVersion);
  useEffect(() => {
    if (!isToday || seen.current === liveVersion) return;
    seen.current = liveVersion;
    reload();
  }, [isToday, liveVersion, reload]);
  useFocusEffect(
    useCallback(() => {
      if (isToday) void refreshLiveHr();
    }, [isToday]),
  );
  return liveHr.updatedAt ?? opened;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The latest reading (today) or the day's average (a past day), over the day's range, average and resting HR. */
function HeartRateHero({ v, now }: { v: HeartRateVM; now: number }) {
  const bpms = v.points.flatMap((p) => (p.v === null ? [] : [p.v]));
  const avg = bpms.length ? Math.round(mean(bpms)) : null;
  const big = v.isToday ? (v.latest?.bpm ?? null) : avg;
  const stats = [
    { label: "Range", value: bpms.length ? `${Math.min(...bpms)}–${Math.max(...bpms)}` : MISSING, spoken: bpms.length ? `${Math.min(...bpms)} to ${Math.max(...bpms)}` : "no readings" },
    ...(v.isToday ? [{ label: "Average", value: avg === null ? MISSING : String(avg), spoken: avg === null ? "no readings" : String(avg) }] : []),
    { label: "Resting", value: v.restingHr === null ? MISSING : String(v.restingHr), spoken: v.restingHr === null ? "not yet" : String(v.restingHr) },
  ];
  return (
    <View className="w-full max-w-[360px] items-center gap-2 py-4">
      <ValueUnit value={big === null ? MISSING : String(big)} unit="bpm" className="font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.02em]" unitClassName="text-xl font-semibold leading-7 text-foreground-secondary" />
      {v.isToday ? (
        v.latest ? (
          <LastReading t={v.latest.t} now={now} />
        ) : (
          <Text className={CAPTION}>No readings yet today</Text>
        )
      ) : (
        <Text className={CAPTION}>{avg === null ? "No readings on this day" : "Day average"}</Text>
      )}
      <View className="mt-4 w-full flex-row gap-3">
        {stats.map((s) => (
          <View key={s.label} accessible accessibilityLabel={`${s.label}: ${s.spoken}${/\d/.test(s.spoken) ? " beats per minute" : ""}`} className="flex-1 items-center">
            <Text accessibilityElementsHidden className="font-numeric text-xl font-bold leading-6 tabular-nums">
              {s.value}
            </Text>
            <Text accessibilityElementsHidden className={cn(LABEL, "mt-1 text-muted-foreground")}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function HeartRateScreen() {
  const { data, error, reload } = useDayScreen("heartRate", getHeartRate);
  const now = useLiveDay(data?.vm.isToday ?? false, reload);
  const vm = data?.vm;
  // A minute without a reading is a gap, never a line across it. Shaped once per load, not per render.
  const series = useMemo(
    () =>
      vm && {
        value: {
          points: vm.points.map((p) => ({ t: p.t, bpm: p.v })),
          zones: vm.zoneBands.map((z) => ({ zone: z.zone, label: z.label, min: z.min, max: z.max ?? vm.maxHr })),
          now: vm.isToday && vm.latest ? vm.latest.t : undefined,
        },
        reason: null,
        provisional: false,
      },
    [vm],
  );
  if (!data || !vm || !series) return error ? <ErrorView detail retry={reload} /> : <HeartRateLoading />;
  const { d, today } = data;
  return (
    <DetailShell
      title="Heart rate"
      bodySkeleton={BODY_SKELETON}
      dateSwitcher={{ mode: "day" }}
      info={HEART_RATE_INFO}
      hero={
        <LiveHeartRateHero isToday={vm.isToday}>
          <HeartRateHero v={vm} now={now} />
        </LiveHeartRateHero>
      }
      primary={
        <SectionShell variant="card" title={vm.isToday ? "Today" : dayLabel(d, today)} info={{ title: "Daily heart rate", body: "Heartbeats per minute across the selected day. Gaps mean no heart rate reading was available." }}>
          <IntradayHrChart data={series} zoned />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="zones" variant="card" title="Time in zones">
          <ZoneBars variant="rows" data={zoneBars(vm.zones)} note={vm.zoneNote} emptyCopy={vm.isToday ? "No heart-rate zones yet today." : "No heart-rate zones on this day."} />
        </SectionShell>,
      ]}
    />
  );
}

const LOADING_PRIMARY = (
  <SectionShell variant="card" title="Today">
    <IntradayHrChartSkeleton />
  </SectionShell>
);

const LOADING_SECONDARY = [
  <SectionShell key="zones" variant="card" title="Time in zones">
    <ZoneBarsSkeleton variant="rows" />
  </SectionShell>,
];

/** Below the fold while a cold push slides in: the loading state's first sections. */
const BODY_SKELETON = (
  <>
    {LOADING_PRIMARY}
    <View className="gap-3">{LOADING_SECONDARY.slice(0, 2)}</View>
  </>
);

/** Heart rate loading: the date row, the reading with its three stats, the day's chart, then time in zones. */
function HeartRateLoading() {
  return (
    <DetailShell
      loading
      title="Heart rate"
      dateSwitcher={{ mode: "day" }}
      hero={
        <View accessibilityElementsHidden className="w-full max-w-[360px] items-center gap-2 py-4">
          <SkeletonText lh={64} fs={64} className="w-[100px]" />
          <SkeletonText className="w-28" />
          <View className="mt-4 w-full flex-row gap-3">
            {["Range", "Average", "Resting"].map((w) => (
              <View key={w} className="flex-1 items-center">
                <SkeletonText lh={24} fs={20} className="w-[42px]" />
                <Text className={cn(LABEL, "mt-1 text-muted-foreground")}>{w}</Text>
              </View>
            ))}
          </View>
        </View>
      }
      primary={LOADING_PRIMARY}
      bodySkeleton={BODY_SKELETON}
      secondary={LOADING_SECONDARY}
    />
  );
}
