// Trends `/trends?metric=&r=` (web: (app)/trends/page.tsx, loading.tsx): one daily metric over up to a year, each range
// against the one before.
import { useMemo } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { parseRange, RANGES, type TrendRange } from "@/lib/url";
import { getTrends, parseTrendMetric, type TrendMetric, type TrendsVM } from "@/queries/trends";
import { useScreen } from "@/screens/useScreen";
import { mapMetric } from "@/screens/_lib/view";
import { TrendChartSkeleton } from "@/ui/charts/TrendChart";
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SkeletonText } from "@/ui/Skeleton";
import { MetricPicker } from "./MetricSheet";
import { Divided, LoadError, PERIOD, RangedTrendChart } from "./parts";

/** The chart's points and each range's change against the one before, once per loaded view model. */
function shape(vm: TrendsVM, m: TrendMetric) {
  // Rounded as the chip shows it, so 0.04 km reads "+0.04", not "0.00".
  const k = m.format === "decimal2" ? 100 : 10;
  const deltas = Object.fromEntries(vm.periods.map((p) => [p.range, p.average.value === null || p.prior === null ? null : Math.round((p.average.value - p.prior) * k) / k])) as Record<TrendRange, number | null>;
  return { data: mapMetric(vm.points, (ps) => ps.map((p) => ({ date: p.day, value: p.value, provisional: p.provisional }))), deltas };
}

export default function TrendsScreen() {
  const { metric, r } = useLocalSearchParams<{ metric?: string; r?: string }>();
  const m = parseTrendMetric(metric);
  const range = parseRange(r);
  const { data, error, reload } = useScreen((ctx) => getTrends(m.key, ctx), [m.key]);
  // A metric change keeps the old view model until the new one lands: never draw it under the new title.
  const vm = data?.metric === m.key ? data : undefined;
  const shaped = useMemo(() => (vm ? shape(vm, m) : undefined), [vm, m]);

  if (error && !vm) return <LoadError title="Trends" reload={reload} />;
  if (!vm || !shaped) return <Loading current={m.key} r={r} />;

  return (
    <DetailShell
      title="Trends"
      primary={
        <View className="gap-4">
          <MetricPicker current={m.key} r={r} />
          <View className="gap-3">
            <SectionShell variant="card" title={m.label} action={{ label: "Details", href: m.href }}>
              <RangedTrendChart key={m.key} range={range} label={m.label} unit={m.unit} format={m.format} colorBy={m.colorBy} direction={m.direction} data={shaped.data} deltas={shaped.deltas} />
            </SectionShell>
            <SectionShell variant="card" title="Averages">
              <Divided>
                {vm.periods.map((p) => (
                  <KeyStatRow key={p.range} variant="row" label={PERIOD[p.range].label} caption={`vs. ${PERIOD[p.range].prior}`} metric={p.average} unit={m.unit} format={m.format} average={p.prior} averageLabel={PERIOD[p.range].prior} direction={m.direction} />
                ))}
              </Divided>
            </SectionShell>
          </View>
        </View>
      }
    />
  );
}

/** Trends: the real picker, the chart card with its plot and toggle, the Averages rows with their labels (spec §5.19). */
function Loading({ current, r }: { current: TrendMetric["key"]; r?: string }) {
  return (
    <DetailShell
      loading
      title="Trends"
      primary={
        <View accessibilityElementsHidden className="gap-4">
          <MetricPicker current={current} r={r} />
          <View className="gap-3">
            <SectionShell variant="card" title={" "} aside={<SkeletonText className="w-20" />}>
              <TrendChartSkeleton chip ranges={RANGES} />
            </SectionShell>
            <SectionShell variant="card" title="Averages">
              <Divided>
                {RANGES.map((x) => (
                  <KeyStatRowSkeleton key={x} variant="row" label={PERIOD[x].label} />
                ))}
              </Divided>
            </SectionShell>
          </View>
        </View>
      }
    />
  );
}
