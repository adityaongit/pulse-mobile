import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { getJournalInsights } from "@/queries/journal";
import { LoadError } from "@/screens/journal/LoadError";
import { FOOTER, ImpactList, MetricToggle, parseMetric, TITLE, Unlock, WORD } from "@/screens/journal/insights";
import { useScreen } from "@/screens/useScreen";
import { DriverListSkeleton } from "@/ui/metrics/DriverList";
import { DetailShell } from "@/ui/shells/DetailShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";

/** Journal Insights `/journal/insights?m=` (spec §7.12, journey 7). */
export default function JournalInsights() {
  const { t } = useTranslation("ui");
  const metric = parseMetric(useLocalSearchParams<{ m?: string }>().m);
  const { data: vm, error, loading, reload } = useScreen((ctx) => getJournalInsights(metric, ctx), ["journalInsights", metric]);

  // The web's loading.tsx: the metric comes from `?m=` which loading UI cannot read, so its heading is a bar.
  if (!vm)
    return (
      <DetailShell
        loading={loading}
        title={t("app.behaviourInsights")}
        hero={
          error ? undefined : (
            <View accessibilityElementsHidden className="w-full gap-4">
              <View className="gap-2">
                <SkeletonText className="w-56" lh={28} fs={22} />
                <View>
                  <SkeletonText className="w-full" lh={22} fs={15} />
                  <SkeletonText className="w-full" lh={22} fs={15} />
                  <SkeletonText className="w-1/3" lh={22} fs={15} />
                </View>
                <Text className="text-xs font-medium leading-4 text-muted-foreground">{t("app.updatedDaily")}</Text>
              </View>
              <Skeleton className="h-11 w-[140px] rounded-lg" />
            </View>
          )
        }
        summary={error ? <LoadError retry={reload} /> : <DriverListSkeleton rows={6} />}
        footer={error ? undefined : <Text className="text-xs font-medium leading-4 text-muted-foreground">{FOOTER}</Text>}
      />
    );

  return (
    <DetailShell
      title={t("app.behaviourInsights")}
      hero={
        <View className="w-full gap-4">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">
              {t("app.impactHeading", { metric: TITLE[metric] })}
            </Text>
            <Text className="max-w-[65ch] text-[15px] leading-[22px] text-foreground-secondary">{t("app.impactIntro", { word: WORD[metric] })}</Text>
            <Text className="text-xs font-medium leading-4 text-muted-foreground">{t("app.updatedDaily")}</Text>
          </View>
          <MetricToggle metric={metric} />
        </View>
      }
      summary={<ImpactList vm={vm} />}
      footer={
        <>
          {vm.needsMore.length > 0 && <Unlock needsMore={vm.needsMore} word={WORD[metric]} />}
          <Text className="text-xs font-medium leading-4 text-muted-foreground">{FOOTER}</Text>
        </>
      }
    />
  );
}
