// The Trends metric picker (web: trends/MetricPage.tsx + parts.tsx MetricPicker). One card row names the section and
// metric on show; a tap opens a bottom sheet of the sections, the current one open, its metrics as wrapping chips (one
// section at a time, so the sheet stays about a screen tall). On the phone the sheet is a route (/trends-metric); a choice
// goes back to /trends with the new `metric`, keeping `r`.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { groupLabel, type GroupKey } from "@/lib/metricLabels";
import { ChevronDown, ChevronsUpDown } from "lucide-react-native";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { TaskPage } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { TREND_GROUPS, TREND_METRICS, type TrendMetricKey } from "@/queries/trends";
import { CardButton, Turn } from "./parts";
import { Press } from "@/ui/Press";
import { push } from "@/ui/navigate";

const GROUPS = TREND_GROUPS.map((g) => ({ group: g, metrics: TREND_METRICS.filter((m) => m.group === g).map(({ key, label }) => ({ key, label })) }));
const SHOWN = GROUPS.flatMap((g) => g.metrics.map((m) => ({ ...m, group: g.group })));
const metricOf = (current?: string) => SHOWN.find((m) => m.key === current) ?? SHOWN[0];

/** The picker's row: the section over the metric's name, and the up-down chevrons. */
export function MetricPicker({ current, r }: { current?: TrendMetricKey; r?: string }) {
  const { t } = useTranslation("trends");
  const metric = metricOf(current);
  return (
    <CardButton
      accessibilityLabel={t("chooseMetric", { group: groupLabel(metric.group as GroupKey), label: metric.label })}
      onPress={() => push(`/trends-metric?current=${metric.key}${r ? `&r=${r}` : ""}`)}
      className="min-h-14 w-full flex-row items-center gap-3 px-4 py-2"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-medium leading-4 text-muted-foreground">{groupLabel(metric.group as GroupKey)}</Text>
        <Text numberOfLines={1} className="text-[15px] font-semibold leading-[22px]">{metric.label}</Text>
      </View>
      <Icon icon={ChevronsUpDown} size={20} tone="muted-foreground" strokeWidth={1.75} />
    </CardButton>
  );
}

/** The sheet's content (route /trends-metric). */
export function MetricPageBody({ current, r }: { current?: string; r?: string }) {
  const { t } = useTranslation("trends");
  const metric = metricOf(current);
  const [expanded, setExpanded] = useState<string>(metric.group);
  const choose = (key: TrendMetricKey) => router.dismissTo({ pathname: "/trends", params: { metric: key, ...(r ? { r } : null) } });
  return (
    <TaskPage title={t("metricTitle")}>
      {/* The web's list has its own `px-4` inside the drawer's `px-4`: 32 px of side margin. Its `pb-[max(env(safe-area-inset-bottom),16px)]` is the sheet's own bottom padding here (TaskPage). */}
      <View className="px-4">
        {GROUPS.map(({ group, metrics }, i) => {
          const on = group === expanded;
          return (
            <View key={group} className={cn("border-b border-border", i === GROUPS.length - 1 && "border-b-0")}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => (!on && haptic.toggle(true), setExpanded(group))} className="min-h-[52px] flex-row items-center justify-between gap-3 rounded-lg">
                <Text className="text-[15px] font-semibold leading-[22px]">{groupLabel(group as GroupKey)}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-[13px] font-medium text-muted-foreground">{metrics.length}</Text>
                  <Turn on={on}>
                    <Icon icon={ChevronDown} size={20} tone="muted-foreground" strokeWidth={1.75} />
                  </Turn>
                </View>
              </Pressable>
              {on && (
                <View className="flex-row flex-wrap gap-2 pb-4">
                  {metrics.map((m) => {
                    const current = m.key === metric.key;
                    return (
                      <Press activeScale={0.96} key={m.key} accessibilityRole="button" accessibilityState={{ selected: current }} onPress={() => (haptic.tap(), choose(m.key))} className={cn("h-10 flex-row items-center rounded-full px-4", current ? "bg-foreground" : "bg-muted")}>
                        <Text className={cn("text-[14px] font-medium leading-5", current ? "text-background" : "text-foreground")}>{m.label}</Text>
                      </Press>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </TaskPage>
  );
}
