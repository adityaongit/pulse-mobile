// Sleep's loading state (spec §5.19), ported from pulse (app)/_lib/skeletons.tsx `SleepSkeleton` and its DialDetail: the
// real shell and each card's own box with its static titles and labels; only values are bars.
import { Fragment } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card, INSET_ROW } from "@/ui/Card";
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
import { cn } from "@/ui/cn";
import type { InfoContent } from "@/ui/shells/InfoButton";
import { cardInfoFor } from "./cardInfoFor";

const lastNightInfo = (title: string) => cardInfoFor("Last night’s sleep", title);
const rows = (n: number, Row: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => <Fragment key={i}>{Row(i)}</Fragment>);

function CardSkeleton({ title, info, children }: { title: string; info?: InfoContent; children: React.ReactNode }) {
  return (
    <SectionShell variant="card" title={title} info={info}>
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
      <View className={cn(INSET_ROW, "mt-4 gap-2 py-3")}>
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

const loadingPrimary = (t: TFunction<"sleep">) => (
  <SectionShell variant="card" title={t("cards.lastNight")} aside={t("cards.vsPrior30")} info={lastNightInfo(t("cards.lastNight"))}>
    <SleepStagesSkeleton />
  </SectionShell>
);

const loadingSecondary = (t: TFunction<"sleep">) => [
  <CardSkeleton key="need" title={t("cards.hoursVsNeeded")} info={cardInfoFor("Hours vs. needed", t("cards.hoursVsNeeded"))}>
    <MeasureSkeleton rows={[t("skeleton.healthyMinimum"), t("skeleton.recentStrain"), t("skeleton.sleepDebt")]} />
  </CardSkeleton>,
  <CardSkeleton key="consistency" title={t("cards.consistency")} info={cardInfoFor("Sleep consistency", t("cards.consistency"))}>
    <View className="gap-4">
      <SkeletonText lh={40} fs={36} className="w-24" />
      <Skeleton className="h-52 rounded-lg" />
    </View>
  </CardSkeleton>,
  <CardSkeleton key="efficiency" title={t("cards.efficiency")} info={cardInfoFor("Sleep efficiency", t("cards.efficiency"))}>
    <View accessibilityElementsHidden className="gap-4">
      <SkeletonText lh={40} fs={36} className="w-24" />
      <Skeleton className="h-3.5 rounded-[3px]" />
      <Skeleton className="h-3.5 rounded-[3px] bg-skeleton" />
      <SkeletonText className="w-32" />
    </View>
  </CardSkeleton>,
  <SectionShell key="planner" variant="card" title={t("cards.tonight")} info={TONIGHT_INFO}>
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
];

/** Below the fold while a cold push slides in: the loading state's first sections. */
function SleepBody() {
  const { t } = useTranslation("sleep");
  return (
    <>
      {loadingPrimary(t)}
      <View className="gap-3">{loadingSecondary(t).slice(0, 2)}</View>
    </>
  );
}
export const SLEEP_BODY_SKELETON = <SleepBody />;

export function SleepSkeleton() {
  const { t } = useTranslation("sleep");
  return (
    <DetailShell
      loading
      title={t("title")}
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={<ScoreDialSkeleton size="lg" variant="sleep" />}
      summary={
        <Card className="gap-0 px-4 py-1">
          {(["hours", "consistency", "efficiency"] as const).map((l, i) => (
            <Fragment key={l}>
              {i > 0 && <View className="h-px bg-border" />}
              <KeyStatRowSkeleton variant="row" label={t(`stat.${l}`)} />
            </Fragment>
          ))}
          <View className={cn(INSET_ROW, "mb-3 mt-1 py-2")}>
            <SkeletonText className="w-48" />
          </View>
        </Card>
      }
      insight={<InsightCardSkeleton action={false} />}
      primary={loadingPrimary(t)}
      bodySkeleton={SLEEP_BODY_SKELETON}
      secondary={loadingSecondary(t)}
      footer={<WeeklyTrendsSkeleton titles={(["sleep", "hours", "hoursNeed", "restorative", "consistency", "timeInBed", "efficiency"] as const).map((k) => t(`weekly.${k}`))} />}
    />
  );
}
