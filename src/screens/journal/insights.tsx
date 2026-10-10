// Journal Insights' own pieces (pulse's (app)/journal/insights/{page,Impacts}.tsx): the metric words, the outcome toggle,
// the impact list and the "Keep logging to unlock" group. The page is app/journal/insights.tsx.
import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { ImpactMetricKey, JournalInsightsVM } from "@/queries/types";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { Segmented } from "@/ui/Segmented";
import { cn } from "@/ui/cn";
import { DriverList } from "@/ui/metrics/DriverList";
import { openSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";

export const WORD: Record<ImpactMetricKey, string> = { recovery: "Recovery", hrv: "HRV", sleep: "sleep performance" };
export const TITLE: Record<ImpactMetricKey, string> = { recovery: "Recovery", hrv: "HRV", sleep: "Sleep" };
export const FOOTER = "Effects are differences in averages, not proof of cause. Change one habit at a time to see what it really does.";
const METRICS: { value: ImpactMetricKey; label: string }[] = [
  { value: "recovery", label: "Recovery" },
  { value: "hrv", label: "HRV" },
  { value: "sleep", label: "Sleep" },
];

export const parseMetric = (raw: string | string[] | undefined): ImpactMetricKey => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "hrv" || v === "sleep" ? v : "recovery";
};

/** Recovery / HRV / Sleep, kept in `m` by replacing the param (spec §7.12). */
export function MetricToggle({ metric }: { metric: ImpactMetricKey }) {
  return <Segmented label="Outcome" value={metric} options={METRICS} onChange={(v) => router.setParams({ m: v === "recovery" ? "" : v })} textClassName="text-[13px] font-bold uppercase tracking-[0.1em]" />;
}

/** The impact list; a row opens its detail sheet (/journal/impact). */
export function ImpactList({ vm }: { vm: JournalInsightsVM }) {
  const [selected, setSelected] = useState<string | undefined>();
  // The row stays ringed while its sheet is open; coming back clears it.
  useFocusEffect(useCallback(() => setSelected(undefined), []));
  return (
    <DriverList
      variant="impact"
      unit={vm.unit}
      data={{ value: vm.items, reason: null, provisional: false }}
      selectedKey={selected}
      onSelect={(k) => {
        setSelected(k);
        openSheet(`/journal/impact?${vm.metric === "recovery" ? "" : `m=${vm.metric}&`}behaviour=${encodeURIComponent(k)}`);
      }}
      outcome={WORD[vm.metric]}
    />
  );
}

/** The reference app's "Keep logging to unlock" group [latest-journal-insights-1]: one card row per behaviour. */
export function Unlock({ needsMore, word }: { needsMore: JournalInsightsVM["needsMore"]; word: string }) {
  const shadow = useCardStyle();
  return (
    <View accessibilityLabel="Keep logging to unlock" className="gap-3">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          Keep logging to unlock
        </Text>
        <Text className="max-w-[65ch] text-[15px] leading-[22px] text-muted-foreground">Log a behaviour as Yes on at least 5 days and No on at least 5 to see how it changes your next-day {word}.</Text>
      </View>
      <View className="gap-2">
        {needsMore.map((n) => {
          const have = Math.min(5, n.yes) + Math.min(5, n.no);
          return (
            <View key={n.key} className={cn(CARD_CLASS, "gap-2.5 p-4")} style={shadow}>
              <CardFill />
              <View className="flex-row items-baseline justify-between gap-3">
                <Text numberOfLines={1} className="min-w-0 shrink text-xs font-bold uppercase leading-4 tracking-[0.1em]">
                  {n.label}
                </Text>
                <Text className="shrink-0 font-numeric text-[13px] font-semibold leading-4 tabular-nums text-foreground-secondary">{have}/10</Text>
              </View>
              <View accessible accessibilityRole="progressbar" accessibilityLabel={`${n.label}: ${have} of 10 days logged`} accessibilityValue={{ min: 0, max: 10, now: have }} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <View className="h-full bg-optimal" style={{ width: `${(have / 10) * 100}%` }} />
              </View>
              <Text className="text-xs font-medium leading-4 tabular-nums text-muted-foreground">
                {Math.min(5, n.yes)} of 5 days with, {Math.min(5, n.no)} of 5 without
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
