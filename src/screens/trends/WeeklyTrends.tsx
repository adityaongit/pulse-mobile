// Weekly Trends (web: components/metrics/WeeklyTrends.tsx, spec §11 R32): the closing stack of a score screen, one card per
// metric over the 7 days ending on the selected day, that day's column highlighted. Each card is a link with a chevron
// into its Trend View on W. The cards come from `getWeeklyTrends` (trendView.ts), loaded with the screen's own view model.
import { View } from "react-native";
import { trendHref } from "@/lib/url";
import type { TrendViewVM } from "@/queries/trendView";
import { Skeleton } from "@/ui/Skeleton";
import { TrendLegend } from "@/ui/metrics/TrendLegend";
import { SectionShell } from "@/ui/shells/SectionShell";
import { TrendViewChart } from "./TrendViewChart";

export function WeeklyTrends({ cards, d, today }: { cards: TrendViewVM[]; d: string; today: string }) {
  if (!cards.length) return null;
  return (
    <SectionShell variant="section" title="Weekly Trends">
      <View className="gap-3">
        {cards.map((vm) => (
          <SectionShell key={vm.key} variant="card" title={vm.card} info={false} href={trendHref(vm.key, { d, today, r: "w" })}>
            {/* Every card keeps the legend's row, so plots line up. */}
            <View className="mb-1 h-5">
              <TrendLegend chart={vm.chart} series={vm.series} className="mb-0" />
            </View>
            <TrendViewChart
              label={vm.label}
              bars={vm.bars}
              chart={vm.chart}
              range="w"
              colorBy={vm.colorBy}
              format={vm.format}
              unit={vm.unit}
              direction={vm.direction}
              series={vm.series}
              domain={vm.domain}
              selected={d}
              compact
            />
          </SectionShell>
        ))}
      </View>
    </SectionShell>
  );
}

/** The loading shape: the heading and one card per title, each a legend row over the chart's height. */
export function WeeklyTrendsSkeleton({ titles }: { titles: string[] }) {
  return (
    <SectionShell variant="section" title="Weekly Trends">
      <View accessibilityElementsHidden className="gap-3">
        {titles.map((t) => (
          <SectionShell key={t} variant="card" title={t} info={false}>
            <View className="mb-1 h-5" />
            <Skeleton className="h-[150px] rounded-lg bg-muted/60" />
          </SectionShell>
        ))}
      </View>
    </SectionShell>
  );
}
