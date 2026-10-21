// Strain `/strain?d=` (spec §7.3): the ring with Strain Target, today against the prior 30 days, heart rate, zones,
// activities and trends. Ported from pulse src/app/(app)/strain/{page,loading}.tsx.
import { View } from "react-native"
import { useTranslation } from "react-i18next"
import { useLocalSearchParams } from "expo-router"
import { Activity, Flame } from "lucide-react-native"
import { cardInfo } from "@/ui/shells/cardInfo"
import { formatValue } from "@/lib/format"
import { reasonCopy } from "@/lib/reasons"
import { activityHref, parseDay, trendHref } from "@/lib/url"
import { type QueryCtx, todayOf } from "@/queries/common"
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
import { TrainingSection } from "./TrainingCards"
import { CardButtonLink } from "@/screens/home/parts"
import { GoalsCard } from "@/screens/goals/Goals"
import { chartHref } from "@/screens/chart/href"
import { WeeklyPlanCard } from "@/screens/goals/WeeklyPlan"

/** Weekly Trends in the reference app's order (strain-25..38). */
const WEEKLY: readonly TrendViewKey[] = ["strain", "zones13", "zones45", "steps", "calories", "strength"]

/** The page's query and key, by the route's `d` (none or empty: today); Home prefetches them. */
export const strainQuery = (raw?: string) => async (ctx: QueryCtx) => {
  const today = todayOf(ctx)
  const { d } = parseDay(raw, today)
  const [vm, weekly] = await Promise.all([getStrain(d, ctx), getWeeklyTrends(WEEKLY, d, ctx)])
  return { d, today, timeZone: ctx.timeZone, vm, weekly }
}
export const strainKey = (raw?: string) => ["strain", raw || null] as const

/** A day's zones carry no typical range (only a workout's do, in another shape): the bars take them without it. */
const dayZones = (m: StrainVM["zones"]) => ({ ...m, value: m.value?.map(({ typical: _typical, ...z }) => z) ?? null })

/** A card's info button under its translated title (cardInfo looks the text up by the English id). */
const infoFor = (id: string, title: string) => {
  const i = cardInfo(id)
  return i && { ...i, title }
}

export function StrainScreen() {
  const { t: tr } = useTranslation("strain")
  const { d: raw } = useLocalSearchParams<{ d?: string }>()
  const { data, error, reload } = useScreen(strainQuery(raw), strainKey(raw))

  if (!data) return error ? <ScreenError retry={reload} /> : <StrainSkeleton />
  const { d, today, timeZone, vm, weekly } = data
  const s = vm.strain
  const t = vm.target.value

  return (
    <DetailShell
      title={tr("screen.title")}
      bodySkeleton={<BodySkeleton />}
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
          <TodayVsLegend period={tr("screen.prior30")} />
        </Card>
      }
      insight={vm.coach ? <InsightCard body={vm.coach} action={{ label: tr("screen.exploreInsights"), href: trendHref("strain", { d, today }) }} /> : null}
      // The day's goals and the weekly plan lead, as halo's Activity tab has them (spec §11).
      primary={<GoalsCard day={d} isToday={vm.isToday} />}
      secondary={[
        <WeeklyPlanCard key="plan" day={d} />,
        <TrainingSection key="training" d={d} timeZone={timeZone} />,
        <SectionShell key="hr" variant="card" title={tr("screen.heartRate")} info={infoFor("Heart rate", tr("screen.heartRate"))} action={{ label: tr("screen.explore"), href: chartHref({ metric: "strain", r: "day", d }) }}>
          <IntradayHrChart data={hrSeries(vm.hr, vm.maxHr)} />
        </SectionShell>,
        <SectionShell key="zones" variant="card" title={tr("screen.timeInZones")} info={infoFor("Time in zones", tr("screen.timeInZones"))}>
          <ZoneBars variant="rows" data={dayZones(vm.zones)} note={vm.zoneNote} emptyCopy={vm.isToday ? tr("screen.noZonesToday") : tr("screen.noZonesDay")} />
        </SectionShell>,
        <SectionShell key="activities" variant="card" title={tr("screen.activities")} info={infoFor("Activities", tr("screen.activities"))}>
          {vm.activities.length ? (
            <View className="gap-1.5">
              {vm.activities.map((a) => (
                <ActivityCard key={a.id} name={a.name} kind={a.activityKind} strain={a.strain} start={a.start} end={a.end} distanceKm={a.distanceKm} paceS={a.paceS} href={activityHref(a.id)} timeZone={timeZone} />
              ))}
            </View>
          ) : (
            <EmptyState body={tr("screen.noActivities")} />
          )}
          {/* Strain Coach on the band's live heart rate (/workout-live), today only, as halo's activities card. */}
          {vm.isToday && <CardButtonLink href="/workout-live" icon={Activity} label={tr("screen.liveWorkout")} className="mt-3" />}
        </SectionShell>,
      ]}
      footer={<WeeklyTrends cards={weekly} d={d} today={today} />}
    />
  )
}

/** "Strain Target 40 - 60%": a range, so it is drawn beside the KeyStatRows rather than as one (no arrow). */
function TargetRow({ vm }: { vm: StrainVM }) {
  const { t: tr } = useTranslation("strain")
  const t = vm.target
  const low = t.value ? formatValue("int", t.value.low) : ""
  const high = t.value ? formatValue("pct", t.value.high) : ""
  const text = t.value ? tr("target.range", { low, high }) : "--"
  const reason = t.value ? null : reasonCopy(t.reason, t.nightsLeft).short
  return (
    <View accessible accessibilityLabel={reason ? tr("target.spokenReason", { reason }) : tr("target.spoken", { low, high })} className="min-h-[52px] flex-row items-center gap-3 py-2">
      <View className="size-5 shrink-0 items-center justify-center">
        <Icon icon={Flame} size={20} tone="muted-foreground" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={LABEL}>{tr("target.label")}</Text>
        {!!reason && (
          <Text className={cn(CAPTION, "mt-0.5")} numberOfLines={1}>
            {reason}
          </Text>
        )}
      </View>
      <InfoButton info={STRAIN_TARGET_INFO} label={tr("target.label")} variant="card" />
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

function LoadingPrimary() {
  const { t } = useTranslation("strain")
  return (
    <SectionShell variant="card" title={t("screen.heartRate")} info={infoFor("Heart rate", t("screen.heartRate"))}>
      <View accessibilityElementsHidden>
        <IntradayHrChartSkeleton />
      </View>
    </SectionShell>
  )
}

function LoadingZones() {
  const { t } = useTranslation("strain")
  return (
    <SectionShell variant="card" title={t("screen.timeInZones")} info={infoFor("Time in zones", t("screen.timeInZones"))}>
      <View accessibilityElementsHidden>
        <ZoneBarsSkeleton variant="rows" />
        <SkeletonText className="mt-3 w-56" />
      </View>
    </SectionShell>
  )
}

function LoadingActivities() {
  const { t } = useTranslation("strain")
  return (
    <SectionShell variant="card" title={t("screen.activities")} info={infoFor("Activities", t("screen.activities"))}>
      <View accessibilityElementsHidden>
        <TimelineSkeleton rows={1} />
      </View>
    </SectionShell>
  )
}

const loadingSecondary = () => [<LoadingZones key="zones" />, <LoadingActivities key="activities" />]

/** Below the fold while a cold push slides in: the loading state's first sections. */
function BodySkeleton() {
  return (
    <>
      <LoadingPrimary />
      <View className="gap-3">{loadingSecondary()}</View>
    </>
  )
}

/** The route's loading state (pulse's StrainSkeleton). */
function StrainSkeleton() {
  const { t } = useTranslation("strain")
  return (
    <DialDetailSkeleton
      title={t("screen.title")}
      dial="strain"
      labels={[t("target.label"), t("stat.zones13"), t("stat.zones45"), t("stat.strength"), t("stat.steps")]}
      legend={t("screen.todayVsPrior")}
      primary={<LoadingPrimary />}
      bodySkeleton={<BodySkeleton />}
      secondary={loadingSecondary()}
      footer={<WeeklyTrendsSkeleton titles={[t("weekly.strain"), t("weekly.zones13"), t("weekly.zones45"), t("weekly.steps"), t("weekly.calories"), t("weekly.strength")]} />}
    />
  )
}
