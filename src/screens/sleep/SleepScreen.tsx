// Sleep `/sleep` (spec §7.4), ported from pulse src/app/(app)/sleep/page.tsx. Left out: the Sleep Stress card
// (`FEATURES.sleepStress`, off).
import { Fragment } from "react";
import { View } from "react-native";
import { clock, hmm } from "@/lib/format";
import { trendHref } from "@/lib/url";
import { getSleep } from "@/queries/sleep";
import { getWeeklyTrends, type TrendViewKey, type TrendViewVM } from "@/queries/trendView";
import type { SleepVM } from "@/queries/types";
import { cn } from "@/ui/cn";
import { Card } from "@/ui/Card";
import { InsightCard } from "@/ui/metrics/InsightCard";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { SleepStages } from "@/ui/metrics/SleepStages";
import { DetailShell } from "@/ui/shells/DetailShell";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useShellCalendar } from "@/ui/shells/ShellStatus";
import { Text } from "@/ui/Text";
import { SLEEP_INFO, TONIGHT_INFO } from "../_lib/info";
import { statProps } from "../_lib/view";
import { useScreen } from "../useScreen";
import { HoursVsNeed, SleepConsistency, SleepEfficiency } from "./SleepCards";
import { WeeklyTrends } from "../trends/WeeklyTrends";
import { SleepSkeleton } from "./SleepSkeleton";

/** Weekly Trends, in the reference app's order (sleep-28..34). */
const WEEKLY: readonly TrendViewKey[] = ["sleep", "hours", "hours_need", "restorative", "consistency", "time_in_bed", "efficiency"];

const STATUS_LEGEND = [
  ["bg-warning", "Poor"],
  ["bg-foreground-secondary", "Sufficient"],
  ["bg-optimal", "Optimal"],
] as const;

export function SleepScreen() {
  const [d] = useSelectedDay();
  const { timeZone } = useShellCalendar();
  const { data } = useScreen(async (ctx) => {
    const [vm, weekly] = await Promise.all([getSleep(ctx, d), getWeeklyTrends(WEEKLY, d, ctx)]);
    return { vm, weekly };
  }, [d]);
  // The web shows its skeleton on every navigation: another day's data is not this day's.
  const shown = data?.vm.day === d && timeZone ? data : undefined;
  return shown && timeZone ? <Sleep vm={shown.vm} weekly={shown.weekly} timeZone={timeZone} /> : <SleepSkeleton />;
}

function Sleep({ vm, weekly, timeZone }: { vm: SleepVM; weekly: TrendViewVM[]; timeZone: string }) {
  const { today } = useShellCalendar();
  const d = vm.day;
  const p = vm.performance;
  return (
    <DetailShell
      title="Sleep"
      info={SLEEP_INFO}
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={
        <ScoreDial
          variant="sleep"
          size="lg"
          value={p.value}
          reason={p.reason}
          nightsLeft={p.nightsLeft}
          provisional={p.provisional}
          tags={p.tags}
          status={p.value === null ? undefined : p.value >= 85 ? "optimal" : p.value >= 70 ? "sufficient" : "poor"}
        />
      }
      summary={
        <Card className="gap-0 px-4 py-1">
          {vm.summary.map((k, i) => (
            <Fragment key={k.key}>
              {i > 0 && <View className="h-px bg-border" />}
              <KeyStatRow variant="row" {...statProps(k, { d, today })} average={null} direction="none" />
            </Fragment>
          ))}
          <View className="mb-3 mt-1 flex-row flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-inset px-3 py-2">
            {STATUS_LEGEND.map(([swatch, word]) => (
              <View key={word} className="flex-row items-center gap-1.5">
                <View accessibilityElementsHidden className={cn("h-1 w-4 rounded-sm", swatch)} />
                <Text className="text-xs font-medium leading-4 text-foreground-secondary">{word}</Text>
              </View>
            ))}
          </View>
        </Card>
      }
      insight={vm.insight ? <InsightCard body={vm.insight} action={{ label: "Explore your sleep insights", href: trendHref("sleep", { d, today }) }} /> : undefined}
      primary={
        <SectionShell variant="card" title="Last night’s sleep" aside="vs. prior 30 days">
          <SleepStages hours={vm.hours} hr={vm.nightHr} data={vm.stages} restorative={vm.restorative} />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="need" variant="card" title="Hours vs. needed">
          <HoursVsNeed vm={vm} />
        </SectionShell>,
        <SectionShell key="consistency" variant="card" title="Sleep consistency">
          <SleepConsistency vm={vm} />
        </SectionShell>,
        <SectionShell key="efficiency" variant="card" title="Sleep efficiency">
          <SleepEfficiency vm={vm} />
        </SectionShell>,
        <SectionShell key="planner" id="planner" variant="card" title="Tonight’s sleep" info={TONIGHT_INFO}>
          <Planner vm={vm} timeZone={timeZone} />
        </SectionShell>,
      ]}
      footer={<WeeklyTrends cards={weekly} d={d} today={today} />}
    />
  );
}

function Planner({ vm, timeZone }: { vm: SleepVM; timeZone: string }) {
  const m = vm.planner;
  if (m.value === null)
    return <ReasonPlaceholder reason={m.reason} nightsLeft={m.nightsLeft} size="md" copy={m.reason === "calibrating" ? "Sleep Planner needs 7 nights to learn your wake time." : undefined} />;
  const plan = m.value;
  const row = (label: string, caption: string, time: string) => (
    <View key={label} className="min-h-[52px] flex-row items-center gap-3 py-2">
      <View className="min-w-0 flex-1">
        <Text className={cn(LABEL, "truncate")}>{label}</Text>
        <Text className={cn(CAPTION, "mt-0.5 truncate")}>{caption}</Text>
      </View>
      <Text className="font-numeric text-xl font-bold leading-6 tabular-nums">{time}</Text>
    </View>
  );
  const rows = [...plan.plans.map((q) => row(q.label, `${Math.round(q.share * 100)}% of need`, clock(q.bedtimeAt, timeZone))), row("Typical wake", plan.weekdayWake ? "Weekday wake time" : "Weekend wake time", clock(plan.wakeAt, timeZone))];
  return (
    <View className="gap-2">
      <View>
        {rows.map((r, i) => (
          <Fragment key={i}>
            {i > 0 && <View className="h-px bg-border" />}
            {r}
          </Fragment>
        ))}
      </View>
      <Text className={CAPTION}>
        Need tonight: <Text className="font-numeric tabular-nums">{hmm(plan.needMin)}</Text>
      </Text>
    </View>
  );
}

