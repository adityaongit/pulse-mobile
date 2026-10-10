// Home's loading state (spec §5.19), ported from pulse (app)/_lib/skeletons.tsx `HomeSkeleton`: the real shell and each
// section's own box with its static titles and labels; only values are bars, so nothing moves when data arrives.
import { Fragment } from "react";
import { View } from "react-native";
import { DASHBOARD_DEFAULT, DASHBOARD_LABEL, type DashboardKey } from "@/lib/dashboard";
import { Wordmark } from "@/ui/brand";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { EnergyBankChartSkeleton } from "@/ui/charts/EnergyBankChart";
import { TimelineSkeleton } from "@/ui/metrics/ActivityCard";
import { KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { ScoreDialSkeleton } from "@/ui/metrics/ScoreDial";
import { TickScaleSkeleton } from "@/ui/metrics/TickScale";
import { PageShell } from "@/ui/shells/PageShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { ENERGY_INFO, STRAIN_RECOVERY_INFO, TONIGHT_INFO } from "../_lib/info";
import { statIcon } from "../_lib/view";

const rows = (n: number, Row: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => <Fragment key={i}>{Row(i)}</Fragment>);

/** A monitor card body: the chip box and two lines. */
function MonitorLineSkeleton() {
  return (
    <View className="flex-row items-center gap-2">
      <Skeleton className="size-7 rounded-md" />
      <View className="min-w-0 flex-1">
        <SkeletonText className="w-24" />
        {/* A phone's half-width card wraps the status word ("Within range") onto a second line. */}
        <SkeletonText className="w-12" />
        <SkeletonText className="w-16" />
      </View>
    </View>
  );
}

/** The 32 px icon link in a Home card's header (open Strain, Journal, Sleep Planner). */
const ICON_SLOT = <View accessibilityElementsHidden className="size-8" />;

/** Home's 56 px gradient banner rows (day outlook, week in review). */
const BannerSkeleton = () => <Skeleton className="h-14 rounded-2xl" />;

/** Today's coach cards (HomeInsight): a title and two lines, the next card peeking underneath. */
function InsightSkeleton() {
  const shadow = useCardStyle();
  return (
    <View accessibilityElementsHidden className="pb-2">
      <View className="absolute inset-x-5 bottom-0 h-8 rounded-b-2xl bg-card/60" />
      <View className={`${CARD_CLASS} gap-0.5 p-5 pr-12`} style={shadow}>
        <CardFill />
        <SkeletonText lh={22} fs={16} className="w-40" />
        <SkeletonText lh={20} fs={15} className="w-full" />
        <SkeletonText lh={20} fs={15} className="w-2/3" />
        <SkeletonText lh={20} fs={15} className="w-1/2" />
        <View className="absolute right-2 top-2 h-12 w-6 rounded-lg bg-foreground/[0.08]" />
      </View>
    </View>
  );
}

/** `stats`: My Dashboard's chosen metrics (getHome's order), so the skeleton has as many rows as the page will. */
export function HomeSkeleton({ stats = DASHBOARD_DEFAULT }: { stats?: DashboardKey[] }) {
  return (
    <PageShell
      loading
      title="Home"
      layout="home"
      slots={{
        top: (
          <View accessibilityState={{ busy: true }} className="-mt-2">
            <View className="gap-3">
              <View accessibilityElementsHidden className="items-center">
                <Wordmark height={17} tone="foreground-secondary" />
              </View>
              <View className="flex-row items-start justify-around">
                {(["sleep", "recovery", "strain"] as const).map((v) => (
                  <View key={v} className="flex-1 items-center">
                    <ScoreDialSkeleton size="md" variant={v} />
                  </View>
                ))}
              </View>
            </View>
          </View>
        ),
        main: (
          <View className="gap-8">
            <View className="-mt-2 gap-6">
              <View className="flex-row gap-3">
                <View className="min-w-0 flex-1">
                  <SectionShell variant="card" title="Health Monitor" info={false} href="/health/monitor" fill>
                    <MonitorLineSkeleton />
                  </SectionShell>
                </View>
                <View className="min-w-0 flex-1">
                  <SectionShell variant="card" title="Stress Monitor" info={false} href="/health/stress" fill>
                    <MonitorLineSkeleton />
                  </SectionShell>
                </View>
              </View>
              <InsightSkeleton />
            </View>
            <SectionShell variant="section" title="My Day" action={<View accessibilityElementsHidden className="size-[34px] rounded-[10px] bg-foreground/90" />}>
              <View className="gap-3">
                <BannerSkeleton />
                <SectionShell variant="card" title="Today’s activities" action={ICON_SLOT}>
                  <TimelineSkeleton />
                  <Skeleton className="mt-3 h-12 rounded-xl" />
                </SectionShell>
                <SectionShell variant="card" title="My journal" action={ICON_SLOT}>
                  <View className="flex-row pt-1">
                    {rows(7, () => (
                      <View className="min-h-16 flex-1 items-center justify-center gap-2">
                        <SkeletonText className="w-5" />
                        <View className="size-7 rounded-full border border-foreground/25" />
                      </View>
                    ))}
                  </View>
                  <Skeleton className="mt-3 h-12 rounded-xl" />
                </SectionShell>
                <SectionShell variant="card" title="Energy Bank" info={ENERGY_INFO} fill>
                  <View className="flex-1 gap-4">
                    <View className="gap-1.5">
                      <TickScaleSkeleton />
                      <SkeletonText className="w-32" />
                    </View>
                    <EnergyBankChartSkeleton />
                    <View className="mt-auto flex-row gap-3">
                      <Skeleton className="h-[68px] flex-1 rounded-lg" />
                      <Skeleton className="h-[68px] flex-1 rounded-lg" />
                    </View>
                    <View className="gap-1">{rows(3, () => <SkeletonText className="w-28" />)}</View>
                  </View>
                </SectionShell>
                <SectionShell variant="card" title="Tonight’s sleep" info={TONIGHT_INFO} action={ICON_SLOT} fill>
                  <View className="flex-1 gap-4">
                    <Skeleton className="my-auto h-[60px] rounded-lg bg-muted/60" />
                    <Skeleton className="mt-auto h-11 rounded-lg" />
                    <SkeletonText className="w-28" />
                  </View>
                </SectionShell>
              </View>
            </SectionShell>
          </View>
        ),
        aside: (
          <SectionShell variant="section" title="My Dashboard" aside="vs. 30-day average" action={ICON_SLOT}>
            <View accessibilityElementsHidden className="gap-2">
              {stats.map((key) => (
                <KeyStatRowSkeleton key={key} variant="card" label={DASHBOARD_LABEL[key]} icon={statIcon(key)} />
              ))}
            </View>
            <SectionShell variant="card" title="Strain & recovery" info={STRAIN_RECOVERY_INFO} fill className="mt-3">
              <View accessibilityElementsHidden className="flex-1">
                <Skeleton className="h-[232px] rounded-lg bg-muted/60" />
              </View>
            </SectionShell>
          </SectionShell>
        ),
        bottom: <BannerSkeleton />,
      }}
    />
  );
}
