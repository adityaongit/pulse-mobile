// Sleep's loading state (spec §5.19), ported from pulse (app)/_lib/skeletons.tsx `SleepSkeleton` and its DialDetail: the
// real shell and each card's own box with its static titles and labels; only values are bars.
import { Fragment } from "react";
import { View } from "react-native";
import { Card } from "@/ui/Card";
import { InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { ScoreDialSkeleton } from "@/ui/metrics/ScoreDial";
import { SleepStagesSkeleton } from "@/ui/metrics/SleepStages";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { TONIGHT_INFO } from "../_lib/info";
import { WeeklyTrendsSkeleton } from "../trends/WeeklyTrends";

const rows = (n: number, Row: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => <Fragment key={i}>{Row(i)}</Fragment>);

function CardSkeleton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SectionShell variant="card" title={title}>
      <View accessibilityElementsHidden>{children}</View>
    </SectionShell>
  );
}

/** A measure card's shape (sleep's hours vs. needed and efficiency): the percentage, a bar, then its legend rows. */
function MeasureSkeleton({ rows: labels }: { rows: string[] }) {
  return (
    <View accessibilityElementsHidden>
      <SkeletonText lh={40} fs={36} className="w-24" />
      <Skeleton className="mt-4 h-3.5 rounded-[3px]" />
      <View className="mt-4 gap-2 rounded-lg bg-inset px-3 py-3">
        {labels.map((l) => (
          <View key={l} className="flex-row items-center gap-3">
            <View className="size-3 shrink-0 rounded-[3px] bg-secondary" />
            <Text className="flex-1 text-[13px] font-medium leading-4 text-foreground-secondary">{l}</Text>
            <SkeletonText className="w-12" />
          </View>
        ))}
      </View>
    </View>
  );
}

export function SleepSkeleton() {
  return (
    <DetailShell
      loading
      title="Sleep"
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={<ScoreDialSkeleton size="lg" variant="sleep" />}
      summary={
        <Card className="gap-0 px-4 py-1">
          {["Hours vs. needed", "Sleep consistency", "Sleep efficiency"].map((l, i) => (
            <Fragment key={l}>
              {i > 0 && <View className="h-px bg-border" />}
              <KeyStatRowSkeleton variant="row" label={l} />
            </Fragment>
          ))}
          <View className="mb-3 mt-1 rounded-lg bg-inset px-3 py-2">
            <SkeletonText className="w-48" />
          </View>
        </Card>
      }
      insight={<InsightCardSkeleton action={false} />}
      primary={
        <SectionShell variant="card" title="Last night’s sleep" aside="vs. prior 30 days">
          <SleepStagesSkeleton />
        </SectionShell>
      }
      secondary={[
        <CardSkeleton key="need" title="Hours vs. needed">
          <MeasureSkeleton rows={["Healthy minimum", "Recent strain", "Sleep debt"]} />
        </CardSkeleton>,
        <CardSkeleton key="consistency" title="Sleep consistency">
          <View className="gap-4">
            <SkeletonText lh={40} fs={36} className="w-24" />
            <Skeleton className="h-52 rounded-lg" />
          </View>
        </CardSkeleton>,
        <CardSkeleton key="efficiency" title="Sleep efficiency">
          <View accessibilityElementsHidden className="gap-4">
            <SkeletonText lh={40} fs={36} className="w-24" />
            <Skeleton className="h-3.5 rounded-[3px]" />
            <Skeleton className="h-3.5 rounded-[3px] bg-muted/60" />
            <SkeletonText className="w-32" />
          </View>
        </CardSkeleton>,
        <SectionShell key="planner" variant="card" title="Tonight’s sleep" info={TONIGHT_INFO}>
          <View accessibilityElementsHidden className="gap-2">
            <View>
              {rows(4, (i) => (
                <>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="min-h-[52px] flex-row items-center gap-3 py-2">
                    <View className="min-w-0 flex-1">
                      <SkeletonText className="w-20" />
                      <SkeletonText className="mt-0.5 w-24" />
                    </View>
                    <SkeletonText lh={24} fs={20} className="w-12" />
                  </View>
                </>
              ))}
            </View>
            <SkeletonText className="w-28" />
          </View>
        </SectionShell>,
      ]}
      footer={<WeeklyTrendsSkeleton titles={["Sleep Performance", "Hours vs. Needed (hours)", "Hours vs. Needed (%)", "Restorative Sleep", "Sleep Consistency", "Time in Bed", "Sleep Efficiency"]} />}
    />
  );
}
