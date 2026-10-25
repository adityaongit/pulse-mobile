// Sleep `/sleep` (spec §7.4), ported from pulse src/app/(app)/sleep/page.tsx. Left out: the Sleep Stress card
// (`FEATURES.sleepStress`, off).
import { useCoachSetup } from "@/coach/session";
import { coachReady } from "@/coach/providers";
import { ActivityCoach } from "../coach/ActivityCoach";
import { Fragment } from "react";
import { View } from "react-native";
import { Trans, useTranslation } from "react-i18next";
import { clock, hmm } from "@/lib/format";
import { trendHref } from "@/lib/url";
import type { QueryCtx } from "@/queries/common";
import { getSleepExtras, type SleepExtras } from "@/queries/mobileExtras";
import { getSleep } from "@/queries/sleep";
import { getWeeklyTrends, type TrendViewKey, type TrendViewVM } from "@/queries/trendView";
import type { SleepVM } from "@/queries/types";
import { cn } from "@/ui/cn";
import { Card, INSET_ROW } from "@/ui/Card";
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
import { cardInfoFor } from "./cardInfoFor";
import { HoursVsNeed, SleepConsistency, SleepEfficiency } from "./SleepCards";
import { WeeklyTrends } from "../trends/WeeklyTrends";
import { SLEEP_BODY_SKELETON, SleepSkeleton } from "./SleepSkeleton";

/** Weekly Trends, in the reference app's order (sleep-28..34). */
const WEEKLY: readonly TrendViewKey[] = ["sleep", "hours", "hours_need", "restorative", "consistency", "time_in_bed", "efficiency"];

const STATUS_LEGEND = [
  ["bg-warning", "poor"],
  ["bg-foreground-secondary", "sufficient"],
  ["bg-optimal", "optimal"],
] as const;

/** The page's query and key; Home prefetches them, so Sleep opens with content. */
export const sleepQuery = (d: string) => async (ctx: QueryCtx) => {
  const [sleep, weekly] = await Promise.all([getSleep(d, ctx), getWeeklyTrends(WEEKLY, d, ctx)]);
  const extras = await getSleepExtras(d, ctx, sleep.stages);
  // The reference app's three rows, each opening its Trend View (restorative sleep sits under the stages instead; the
  // Sleep Stress row stays out, as on the PWA).
  const summary = sleep.summary.flatMap((k) => (k.key in SUMMARY_TREND ? [{ ...k, href: trendHref(SUMMARY_TREND[k.key]) }] : []));
  const vm: SleepPageVM = { ...sleep, ...extras, summary };
  return { vm, weekly };
};

/** The summary rows the page shows, by key, and the Trend View each opens. */
const SUMMARY_TREND: Record<string, TrendViewKey> = { hours: "hours_need", consistency: "consistency", efficiency: "efficiency" };

/** halo's SleepVM with Pulse's Restorative Sleep row and Sleep Efficiency card (src/queries/mobileExtras.ts). */
type SleepPageVM = Omit<SleepVM, "restorative"> & SleepExtras;
export const sleepKey = (d: string) => ["sleep", d] as const;

export function SleepScreen() {
  const [d] = useSelectedDay();
  const { timeZone } = useShellCalendar();
  const { data } = useScreen(sleepQuery(d), sleepKey(d));
  // The web shows its skeleton on every navigation: another day's data is not this day's.
  const shown = data?.vm.day === d && timeZone ? data : undefined;
  return shown && timeZone ? <Sleep vm={shown.vm} weekly={shown.weekly} timeZone={timeZone} /> : <SleepSkeleton />;
}

function Sleep({ vm, weekly, timeZone }: { vm: SleepPageVM; weekly: TrendViewVM[]; timeZone: string }) {
  const { t } = useTranslation("sleep");
  const { t: coachT } = useTranslation("coach");
  const setup = useCoachSetup();
  const coach = coachReady(setup) && vm.hours.value !== null;
  const { today } = useShellCalendar();
  const d = vm.day;
  const p = vm.performance;
  return (
    <View className="flex-1">
      <DetailShell
        title={t("title")}
        floatingAction={!coach}
        bodySkeleton={SLEEP_BODY_SKELETON}
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
            <View className={cn(INSET_ROW, "mb-3 mt-1 flex-row flex-wrap items-center gap-x-4 gap-y-1 py-2")}>
              {STATUS_LEGEND.map(([swatch, word]) => (
                <View key={word} className="flex-row items-center gap-1.5">
                  <View accessibilityElementsHidden className={cn("h-1 w-4 rounded-sm", swatch)} />
                  <Text className="text-xs font-medium leading-4 text-foreground-secondary">{t(`status.${word}`)}</Text>
                </View>
              ))}
            </View>
          </Card>
        }
        insight={vm.insight ? <InsightCard body={vm.insight} action={{ label: t("insight.explore"), href: trendHref("sleep", { d, today }) }} /> : undefined}
        primary={
          <SectionShell variant="card" title={t("cards.lastNight")} aside={t("cards.vsPrior30")} info={cardInfoFor("Last night’s sleep", t("cards.lastNight"))}>
            <SleepStages hours={vm.hours} hr={vm.nightHr} data={vm.stages} restorative={vm.restorative} />
          </SectionShell>
        }
        secondary={[
          <SectionShell key="need" variant="card" title={t("cards.hoursVsNeeded")} info={cardInfoFor("Hours vs. needed", t("cards.hoursVsNeeded"))}>
            <HoursVsNeed vm={vm} />
          </SectionShell>,
          <SectionShell key="consistency" variant="card" title={t("cards.consistency")} info={cardInfoFor("Sleep consistency", t("cards.consistency"))}>
            <SleepConsistency vm={vm} />
          </SectionShell>,
          <SectionShell key="efficiency" variant="card" title={t("cards.efficiency")} info={cardInfoFor("Sleep efficiency", t("cards.efficiency"))}>
            <SleepEfficiency vm={vm} />
          </SectionShell>,
          <SectionShell key="planner" id="planner" variant="card" title={t("cards.tonight")} info={TONIGHT_INFO}>
            <Planner vm={vm} timeZone={timeZone} />
          </SectionShell>,
        ]}
        footer={<WeeklyTrends cards={weekly} d={d} today={today} />}
      />
      {coach && <ActivityCoach activity={{ kind: "sleep", id: d }} question={coachT("sleep.question", { day: d })} setup={setup} />}
    </View>
  );
}

function Planner({ vm, timeZone }: { vm: Pick<SleepVM, "planner">; timeZone: string }) {
  const { t } = useTranslation("sleep");
  const m = vm.planner;
  if (m.value === null)
    return <ReasonPlaceholder reason={m.reason} nightsLeft={m.nightsLeft} size="md" copy={m.reason === "calibrating" ? t("planner.calibrating") : undefined} />;
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
  const rows = [...plan.plans.map((q) => row(t(`planner.plan.${q.key === "get_by" ? "getBy" : q.key}`), t("planner.shareOfNeed", { pct: Math.round(q.share * 100) }), clock(q.bedtimeAt, timeZone))), row(t("planner.typicalWake"), t(plan.weekdayWake ? "planner.weekdayWake" : "planner.weekendWake"), clock(plan.wakeAt, timeZone))];
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
        <Trans t={t} i18nKey="planner.needTonight" values={{ value: hmm(plan.needMin) }} components={{ n: <Text className="font-numeric tabular-nums" /> }} />
      </Text>
    </View>
  );
}

