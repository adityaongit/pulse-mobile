// Activity `/activity/[id]` (spec §7.4). No date switcher; back falls back to that day's Strain. Ported from pulse
// src/app/(app)/activity/[id]/{page,loading}.tsx. Not ported, because the web gates them behind flags that are off
// (src/lib/features.ts): WorkoutBanner (FEATURES.strengthTrainer) and the cardio / muscular split (FEATURES.muscularLoad).
import { ScrollView, useWindowDimensions, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { deltaTone } from "@/lib/bands"
import { clock, dayLabel, formatValue } from "@/lib/format"
import { dayHref } from "@/lib/url"
import { getActivity } from "@/queries/activity"
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
import { hrSeries, STAT_ICON, statProps } from "@/screens/_lib/view"
import { ScreenError } from "@/screens/recovery/shared"
import { useScreen } from "@/screens/useScreen"
import { ActivityMenu } from "./ActivityMenu"
import { CoachGlance } from "./CoachGlance"
import { coachReady } from "./coachStub"

const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
/** The profile, where max heart rate (and so the zones) is set. */
const HR_SETTINGS = "/settings?s=account"

export function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, error, reload } = useScreen(async (ctx) => {
    const [vm, coach] = await Promise.all([getActivity(ctx, id), coachReady(ctx)])
    return { vm, coach, today: todayOf(ctx), timeZone: ctx.timeZone }
  }, [id])

  if (!data) return error ? <ScreenError retry={reload} /> : <ActivitySkeleton />
  const { vm, coach, today, timeZone } = data
  // The web answers an unknown id with its 404 page; React Native has none of its own to show, so this is the screen's empty state.
  if (!vm) return <DetailShell title="Activity" primary={<EmptyState body="This activity isn’t available." />} />

  const noHr = vm.hr.value === null && vm.zones.value === null
  const tiles = vm.stats.filter((k) => !(noHr && k.metric.value === null))
  const strainHref = dayHref("/strain", vm.day, today)
  const question = `Tell me about my ${vm.name.toLowerCase()} on ${dayLabel(vm.day, today).toLowerCase()}.`

  return (
    <View className="flex-1">
      <DetailShell
        title={vm.name}
        subtitle={`${dayLabel(vm.day, today)} ${clock(vm.start, timeZone)} to ${clock(vm.end, timeZone)}`}
        align="start"
        titleIcon={<Icon icon={ACTIVITY_ICON[vm.kind]} size={24} tone="foreground" strokeWidth={1.75} />}
        backHref={strainHref}
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
              <View accessibilityLabel="Heart rate">
                <IntradayHrChart variant="activity" data={hrSeries(vm.hr, vm.maxHr)} />
              </View>
              <View accessibilityLabel="Time in zones">
                <ZoneBars variant="rows" data={vm.zones} note={vm.zoneNote} noteLink={{ label: "View heart-rate settings", href: HR_SETTINGS }} emptyCopy="No heart-rate zones for this activity." />
              </View>
            </View>
          )
        }
        secondary={[
          tiles.length > 0 && (
            <SectionShell key="stats" variant="section" title="Key statistics" aside="vs. 30-day average">
              <StatTiles tiles={tiles} />
            </SectionShell>
          ),
          // A titled section like Key statistics beside it. Without heart rate there is nothing to recover from, and the notice says why.
          !noHr && (
            <SectionShell key="hrr" variant="section" title="Heart rate recovery">
              <Card className="px-4">
                <HeartRateRecovery hrr={vm.hrr} />
              </Card>
            </SectionShell>
          ),
        ].filter((x) => x !== false)}
        // With the coach set up, its pill takes the insight's place (activity-01, spec §11 R44); without it, the templated insight.
        footer={!coach && vm.insight ? <InsightCard body={vm.insight} /> : null}
      />
      {coach && <CoachGlance id={vm.id} question={question} />}
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
function Hero({ vm }: { vm: ActivityVM }) {
  const s = vm.strain.value
  return (
    <View className="w-full gap-2">
      <View className="flex-row flex-wrap items-end gap-x-10 gap-y-4">
        <HeroStat label="Activity strain" value={formatValue("decimal1", s)} average={vm.strainAverage} format="decimal1" valueClass={s === null ? "text-muted-foreground" : "text-strain-text"} raw={s} />
        {vm.steps && <HeroStat label="Activity steps" value={formatValue("grouped", vm.steps.value)} average={vm.steps.average} format="grouped" raw={vm.steps.value} />}
      </View>
      {/* The band-off notice under the hero already says why; repeating it here was the first of three copies. */}
      {s === null && vm.hr.value !== null && <ReasonPlaceholder reason={vm.strain.reason} size="sm" />}
    </View>
  )
}

function HeroStat({ label, value, raw, average, format, valueClass }: { label: string; value: string; raw: number | null; average: number | null; format: "decimal1" | "grouped"; valueClass?: string }) {
  const dir = raw !== null && average !== null ? deltaTone("neutral", raw, average).dir : null
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Text className={cn("font-numeric text-[34px] font-bold leading-none tabular-nums", valueClass)}>{value}</Text>
        {dir && average !== null && (
          <View accessible accessibilityLabel={`30-day average for this kind of activity ${formatValue(format, average)}`}>
            <StatusChip tone="neutral" delta={dir}>
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
  const what = "heart rate, zones or strain for this activity"
  return reason === "band_not_worn" ? `Band not worn, so there's no ${what}.` : `Too little heart-rate data to show ${what}.`
}

function HeartRateRecovery({ hrr }: { hrr: ActivityVM["hrr"] }) {
  if (hrr.value === null) return <ReasonPlaceholder reason="insufficient_hr_data" size="md" copy="Not enough heart-rate data after the workout." />
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-3">
        <ValueUnit value={formatValue("int", hrr.value.value)} unit="bpm" className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]" />
        <StatusChip tone={hrr.value.tone}>{hrr.value.label}</StatusChip>
      </View>
      <Text className={CAPTION}>Drop in the first 60 seconds after you stopped. Above 20 is typical for fit adults.</Text>
    </View>
  )
}

/** Three tiles in two columns (the web's `grid grid-cols-2 gap-3`). */
function StatsSkeleton() {
  const { width } = useWindowDimensions()
  return (
    <View accessibilityElementsHidden className="flex-row flex-wrap gap-3">
      {(
        [
          ["avgHr", "Average heart rate"],
          ["maxHr", "Max heart rate"],
          ["calories", "Calories"],
        ] as const
      ).map(([k, l]) => (
        <View key={k} style={{ width: (width - 32 - 12) / 2 }}>
          <KeyStatRowSkeleton variant="tile" label={l} icon={<Icon icon={STAT_ICON[k]} size={20} tone="muted-foreground" />} />
        </View>
      ))}
    </View>
  )
}

/** The route's loading state (pulse's ActivitySkeleton). */
function ActivitySkeleton() {
  return (
    <DetailShell
      loading
      title="Activity"
      align="start"
      hero={
        <View accessibilityElementsHidden className="w-full gap-2">
          <View className="flex-row flex-wrap items-end gap-x-10 gap-y-3">
            {["Activity strain", "Duration"].map((l) => (
              <View key={l}>
                <SkeletonText className="w-14" lh={34} fs={34} />
                <Text className={cn(LABEL, "mt-2 text-foreground-secondary")}>{l}</Text>
              </View>
            ))}
          </View>
          <SkeletonText className="w-24" />
        </View>
      }
      primary={
        <View accessibilityElementsHidden className="gap-6">
          <IntradayHrChartSkeleton variant="activity" />
          <View>
            <ZoneBarsSkeleton variant="rows" />
            <SkeletonText className="mt-3 w-56" />
          </View>
        </View>
      }
      secondary={[
        <SectionShell key="stats" variant="section" title="Key statistics" aside="vs. 30-day average">
          <StatsSkeleton />
        </SectionShell>,
        <SectionShell key="hrr" variant="section" title="Heart rate recovery">
          <Card accessibilityElementsHidden className="justify-center px-4">
            <Skeleton className="h-24 rounded-lg bg-muted/60" />
          </Card>
        </SectionShell>,
      ]}
      footer={<InsightCardSkeleton />}
    />
  )
}
