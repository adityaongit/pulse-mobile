// Shared by the Trends, Metric detail and Reports screens (web: trends/parts.tsx and the loading shapes).
import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { router } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { deltaTone, type GoodDirection } from "@/lib/bands";
import { formatValue, type FormatKey } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { byMonth, mean, monthSegments, wholeMonths, type TrendViewBar } from "@/lib/trend";
import { RANGE_DAYS, RANGES, type TrendRange } from "@/lib/url";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { MetricState } from "@/ui/shells/MetricState";
import { StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { TrendLegend } from "@/ui/metrics/TrendLegend";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { TrendViewChart } from "./TrendViewChart";
import type { ColorBy } from "./trendViewLayout";
import { Divided } from "@/ui/Divided";
import { Press } from "@/ui/Press";
import { DURATION } from "@/ui/motion";

export const PERIOD: Record<TrendRange, { label: string; prior: string }> = {
  w: { label: "Last 7 days", prior: "the 7 days before" },
  m: { label: "Last 30 days", prior: "the 30 days before" },
  "6m": { label: "Last 6 months", prior: "the 6 months before" },
  "1y": { label: "Last 12 months", prior: "the year before" },
};

const RANGE_LABEL: Record<TrendRange, string> = { w: "W", m: "M", "6m": "6M", "1y": "1Y" };
const RANGE_ARIA: Record<TrendRange, string> = { w: "1 week", m: "1 month", "6m": "6 months", "1y": "1 year" };

/** Sets the route's `?r=` (the web's toggle writes it too, so the range survives a metric change). */
export const setRange = (r: TrendRange) => router.setParams({ r });

export type HistoryPoint = { date: string; value: number | null; provisional?: boolean; parts?: Record<string, number> | null };

export type HistoryChartProps = {
  range: TrendRange;
  label: string;
  unit?: string;
  format: FormatKey;
  colorBy: ColorBy;
  direction: GoodDirection;
  /** A level (resting heart rate, weight) is a line on its own range; an amount or a score stands as bars on zero. */
  level: boolean;
  /** Oldest first, ending on the selected day, with enough days for 1Y. */
  data: Metric<HistoryPoint[]> | null | undefined;
  /** Each range's average minus the one before. */
  deltas: Partial<Record<TrendRange, number | null>>;
  /** Stack parts, bottom first (`parts` keys on each point). */
  series?: readonly { key: string; label: string }[];
  /** Shades mean ± 1 SD. */
  baseline?: { mean: number; sd: number } | null;
};

/** Scores (Recovery, Sleep, Strain, Stress) stand on their whole 0–100 scale, as on the Trend View. */
const SCORE_DOMAIN: [number, number] = [0, 100];

/**
 * A metric's history (Trends, Metric detail) on the Trend View's chart, the range in the route's `r` param so the stats
 * below read the same range. Each range reads at its own grain, as WHOOP's Trend View and the web's do: W each day with
 * its value, M each day against weekly ticks, 6M and 1Y a level segment per month (with its change) over the faint days.
 */
export function HistoryChart(p: HistoryChartProps) {
  const shown = !!p.data?.value?.length;
  return (
    <View className="min-w-0">
      {shown && (
        <View className="mb-3">
          <Segmented label="Range" fill value={p.range} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r], accessibilityLabel: RANGE_ARIA[r] }))} onChange={setRange} />
        </View>
      )}
      <MetricState metric={p.data} skeleton={<Skeleton className="h-[240px] rounded-lg bg-skeleton" />} empty={<EmptyState body="No data in this range yet." />}>
        {(points) => <History {...p} points={points} />}
      </MetricState>
    </View>
  );
}

/** HistoryChart's shape while it loads: the range toggle, the average with its chip, and the chart's height. */
export function HistoryChartSkeleton() {
  return (
    <View accessibilityElementsHidden className="min-w-0 gap-3">
      <View className="flex-row gap-0.5 rounded-lg bg-muted p-0.5">
        {RANGES.map((r) => (
          <View key={r} className="h-10 flex-1 items-center justify-center rounded-md px-3">
            <Text className="font-numeric text-[13px] font-bold text-muted-foreground/60">{RANGE_LABEL[r]}</Text>
          </View>
        ))}
      </View>
      <View>
        <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">Average</Text>
        <SkeletonText className="w-14" fs={28} lh={32} />
        <Skeleton className="mt-1 h-6 w-28" />
      </View>
      <Skeleton className="h-[240px] rounded-lg bg-skeleton" />
    </View>
  );
}

function History({ points, ...p }: HistoryChartProps & { points: HistoryPoint[] }) {
  const { range } = p;
  const frame = useMemo(() => {
    const days = points.slice(-RANGE_DAYS[range]);
    // Today's running total is drawn, not averaged (the Trend View's rule).
    const settled = days.map((d) => ({ day: d.date, value: d.provisional ? null : d.value }));
    const bars: TrendViewBar[] = days.map((d) => ({ from: d.date, to: d.date, value: d.value, ...(d.provisional && { provisional: true }), ...(d.parts !== undefined && { parts: d.parts }) }));
    return { bars, average: mean(settled.map((d) => d.value)), segments: byMonth(range) ? wholeMonths(monthSegments(settled)) : null };
  }, [points, range]);
  const delta = p.deltas[range] ?? null;
  const tone = delta === null || delta === 0 || p.direction === "neutral" ? null : deltaTone(p.direction, delta, 0).tone;
  const chart = p.series ? "stack" : p.level ? "line" : "bars";
  const typical: [number, number] | null = p.baseline ? [p.baseline.mean - p.baseline.sd, p.baseline.mean + p.baseline.sd] : null;
  return (
    <View className="min-w-0 gap-3">
      <View>
        <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">Average</Text>
        <ValueUnit value={formatValue(p.format, frame.average)} unit={p.unit} className="font-numeric text-[28px] font-bold leading-8" />
        {delta !== null && (
          <View className="mt-1 flex-row">
            <StatusChip tone={tone === "good" ? "optimal" : tone === "bad" ? "warning" : "neutral"} delta={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
              {`${formatValue(p.format, Math.abs(delta))}${p.unit === "%" ? "%" : p.unit ? ` ${p.unit}` : ""} vs. ${PERIOD[range].prior}`}
            </StatusChip>
          </View>
        )}
      </View>
      {frame.average === null ? (
        <View className="h-[240px] items-center justify-center">
          <EmptyState body="No data in this range yet." />
        </View>
      ) : (
        <View className="min-w-0">
          <TrendLegend chart={chart} series={p.series} typical={!!typical} />
          <TrendViewChart
            label={p.label}
            bars={frame.bars}
            chart={chart}
            range={range}
            colorBy={p.colorBy}
            format={p.format}
            unit={p.unit}
            direction={p.direction}
            series={p.series}
            domain={!p.level && (p.unit === "%" || p.colorBy === "stress") ? SCORE_DOMAIN : undefined}
            typical={typical}
            average={frame.average}
            segments={frame.segments}
          />
        </View>
      )}
    </View>
  );
}

/** A chevron that turns half a way over 200 ms when `on` (the web's `transition-transform duration-200` with `rotate-180`). */
export function Turn({ on, children }: { on: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(on ? "180deg" : "0deg", { duration: DURATION.base }) }] }), [on]);
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A whole-card button: the card material, pressing in (the web's CARD_LINK on a button). */
export function CardButton({ onPress, className, accessibilityLabel, activeScale = 0.96, children }: { onPress: () => void; className?: string; accessibilityLabel?: string; activeScale?: number; children: ReactNode }) {
  const shadow = useCardStyle();
  return (
    <Press activeScale={activeScale} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} className={cn(CARD_CLASS, className)} style={shadow}>
      <CardFill />
      {children}
    </Press>
  );
}

/** The web's error view for every route: the shell stays, the screen offers a retry (spec §7). */
export function LoadError({ title, reload }: { title: string; reload: () => void }) {
  return <DetailShell title={title} primary={<View accessibilityRole="alert" className="pt-16"><EmptyState icon={CircleAlert} body="Couldn’t load this screen." action={{ label: "Try again", onClick: reload }} /></View>} />;
}

export { Divided };
