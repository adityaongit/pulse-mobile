// Activities `/activities`: the workout journal behind Home's "Today's activities". Day groups newest first, each row
// the same timeline row as Home, a sport filter, and "Show older" a month at a time. Ported from pulse
// src/app/(app)/activities/{page,loading}.tsx. The web keeps `days` and `kind` in the URL; here they are route params.
import type { ReactNode } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { dayLabel, formatValue, hmm } from "@/lib/format"
import { activityHref } from "@/lib/url"
import { ACTIVITY_PAGE_DAYS, getActivities } from "@/queries/activities"
import type { ActivitiesVM } from "@/queries/types"
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

const KIND_LABEL: Record<ActivityKind, string> = { run: "Runs", ride: "Rides", walk: "Walks", strength: "Strength", workout: "Workouts" }
const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase"
const PILL = "h-9 shrink-0 items-center justify-center rounded-full px-4"
const PILL_TEXT = "text-xs font-bold tracking-[0.1em] uppercase"

type Group = ActivitiesVM["groups"][number]

/** The route params as the web's query: `days` (`?days=`, only past one page) and `kind` ("" is none, as the date's "" is today). */
const setQuery = ({ days, kind }: { days: number; kind: ActivityKind | null }) =>
  router.setParams({ days: days > ACTIVITY_PAGE_DAYS ? String(days) : "", kind: kind ?? "" })

export function ActivitiesScreen() {
  const sp = useLocalSearchParams<{ days?: string; kind?: string }>()
  const pages = Math.min(120, Math.max(1, Math.round(Number(sp.days) / ACTIVITY_PAGE_DAYS) || 1))
  const days = pages * ACTIVITY_PAGE_DAYS
  const { data, error, reload } = useScreen(async (ctx) => ({ timeZone: ctx.timeZone, vm: await getActivities(ctx, days) }), [days])

  if (!data) return error ? <ScreenError retry={reload} /> : <ActivitiesSkeleton />
  const { vm, timeZone } = data
  const kinds = [...new Set(vm.groups.flatMap((g) => g.items.map((a) => a.activityKind)))]
  const kind = kinds.find((k) => k === sp.kind) ?? null
  const groups = vm.groups
    .map((g) => (kind ? { ...g, items: g.items.filter((a) => a.activityKind === kind) } : g))
    .filter((g) => g.items.length || (!kind && g.day === vm.today))
  const items = groups.flatMap((g) => g.items)

  return (
    <DetailShell
      title="Activities"
      backHref="/"
      primary={
        <View className={MORE_COLUMN}>
          {items.length > 0 && <Summary items={items} days={days} />}
          {kinds.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Sport" style={{ marginHorizontal: -16, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
              {[null, ...kinds].map((k) => (
                <Pressable
                  key={k ?? "all"}
                  accessibilityRole="link"
                  accessibilityState={{ selected: kind === k }}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={() => setQuery({ days, kind: k })}
                  className={cn(PILL, kind === k && "bg-secondary")}
                >
                  <Text className={cn(PILL_TEXT, kind === k ? "text-foreground" : "text-muted-foreground")}>{k ? KIND_LABEL[k] : "All"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {groups.map((g) => (
            <Day key={g.day} g={g} today={vm.today} timeZone={timeZone} />
          ))}
          {!items.length && groups.length <= 1 && !vm.older && <EmptyState body="No workouts in the last month. Workouts you record on your Fitbit or phone appear here after they sync." />}
          {vm.older ? (
            <Pressable accessibilityRole="link" onPress={() => setQuery({ days: days + ACTIVITY_PAGE_DAYS, kind })} className="h-11 items-center justify-center self-center rounded-full px-5 active:bg-foreground/[0.06]">
              <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/85">Show older</Text>
            </Pressable>
          ) : (
            items.length > 0 && <Text className={cn(CAPTION, "text-center")}>No older activities</Text>
          )}
        </View>
      }
    />
  )
}

/** Count, total time and average activity Strain over what the list shows. */
function Summary({ items, days }: { items: Group["items"]; days: number }) {
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
    <View accessibilityLabel={`Last ${days} days`} className="gap-2">
      <Text accessibilityRole="header" className={GROUP_LABEL}>
        Last {days} days
      </Text>
      <Card className="flex-row gap-3 px-4">
        {stat(items.length, items.length === 1 ? "Activity" : "Activities")}
        {stat(hmm(minutes), "Time")}
        {stat(<Text className={avg === null ? "text-muted-foreground" : "text-strain-text"}>{formatValue("decimal1", avg)}</Text>, "Avg strain")}
      </Card>
    </View>
  )
}

function Day({ g, today, timeZone }: { g: Group; today: string; timeZone: string }) {
  return (
    <View accessibilityLabel={dayLabel(g.day, today)} className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3 px-1">
        <Text accessibilityRole="header" className={GROUP_LABEL.replace("px-1 ", "")}>
          {dayLabel(g.day, today)}
        </Text>
        <Text className="shrink font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground" numberOfLines={1}>
          {g.steps !== null && `${formatValue("grouped", g.steps)} steps`}
          {g.steps !== null && g.dayStrain !== null && " · "}
          {g.dayStrain !== null && (
            <>
              Day strain <Text className="font-bold text-strain-text">{formatValue("decimal1", g.dayStrain)}</Text>
            </>
          )}
        </Text>
      </View>
      {g.items.length ? (
        // 6 px inset in a 16 px card around the rows' 10 px radius, as on Home (spec §2.4).
        <Card className="p-1.5">
          <View className="gap-1.5">
            {g.items.map((a) => (
              <ActivityCard key={a.id} name={a.name} kind={a.activityKind} strain={a.strain} start={a.start} end={a.end} distanceKm={a.distanceKm} paceS={a.paceS} href={activityHref(a.id)} timeZone={timeZone} />
            ))}
          </View>
        </Card>
      ) : (
        <Card className="px-4">
          <Text className={CAPTION}>No activities yet today. Workouts appear after Fitbit syncs them.</Text>
        </Card>
      )}
    </View>
  )
}

/** Activities' loading state: the summary card and two day groups at their final size (spec §5.19). */
function ActivitiesSkeleton() {
  return (
    <DetailShell
      loading
      title="Activities"
      primary={
        <View className={MORE_COLUMN}>
          <View className="gap-2">
            <Text className={GROUP_LABEL}>Last 30 days</Text>
            <Card style={{ height: 92 }} />
          </View>
          {[1, 2].map((n) => (
            <View key={n} className="gap-2">
              <Text className={GROUP_LABEL}>{" "}</Text>
              <Card className="p-1.5">
                <TimelineSkeleton rows={n} />
              </Card>
            </View>
          ))}
        </View>
      }
    />
  )
}
