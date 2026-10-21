// Journal Insights' own pieces (pulse's (app)/journal/insights/{page,Impacts}.tsx): the metric words, the outcome toggle,
// the impact list and the "Keep logging to unlock" group. The page is app/journal/insights.tsx.
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { ImpactMetricKey, JournalInsightsVM } from "@/queries/types";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { haptic } from "@/ui/haptics";
import { cn } from "@/ui/cn";
import { SEGMENT, SEGMENT_ON } from "@/ui/Segmented";
import { DriverList } from "@/ui/metrics/DriverList";
import { Text } from "@/ui/Text";
import { push } from "@/ui/navigate";
import { BAR_CORNERS } from "@/ui/radius";

const METRIC_KEYS = ["recovery", "hrv", "sleep"] as const;
/** `{ recovery, hrv, sleep }` as getters of one `journal` key family: the text resolves when it is read. */
const byMetric = (family: "metricWord" | "metricTitle") => {
  const o = {} as Record<ImpactMetricKey, string>;
  for (const k of METRIC_KEYS) Object.defineProperty(o, k, { get: () => i18n.t(`journal:${family}.${k}`), enumerable: true });
  return o;
};
/** The outcome in a sentence ("next-day sleep performance") and as a title ("Sleep impact analysis"). */
export const WORD = byMetric("metricWord");
export const TITLE = byMetric("metricTitle");

function FooterText() {
  const { t } = useTranslation("journal");
  return <>{t("insights.footer")}</>;
}
/** The footnote under the impact lists. An element, so `{FOOTER}` reads the language when it renders. */
export const FOOTER = <FooterText />;

export const parseMetric = (raw: string | string[] | undefined): ImpactMetricKey => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "hrv" || v === "sleep" ? v : "recovery";
};

/**
 * Recovery / HRV / Sleep, kept in `m` by replacing the param (spec §7.12). The web's ToggleGroup is w-fit, and with spacing 0
 * its items get px-2 (toggle-group.tsx `group-data-[spacing=0]:px-2` beats the page's px-3), so the kit's Segmented (px-3, for
 * the W / M / 6M control) is 2 x 4 px too wide per segment here.
 */
export function MetricToggle({ metric }: { metric: ImpactMetricKey }) {
  const { t } = useTranslation("journal");
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t("insights.outcome")} className="flex-row gap-0.5 self-start rounded-lg bg-muted p-0.5">
      {METRIC_KEYS.map((value) => {
        const on = value === metric;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              haptic.select();
              router.setParams({ m: value === "recovery" ? "" : value });
            }}
            className={cn(SEGMENT, "min-w-11 px-2", on && SEGMENT_ON)}
          >
            <Text className={cn("text-[13px] font-bold uppercase tracking-[0.1em]", on ? "text-foreground" : "text-muted-foreground")}>{t(`metricTitle.${value}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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
        push(`/journal/impact?${vm.metric === "recovery" ? "" : `m=${vm.metric}&`}behaviour=${encodeURIComponent(k)}`);
      }}
      outcome={WORD[vm.metric]}
    />
  );
}

/** The reference app's "Keep logging to unlock" group [latest-journal-insights-1]: one card row per behaviour. */
export function Unlock({ needsMore, word }: { needsMore: JournalInsightsVM["needsMore"]; word: string }) {
  const { t } = useTranslation("journal");
  const shadow = useCardStyle();
  return (
    <View accessibilityLabel={t("insights.unlockTitle")} className="gap-3">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          {t("insights.unlockTitle")}
        </Text>
        <Text className="max-w-[65ch] text-[15px] leading-[22px] text-muted-foreground">{t("insights.unlockBody", { word })}</Text>
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
              <View accessible accessibilityRole="progressbar" accessibilityLabel={t("insights.progress", { label: n.label, have })} accessibilityValue={{ min: 0, max: 10, now: have }} className={cn("h-1.5 overflow-hidden bg-muted", BAR_CORNERS)}>
                <View className="h-full bg-optimal" style={{ width: `${(have / 10) * 100}%` }} />
              </View>
              <Text className="text-xs font-medium leading-4 tabular-nums text-muted-foreground">
                {t("insights.split", { yes: Math.min(5, n.yes), no: Math.min(5, n.no) })}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
