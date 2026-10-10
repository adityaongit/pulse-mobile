// Recovery `/recovery?d=` (spec §7.2, §11 R34): the ring, today's inputs against the last 30 days, behaviours, trends.
// Ported from pulse src/app/(app)/recovery/{page,loading}.tsx.
import { useLocalSearchParams } from "expo-router"
import { dayHref, parseDay, trendHref } from "@/lib/url"
import { getRecovery } from "@/queries/recovery"
import { getWeeklyTrends, type TrendViewKey } from "@/queries/trendView"
import { todayOf } from "@/queries/common"
import { Card } from "@/ui/Card"
import { InsightCard } from "@/ui/metrics/InsightCard"
import { KeyStatRow } from "@/ui/metrics/KeyStatRow"
import { ScoreDial } from "@/ui/metrics/ScoreDial"
import { DetailShell } from "@/ui/shells/DetailShell"
import { RECOVERY_INFO } from "@/screens/_lib/info"
import { statProps, TodayVsLegend } from "@/screens/_lib/view"
import { WeeklyTrends, WeeklyTrendsSkeleton } from "@/screens/trends/WeeklyTrends"
import { useScreen } from "@/screens/useScreen"
import { BehaviorInsights } from "./BehaviorInsights"
import { DialDetailSkeleton, Divided, ScreenError } from "./shared"

/** Weekly Trends: Recovery and HRV as captured (recovery-12..15), then the other contributors in row order. */
const WEEKLY: readonly TrendViewKey[] = ["recovery", "hrv", "rhr", "resp", "sleep"]

export function RecoveryScreen() {
  const { d: raw } = useLocalSearchParams<{ d?: string }>()
  const { data, error, reload } = useScreen(async (ctx) => {
    const today = todayOf(ctx)
    const { d } = parseDay(raw, today)
    const [vm, weekly] = await Promise.all([getRecovery(ctx, d), getWeeklyTrends(WEEKLY, d, ctx)])
    return { d, today, vm, weekly }
  }, [raw])

  if (!data) return error ? <ScreenError retry={reload} /> : <RecoverySkeleton />
  const { d, today, vm, weekly } = data
  const r = vm.recovery

  return (
    <DetailShell
      title="Recovery"
      info={RECOVERY_INFO}
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={<ScoreDial variant="recovery" size="lg" value={r.value} reason={r.reason} nightsLeft={r.nightsLeft} provisional={r.provisional} tags={r.tags} />}
      summary={
        <Card className="gap-0 px-4 py-1">
          <Divided>
            {vm.summary.map((k) => (
              <KeyStatRow key={k.key} variant="row" {...statProps(k, { d, today })} />
            ))}
          </Divided>
          <TodayVsLegend period="last 30 days" />
        </Card>
      }
      insight={vm.insight ? <InsightCard body={vm.insight} action={{ label: "Explore your recovery insights", href: trendHref("recovery", { d, today }) }} /> : null}
      primary={<BehaviorInsights chips={vm.behaviors} href={dayHref("/journal/insights", d, today)} />}
      footer={<WeeklyTrends cards={weekly} d={d} today={today} />}
    />
  )
}

/** The route's loading state: the shell with each section's own box (pulse's RecoverySkeleton). */
function RecoverySkeleton() {
  return (
    <DialDetailSkeleton
      title="Recovery"
      dial="recovery"
      labels={["Heart rate variability", "Resting heart rate", "Respiratory rate", "Sleep performance"]}
      legend="Today vs. last 30 days"
      footer={<WeeklyTrendsSkeleton titles={["Recovery", "Heart Rate Variability", "Resting Heart Rate", "Respiratory Rate", "Sleep Performance"]} />}
    />
  )
}
