// Strain `/strain?d=` (spec §7.3): the ring with Strain Target, today against the prior 30 days, heart rate, zones,
// activities and trends. Ported from pulse src/app/(app)/strain/{page,loading}.tsx.
import { View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { Flame } from "lucide-react-native"
import { formatValue } from "@/lib/format"
import { reasonCopy } from "@/lib/reasons"
import { activityHref, parseDay, trendHref } from "@/lib/url"
import { todayOf } from "@/queries/common"
import { getStrain } from "@/queries/strain"
import { getWeeklyTrends, type TrendViewKey } from "@/queries/trendView"
import type { StrainVM } from "@/queries/types"
import { cn } from "@/ui/cn"
import { Card } from "@/ui/Card"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import { IntradayHrChart, IntradayHrChartSkeleton } from "@/ui/charts/IntradayHrChart"
import { ZoneBars, ZoneBarsSkeleton } from "@/ui/charts/ZoneBars"
import { ActivityCard, TimelineSkeleton } from "@/ui/metrics/ActivityCard"
import { InsightCard } from "@/ui/metrics/InsightCard"
import { KeyStatRow } from "@/ui/metrics/KeyStatRow"
import { MetricTags } from "@/ui/metrics/primitives"
import { ScoreDial } from "@/ui/metrics/ScoreDial"
import { SkeletonText } from "@/ui/Skeleton"
import { DetailShell } from "@/ui/shells/DetailShell"
import { EmptyState } from "@/ui/shells/EmptyState"
import { InfoButton } from "@/ui/shells/InfoButton"
import { SectionShell } from "@/ui/shells/SectionShell"
import { STRAIN_INFO, STRAIN_TARGET_INFO } from "@/screens/_lib/info"
import { CAPTION, hrSeries, LABEL, statProps, TodayVsLegend } from "@/screens/_lib/view"
import { DialDetailSkeleton, Divided, ScreenError } from "@/screens/recovery/shared"
import { WeeklyTrends, WeeklyTrendsSkeleton } from "@/screens/trends/WeeklyTrends"
import { useScreen } from "@/screens/useScreen"

/** Weekly Trends in the reference app's order (strain-25..38). */
const WEEKLY: readonly TrendViewKey[] = ["strain", "zones13", "zones45", "steps", "calories", "strength"]

export function StrainScreen() {
  const { d: raw } = useLocalSearchParams<{ d?: string }>()
  const { data, error, reload } = useScreen(async (ctx) => {
    const today = todayOf(ctx)
    const { d } = parseDay(raw, today)
    const [vm, weekly] = await Promise.all([getStrain(ctx, d), getWeeklyTrends(WEEKLY, d, ctx)])
    return { d, today, timeZone: ctx.timeZone, vm, weekly }
  }, [raw])

  if (!data) return error ? <ScreenError retry={reload} /> : <StrainSkeleton />
  const { d, today, timeZone, vm, weekly } = data
  const s = vm.strain
  const t = vm.target.value

  return (
    <DetailShell
      title="Strain"
      info={STRAIN_INFO}
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={<ScoreDial variant="strain" size="lg" value={s.value} reason={s.reason} target={t ? [t.low, t.high] : null} extraTags={vm.soFar && s.value !== null ? ["so_far"] : undefined} />}
      summary={
        <Card className="gap-0 px-4 py-1">
          <Divided>
            <TargetRow vm={vm} />
            {vm.summary.map((k) => (
              <KeyStatRow key={k.key} variant="row" {...statProps(k, { d, today })} />
            ))}
          </Divided>
          <TodayVsLegend period="prior 30 days" />
        </Card>
      }
      insight={vm.coach ? <InsightCard body={vm.coach} action={{ label: "Explore your strain insights", href: trendHref("strain", { d, today }) }} /> : null}
      primary={
        <SectionShell variant="card" title="Heart rate">
          <IntradayHrChart data={hrSeries(vm.hr, vm.maxHr)} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="zones" variant="card" title="Time in zones">
          <ZoneBars variant="rows" data={vm.zones} note={vm.zoneNote} emptyCopy={vm.isToday ? "No heart-rate zones yet today." : "No heart-rate zones on this day."} />
        </SectionShell>,
        <SectionShell key="activities" variant="card" title="Activities">
          {vm.activities.length ? (
            <View className="gap-1.5">
              {vm.activities.map((a) => (
                <ActivityCard key={a.id} name={a.name} kind={a.activityKind} strain={a.strain} start={a.start} end={a.end} distanceKm={a.distanceKm} paceS={a.paceS} href={activityHref(a.id)} timeZone={timeZone} />
              ))}
            </View>
          ) : (
            <EmptyState body="No activities on this day." />
          )}
        </SectionShell>,
      ]}
      footer={<WeeklyTrends cards={weekly} d={d} today={today} />}
    />
  )
}

/** "Strain Target 12.0 - 15.0": a range, so it is drawn beside the KeyStatRows rather than as one (no arrow). */
function TargetRow({ vm }: { vm: StrainVM }) {
  const t = vm.target
  const text = t.value ? `${formatValue("decimal1", t.value.low)} - ${formatValue("decimal1", t.value.high)}` : "--"
  const reason = t.value ? null : reasonCopy(t.reason, t.nightsLeft).short
  return (
    <View accessible accessibilityLabel={reason ? `Strain Target: ${reason}` : `Strain Target ${text.replace(" - ", " to ")}`} className="min-h-[52px] flex-row items-center gap-3 py-2">
      <View className="size-5 shrink-0 items-center justify-center">
        <Icon icon={Flame} size={20} tone="muted-foreground" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={LABEL}>Strain Target</Text>
        {reason && (
          <Text className={cn(CAPTION, "mt-0.5")} numberOfLines={1}>
            {reason}
          </Text>
        )}
        {t.value?.estimate && <MetricTags extra={["estimate"]} className="mt-1 justify-start" />}
      </View>
      <InfoButton info={STRAIN_TARGET_INFO} label="Strain Target" variant="card" />
      {/* Same columns as KeyStatRow's value + arrow, so the values right-align down the card. */}
      <View className="shrink-0 flex-row gap-2">
        <Text className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", reason && "text-muted-foreground")}>{text}</Text>
        <View className="w-2" />
      </View>
      {/* The rows below end on a chevron: keep its column so the values still line up. */}
      <View className="size-4 shrink-0" />
    </View>
  )
}

/** The route's loading state (pulse's StrainSkeleton). */
function StrainSkeleton() {
  return (
    <DialDetailSkeleton
      title="Strain"
      dial="strain"
      labels={["Strain Target", "Heart rate zones 1-3", "Heart rate zones 4-5", "Strength activity time", "Steps"]}
      legend="Today vs. prior 30 days"
      primary={
        <SectionShell variant="card" title="Heart rate">
          <View accessibilityElementsHidden>
            <IntradayHrChartSkeleton />
          </View>
        </SectionShell>
      }
      secondary={[
        <SectionShell key="zones" variant="card" title="Time in zones">
          <View accessibilityElementsHidden>
            <ZoneBarsSkeleton variant="rows" />
            <SkeletonText className="mt-3 w-56" />
          </View>
        </SectionShell>,
        <SectionShell key="activities" variant="card" title="Activities">
          <View accessibilityElementsHidden>
            <TimelineSkeleton rows={1} />
          </View>
        </SectionShell>,
      ]}
      footer={<WeeklyTrendsSkeleton titles={["Strain", "HR Zones 1-3", "HR Zones 4-5", "Steps", "Calories", "Strength Activity Time"]} />}
    />
  )
}
