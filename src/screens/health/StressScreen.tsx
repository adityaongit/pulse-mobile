// Stress Monitor `/health/stress` for `d` (spec §7.9). Ported from pulse src/app/(app)/health/stress/page.tsx and
// loading.tsx (the skeleton shows while the query runs).
import { View } from "react-native";
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { clock, dayLabel, durationWords, hmm } from "@/lib/format";
import { getStress } from "@/queries/health";
import type { StressVM } from "@/queries/types";
import { StressChart, StressChartSkeleton } from "@/ui/charts/StressChart";
import { TrendChart, TrendChartSkeleton } from "@/ui/charts/TrendChart";
import { cn } from "@/ui/cn";
import { InsightCard, InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { ScoreDial, ScoreDialSkeleton } from "@/ui/metrics/ScoreDial";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { stressSeries } from "../_lib/view";
import { useDayScreen } from "./day";
import { ErrorView } from "./ErrorView";
import { BreatheCard } from "../breathe/BreatheScreen";
import { STRESS_INFO } from "./info";
import { BAR_CORNERS } from "@/ui/radius";

const LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em]";

const LEVEL_KEYS = [
  { key: "lowMin", level: "low", bar: "bg-stress-low", text: "text-stress-low-text" },
  { key: "mediumMin", level: "medium", bar: "bg-stress-medium", text: "text-stress-medium-text" },
  { key: "highMin", level: "high", bar: "bg-stress-high", text: "text-stress-high-text" },
] as const;

function LevelBar({ m, className }: { m: { lowMin: number; mediumMin: number; highMin: number }; className: string }) {
  return (
    <View accessibilityElementsHidden className={cn("flex-row gap-0.5 overflow-hidden", BAR_CORNERS, className)}>
      {LEVEL_KEYS.map((k) => m[k.key] > 0 && <View key={k.key} className={k.bar} style={{ flexGrow: m[k.key], flexBasis: 0 }} />)}
    </View>
  );
}

function typicalLine(l: NonNullable<StressVM["levels"]["value"]>) {
  if (l.typicalDeltaMin === null) return null;
  const m = Math.round(l.typicalDeltaMin);
  const delta = Math.abs(m) < 1 ? i18n.t("health:stress.typicalSame") : i18n.t(m > 0 ? "health:stress.typicalMore" : "health:stress.typicalLess", { duration: durationWords(Math.abs(m)) });
  return i18n.t("health:stress.typicalLine", { weekday: l.weekday, delta });
}

function TotalDay({ l, day }: { l: NonNullable<StressVM["levels"]["value"]>; day: string }) {
  const { t } = useTranslation("health");
  const total = l.lowMin + l.mediumMin + l.highMin;
  if (!total) return <EmptyState body={t("stress.empty")} />;
  const line = typicalLine(l);
  return (
    <View className="gap-4">
      <Text className={LABEL}>
        {l.typical ? (
          <Trans t={t} i18nKey="stress.dayStressTypical" values={{ day, weekday: l.weekday }} components={{ muted: <Text className="text-muted-foreground" /> }} />
        ) : (
          t("stress.dayStress", { day })
        )}
      </Text>
      <View className="gap-1.5">
        <LevelBar m={l} className="h-3" />
        {l.typical && <LevelBar m={l.typical} className="h-2 opacity-50" />}
      </View>
      <View className="flex-row gap-3">
        {LEVEL_KEYS.map((k) => (
          <View key={k.key} accessible accessibilityLabel={
              l.typical
                ? t("stress.levelAriaTypical", { word: i18n.t(`common:stressLevel.${k.level}`), duration: durationWords(Math.round(l[k.key])), typical: durationWords(Math.round(l.typical[k.key])) })
                : t("stress.levelAria", { word: i18n.t(`common:stressLevel.${k.level}`), duration: durationWords(Math.round(l[k.key])) })
            } className="flex-1">
            <Text accessibilityElementsHidden className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", k.text)}>
              {hmm(l[k.key])}
            </Text>
            <Text accessibilityElementsHidden className={cn(LABEL, "mt-1")}>
              {i18n.t(`common:stressLevel.${k.level}`)}
            </Text>
            {l.typical && (
              <Text accessibilityElementsHidden className="mt-0.5 font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground">
                {t("stress.typicalValue", { value: hmm(l.typical[k.key]) })}
              </Text>
            )}
          </View>
        ))}
      </View>
      {!!line && <Text className="text-xs font-medium leading-4 text-muted-foreground">{line}</Text>}
    </View>
  );
}

export function StressScreen() {
  const { t } = useTranslation("health");
  const { data, error, reload } = useDayScreen("stress", getStress);
  if (!data) return error ? <ErrorView detail retry={reload} /> : <StressLoading />;
  const { vm, d, today, timeZone } = data;
  const g = vm.gauge;
  const dayWord = vm.isToday ? t("today", { ns: "common" }) : dayLabel(d, today);

  return (
    <DetailShell
      title="Stress Monitor"
      bodySkeleton={bodySkeleton()}
      dateSwitcher={{ mode: "day" }}
      info={STRESS_INFO}
      hero={
        <View className="items-center gap-2">
          <ScoreDial
            variant="gauge"
            size="lg"
            value={g.value?.value ?? null}
            reason={g.reason}
            provisional={g.provisional}
            caption={g.value ? (g.value.dayAverage || !vm.isToday ? t("stress.dayAverage") : g.value.at ? t("stress.lastUpdated", { time: clock(g.value.at, timeZone) }) : undefined) : undefined}
          />
          {g.reason === "no_data" && <Text className="max-w-72 text-center text-xs font-medium leading-4 text-muted-foreground">{t("stress.empty")}</Text>}
        </View>
      }
      insight={vm.insight ? <InsightCard body={vm.insight} /> : undefined}
      primary={
        <SectionShell variant="card" title={dayWord} info={{ title: t("stress.chartInfoTitle"), body: t("stress.chartInfoBody") }}>
          <StressChart variant="full" data={stressSeries(vm.chart)} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="levels" variant="card" title={t("title.totalDay")} info={{ title: t("stress.levelsInfoTitle"), body: t("stress.levelsInfoBody") }}>
          <MetricState metric={vm.levels} skeleton={<Skeleton className="h-24 w-full" />} renderReason={() => <EmptyState body={t("stress.empty")} />}>
            {(l) => <TotalDay l={l} day={dayWord} />}
          </MetricState>
        </SectionShell>,
        <BreatheCard key="breathe" />,
        <SectionShell key="trend" variant="card" title={t("title.trend30")} info={{ title: t("stress.trendInfoTitle"), body: t("stress.trendInfoBody") }}>
          <TrendChart label={t("stress.trendLabel")} data={{ value: vm.trend.points.map((p) => ({ date: p.day, value: p.value })), reason: null, provisional: false }} format="int" colorBy="stress" direction="down" fixedRange="m" />
        </SectionShell>,
      ]}
    />
  );
}

const loadingPrimary = () => (
  <SectionShell variant="card" title={i18n.t("common:today")}>
    <StressChartSkeleton variant="full" />
  </SectionShell>
);

const loadingSecondary = () => [
  <SectionShell key="levels" variant="card" title={i18n.t("health:title.totalDay")}>
    <View accessibilityElementsHidden className="gap-4">
      <SkeletonText className="w-48" />
      <View className="gap-1.5">
        <Skeleton className="h-3 rounded-sm" />
        <Skeleton className="h-2 rounded-sm" />
      </View>
      <View className="flex-row gap-3">
        {LEVEL_KEYS.map((k) => (
          <View key={k.level} className="flex-1">
            <SkeletonText lh={24} fs={20} className="w-[42px]" />
            <Text className={cn(LABEL, "mt-1")}>{i18n.t(`common:stressLevel.${k.level}`)}</Text>
            <SkeletonText className="mt-0.5 w-20" />
          </View>
        ))}
      </View>
      <SkeletonText className="w-56" />
    </View>
  </SectionShell>,
  <SectionShell key="trend" variant="card" title={i18n.t("health:title.trend30")}>
    <TrendChartSkeleton />
  </SectionShell>,
];

/** Below the fold while a cold push slides in: the loading state's first sections. */
const bodySkeleton = () => (
  <>
    {loadingPrimary()}
    <View className="gap-3">{loadingSecondary().slice(0, 2)}</View>
  </>
);

/**
 * Stress Monitor loading (spec §7.9, §5.19): the date row, the gauge with the insight, the day's chart, then Total day
 * and the 30-day trend.
 */
function StressLoading() {
  return (
    <DetailShell
      loading
      title="Stress Monitor"
      dateSwitcher={{ mode: "day" }}
      hero={<ScoreDialSkeleton variant="gauge" size="lg" />}
      insight={<InsightCardSkeleton />}
      primary={loadingPrimary()}
      bodySkeleton={bodySkeleton()}
      secondary={loadingSecondary()}
    />
  );
}
