// Weekly plan (halo src/screens/home/WeeklyPlanCard.tsx, after WHOOP's Weekly Plan), in the look of Strain's key stat
// rows. The card (on Strain, under the goals): how many of the week's targets are on track beside the title, the plan's
// streak, and a row per target with a ZoneBars-style bar (a tick where an even pace would be), the status word and a
// DeltaMark. It opens the sheet `/weekly-plan?d=`: every target's full row (status and what is left, the week's days as
// grey dots, the last 8 weeks, what the habit is worth on Pulse Age), each a link to its screen.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { CalendarCheck, Dumbbell, Flame, Footprints, HeartPulse, Moon, type LucideIcon } from "lucide-react-native";
import { i18n } from "@/i18n/config";
import { DAY, formatDay, rangeLabel } from "@/lib/format";
import { getWeeklyPlan, PLAN_KEYS, type PlanKey, type PlanRow, type WeeklyPlanVM } from "@/queries/weeklyPlan";
import { useScreen } from "@/screens/useScreen";
import { useWeeklyPlan } from "@/state/weeklyPlan";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { goBack, push } from "@/ui/navigate";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { InfoButton } from "@/ui/shells/InfoButton";
import { TaskPage } from "@/ui/shells/TaskPage";
import { SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { GOALS_SETTINGS } from "./Goals";
import { ASIDE, BarLine, GoalRowShell, planColor } from "./parts";
import { PLAN_STATUS, planCaption, planTargetText, planValueText } from "./weeklyPlanView";

export const PLAN_ICON: Record<PlanKey, LucideIcon> = { zone13: HeartPulse, zone45: Flame, strength: Dumbbell, steps: Footprints, consistency: CalendarCheck, sleepNeed: Moon };

const titleOf = (vm: { isCurrentWeek: boolean; monday: string }) => (vm.isCurrentWeek ? i18n.t("goals:plan.thisWeek") : i18n.t("goals:plan.weekOf", { date: formatDay(vm.monday, DAY.monthDay) }));
const cardTitleOf = (vm: { isCurrentWeek: boolean; monday: string }) => (vm.isCurrentWeek ? i18n.t("goals:plan.cardThisWeek") : i18n.t("goals:plan.cardWeekOf", { date: formatDay(vm.monday, DAY.monthDay).toLowerCase() }));
const streakText = (weeks: number) => i18n.t("goals:plan.streak", { count: weeks });
/** Where an even pace would be by now, on [0, 1]; null once done or missed. */
const paceOf = (it: PlanRow) => (it.expected !== null && it.status !== "done" && it.status !== "missed" && it.target > 0 ? Math.min(1, it.expected / it.target) : null);

/** The week holding `day`, once the phone's plan is read (the defaults would show the wrong targets until then). */
function usePlanWeek(day: string) {
  const { plan, ready } = useWeeklyPlan();
  const { data } = useScreen((ctx) => (ready ? getWeeklyPlan(day, ctx, plan) : Promise.resolve(null)), ["weeklyPlan", day, plan, ready]);
  return { keys: PLAN_KEYS.filter((k) => plan.enabled[k]), ready, data: data && data.day === day ? data : undefined };
}

/** Strain's Weekly plan card. */
export function WeeklyPlanCard({ day }: { day: string }) {
  const { t } = useTranslation("goals");
  const { keys, ready, data } = usePlanWeek(day);
  if (ready && keys.length === 0)
    return (
      <SectionShell variant="card" title={t("plan.title")}>
        <EmptyState body={t("plan.emptyBody")} action={{ label: t("plan.emptyAction"), href: GOALS_SETTINGS }} />
      </SectionShell>
    );
  const streak = data?.planStreak.current ?? 0;
  return (
    <SectionShell
      variant="card"
      title={data ? cardTitleOf(data) : t("plan.title")}
      href={`/weekly-plan?d=${day}`}
      aside={data && <Text className={ASIDE}>{t("plan.onTrack", { on: data.onTrack, total: data.items.length })}</Text>}
    >
      {data ? (
        <View>
          {streak > 0 && <Text className={cn(CAPTION, "pb-1")}>{streakText(streak)}</Text>}
          <Divided>{data.items.map((it) => <PlanRowCompact key={it.key} it={it} />)}</Divided>
        </View>
      ) : (
        <Divided>
          {keys.map((k) => (
            <View key={k} className="min-h-14 flex-row items-center gap-3 py-2">
              <Icon icon={PLAN_ICON[k]} size={20} tone="muted-foreground" />
              <SkeletonText lh={16} fs={12} className="w-32" />
            </View>
          ))}
        </Divided>
      )}
    </SectionShell>
  );
}

function PlanRowCompact({ it }: { it: PlanRow }) {
  const { t } = useTranslation("goals");
  const { c } = useTheme();
  const status = PLAN_STATUS[it.status];
  return (
    <GoalRowShell
      icon={PLAN_ICON[it.key]}
      label={it.short}
      value={planValueText(it)}
      of={planTargetText(it)}
      muted={it.value === null}
      mark={status.mark}
      spoken={t("plan.spoken", { label: it.label, value: planValueText(it), target: planTargetText(it), status: status.word })}
    >
      <BarLine value={it.progress} color={planColor(c, it.key)} tick={paceOf(it)} caption={status.word} />
    </GoalRowShell>
  );
}

/** The last 8 weeks as small grey squares, oldest first: filled when the target was met, outlined otherwise. */
/** One target's full row in the sheet; the head links to its screen. */
function PlanLine({ it, onOpen }: { it: PlanRow; onOpen: () => void }) {
  const { t } = useTranslation("goals");
  const { c } = useTheme();
  return (
    <GoalRowShell
      icon={PLAN_ICON[it.key]}
      label={it.label}
      value={planValueText(it)}
      of={planTargetText(it)}
      muted={it.value === null}
      mark={PLAN_STATUS[it.status].mark}
      spoken={t("plan.spokenLine", { label: it.label, value: planValueText(it), target: planTargetText(it), caption: planCaption(it) })}
      onPress={onOpen}
    >
      <BarLine value={it.progress} color={planColor(c, it.key)} tick={paceOf(it)} />
      <Text className={cn(CAPTION, "mt-1.5")}>{planCaption(it)}</Text>
    </GoalRowShell>
  );
}

// Each row is the target, its bar and one line, so the page reads at a glance (the owner found the week's days, the
// last 8 weeks and the per-habit Pulse Age effect too noisy here). A tap opens the habit's screen; Pulse Age has its own.

/** The page `/weekly-plan?d=` (halo's PlanPage). */
export function WeeklyPlanPageBody() {
  const { t } = useTranslation("goals");
  const [day] = useSelectedDay();
  const { keys, data } = usePlanWeek(day);
  const go = (href: string) => {
    goBack();
    push(href);
  };
  return (
    <TaskPage
      title={data ? titleOf(data) : t("plan.thisWeek")}
      description={data ? t("plan.pageDescription", { range: rangeLabel(data.monday, data.sunday), on: data.onTrack, total: data.items.length }) : undefined}
      action={<InfoButton info={{ title: t("plan.whyTitle"), body: t("plan.whyBody") }} label={t("plan.whyTitle")} variant="header" />}
      footer={
        <View className="flex-row gap-3">
          <Button variant="secondary" className="flex-1" onPress={() => go(GOALS_SETTINGS)}>{t("plan.editTargets")}</Button>
          <Button variant="secondary" className="flex-1" onPress={() => go("/health/healthspan")}>{t("plan.pulseAge")}</Button>
        </View>
      }
    >
      <Card className="gap-0 px-4 py-1">
        {data ? <PlanList data={data} go={go} /> : <View className="gap-4 py-3">{keys.map((k) => <SkeletonText key={k} lh={26} fs={22} className="w-40" />)}</View>}
      </Card>
    </TaskPage>
  );
}

function PlanList({ data, go }: { data: WeeklyPlanVM; go: (href: string) => void }) {
  return (
    <View>
      {data.planStreak.current > 0 && <Text className={cn(CAPTION, "pb-1")}>{streakText(data.planStreak.current)}</Text>}
      <Divided>{data.items.map((it) => <PlanLine key={it.key} it={it} onOpen={() => go(it.href.replace("#", "?section="))} />)}</Divided>
    </View>
  );
}
