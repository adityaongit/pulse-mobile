// Heart rate `/health/heart-rate?d=`: the day's minutes (today up to now), resting heart rate and time in zones. Ported
// from pulse src/app/(app)/health/heart-rate/page.tsx, LiveHeartRate.tsx and loading.tsx. The web's poll of
// `/heart-rate` becomes `pullLiveHeartRate()` (live.ts) on a 60 s timer that runs while this screen is focused and
// today is shown; each pull that brought data re-reads the day from the store.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { dayLabel, MISSING } from "@/lib/format";
import { getHeartRate } from "@/queries/health";
import type { HeartRateVM } from "@/queries/types";
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
import { pullLiveHeartRate } from "./live";

const POLL_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;

/**
 * While this screen is focused and today is shown, pulls every minute (live.ts) and re-reads the day when a pull brought
 * data. A failed pull doubles the wait, up to 10 minutes. Backgrounded app: no pulls until it is active again. Returns
 * the time of the last pull, which "2 minutes ago" is measured from.
 */
function useLiveHeartRate(isToday: boolean, end: number, reload: () => void) {
  const [now, setNow] = useState(() => Date.now());
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useFocusEffect(
    useCallback(() => {
      if (!isToday) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let alive = true;
      let wait = POLL_MS;
      const poll = async () => {
        clearTimeout(timer);
        if (!alive || AppState.currentState !== "active" || Date.now() >= end) return; // the day is over: past days don't poll
        try {
          const r = await pullLiveHeartRate();
          if (r.connected && r.changed) reloadRef.current();
          wait = POLL_MS;
        } catch {
          wait = Math.min(wait * 2, MAX_BACKOFF_MS);
        }
        if (!alive) return;
        setNow(Date.now());
        timer = setTimeout(poll, wait);
      };
      const sub = AppState.addEventListener("change", (s) => {
        clearTimeout(timer);
        if (s === "active") void poll();
      });
      void poll();
      return () => {
        alive = false;
        clearTimeout(timer);
        sub.remove();
      };
    }, [isToday, end]),
  );
  return now;
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
  const { data, error, reload } = useDayScreen(getHeartRate);
  const now = useLiveHeartRate(data?.vm.isToday ?? false, data?.vm.end ?? 0, reload);
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
      dateSwitcher={{ mode: "day" }}
      info={HEART_RATE_INFO}
      hero={<HeartRateHero v={vm} now={now} />}
      primary={
        <SectionShell variant="card" title={vm.isToday ? "Today" : dayLabel(d, today)} info={{ title: "Daily heart rate", body: "Heartbeats per minute across the selected day. Gaps mean no heart rate reading was available." }}>
          <IntradayHrChart data={series} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="zones" variant="card" title="Time in zones">
          <ZoneBars variant="rows" data={vm.zones} note={vm.zoneNote} emptyCopy={vm.isToday ? "No heart-rate zones yet today." : "No heart-rate zones on this day."} />
        </SectionShell>,
      ]}
    />
  );
}

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
      primary={
        <SectionShell variant="card" title="Today">
          <IntradayHrChartSkeleton />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="zones" variant="card" title="Time in zones">
          <ZoneBarsSkeleton variant="rows" />
        </SectionShell>,
      ]}
    />
  );
}
