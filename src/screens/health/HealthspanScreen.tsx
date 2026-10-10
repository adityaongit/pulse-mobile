// Healthspan `/health/healthspan?d=` (spec §7.7): the ISO week containing `d`. Ported from pulse
// src/app/(app)/health/healthspan/page.tsx and loading.tsx (the skeleton shows while the query runs).
import { View } from "react-native";
import { AGE_LABEL, formatValue, MISSING } from "@/lib/format";
import { getHealthspan } from "@/queries/health";
import type { HealthspanVM } from "@/queries/types";
import { TrendChart, TrendChartSkeleton } from "@/ui/charts/TrendChart";
import { cn } from "@/ui/cn";
import { ContributorRowSkeleton } from "@/ui/metrics/ContributorRow";
import { InsightCard, InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { CAPTION } from "@/ui/metrics/primitives";
import { TickScale, TickScaleSkeleton } from "@/ui/metrics/TickScale";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { AgeOrb } from "./AgeOrb";
import { ContributorCard } from "./ContributorCard";
import { useDayScreen } from "./day";
import { ErrorView } from "./ErrorView";
import { HEALTHSPAN_INFO } from "./info";
import { FAST, SLOW } from "./pace";

/** The one glow in the app (spec §2.6, docs/design/orb.md): the Pulse Age orb. `compact`: the collapsed header's 108 px orb. */
function Orb({ vm, compact }: { vm: HealthspanVM; compact?: boolean }) {
  const r = vm.result.value;
  if (compact)
    // Hangs 8 px below the stats' centre line, about 30 px past the band, as in [latest-healthspan-collapsed-2].
    return (
      <View style={{ transform: [{ translateY: 8 }] }}>
        <AgeOrb compact age={r?.pulseAge ?? null} deltaYears={r?.deltaYears ?? null} reason={vm.result.reason} />
      </View>
    );
  return (
    <View className="items-center gap-3">
      <AgeOrb age={r?.pulseAge ?? null} deltaYears={r?.deltaYears ?? null} provisional={vm.result.provisional} reason={vm.result.reason} size={300} />
      <Text className={cn(CAPTION, "text-center tabular-nums")}>{r ? `Your age: ${formatValue("decimal1", vm.age)}` : "Healthspan needs 20 days of data."}</Text>
      {r && vm.result.provisional && <Text className={cn(CAPTION, "text-center")}>Healthspan firms up after 20 days of data.</Text>}
    </View>
  );
}

export function HealthspanScreen() {
  const { data, error, reload } = useDayScreen(getHealthspan);
  if (!data) return error ? <ErrorView detail retry={reload} /> : <HealthspanLoading />;
  const { vm } = data;
  const r = vm.result.value;
  const pace = r ? { value: r.pace, reason: null, provisional: r.paceProvisional } : { value: null, reason: vm.result.reason, provisional: false };
  const hasHistory = vm.history.some((p) => p.value !== null);
  const group = (g: "sleep" | "strain" | "fitness") => vm.contributors.filter((c) => c.group === g);
  const n = vm.nextUpdateInDays;
  // Collapsed header stats ([latest-healthspan-collapsed-1..5]): years younger in green, older in amber; pace in white.
  const older = !!r && r.deltaYears > 0;
  const stats = {
    left: {
      value: r ? formatValue("decimal1", Math.abs(r.deltaYears)) : MISSING,
      label: older ? "Years older" : "Years younger",
      tone: r ? (older ? "warning" : "optimal") : undefined,
    },
    right: { value: r ? `${formatValue("decimal1", r.pace)}x` : MISSING, label: "Pace of aging" },
  } as const;

  return (
    <DetailShell
      title="Healthspan"
      subtitle={n > 0 ? `Next update in ${n} ${n === 1 ? "day" : "days"}` : undefined}
      dateSwitcher={{ mode: "week" }}
      info={HEALTHSPAN_INFO}
      ground="healthspan"
      hero={<Orb vm={vm} />}
      stats={stats}
      collapse
      summary={
        <SectionShell variant="card" title="Pace of Aging">
          <TickScale
            variant="marker"
            label="Pace of Aging"
            metric={pace}
            min={-1}
            max={3}
            format="decimal1"
            unit="x"
            describe={r ? (r.pace < 1 ? "aging slower than your 6-month average" : r.pace > 1 ? "aging faster than your 6-month average" : "aging at the normal rate") : undefined}
            ends={["−1.0x", "1.0x", "3.0x"]}
            leading={SLOW}
            trailing={FAST}
          />
          <Text className={cn(CAPTION, "mt-3")}>
            {r?.paceProvisional ? "Pace of Aging uses a 6-month window. It firms up as history builds." : "Compares your last 30 days with your 6-month Pulse Age."}
          </Text>
        </SectionShell>
      }
      insight={vm.insight ? <InsightCard title={vm.insight.title} body={vm.insight.body} /> : undefined}
      primary={
        <SectionShell variant="card" title={`${AGE_LABEL} history`}>
          {hasHistory ? (
            <TrendChart
              label={AGE_LABEL}
              data={{ value: vm.history.map((p) => ({ date: p.day, value: p.value })), reason: null, provisional: false }}
              format="decimal1"
              colorBy="single"
              fixedRange="6m"
              reference={{ y: vm.age, label: "Your age" }}
            />
          ) : (
            <EmptyState body="History builds one week at a time." />
          )}
        </SectionShell>
      }
      secondary={[
        <ContributorCard key="sleep" title="Sleep" items={group("sleep")} />,
        <ContributorCard key="strain" title="Strain" items={group("strain")} />,
        <ContributorCard key="fitness" title="Fitness" items={group("fitness")} />,
      ]}
    />
  );
}

/** A contributor card: `n` healthspan rows, as ContributorCard lays them out. */
function Contributors({ title, n }: { title: string; n: number }) {
  return (
    <SectionShell variant="card" title={title} fill>
      <View>
        {Array.from({ length: n }, (_, i) => (
          <View key={i} className={cn(i > 0 && "border-t border-border")}>
            <ContributorRowSkeleton variant="healthspan" />
          </View>
        ))}
      </View>
    </SectionShell>
  );
}

/**
 * Healthspan loading (spec §7.7, §5.19): the week row, the 300 px orb as its rim, Pace of Aging, the insight, Pulse Age
 * history, then the Sleep (2), Strain (4) and Fitness (3) contributors.
 */
function HealthspanLoading() {
  return (
    <DetailShell
      loading
      title="Healthspan"
      dateSwitcher={{ mode: "week" }}
      ground="healthspan"
      hero={
        <View accessibilityElementsHidden className="items-center gap-3">
          <View className="size-[300px] items-center justify-center rounded-full border-2 border-dial-track">
            <SkeletonText lh={56} fs={56} className="w-[116px]" />
          </View>
          <SkeletonText className="w-24" />
        </View>
      }
      summary={
        <SectionShell variant="card" title="Pace of Aging">
          <View accessibilityElementsHidden>
            <TickScaleSkeleton variant="marker" />
            <SkeletonText className="mt-3 w-64" />
          </View>
        </SectionShell>
      }
      insight={<InsightCardSkeleton title />}
      primary={
        <SectionShell variant="card" title={`${AGE_LABEL} history`}>
          <TrendChartSkeleton />
        </SectionShell>
      }
      secondary={[<Contributors key="sleep" title="Sleep" n={2} />, <Contributors key="strain" title="Strain" n={4} />, <Contributors key="fitness" title="Fitness" n={3} />]}
    />
  );
}
