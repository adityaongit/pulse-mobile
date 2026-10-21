// Activity `/activity/[id]` (spec §7.4). No date switcher; back falls back to that day's Strain. Ported from pulse
// src/app/(app)/activity/[id]/{page,loading}.tsx. Left out while their flags are off
// (src/lib/features.ts): WorkoutBanner (FEATURES.strengthTrainer) and the cardio / muscular split (FEATURES.muscularLoad).
import { ScrollView, useWindowDimensions, View } from "react-native"
import { useTranslation } from "react-i18next"
import { useLocalSearchParams } from "expo-router"
import { deltaTone } from "@/lib/bands"
import { clock, dayLabel, dayPhrase, formatValue } from "@/lib/format"
import { i18n } from "@/i18n/config"
import { dayHref } from "@/lib/url"
import { getActivity } from "@/queries/activity"
import { getActivityExtras } from "@/queries/mobileExtras"
import { todayOf } from "@/queries/common"
import type { ActivityVM } from "@/queries/types"
import { cn } from "@/ui/cn"
import { Card } from "@/ui/Card"
import { Icon } from "@/ui/Icon"
import { Skeleton, SkeletonText } from "@/ui/Skeleton"
import { Text } from "@/ui/Text"
import { IntradayHrChart, IntradayHrChartSkeleton } from "@/ui/charts/IntradayHrChart"
import { ZoneBars, ZoneBarsSkeleton } from "@/ui/charts/ZoneBars"
import { ACTIVITY_ICON } from "@/ui/metrics/ActivityCard"
import { InsightCard, InsightCardSkeleton } from "@/ui/metrics/InsightCard"
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow"
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives"
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder"
import { DetailShell } from "@/ui/shells/DetailShell"
import { EmptyState } from "@/ui/shells/EmptyState"
import { SectionShell } from "@/ui/shells/SectionShell"
import { hrSeries, STAT_ICON, statProps, zoneBars } from "@/screens/_lib/view"
import { ScreenError } from "@/screens/recovery/shared"
import { useScreen } from "@/screens/useScreen"
import { TrainingEffectCard } from "@/screens/strain/TrainingCards"
import { ActivityCostCard } from "./ActivityCost"
import { ActivityMenu } from "./ActivityMenu"
import { CoachGlance } from "./CoachGlance"
import { useCoachSetup, useHasCoachKey } from "@/coach/session"

const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
/** The profile, where max heart rate (and so the zones) is set. */
const HR_SETTINGS = "/settings?s=account"

// The id is a Google resource name, so activityHref encodes it; the web page decodes it (decodeURIComponent), as the nap route does.
const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function ActivityScreen() {
  const { t } = useTranslation("strain")
  const { id: raw } = useLocalSearchParams<{ id: string }>()
  const id = decode(raw)
  const { data, error, reload } = useScreen(async (ctx) => {
    const [vm, extras] = await Promise.all([getActivity(id, ctx), getActivityExtras(id, ctx)])
    return { vm: vm && { ...vm, ...extras }, today: todayOf(ctx), timeZone: ctx.timeZone }
  }, ["activity", id])
  // The coach is set up: a provider key saved (pulse's coachReady).
  const coach = useHasCoachKey()
  const autoAnalysis = useCoachSetup()?.autoAnalysis ?? true

  if (!data) return error ? <ScreenError retry={reload} /> : <ActivitySkeleton />
  const { vm, today, timeZone } = data
  // The web answers an unknown id with its 404 page; React Native has none of its own to show, so this is the screen's empty state.
  if (!vm) return <DetailShell title={t("activity.title")} primary={<EmptyState body={t("activity.unavailable")} />} />

  const noHr = vm.hr.value === null && vm.zones.value === null
  const tiles = vm.stats.filter((k) => !(noHr && k.metric.value === null))
  const strainHref = dayHref("/strain", vm.day, today)
  const question = t("activity.question", { name: vm.name.toLowerCase(), when: dayPhrase(vm.day, today) })

  return (
    <View className="flex-1">
      <DetailShell
        title={vm.name}
        bodySkeleton={<BodySkeleton />}
        subtitle={t("activity.subtitle", { day: dayLabel(vm.day, today), start: clock(vm.start, timeZone), end: clock(vm.end, timeZone) })}
        align="start"
        titleIcon={<Icon icon={ACTIVITY_ICON[vm.kind]} size={24} tone="foreground" strokeWidth={1.75} />}
        backHref={strainHref}
        // The coach pill takes the foot of the screen, full width, in place of the round coach button.
        floatingAction={!coach}
        action={<ActivityMenu strainHref={strainHref} settingsHref={HR_SETTINGS} />}
        hero={<Hero vm={vm} />}
        // the reference app draws the heart rate and the zone rows on the ground, not in cards [latest-activity-1].
        primary={
          noHr ? (
            <Card className="items-center gap-0 px-4 py-2">
              <ReasonPlaceholder reason={vm.hr.reason} size="md" copy={noHrCopy(vm.hr.reason)} />
            </Card>
          ) : (
            <View className="gap-6">
              <View accessibilityLabel={t("activity.heartRate")}>
                <IntradayHrChart variant="activity" data={hrSeries(vm.hr, vm.maxHr)} />
              </View>
              <View accessibilityLabel={t("activity.timeInZones")}>
                <ZoneBars variant="rows" data={zoneBars(vm.zones)} note={vm.zoneNote} noteLink={{ label: t("activity.viewHrSettings"), href: HR_SETTINGS }} emptyCopy={t("activity.noZones")} />
              </View>
            </View>
          )
        }
        secondary={[
          tiles.length > 0 && (
            <SectionShell key="stats" variant="section" title={t("activity.keyStats")} aside={t("activity.vsAverage")}>
              <StatTiles tiles={tiles} />
            </SectionShell>
          ),
          // A titled section like Key statistics beside it. Without heart rate there is nothing to recover from, and the notice says why.
          !noHr && <TrainingEffectCard key="te" te={vm.trainingEffect} />,
          !noHr && (
            <SectionShell key="hrr" variant="section" title={t("activity.hrRecovery")}>
              <Card className="px-4">
                <HeartRateRecovery hrr={vm.hrr} />
              </Card>
            </SectionShell>
          ),
          vm.cost && <SectionShell key="cost" variant="section" title={t("activity.recoveryCost")}><ActivityCostCard cost={vm.cost} /></SectionShell>,
        ].filter((x) => x !== false && x !== null)}
        // With the coach set up, its pill takes the insight's place (activity-01, spec §11 R44); without it, the templated insight.
        footer={!coach && vm.insight ? <InsightCard body={vm.insight} /> : null}
      />
      {coach && <CoachGlance id={vm.id} question={question} auto={autoAnalysis} />}
    </View>
  )
}

/**
 * Key statistics: one scrolling row, the next tile peeking at the edge (activity-03), bleeding to the edges. A tile is
 * 1 / 2.15 of the column less the gap, as the web's `w-[calc((100%-12px)/2.15)]`, and the row snaps tile by tile.
 */
function StatTiles({ tiles }: { tiles: ActivityVM["stats"] }) {
  const { width } = useWindowDimensions()
  const tile = (width - 32 - 12) / 2.15
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={tile + 12}
      decelerationRate="fast"
      style={{ marginHorizontal: -16, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4, gap: 12 }}
    >
      {tiles.map((k) => (
        <View key={k.key} style={{ width: tile }} className="shrink-0">
          <KeyStatRow variant="tile" {...statProps(k)} className="w-full" />
        </View>
      ))}
    </ScrollView>
  )
}

/**
 * The activity hero (activity-01, activity-05): strain in blue with a chip of this kind's 30-day average, then the steps
 * in the workout for runs and walks.
 */
function Hero({ vm }: { vm: ActivityVM & Awaited<ReturnType<typeof getActivityExtras>> }) {
  const { t } = useTranslation("strain")
  const s = vm.strain.value
  return (
    <View className="w-full gap-2">
      <View className="flex-row flex-wrap items-end gap-x-10 gap-y-4">
        <HeroStat label={t("activity.heroStrain")} value={formatValue("pct", s)} average={vm.strainAverage} format="pct" valueClass={s === null ? "text-muted-foreground" : "text-strain-text"} raw={s} />
        {vm.steps && <HeroStat label={t("activity.heroSteps")} value={formatValue("grouped", vm.steps.value)} average={vm.steps.average} format="grouped" raw={vm.steps.value} />}
      </View>
      {/* The band-off notice under the hero already says why; so it is not repeated here. */}
      {s === null && vm.hr.value !== null && <ReasonPlaceholder reason={vm.strain.reason} size="sm" />}
    </View>
  )
}

function HeroStat({ label, value, raw, average, format, valueClass }: { label: string; value: string; raw: number | null; average: number | null; format: "pct" | "grouped"; valueClass?: string }) {
  const { t } = useTranslation("strain")
  const dir = raw !== null && average !== null ? deltaTone("neutral", raw, average).dir : null
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Text className={cn("font-numeric text-[34px] font-bold leading-none tabular-nums", valueClass)}>{value}</Text>
        {dir && average !== null && (
          <View accessible accessibilityLabel={t("activity.spokenAverage", { value: formatValue(format, average) })}>
            <StatusChip tone="neutral" delta={dir} className="self-center">
              {formatValue(format, average)}
            </StatusChip>
          </View>
        )}
      </View>
      <Text className={cn(STAT_LABEL, "mt-2")}>{label}</Text>
    </View>
  )
}

/** The one band-off notice: what is missing and why. */
function noHrCopy(reason: string | null | undefined) {
  return reason === "band_not_worn" ? i18n.t("strain:activity.noHrBand") : i18n.t("strain:activity.noHrData")
}

function HeartRateRecovery({ hrr }: { hrr: ActivityVM["hrr"] }) {
  const { t } = useTranslation("strain")
  if (hrr.value === null) return <ReasonPlaceholder reason="insufficient_hr_data" size="md" copy={t("activity.hrrNone")} />
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-3">
        <ValueUnit value={formatValue("int", hrr.value.value)} unit="bpm" className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]" />
        <StatusChip tone={hrr.value.tone} className="self-center">{hrr.value.label}</StatusChip>
      </View>
      <Text className={CAPTION}>{t("activity.hrrNote")}</Text>
    </View>
  )
}

/** Three tiles in two columns (the web's `grid grid-cols-2 gap-3`). */
function StatsSkeleton() {
  const { t } = useTranslation("strain")
  const { width } = useWindowDimensions()
  return (
    <View accessibilityElementsHidden className="flex-row flex-wrap gap-3">
      {(
        [
          ["avgHr", t("stat.avgHr")],
          ["maxHr", t("stat.maxHr")],
          ["calories", t("stat.calories")],
        ] as const
      ).map(([k, l]) => (
        <View key={k} style={{ width: (width - 32 - 12) / 2 }}>
          <KeyStatRowSkeleton variant="tile" label={l} icon={<Icon icon={STAT_ICON[k]} size={20} tone="muted-foreground" />} />
        </View>
      ))}
    </View>
  )
}

function LoadingPrimary() {
  return (
    <View accessibilityElementsHidden className="gap-6">
      <IntradayHrChartSkeleton variant="activity" />
      <View>
        <ZoneBarsSkeleton variant="rows" />
        <SkeletonText className="mt-3 w-56" />
      </View>
    </View>
  )
}

function LoadingStats() {
  const { t } = useTranslation("strain")
  return (
    <SectionShell variant="section" title={t("activity.keyStats")} aside={t("activity.vsAverage")}>
      <StatsSkeleton />
    </SectionShell>
  )
}

function LoadingRecovery() {
  const { t } = useTranslation("strain")
  return (
    <SectionShell variant="section" title={t("activity.hrRecovery")}>
      <Card accessibilityElementsHidden className="justify-center px-4">
        <Skeleton className="h-24 rounded-lg bg-skeleton" />
      </Card>
    </SectionShell>
  )
}

const loadingSecondary = () => [<LoadingStats key="stats" />, <LoadingRecovery key="hrr" />]

/** Below the fold while a cold push slides in: the loading state's first sections. */
function BodySkeleton() {
  return (
    <>
      <LoadingPrimary />
      <View className="gap-3">{loadingSecondary()}</View>
    </>
  )
}

/** The route's loading state (pulse's ActivitySkeleton). */
function ActivitySkeleton() {
  const { t } = useTranslation("strain")
  return (
    <DetailShell
      loading
      title={t("activity.title")}
      align="start"
      hero={
        <View accessibilityElementsHidden className="w-full gap-2">
          <View className="flex-row flex-wrap items-end gap-x-10 gap-y-3">
            {[t("activity.heroStrain"), t("activity.heroDuration")].map((l) => (
              <View key={l}>
                <SkeletonText className="w-14" lh={34} fs={34} />
                <Text className={cn(LABEL, "mt-2 text-foreground-secondary")}>{l}</Text>
              </View>
            ))}
          </View>
          <SkeletonText className="w-24" />
        </View>
      }
      primary={<LoadingPrimary />}
      bodySkeleton={<BodySkeleton />}
      secondary={loadingSecondary()}
      footer={<InsightCardSkeleton />}
    />
  )
}
