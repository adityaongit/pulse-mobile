// A metric's own screen `/metric/[key]?d=&r=` (web: (app)/metric/[key]/page.tsx, loading.tsx; spec §11 MD1): the day, its
// history, then the metric's own sections.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { deltaTone } from "@/lib/bands";
import { DAY, formatDay, formatValue, unitLabel } from "@/lib/format";
import { parseRange, RANGES, type TrendRange } from "@/lib/url";
import { getMetricDetail, isDetailKey, isLevelMetric, type DetailKey, type MetricDetailVM } from "@/queries/metric";
import { cardOf, Divided, HistoryChart, HistoryChartSkeleton, LoadError, period } from "@/screens/trends/parts";
import { useScreen } from "@/screens/useScreen";
import { CAPTION, LABEL, mapMetric } from "@/screens/_lib/view";
import { cn } from "@/ui/cn";
import { KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { DetailShell } from "@/ui/shells/DetailShell";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { EmptyState } from "@/ui/shells/EmptyState";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useOptionalShellCalendar } from "@/ui/shells/ShellStatus";
import { SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { chartDef } from "@/queries/chart";
import { chartHref, type ChartRange } from "@/screens/chart/href";
import { RangeStatsCard } from "./RangeStats";
import { MetricSection } from "./sections";

/** History's stacks, bottom first; their colours come from `partColor`. */
const stackOf = (kind: "calories" | "distance"): readonly { key: string; label: string }[] =>
  kind === "calories"
    ? [{ key: "resting", label: i18n.t("trends:metricScreen.resting") }, { key: "active", label: i18n.t("trends:metricScreen.active") }]
    : [{ key: "everyday", label: i18n.t("trends:metricScreen.everyday") }, { key: "workouts", label: i18n.t("trends:metricScreen.workouts") }];

/** The chart's 365 points and each range's change, once per loaded view model. */
function shape(vm: MetricDetailVM) {
  // Rounded as the chip shows it, so 0.04 km reads "+0.04", not "0.00".
  const k = vm.format === "decimal2" ? 100 : vm.format === "decimal1" ? 10 : 1;
  const deltas = Object.fromEntries(
    RANGES.map((r) => [r, vm.ranges[r].average === null || vm.ranges[r].prior === null ? null : Math.round((vm.ranges[r].average! - vm.ranges[r].prior!) * k) / k]),
  ) as Record<TrendRange, number | null>;
  return { data: mapMetric(vm.history, (ps) => ps.map((p) => ({ date: p.day, value: p.value, provisional: p.provisional, parts: p.parts }))), deltas };
}

export default function MetricScreen() {
  const { t } = useTranslation("trends");
  const { key, r } = useLocalSearchParams<{ key: string; r?: string }>();
  const [d] = useSelectedDay();
  const range = parseRange(r);
  const timeZone = useOptionalShellCalendar()?.timeZone;
  const valid = isDetailKey(key);
  const { data, error, reload } = useScreen((ctx) => getMetricDetail(key as DetailKey, d, ctx), ["metric", key, d]);
  // A day change keeps the old view model on screen until the new one lands; another metric never shows the old one.
  const vm = data?.key === key ? data : undefined;
  const shaped = useMemo(() => (vm ? shape(vm) : undefined), [vm]);

  if (!valid) return <DetailShell title={t("metricScreen.title")} dateSwitcher={{ mode: "day" }} primary={<EmptyState body={t("metricScreen.noScreen")} />} />;
  if (error && !vm) return <LoadError title={t("metricScreen.title")} reload={reload} />;
  if (!vm || !shaped) return <Loading />;

  const empty = vm.value.value === null && vm.history.value === null;
  // The day's hourly view sits under the hero; every other section follows the history.
  const [first, ...rest] = vm.sections;
  const lead = first?.kind === "hourly" && !empty ? first : null;
  const more = lead ? rest : vm.sections;
  const stats = { ranges: vm.ranges, format: vm.format, unit: vm.unit, direction: vm.direction, total: vm.total };

  return (
    <DetailShell
      title={vm.label}
      bodySkeleton={<LoadingPrimary />}
      dateSwitcher={{ mode: "day" }}
      hero={<Hero vm={vm} />}
      summary={lead && <MetricSection s={lead} vm={vm} timeZone={timeZone} />}
      primary={
        empty ? (
          <SectionShell variant="card" {...cardOf("History", t("metricScreen.history"))}>
            <EmptyState
              body={
                vm.group === "nutrition"
                  ? t("metricScreen.noneLogged", { label: vm.label.toLowerCase() })
                  : t("metricScreen.noneHealthConnect", { label: vm.label.toLowerCase() })
              }
              action={vm.group === "nutrition" ? { label: t("metricScreen.openJournal"), href: "/journal" } : undefined}
            />
          </SectionShell>
        ) : (
          <View className="gap-3">
            <SectionShell variant="card" {...cardOf("History", t("metricScreen.history"))} action={chartDef(vm.key) ? { label: t("explore"), href: chartHref({ metric: vm.key, r: range as ChartRange, d }) } : undefined}>
              <HistoryChart
                key={vm.key}
                range={range}
                label={vm.label}
                unit={vm.unit}
                format={vm.format}
                colorBy="single"
                level={isLevelMetric(vm.key)}
                direction={vm.direction}
                data={shaped.data}
                deltas={shaped.deltas}
                series={vm.chart.stack ? stackOf(vm.chart.stack) : undefined}
                baseline={vm.chart.baseline}
              />
            </SectionShell>
            <RangeStatsCard {...stats} range={range} />
          </View>
        )
      }
      secondary={empty ? [] : more.map((s) => <MetricSection key={s.kind} s={s} vm={vm} timeZone={timeZone} />)}
      footer={
        <SectionShell variant="card" title={t("metricScreen.about", { label: vm.label.toLowerCase() })}>
          <View className="gap-2">
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{vm.about}</Text>
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{vm.source}</Text>
          </View>
        </SectionShell>
      }
    />
  );
}

const unitText = (unit?: string) => (unit ? (unit === "%" ? "%" : ` ${unitLabel(unit)}`) : "");

/** The day's value (a reading metric's latest reading) against its 30-day average. */
function Hero({ vm }: { vm: MetricDetailVM }) {
  const { t: tr } = useTranslation("trends");
  // The date switcher names the day; a reading from an earlier day says which.
  const when = vm.valueDay && vm.valueDay !== vm.day ? tr("metricScreen.latestReading", { day: formatDay(vm.valueDay, DAY.short) }) : null;
  return (
    <View className="w-full max-w-[360px] items-center gap-2 py-4">
      {!!when && <Text className={cn(LABEL, "text-center text-muted-foreground")}>{when}</Text>}
      <MetricState metric={vm.value} skeleton={null} renderReason={(r) => <ReasonPlaceholder reason={r} size="lg" className="py-3" />}>
        {(value) => {
          const avg = vm.average;
          const t = avg !== null ? deltaTone(vm.direction, value, avg, vm.sd) : null;
          const diff = avg !== null ? value - avg : null;
          return (
            <>
              <ValueUnit value={formatValue(vm.format, value)} unit={vm.unit} className="font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.02em]" unitClassName="text-xl font-semibold leading-7 text-foreground-secondary" />
              {/* A running total against whole days would always read "below": today shows the average alone. */}
              {t && diff !== null && !vm.soFar && (
                <StatusChip tone={t.tone === "good" ? "optimal" : t.tone === "bad" ? "warning" : "neutral"} delta={t.dir} className="mt-1 self-center">
                  {t.dir === "flat" ? tr("metricScreen.inLine") : tr(t.dir === "up" ? "metricScreen.above" : "metricScreen.below", { diff: `${formatValue(vm.format, Math.abs(diff))}${unitText(vm.unit)}` })}
                </StatusChip>
              )}
              <Text className={cn(CAPTION, "text-center")}>{avg === null ? tr("metricScreen.noAverage") : tr("metricScreen.average", { value: `${formatValue(vm.format, avg)}${unitText(vm.unit)}` })}</Text>
            </>
          );
        }}
      </MetricState>
    </View>
  );
}

function LoadingPrimary() {
  const { t } = useTranslation("trends");
  const last30 = period("m");
  return (
    <View accessibilityElementsHidden className="gap-3">
      <SectionShell variant="card" {...cardOf("History", t("metricScreen.history"))}>
        <HistoryChartSkeleton />
      </SectionShell>
      <SectionShell variant="card" {...cardOf(last30.infoId, last30.label)}>
        <Divided>
          {(["dailyAverage", "highest", "lowest", "daysWithData"] as const).map((l) => (
            <KeyStatRowSkeleton key={l} variant="row" label={t(`rangeStats.${l}`)} />
          ))}
        </Divided>
      </SectionShell>
    </View>
  );
}

/** Metric detail: the hero's label and value, the History card and its stats with their real labels (spec §5.19). */
function Loading() {
  return (
    <DetailShell
      loading
      title={" "}
      dateSwitcher={{ mode: "day" }}
      hero={
        <View accessibilityElementsHidden className="w-full max-w-[360px] items-center gap-2 py-4">
          <SkeletonText className="w-16" />
          <SkeletonText className="w-44" fs={64} lh={64} />
          <SkeletonText className="w-40" />
        </View>
      }
      primary={<LoadingPrimary />}
      bodySkeleton={<LoadingPrimary />}
    />
  );
}
