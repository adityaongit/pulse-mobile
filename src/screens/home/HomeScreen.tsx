import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CalendarRange, Check, ChevronRight, CircleAlert, Info, Lightbulb, Maximize2, Moon, Plus, Sun, TriangleAlert } from "lucide-react-native";
import { isDashboardKey } from "@/lib/dashboard";
import { dashboardChoice } from "@/actions/dashboard";
import type { QueryCtx } from "@/queries/ctx";
import { addDays } from "@/lib/time";
import { clock, DAY, formatDay, formatValue, MISSING, rangeLabel } from "@/lib/format";
import { reasonCopy } from "@/lib/reasons";
import { activityHref, dayHref, napHref } from "@/lib/url";
import { getHome } from "@/queries/home";
import { dashboardKeys, getHomeDashboard, type HomeDashboard } from "@/queries/homeExtras";
import type { HomeVM, KeyStat, StressLevel } from "@/queries/types";
import { Wordmark } from "@/ui/brand";
import { EnergyBankChart } from "@/ui/charts/EnergyBankChart";
import { StrainRecoveryChart } from "@/ui/charts/StrainRecoveryChart";
import { StressChart } from "@/ui/charts/StressChart";
import { cn } from "@/ui/cn";
import { CARD_BUTTON, CARD_CLASS, CardFill, SECONDARY_ROW, useCardStyle } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { ActivityCard } from "@/ui/metrics/ActivityCard";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { SleepCard } from "@/ui/metrics/SleepCard";
import { TickScale } from "@/ui/metrics/TickScale";
import { EmptyState } from "@/ui/shells/EmptyState";
import { InfoCardTrigger } from "@/ui/shells/InfoButton";
import { InfoDialog } from "@/ui/shells/InfoDialog";
import { MetricState } from "@/ui/shells/MetricState";
import { HeaderSentinel, PageShell } from "@/ui/shells/PageShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { useShellCalendar, useShellSync } from "@/ui/shells/ShellStatus";
import { Text } from "@/ui/Text";
import { ring } from "@/ui/shadow";
import { useTheme } from "@/ui/theme";
import { ADD_ACTIVITY_INFO, ENERGY_INFO, STRAIN_RECOVERY_INFO, TONIGHT_INFO } from "../_lib/info";
import { energySeries, statProps, stressSeries } from "../_lib/view";
import { getMore } from "@/queries/settings";
import { HEALTH_KEY, healthQuery } from "../health/HealthScreen";
import { journalKey, journalQuery } from "../journal/query";
import { MORE_KEY } from "../more/MoreScreen";
import { recoveryKey, recoveryQuery } from "../recovery/RecoveryScreen";
import { sleepKey, sleepQuery } from "../sleep/SleepScreen";
import { strainKey, strainQuery } from "../strain/StrainScreen";
import { useScreenReady } from "@/ui/shells/useScreenReady";
import { preloadWhenIdle, useScreen } from "../useScreen";
import { EditDashboardButton } from "./EditDashboard";
import { DetectedRow } from "../activity/ActivityCost";
import { HeartRateTile } from "./HeartRateTile";
import { HomeInsight } from "./HomeInsight";
import { HomeSkeleton } from "./HomeSkeleton";
import { CardButtonContent, CardButtonLink, GradientBanner, IconLink } from "./parts";
import { PlusKey } from "./PlusMenu";
import { TonightPlan } from "./TonightPlan";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";

const STRESS_TONE: Record<StressLevel, { chip: string; text: string; word: string }> = {
  low: { chip: "bg-stress-low/15", text: "text-stress-low-text", word: "Low" },
  medium: { chip: "bg-stress-medium/15", text: "text-stress-medium-text", word: "Medium" },
  high: { chip: "bg-stress-high/15", text: "text-stress-high-text", word: "High" },
};
const CHIP_BOX = "h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1";
const NO_BAND_INFO = {
  title: "No band data yet",
  body: (
    <>
      <Text className="text-[15px] leading-[22px] text-foreground-body">Sleep, Recovery and Strain are scored from your Fitbit’s heart rate, which your phone can’t measure.</Text>
      <Text className="text-[15px] leading-[22px] text-foreground-body">Until your Fitbit syncs, Home shows what your phone counts: steps, distance, calories and active minutes.</Text>
    </>
  ),
};

const go = (href: string) => push(href);

/** halo's Home with My Dashboard from Pulse's catalogue (src/queries/homeExtras.ts) and the stress tile's line. */
type HomePageVM = Omit<HomeVM, "dashboard"> & { dashboard: { empty: HomeDashboard["empty"] }; stressChart: HomeDashboard["stressChart"] };
const homeQuery = (d: string) => async (ctx: QueryCtx): Promise<HomePageVM> => {
  const chosen = await dashboardChoice();
  const [vm, dash] = await Promise.all([getHome(d, ctx), getHomeDashboard(d, ctx, chosen)]);
  return { ...vm, keyStats: dash.keyStats, dashboard: { empty: dash.empty }, stressChart: dash.stressChart };
};
const homeKey = (d: string) => ["home", d] as const;

export function HomeScreen() {
  const [d] = useSelectedDay();
  const { timeZone } = useShellCalendar();
  const { data } = useScreen(homeQuery(d), homeKey(d));
  const keys = useScreen(async (ctx) => dashboardKeys(ctx, await dashboardChoice()), ["home-keys"]).data;
  // The web shows its skeleton on every navigation: another day's data is not this day's.
  const vm = data?.day === d && timeZone ? data : undefined;
  // What is one tap away loads as data while Home is in view and settled, one item per idle moment: the dials' screens,
  // the other tabs and the date pill's steps (the day before and after). On another day only the steps load: each query
  // reads SQLite on the JS thread, and stepping through days should not queue up a dial page's queries per step. Pages
  // are not prerendered (router.prefetch): Back pops a prerendered page, and rendering it again on Home cost two frames
  // of 60-90 ms after every Back, more than a cold push of the page costs (docs/learning.md, "Screens open from memory").
  const day = vm?.day;
  const today = vm?.today;
  const ready = useScreenReady();
  useFocusEffect(
    useCallback(() => {
      if (!day || !today || !ready) return;
      const steps = [addDays(day, -1), addDays(day, 1)].filter((d) => d <= today).map((d) => ({ query: homeQuery(d), key: homeKey(d) }));
      if (day !== today) return preloadWhenIdle(steps);
      return preloadWhenIdle([
        { query: sleepQuery(day), key: sleepKey(day) },
        { query: recoveryQuery(), key: recoveryKey() },
        { query: strainQuery(), key: strainKey() },
        { query: healthQuery, key: HEALTH_KEY },
        { query: journalQuery(), key: journalKey() },
        { query: getMore, key: MORE_KEY },
        ...steps,
      ]);
    }, [day, today, ready]),
  );
  return vm && timeZone ? <Home vm={vm} timeZone={timeZone} /> : <HomeSkeleton stats={keys} />;
}

function Home({ vm, timeZone }: { vm: HomePageVM; timeZone: string }) {
  const d = vm.day;
  const { today } = vm;
  const at = (href: string) => dayHref(href, d, today);
  const { dials } = vm;
  const { c } = useTheme();
  const dashboardKeysShown = useMemo(() => vm.keyStats.map((s) => s.key).filter(isDashboardKey), [vm.keyStats]);

  return (
    <PageShell
      title="Home"
      layout="home"
      rings={{
        sleep: { value: dials.sleep.value, href: at("/sleep") },
        recovery: { value: dials.recovery.value, href: at("/recovery") },
        strain: { value: dials.strain.value, href: at("/strain") },
      }}
      slots={{
        top: (
          <View className="-mt-2">
            <View className="gap-3">
              <View accessibilityElementsHidden className="items-center">
                <Wordmark height={17} tone="foreground-secondary" />
              </View>
              <FirstSync />
              {/* No provisional or other tags under the dials, as WHOOP's Home (owner, 2026-10-13); the dials' own pages show them. */}
              <View className="flex-row items-start justify-around">
                <View className="flex-1 items-center"><ScoreDial variant="sleep" size="md" value={dials.sleep.value} reason={dials.sleep.reason} href={at("/sleep")} /></View>
                <View className="flex-1 items-center">
                  <ScoreDial
                    variant="recovery"
                    size="md"
                    value={dials.recovery.value}
                    reason={dials.recovery.reason}
                    nightsLeft={dials.recovery.nightsLeft}
                    href={at("/recovery")}
                  />
                </View>
                <View className="flex-1 items-center"><ScoreDial variant="strain" size="md" value={dials.strain.value} reason={dials.strain.reason} target={dials.strainTarget} href={at("/strain")} /></View>
              </View>
              {/* The end of the collapse distance: the dials' bottom (the web's sentinel; -mt-3 cancels this column's gap). */}
              <HeaderSentinel className="-mt-3 h-0" />
              {dials.reason && (
                <View className="items-center pt-3">
                  {vm.phone ? (
                    <InfoCardTrigger info={NO_BAND_INFO} className="flex-row items-center gap-1.5 rounded-md py-3">
                      <ReasonPlaceholder reason={dials.reason.reason} size="sm" copy="No band data yet" />
                      <Icon icon={Info} size={14} tone="muted-foreground" strokeWidth={1.75} />
                    </InfoCardTrigger>
                  ) : (
                    <ReasonPlaceholder reason={dials.reason.reason} nightsLeft={dials.reason.nightsLeft} size="sm" />
                  )}
                </View>
              )}
            </View>
          </View>
        ),
        main: (
          <View className="gap-8">
            <View className="-mt-2 gap-6">
              {vm.isToday && <HeartRateTile phoneOnly={!!vm.phone} />}
              {vm.phone ? (
                <PhoneActivity stats={vm.phone} link={{ d, today }} />
              ) : (
                <View className="flex-row gap-3">
                  <View className="min-w-0 flex-1 flex-row"><MonitorCard vm={vm} href={at("/health/monitor")} /></View>
                  <View className="min-w-0 flex-1 flex-row"><StressCard vm={vm} href={at("/health/stress")} timeZone={timeZone} /></View>
                </View>
              )}
              {vm.insights.length > 0 && <HomeInsight day={d} items={vm.insights} />}
              {vm.monitorAlert && <MonitorAlert alert={vm.monitorAlert} href={at("/health/monitor")} />}
            </View>
            <SectionShell variant="section" title="My Day" action={<PlusKey label={vm.isToday ? "Add to today" : `Add to ${formatDay(d, DAY.short)}`} />}>
              <View className="gap-3">
                {vm.outlook && <DayBanner outlook={vm.outlook} />}
                <SectionShell variant="card" title={vm.activities.title} action={<IconLink href="/activities" label="All activities" icon={Maximize2} />}>
                  {vm.activities.items.length || vm.activities.detected.length ? (
                    <View className="gap-1.5">
                      {vm.activities.items.map((it) =>
                        it.kind === "activity" ? (
                          <ActivityCard key={it.id} name={it.name} kind={it.activityKind} strain={it.strain} start={it.start} end={it.end} distanceKm={it.distanceKm} paceS={it.paceS} href={activityHref(it.id)} timeZone={timeZone} />
                        ) : (
                          <SleepCard key={it.id} kind={it.kind} minutes={it.minutes} start={it.start} end={it.end} href={it.kind === "nap" ? napHref(it.id) : at("/sleep")} timeZone={timeZone} />
                        ),
                      )}
                      {vm.activities.detected.map((it) => <DetectedRow key={`detected-${it.start}`} item={it} timeZone={timeZone} />)}
                    </View>
                  ) : (
                    <EmptyState body={vm.isToday ? "No activities yet today. Workouts appear after Fitbit syncs them." : "No activities on this day."} />
                  )}
                  {/* Workouts come from Google, so Add explains importing rather than creating a local workout. */}
                  <View className="mt-3">
                    <InfoCardTrigger info={ADD_ACTIVITY_INFO} activeScale={0.96} className={CARD_BUTTON}>
                      <CardButtonContent icon={Plus} label="Add activity" />
                    </InfoCardTrigger>
                  </View>
                </SectionShell>
                {vm.isToday && (
                  <SectionShell variant="card" title="Tonight’s sleep" info={TONIGHT_INFO} fill action={<IconLink href={at("/sleep?section=planner")} label="Open Sleep Planner" icon={ChevronRight} />}>
                    <MetricState
                      metric={vm.tonight}
                      skeleton={null}
                      renderReason={(r, meta) => (
                        <View className="my-auto">
                          <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" copy={r === "calibrating" ? "Sleep Planner needs 7 nights to learn your wake time." : undefined} />
                        </View>
                      )}
                    >
                      {(plan) => <TonightPlan plan={plan} timeZone={timeZone} />}
                    </MetricState>
                  </SectionShell>
                )}
                <JournalWeek vm={vm} at={at} />
                <EnergyCard vm={vm} timeZone={timeZone} />
              </View>
            </SectionShell>
          </View>
        ),
        aside: (
          <SectionShell
            variant="section"
            title="My Dashboard"
            action={<EditDashboardButton keys={dashboardKeysShown} empty={vm.dashboard.empty} />}
          >
            <View accessibilityRole="list" className="gap-2">
              {vm.keyStats.map((s) =>
                s.key === "stress" ? <StressTile key={s.key} vm={vm} href={at("/health/stress")} timeZone={timeZone} /> : <KeyStatRow key={s.key} variant="card" {...statProps(s, { d, today })} />,
              )}
            </View>
            {/* One point cannot show a trend. */}
            {vm.strainRecovery.filter((p) => p.strain !== null || p.recovery !== null).length >= 2 && (
              <SectionShell variant="card" title="Strain & recovery" info={STRAIN_RECOVERY_INFO} fill className="mt-3">
                <StrainRecoveryChart points={vm.strainRecovery} today={d} />
              </SectionShell>
            )}
          </SectionShell>
        ),
        bottom: vm.weeklyTeaser && (
          <GradientBanner from={c["banner-from"]} to={c["banner-to"]} role="link" onPress={() => go(`/reports/${vm.weeklyTeaser!.period}`)}>
            <Icon icon={CalendarRange} size={22} tone="foreground" strokeWidth={1.5} />
            <Text className="min-w-0 flex-1 text-base font-semibold leading-[22px]">Your week in review</Text>
            <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{rangeLabel(vm.weeklyTeaser.start, vm.weeklyTeaser.end)}</Text>
            <Icon icon={ChevronRight} size={20} tone="foreground-secondary" strokeWidth={1.75} />
          </GradientBanner>
        ),
      }}
    />
  );
}

function DayBanner({ outlook }: { outlook: NonNullable<HomeVM["outlook"]> }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const review = outlook.kind === "review";
  const glyph = review ? Moon : Sun;
  return (
    <>
      <GradientBanner from={review ? c["banner-from"] : c["outlook-from"]} to={review ? c["banner-to"] : c["outlook-to"]} role="button" onPress={() => setOpen(true)}>
        <Icon icon={glyph} size={22} tone="foreground-secondary" strokeWidth={1.5} />
        <Text className="min-w-0 flex-1 truncate text-base font-semibold leading-[22px]">{outlook.title}</Text>
        <Icon icon={ChevronRight} size={20} tone={review ? "coach-text" : "outlook-accent"} strokeWidth={1.75} />
      </GradientBanner>
      <InfoDialog open={open} onClose={() => setOpen(false)} title={outlook.title} icon={<Icon icon={glyph} size={28} tone="foreground" strokeWidth={1.5} />} body={outlook.body} />
    </>
  );
}

function JournalWeek({ vm, at }: { vm: HomePageVM; at: (href: string) => string }) {
  return (
    <SectionShell variant="card" title="My journal" action={<IconLink href={at("/journal")} label="Open Journal" icon={ChevronRight} />}>
      <View accessibilityRole="list" className="flex-row pt-1">
        {vm.journalWeek.map((w) => {
          const current = w.day === vm.day;
          return (
            <Press
              activeBg="bg-accent"
              key={w.day}
              accessibilityRole="link"
              accessibilityLabel={`${formatDay(w.day, DAY.long)}: ${w.done ? "checked in" : "no check-in"}`}
              accessibilityState={{ selected: current }}
              onPress={() => go(dayHref("/journal", w.day, vm.today))}
              className="min-h-16 flex-1 items-center justify-center gap-2 rounded-lg"
            >
              <Text accessible={false} className={cn("text-xs font-bold uppercase leading-4 tracking-[0.1em]", current ? "text-foreground" : "text-muted-foreground")}>
                {formatDay(w.day, { weekday: "short" })}
              </Text>
              <View accessibilityElementsHidden className={cn("size-7 items-center justify-center rounded-full", w.done ? "bg-optimal" : "border border-foreground/25")}>
                {w.done && <Icon icon={Check} size={16} tone="background" strokeWidth={3} />}
              </View>
            </Press>
          );
        })}
      </View>
      <CardButtonLink href="/journal/insights" icon={Lightbulb} label="Behaviour insights" className="mt-3" />
    </SectionShell>
  );
}

function MonitorAlert({ alert, href }: { alert: NonNullable<HomeVM["monitorAlert"]>; href: string }) {
  const { c } = useTheme();
  const illness = alert.kind === "illness";
  const names = alert.names.length > 1 ? `${alert.names.slice(0, -1).join(", ")} and ${alert.names.at(-1)}` : (alert.names[0] ?? "Some vitals");
  // ring-1 ring-recovery-red/60 (or warning/50): one more shadow on the card's own.
  const shadow = useCardStyle(ring(illness ? c["alert-ring"] : c["warning-ring"], { inset: false }));
  return (
    <View accessibilityRole="alert" className={`${CARD_CLASS} flex-row gap-x-3 px-4 py-3`} style={shadow}>
      <CardFill />
      <View className="pt-px">
        <Icon icon={illness ? CircleAlert : TriangleAlert} size={20} tone={illness ? "recovery-red-text" : "warning-text"} strokeWidth={1.75} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-semibold leading-[22px]">{illness ? "Your body may be fighting something" : `${alert.count} ${alert.count === 1 ? "vital" : "vitals"} outside your normal range`}</Text>
        <View className="gap-2">
          <Text className="text-[15px] leading-[22px] text-foreground-secondary">
            {illness
              ? "Several vitals moved away from your normal range together, a pattern that often comes before feeling unwell. Consider an easier day."
              : `${names} ${alert.names.length === 1 ? "is" : "are"} outside your usual range. This can be an early sign of illness or heavy strain.`}
          </Text>
          <Press activeOpacity={0.7} accessibilityRole="link" onPress={() => go(href)} hitSlop={{ left: 8, right: 8, top: 14, bottom: 14 }} className="flex-row items-center gap-0.5 self-start">
            <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">View Health Monitor</Text>
            <Icon icon={ChevronRight} size={14} tone="foreground" strokeWidth={2} />
          </Press>
        </View>
      </View>
    </View>
  );
}

function PhoneActivity({ stats, link }: { stats: KeyStat[]; link: { d: string; today: string } }) {
  // An odd count lets the first tile (steps) span the row as a wide strip that spells out its comparison.
  const wide = stats.length % 2 === 1;
  const rest = wide ? stats.slice(1) : stats;
  const rows: KeyStat[][] = [];
  for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  return (
    <SectionShell variant="section" title="From your phone" aside="vs. 30-day avg">
      <View accessibilityRole="list" className="gap-3">
        {wide && <KeyStatRow variant="tile" {...statProps(stats[0], link)} wide />}
        {rows.map((row) => (
          <View key={row[0].key} className="flex-row gap-3">
            {row.map((s) => (
              <View key={s.key} className="min-w-0 flex-1 flex-row"><KeyStatRow variant="tile" {...statProps(s, link)} className="flex-1" /></View>
            ))}
          </View>
        ))}
      </View>
    </SectionShell>
  );
}

function MonitorLine({ chip, chipClass, top, topClass, bottom }: { chip: ReactNode; chipClass: string; top: string; topClass: string; bottom: string }) {
  return (
    <View className="min-w-0 flex-row items-center gap-2">
      <View className={cn(CHIP_BOX, chipClass)}>{chip}</View>
      <View className="min-w-0 flex-1">
        <Text className={cn("text-xs font-bold uppercase leading-4 tracking-[0.06em]", topClass)}>{top}</Text>
        {/* Wraps rather than truncates: "Day average" lost a pixel at 320 px. */}
        <Text className="text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{bottom}</Text>
      </View>
    </View>
  );
}

const NO_READING_CHIP = <Text className="font-numeric text-base font-bold text-muted-foreground">{MISSING}</Text>;

function MonitorCard({ vm, href }: { vm: HomePageVM; href: string }) {
  const m = vm.monitor;
  return (
    <SectionShell variant="card" title="Health Monitor" info={false} href={href} fill>
      {m.value === null || m.value.inRange + m.value.flagged === 0 ? (
        // No vital judged yet (no readings, or every baseline still calibrating): never "Within range".
        <MonitorLine chip={NO_READING_CHIP} chipClass="bg-secondary" top="No readings" topClass="text-foreground-secondary" bottom={reasonCopy(m.value === null ? m.reason : "calibrating").short} />
      ) : m.value.flagged === 0 ? (
        <MonitorLine chip={<Icon icon={Check} size={16} tone="optimal-text" strokeWidth={2.5} />} chipClass="bg-optimal/15" top="Within range" topClass="text-optimal-text" bottom={`${m.value.inRange} of ${m.value.total} metrics`} />
      ) : (
        // The count names what the headline says: "1 of 4 metrics" under Out of range, never the in-range "3/4", which
        // read as three vitals out of range.
        <MonitorLine chip={<Icon icon={TriangleAlert} size={16} tone="warning-text" strokeWidth={2} />} chipClass="bg-warning/15" top="Out of range" topClass="text-warning-text" bottom={`${m.value.flagged} of ${m.value.total} metrics`} />
      )}
    </SectionShell>
  );
}

function StressCard({ vm, href, timeZone }: { vm: HomePageVM; href: string; timeZone: string }) {
  const s = vm.stress;
  if (s.value === null)
    return (
      <SectionShell variant="card" title="Stress Monitor" info={false} href={href} fill>
        <MonitorLine chip={NO_READING_CHIP} chipClass="bg-secondary" top={s.reason === "band_not_worn" ? "Not worn" : "No stress scored yet"} topClass="text-foreground-secondary" bottom={vm.isToday ? "Today" : "This day"} />
      </SectionShell>
    );
  const tone = STRESS_TONE[s.value.level];
  return (
    <SectionShell variant="card" title="Stress Monitor" info={false} href={href} fill>
      <MonitorLine
        chip={<Text className={cn("font-numeric text-lg font-bold tabular-nums", tone.text)}>{formatValue("int", s.value.value)}</Text>}
        chipClass={tone.chip}
        top={tone.word}
        topClass={tone.text}
        bottom={s.value.at !== null ? clock(s.value.at, timeZone) : "Day average"}
      />
    </SectionShell>
  );
}

function StressTile({ vm, href, timeZone }: { vm: HomePageVM; href: string; timeZone: string }) {
  const s = vm.stress.value;
  const tone = s && STRESS_TONE[s.level];
  const data = useMemo(() => vm.stressChart && stressSeries(vm.stressChart), [vm.stressChart]);
  return (
    <SectionShell variant="card" title="Stress Monitor" info={false} href={href}>
      {s && tone && (
        <View className="-mt-1 mb-3 flex-row items-baseline justify-between gap-3">
          <Text className="text-xs font-medium leading-4 text-foreground-secondary">
            {s.at !== null ? (
              <>
                Last updated <Text className="font-numeric tabular-nums">{clock(s.at, timeZone)}</Text>
              </>
            ) : (
              "Day average"
            )}
          </Text>
          <View className="flex-row items-baseline gap-1.5">
            <Text className={cn("text-xs font-bold uppercase leading-4 tracking-[0.1em]", tone.text)}>{tone.word}</Text>
            <Text className="font-numeric text-base font-bold leading-5 tabular-nums text-foreground">{formatValue("int", s.value)}</Text>
          </View>
        </View>
      )}
      <StressChart variant="full" data={data} />
    </SectionShell>
  );
}

function EnergyCard({ vm, timeZone }: { vm: HomePageVM; timeZone: string }) {
  const e = vm.energyBank;
  return (
    <SectionShell variant="card" title="Energy Bank" info={ENERGY_INFO} fill>
      <MetricState
        metric={e}
        skeleton={null}
        renderReason={(r, meta) => (
          // Centred when the card is stretched beside Tonight's sleep, never pinned to the top of an empty card.
          <View className="my-auto">
            <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" />
          </View>
        )}
      >
        {(eb) => <EnergyBody eb={eb} timeZone={timeZone} />}
      </MetricState>
    </SectionShell>
  );
}

function EnergyBody({ eb, timeZone }: { eb: NonNullable<HomeVM["energyBank"]["value"]>; timeZone: string }) {
  const metric = useMemo(() => ({ value: energySeries(eb), reason: null, provisional: false }), [eb]);
  const drains = useMemo(() => [...(metric.value.drains ?? [])].sort((a, b) => b.amount - a.amount).slice(0, 3).sort((a, b) => a.t - b.t), [metric]);
  return (
    <View className="flex-1 gap-4">
      <View className="gap-1.5">
        <TickScale variant="meter" label="Energy" metric={{ value: eb.current, reason: null, provisional: false }} min={0} max={100} format="int" unit="%" />
        <Text className={CAPTION}>
          Woke at <Text className="font-numeric tabular-nums">{clock(eb.startAt, timeZone)}</Text> with <Text className="font-numeric tabular-nums">{formatValue("int", eb.startLevel)}%</Text>
        </Text>
      </View>
      <EnergyBankChart data={metric} />
      <View className="mt-auto flex-row gap-3">
        <MiniStat label="Charged" value={formatValue("signedInt", eb.charged)} className="text-optimal-text" />
        <MiniStat label="Drained" value={formatValue("signedInt", eb.drained)} className="text-warning-text" />
      </View>
      {/* The chart's dots, in time order. */}
      {drains.length > 0 && (
        <View accessibilityRole="list" className="gap-1">
          {drains.map((dr) => (
            <Text key={dr.t} className="text-xs font-medium leading-4 text-foreground-secondary">
              {dr.label} at <Text className="font-numeric tabular-nums">{clock(dr.t, timeZone)}</Text> · <Text className="font-numeric tabular-nums">{formatValue("signedInt", -Math.abs(dr.amount))}</Text>
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function MiniStat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <View className={cn(SECONDARY_ROW, "flex-1 p-3")}>
      <Text className={cn(LABEL, "text-muted-foreground")}>{label}</Text>
      <Text className={cn("mt-1 font-numeric text-xl font-bold leading-6 tabular-nums", className)}>{value}</Text>
    </View>
  );
}

function FirstSync() {
  const s = useShellSync();
  if (!s || (s.connection !== "importing" && !(s.sync.state === "syncing" && s.sync.lastSuccessAt == null))) return null;
  const p = s.importProgress;
  return (
    <Text accessibilityLiveRegion="polite" className={cn(LABEL, "text-center text-muted-foreground")}>
      {p ? `Syncing · ${Math.floor(p.done / p.total * 100)}%` : "Syncing…"}
    </Text>
  );
}
