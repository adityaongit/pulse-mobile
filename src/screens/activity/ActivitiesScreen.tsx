// Activities `/activities`: the workout journal behind Home's "Today's activities". Day groups newest first, each row
// the same timeline row as Home, a sport filter, and "Show older" a month at a time. Ported from pulse
// src/app/(app)/activities/{page,loading}.tsx. The web keeps `days` and `kind` in the URL; here they are route params.
import type { ReactNode } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { Trans, useTranslation } from "react-i18next"
import { router, useLocalSearchParams } from "expo-router"
import { dayLabel, formatValue, hmm } from "@/lib/format"
import { activityHref } from "@/lib/url"
import { ACTIVITY_PAGE_DAYS, getActivities } from "@/queries/activities"
import type { ActivitiesVM } from "@/queries/types"
import { i18n } from "@/i18n/config"
import { cn } from "@/ui/cn"
import { Card } from "@/ui/Card"
import { Text } from "@/ui/Text"
import { ActivityCard, type ActivityKind, TimelineSkeleton } from "@/ui/metrics/ActivityCard"
import { DetailShell } from "@/ui/shells/DetailShell"
import { EmptyState } from "@/ui/shells/EmptyState"
import { GROUP_LABEL, MORE_COLUMN } from "@/ui/shells/LinkList"
import { CAPTION } from "@/screens/_lib/view"
import { ScreenError } from "@/screens/recovery/shared"
import { useScreen } from "@/screens/useScreen"
import { Press } from "@/ui/Press";
import { ActivityCostList, DetectedNote, DetectedRow } from "./ActivityCost"

const KIND_LABEL: Record<ActivityKind, () => string> = {
  run: () => i18n.t("strain:activities.kindRun"),
  ride: () => i18n.t("strain:activities.kindRide"),
  walk: () => i18n.t("strain:activities.kindWalk"),
  strength: () => i18n.t("strain:activities.kindStrength"),
  workout: () => i18n.t("strain:activities.kindWorkout"),
}
const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
const PILL = "h-9 shrink-0 items-center justify-center rounded-full px-4"
const PILL_TEXT = "text-xs font-bold tracking-[0.1em] uppercase"

type Group = ActivitiesVM["groups"][number]

/** The route params as the web's query: `days` (`?days=`, only past one page) and `kind` ("" is none, as the date's "" is today). */
const setQuery = ({ days, kind }: { days: number; kind: ActivityKind | null }) =>
  router.setParams({ days: days > ACTIVITY_PAGE_DAYS ? String(days) : "", kind: kind ?? "" })

export function ActivitiesScreen() {
  const { t } = useTranslation("strain")
  const sp = useLocalSearchParams<{ days?: string; kind?: string }>()
  const pages = Math.min(120, Math.max(1, Math.round(Number(sp.days) / ACTIVITY_PAGE_DAYS) || 1))
  const days = pages * ACTIVITY_PAGE_DAYS
  const { data, error, reload } = useScreen(async (ctx) => ({ timeZone: ctx.timeZone, vm: await getActivities(days, ctx) }), ["activities", days])

  if (!data) return error ? <ScreenError retry={reload} /> : <ActivitiesSkeleton />
  const { vm, timeZone } = data
  const kinds = [...new Set(vm.groups.flatMap((g) => g.items.map((a) => a.activityKind)))]
  const kind = kinds.find((k) => k === sp.kind) ?? null
  const groups = vm.groups
    // Detected activities have no sport to filter by: they show under "All" only.
    .map((g) => (kind ? { ...g, items: g.items.filter((a) => a.activityKind === kind), detected: [] } : g))
    .filter((g) => g.items.length || (!kind && (g.detected.length || g.day === vm.today)))
  const items = groups.flatMap((g) => g.items)
  const costs = vm.cost?.items.filter((x) => !kind || x.kind === kind) ?? []

  return (
    <DetailShell
      title={t("activities.title")}
      bodySkeleton={<LoadingPrimary />}
      backHref="/"
      primary={
        <View className={MORE_COLUMN}>
          {items.length > 0 && <Summary items={items} days={days} />}
          {kinds.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={t("activities.sport")} style={{ marginHorizontal: -16, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
              {[null, ...kinds].map((k) => (
                <Pressable
                  key={k ?? "all"}
                  accessibilityRole="link"
                  accessibilityState={{ selected: kind === k }}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={() => setQuery({ days, kind: k })}
                  className={cn(PILL, kind === k && "bg-secondary")}
                >
                  <Text className={cn(PILL_TEXT, kind === k ? "text-foreground" : "text-muted-foreground")}>{k ? KIND_LABEL[k]() : t("activities.all")}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {vm.cost && costs.length > 0 && (
            <View className="gap-2">
              <Text accessibilityRole="header" className={GROUP_LABEL}>{t("activities.recoveryCost")}</Text>
              <ActivityCostList vm={vm.cost} items={costs} />
            </View>
          )}
          {groups.map((g) => (
            <Day key={g.day} g={g} today={vm.today} timeZone={timeZone} />
          ))}
          {groups.some((g) => g.detected.length > 0) && <DetectedNote className="px-1" />}
          {!items.length && groups.length <= 1 && !vm.older && <EmptyState body={t("activities.empty")} />}
          {vm.older ? (
            <Press activeBg="bg-fill-faint" accessibilityRole="link" onPress={() => setQuery({ days: days + ACTIVITY_PAGE_DAYS, kind })} className="h-11 items-center justify-center self-center rounded-full px-5">
              <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground-body">{t("activities.showOlder")}</Text>
            </Press>
          ) : (
            items.length > 0 && <Text className={cn(CAPTION, "text-center")}>{t("activities.noOlder")}</Text>
          )}
        </View>
      }
    />
  )
}

/** Count, total time and average activity Strain over what the list shows. */
function Summary({ items, days }: { items: Group["items"]; days: number }) {
  const { t } = useTranslation("strain")
  const minutes = items.reduce((m, a) => m + (a.end - a.start) / 60_000, 0)
  const strains = items.flatMap((a) => (a.strain.value === null ? [] : [a.strain.value]))
  const avg = strains.length ? strains.reduce((a, b) => a + b, 0) / strains.length : null
  const stat = (value: ReactNode, label: string) => (
    <View className="min-w-0 flex-1 gap-1">
      <Text className="font-numeric text-2xl font-bold leading-7 tabular-nums">{value}</Text>
      <Text className={STAT_LABEL}>{label}</Text>
    </View>
  )
  return (
    <View accessibilityLabel={t("activities.lastDays", { count: days })} className="gap-2">
      <Text accessibilityRole="header" className={GROUP_LABEL}>
        {t("activities.lastDays", { count: days })}
      </Text>
      <Card className="flex-row gap-3 px-4">
        {stat(items.length, t("activities.statActivity", { count: items.length }))}
        {stat(hmm(minutes), t("activities.statTime"))}
        {stat(<Text className={avg === null ? "text-muted-foreground" : "text-strain-text"}>{formatValue("pct", avg)}</Text>, t("activities.statAvgStrain"))}
      </Card>
    </View>
  )
}

function Day({ g, today, timeZone }: { g: Group; today: string; timeZone: string }) {
  const { t } = useTranslation("strain")
  return (
    <View accessibilityLabel={dayLabel(g.day, today)} className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3 px-1">
        <Text accessibilityRole="header" className={GROUP_LABEL.replace("px-1 ", "")}>
          {dayLabel(g.day, today)}
        </Text>
        <Text className="shrink font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground" numberOfLines={1}>
          {g.steps !== null && t("activities.steps", { value: formatValue("grouped", g.steps) })}
          {g.steps !== null && g.dayStrain !== null && " · "}
          {g.dayStrain !== null && (
            <Trans t={t} i18nKey="activities.dayStrain" values={{ value: formatValue("pct", g.dayStrain) }} components={{ b: <Text className="font-bold text-strain-text" /> }} />
          )}
        </Text>
      </View>
      {g.items.length || g.detected.length ? (
        // 6 px inset in a 16 px card around the rows' 10 px radius, as on Home (spec §2.4). Recorded and detected rows
        // in one time order, newest first.
        <Card className="p-1.5">
          <View className="gap-1.5">
            {[
              ...g.items.map((a) => ({ start: a.start, row: <ActivityCard key={a.id} name={a.name} kind={a.activityKind} strain={a.strain} start={a.start} end={a.end} distanceKm={a.distanceKm} paceS={a.paceS} href={activityHref(a.id)} timeZone={timeZone} /> })),
              ...g.detected.map((d) => ({ start: d.start, row: <DetectedRow key={`detected-${d.start}`} item={d} timeZone={timeZone} /> })),
            ]
              .sort((a, b) => b.start - a.start)
              .map((x) => x.row)}
          </View>
        </Card>
      ) : (
        <Card className="px-4">
          <Text className={CAPTION}>{t("activities.noneToday")}</Text>
        </Card>
      )}
    </View>
  )
}

function LoadingPrimary() {
  const { t } = useTranslation("strain")
  return (
    <View className={MORE_COLUMN}>
      <View className="gap-2">
        <Text className={GROUP_LABEL}>{t("activities.lastDays", { count: 30 })}</Text>
        <Card style={{ height: 92 }} />
      </View>
      {[1, 2].map((n) => (
        <View key={n} className="gap-2">
          <Text className={GROUP_LABEL}>{" "}</Text>
          <Card className="p-1.5">
            <TimelineSkeleton rows={n} />
          </Card>
        </View>
      ))}
    </View>
  )
}

/** Activities' loading state: the summary card and two day groups at their final size (spec §5.19). */
function ActivitiesSkeleton() {
  const { t } = useTranslation("strain")
  return (
    <DetailShell
      loading
      title={t("activities.title")}
      primary={<LoadingPrimary />}
      bodySkeleton={<LoadingPrimary />}
    />
  )
}
