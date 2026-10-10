// Stress Monitor `/health/stress` for `d` (spec §7.9). Ported from pulse src/app/(app)/health/stress/page.tsx and
// loading.tsx (the skeleton shows while the query runs).
import { View } from "react-native";
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
import { STRESS_INFO } from "./info";

const EMPTY = "No still minutes to score yet today.";
const LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em]";

const LEVEL_KEYS = [
  { key: "lowMin", word: "Low", bar: "bg-stress-low", text: "text-stress-low-text" },
  { key: "mediumMin", word: "Medium", bar: "bg-stress-medium", text: "text-stress-medium-text" },
  { key: "highMin", word: "High", bar: "bg-stress-high", text: "text-stress-high-text" },
] as const;

function LevelBar({ m, className }: { m: { lowMin: number; mediumMin: number; highMin: number }; className: string }) {
  return (
    <View accessibilityElementsHidden className={cn("flex-row gap-0.5 overflow-hidden rounded-sm", className)}>
      {LEVEL_KEYS.map((k) => m[k.key] > 0 && <View key={k.key} className={k.bar} style={{ flexGrow: m[k.key], flexBasis: 0 }} />)}
    </View>
  );
}

function typicalLine(l: NonNullable<StressVM["levels"]["value"]>) {
  if (l.typicalDeltaMin === null) return null;
  const m = Math.round(l.typicalDeltaMin);
  const delta = Math.abs(m) < 1 ? "about the same high stress" : `${durationWords(Math.abs(m))} ${m > 0 ? "more" : "less"} high stress`;
  return `vs. your typical ${l.weekday}: ${delta}`;
}

function TotalDay({ l, day }: { l: NonNullable<StressVM["levels"]["value"]>; day: string }) {
  const total = l.lowMin + l.mediumMin + l.highMin;
  if (!total) return <EmptyState body={EMPTY} />;
  const line = typicalLine(l);
  return (
    <View className="gap-4">
      <Text className={LABEL}>
        {day} stress{l.typical && <Text className="text-muted-foreground"> vs. typical {l.weekday}</Text>}
      </Text>
      <View className="gap-1.5">
        <LevelBar m={l} className="h-3" />
        {l.typical && <LevelBar m={l.typical} className="h-2 opacity-50" />}
      </View>
      <View className="flex-row gap-3">
        {LEVEL_KEYS.map((k) => (
          <View key={k.key} accessible accessibilityLabel={`${k.word}: ${durationWords(Math.round(l[k.key]))}${l.typical ? `, typical ${durationWords(Math.round(l.typical[k.key]))}` : ""}`} className="flex-1">
            <Text accessibilityElementsHidden className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", k.text)}>
              {hmm(l[k.key])}
            </Text>
            <Text accessibilityElementsHidden className={cn(LABEL, "mt-1")}>
              {k.word}
            </Text>
            {l.typical && (
              <Text accessibilityElementsHidden className="mt-0.5 font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground">
                {hmm(l.typical[k.key])} typical
              </Text>
            )}
          </View>
        ))}
      </View>
      {line && <Text className="text-xs font-medium leading-4 text-muted-foreground">{line}</Text>}
    </View>
  );
}

export function StressScreen() {
  const { data, error, reload } = useDayScreen(getStress);
  if (!data) return error ? <ErrorView detail retry={reload} /> : <StressLoading />;
  const { vm, d, today, timeZone } = data;
  const g = vm.gauge;
  const dayWord = vm.isToday ? "Today" : dayLabel(d, today);

  return (
    <DetailShell
      title="Stress Monitor"
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
            caption={g.value ? (g.value.dayAverage || !vm.isToday ? "Day average" : g.value.at ? `Last updated ${clock(g.value.at, timeZone)}` : undefined) : undefined}
          />
          {g.reason === "no_data" && <Text className="max-w-72 text-center text-xs font-medium leading-4 text-muted-foreground">{EMPTY}</Text>}
        </View>
      }
      insight={vm.insight ? <InsightCard body={vm.insight} /> : undefined}
      primary={
        <SectionShell variant="card" title={dayWord} info={{ title: "Stress throughout the day", body: "Body activation during still minutes, from 0 to 3. Movement, workouts and sleep appear as excluded periods rather than stress scores." }}>
          <StressChart variant="full" data={stressSeries(vm.chart)} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="levels" variant="card" title="Total day" info={{ title: "Time at each stress level", body: "Scored still minutes split into low, medium and high activation. When available, the faded bar compares the same weekday in your recent history." }}>
          <MetricState metric={vm.levels} skeleton={<Skeleton className="h-24 w-full" />} renderReason={() => <EmptyState body={EMPTY} />}>
            {(l) => <TotalDay l={l} day={dayWord} />}
          </MetricState>
        </SectionShell>,
        <SectionShell key="trend" variant="card" title="30-day trend" info={{ title: "Daily stress trend", body: "Average activation across each day's scored still minutes over the last 30 days. Days without enough data remain gaps." }}>
          <TrendChart label="Stress" data={{ value: vm.trend.points.map((p) => ({ date: p.day, value: p.value })), reason: null, provisional: false }} format="decimal1" colorBy="stress" direction="down" fixedRange="m" />
        </SectionShell>,
      ]}
    />
  );
}

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
      primary={
        <SectionShell variant="card" title="Today">
          <StressChartSkeleton variant="full" />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="levels" variant="card" title="Total day">
          <View accessibilityElementsHidden className="gap-4">
            <SkeletonText className="w-48" />
            <View className="gap-1.5">
              <Skeleton className="h-3 rounded-sm" />
              <Skeleton className="h-2 rounded-sm" />
            </View>
            <View className="flex-row gap-3">
              {["Low", "Medium", "High"].map((w) => (
                <View key={w} className="flex-1">
                  <SkeletonText lh={24} fs={20} className="w-[42px]" />
                  <Text className={cn(LABEL, "mt-1")}>{w}</Text>
                  <SkeletonText className="mt-0.5 w-20" />
                </View>
              ))}
            </View>
            <SkeletonText className="w-56" />
          </View>
        </SectionShell>,
        <SectionShell key="trend" variant="card" title="30-day trend">
          <TrendChartSkeleton />
        </SectionShell>,
      ]}
    />
  );
}
