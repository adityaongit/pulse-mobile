// Fitness `/health/fitness` (spec §7.10): latest values, no date switcher. Ported from pulse
// src/app/(app)/health/fitness/page.tsx and loading.tsx (the skeleton shows while the query runs).
import { View } from "react-native";
import { DAY, formatDay, formatValue } from "@/lib/format";
import { getFitness } from "@/queries/health";
import type { FitnessVM } from "@/queries/types";
import { TrendChart, TrendChartSkeleton } from "@/ui/charts/TrendChart";
import { cn } from "@/ui/cn";
import { CAPTION, LABEL, MetricTags, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { TickScale, TickScaleSkeleton } from "@/ui/metrics/TickScale";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { ErrorView } from "./ErrorView";
import { categoryTone, categoryWord, ordinal } from "./format";
import { FITNESS_INFO } from "./info";
import { LoadChart } from "./LoadChart";

const BODY = "text-[15px] leading-[22px] text-foreground-secondary";
// Both thresholds follow the pipeline: ACWR shows after 14 days of strain (readiness `minChronic`), fitness and fatigue
// after 14 days in a row (training load `minimumDays`).
const NO_LOAD = "Training load needs 14 days of strain.";
const NO_FFS = "Fitness, fatigue and form need 14 days of strain in a row.";

const STATUS: Record<NonNullable<FitnessVM["trainingLoad"]["value"]>["status"], { word: string; body: string }> = {
  detraining: { word: "Detraining", body: "Detraining: your recent load is well below your usual. Fitness slowly drops if this lasts." },
  optimal: { word: "Optimal", body: "Optimal: your recent load matches what you are used to." },
  pushing: { word: "Pushing", body: "Pushing: load is rising faster than usual. Watch your Recovery." },
  high_risk: { word: "High risk", body: "High risk: load jumped well above your usual. Injury and illness risk rise." },
};
const CATEGORIES = ["Poor", "Fair", "Good", "Excellent", "Superior"];

function Hero({ vo2 }: { vo2: FitnessVM["vo2"] }) {
  const v = vo2.value;
  if (!v) return <EmptyState body="No VO2 max yet. Fitbit estimates it from runs and resting heart rate." />;
  return (
    <View className="items-center gap-2 py-4">
      <ValueUnit value={formatValue("decimal1", v.value)} unit="ml/kg/min" className="text-center font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.01em]" />
      <View className="flex-row items-center gap-3">
        <Text className={LABEL}>VO2 max</Text>
        <Text className={cn(LABEL, categoryTone(v.category))}>{categoryWord(v.category)}</Text>
      </View>
      <Text className={CAPTION}>{v.source === "run" ? `From a run on ${formatDay(v.sourceDay, DAY.monthDay)}` : "Daily estimate from Fitbit"}</Text>
      {vo2.provisional && <MetricTags extra={["estimate"]} />}
    </View>
  );
}

export function FitnessScreen() {
  const { data: vm, error, reload } = useScreen((ctx) => getFitness(ctx), []);
  if (!vm) return error ? <ErrorView detail retry={reload} /> : <FitnessLoading />;
  const v = vm.vo2.value;
  const tl = vm.trainingLoad.value;

  return (
    <DetailShell
      title="Fitness"
      info={FITNESS_INFO}
      hero={<Hero vo2={vm.vo2} />}
      summary={
        v && (
          <SectionShell variant="card" title="Percentile">
            <TickScale
              variant="marker"
              label="VO2 max percentile"
              metric={{ value: v.percentile, reason: null, provisional: false }}
              min={0}
              max={100}
              format="int"
              describe={`${categoryWord(v.category)} for ${v.sex === "male" ? "men" : "women"} ${v.ageBand}`}
              bands={[
                { from: 0, to: 39.9, tone: "warning" },
                { from: 60, to: 100, tone: "optimal" },
              ]}
              ends={["0", "50", "100"]}
            />
            <View accessibilityElementsHidden className="mt-2 flex-row">
              {CATEGORIES.map((c) => (
                <Text key={c} numberOfLines={1} className={cn(CAPTION, "flex-1 text-center", c === categoryWord(v.category) && "font-bold text-foreground")}>
                  {c}
                </Text>
              ))}
            </View>
            <Text className={cn(CAPTION, "mt-3")}>
              {ordinal(v.percentile)} percentile for {v.sex === "male" ? "men" : "women"} {v.ageBand} (FRIEND registry).
            </Text>
          </SectionShell>
        )
      }
      primary={
        <SectionShell variant="card" title="VO2 max trend">
          <TrendChart label="VO2 max" data={{ value: vm.trend.points.map((p) => ({ date: p.day, value: p.value })), reason: null, provisional: false }} unit="ml/kg/min" format="decimal1" colorBy="single" direction="up" defaultRange="6m" />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="load" variant="card" title="Training load">
          {tl ? (
            <View className="gap-4">
              <View className="flex-row items-center gap-3">
                <Text className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em] tabular-nums">{formatValue("decimal2", tl.acwr)}</Text>
                <StatusChip tone={tl.tone}>{STATUS[tl.status].word}</StatusChip>
              </View>
              <TickScale
                variant="marker"
                label="Training load"
                metric={vm.trainingLoad.value ? { value: tl.acwr, reason: null, provisional: false } : null}
                min={0.5}
                max={2}
                format="decimal2"
                bands={[
                  { from: 0.8, to: 1.3, tone: "optimal" },
                  { from: 1.5, to: 2, tone: "warning" },
                ]}
                ends={["0.5", "1.0", "1.5", "2.0"]}
              />
              <Text className={BODY}>{STATUS[tl.status].body}</Text>
            </View>
          ) : (
            <ReasonPlaceholder reason="calibrating" size="md" copy={NO_LOAD} />
          )}
        </SectionShell>,
        <SectionShell key="ffs" variant="card" title="Fitness, fatigue and form">
          {vm.loadReason ? (
            <ReasonPlaceholder reason={vm.loadReason.reason} size="md" copy={NO_FFS} />
          ) : (
            <>
              <LoadChart load={vm.load} />
              <Text className={cn(CAPTION, "mt-2")}>Fitness is your 42-day load, fatigue your 7-day load, form the difference.</Text>
            </>
          )}
        </SectionShell>,
      ]}
    />
  );
}

/** Fitness loading (spec §7.10, §5.19): no date row; the VO2 max hero with Percentile, the VO2 max trend, then Training load and Fitness, fatigue and form. */
function FitnessLoading() {
  return (
    <DetailShell
      loading
      title="Fitness"
      hero={
        <View accessibilityElementsHidden className="items-center gap-2 py-4">
          <SkeletonText lh={64} fs={64} className="w-[133px]" />
          <View className="flex-row items-center gap-3">
            <Text className={LABEL}>VO2 max</Text>
            <SkeletonText className="w-16" />
          </View>
          <SkeletonText className="w-32" />
        </View>
      }
      summary={
        <SectionShell variant="card" title="Percentile">
          <View accessibilityElementsHidden>
            <TickScaleSkeleton variant="marker" />
            <View className="mt-2 flex-row">
              {CATEGORIES.map((c) => (
                <Text key={c} numberOfLines={1} className={cn(CAPTION, "flex-1 text-center")}>
                  {c}
                </Text>
              ))}
            </View>
            <SkeletonText className="mt-3 w-64" />
          </View>
        </SectionShell>
      }
      primary={
        <SectionShell variant="card" title="VO2 max trend">
          <TrendChartSkeleton />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="load" variant="card" title="Training load">
          <View accessibilityElementsHidden className="gap-4">
            <View className="flex-row items-center gap-3">
              <SkeletonText lh={40} fs={36} className="w-[75px]" />
              <Skeleton className="h-6 w-20 rounded-md" />
            </View>
            <TickScaleSkeleton variant="marker" />
            <View>
              <SkeletonText lh={22} fs={15} className="w-full" />
              <SkeletonText lh={22} fs={15} className="w-1/2" />
            </View>
          </View>
        </SectionShell>,
        <SectionShell key="ffs" variant="card" title="Fitness, fatigue and form">
          <View accessibilityElementsHidden>
            <Skeleton className="h-[220px] rounded-lg bg-muted/60" />
            <Text className={cn(CAPTION, "mt-2")}>Fitness is your 42-day load, fatigue your 7-day load, form the difference.</Text>
          </View>
        </SectionShell>,
      ]}
    />
  );
}
