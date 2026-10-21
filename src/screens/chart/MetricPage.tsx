// The explorer's metric and compare pickers (halo src/screens/chart/MetricPage.tsx) as our route sheet
// `/chart-metric?for=metric|compare&metric=&r=&d=&compare=`: Trends' metric sheet (one section open at a time, its
// metrics as wrapping chips) over the explorer's catalogue. A choice goes back to /chart with the new params.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { groupLabel, type GroupKey } from "@/lib/metricLabels";
import { ChevronDown } from "lucide-react-native";
import { CHART_GROUPS, chartDef, DAY_VIEW } from "@/queries/chart";
import { Turn } from "@/screens/trends/parts";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { TaskPage } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { DAY_COMPARE, NO_COMPARE, parseRange } from "./model";

type Group = { group: string; metrics: { key: string; label: string }[] };

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press activeScale={0.96} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => (haptic.tap(), onPress())} className={cn("h-10 flex-row items-center rounded-full px-4", on ? "bg-foreground" : "bg-muted")}>
      <Text className={cn("text-[14px] font-medium leading-5", on ? "text-background" : "text-foreground")}>{label}</Text>
    </Press>
  );
}

export function ChartMetricPage() {
  const { t } = useTranslation("trends");
  const p = useLocalSearchParams<{ for?: string; metric?: string; r?: string; d?: string; compare?: string }>();
  const def = chartDef(p.metric);
  const range = parseRange(p.r, !!def?.day);
  const view = range === "day" ? (def?.day ?? null) : null;
  const isCompare = p.for === "compare";
  const groups: Group[] = isCompare
    ? view
      ? [{ group: "sameDay", metrics: DAY_COMPARE.filter((x) => x.view !== view).map((x) => ({ key: x.key, label: DAY_VIEW[x.view].label })) }]
      : CHART_GROUPS.map((g) => ({ group: g.group as string, metrics: g.metrics.filter((m) => m.key !== def?.key).map(({ key, label }) => ({ key, label })) })).filter((g) => g.metrics.length)
    : CHART_GROUPS.map((g) => ({ group: g.group as string, metrics: g.metrics.map(({ key, label }) => ({ key, label })) }));
  const current = isCompare ? (p.compare ?? null) : (def?.key ?? null);
  const [open, setOpen] = useState(groups.find((g) => g.metrics.some((m) => m.key === current))?.group ?? groups[0]?.group ?? "");

  // Back to the explorer with every param it keeps; an empty one is cleared.
  const go = (next: { metric?: string; r?: string; compare?: string | null }) => {
    const out = { metric: p.metric ?? "", r: p.r ?? "", d: p.d ?? "", compare: p.compare ?? "", ...next };
    router.dismissTo({ pathname: "/chart", params: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v ?? ""])) });
  };
  // A metric without the current day view falls back to its month; a compare on the new metric itself, or a day's
  // "none", was for the old metric and is cleared. Clearing a day's compare remembers "none" (its default would return).
  const pickMetric = (key: string) => go({ metric: key, r: range === "day" && !chartDef(key)?.day ? "m" : range, ...(p.compare === key || p.compare === NO_COMPARE ? { compare: null } : {}) });
  const pickCompare = (key: string | null) => go({ compare: key ?? (view ? NO_COMPARE : null) });

  return (
    <TaskPage title={isCompare ? t("compareWith") : t("metricTitle")}>
      <View className="px-4">
        {isCompare && (
          <View className="flex-row pb-3">
            <Chip label={t("none")} on={current === null || current === NO_COMPARE} onPress={() => pickCompare(null)} />
          </View>
        )}
        {groups.map(({ group, metrics }, i) => {
          const on = group === open || groups.length === 1;
          return (
            <View key={group} className={cn("border-b border-border", i === groups.length - 1 && "border-b-0")}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => (!on && haptic.toggle(true), setOpen(group))} className="min-h-[52px] flex-row items-center justify-between gap-3">
                <Text className="text-[15px] font-semibold leading-[22px]">{group === "sameDay" ? t("sameDay") : groupLabel(group as GroupKey)}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-[13px] font-medium text-muted-foreground">{metrics.length}</Text>
                  <Turn on={on}>
                    <Icon icon={ChevronDown} size={20} tone="muted-foreground" strokeWidth={1.75} />
                  </Turn>
                </View>
              </Pressable>
              {on && (
                <View className="flex-row flex-wrap gap-2 pb-4">
                  {metrics.map((m) => (
                    <Chip key={m.key} label={m.label} on={m.key === current} onPress={() => (isCompare ? pickCompare(m.key) : pickMetric(m.key))} />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </TaskPage>
  );
}
