// Tool results as kit cards (spec §7.21 Messages), ported from pulse src/app/(app)/coach/Evidence.tsx and Coach.tsx's
// DayCard: get_day as three MiniRings with contributors, the other tools as compact KeyStatRow cards, each followed by
// a "Based on" link to the screen it read.
import { localeFixed } from "@/lib/locale";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react-native";
import type { CoachOutputs } from "@/coach/tools";
import { i18n } from "@/i18n/config";
import { normalizeReason, reasonCopy, type Metric } from "@/lib/reasons";
import { cn } from "@/ui/cn";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { ZoneBars } from "@/ui/charts/ZoneBars";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { MiniRing, type MiniRingVariant } from "@/ui/metrics/MiniRing";
import { Sparkline } from "@/ui/metrics/Sparkline";
import { zoneBars } from "@/screens/_lib/view";

const NOTE = "text-[13px] leading-5 text-muted-foreground";

function metric(m: { value: number | null; reason?: string | null; provisional?: boolean }): Metric<number> {
  return { value: m.value, reason: m.value === null ? normalizeReason(m.reason) : null, provisional: m.provisional ?? false } as Metric<number>;
}

function BasedOn({ href, children }: { href: string; children: string }) {
  const { t } = useTranslation("coach");
  return (
    <Press accessibilityRole="link" onPress={() => push(href)} className="min-h-10 flex-row items-center gap-1.5 self-start">
      <Text className="text-xs leading-4 text-coach-text">{t("evidence.basedOn", { what: children })}</Text>
      <Icon icon={ArrowUpRight} size={14} tone="coach-text" />
    </Press>
  );
}

function EvidenceCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <Text className="mb-1 text-xs font-semibold text-foreground-secondary">{title}</Text>
      {children}
    </Card>
  );
}

type DayDigest = CoachOutputs["get_day"];

function Ring({ label, variant, m, unit }: { label: string; variant: MiniRingVariant; m: { value: number | null; reason: string | null }; unit?: string }) {
  return (
    <View className="flex-1 items-center gap-1 rounded-md bg-secondary p-3">
      <MiniRing variant={variant} value={m.value} />
      <Text className={cn("font-numeric font-bold", m.value === null ? "text-sm text-foreground-secondary" : "text-xl")}>{m.value === null ? reasonCopy(m.reason).short : `${m.value}${unit ?? ""}`}</Text>
      <Text className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</Text>
    </View>
  );
}

/** get_day: Recovery, Sleep and Strain, then up to three contributors with their points. */
export function DayCard({ d }: { d: DayDigest }) {
  const { t } = useTranslation("coach");
  const moved = d.recovery.contributors.filter((c) => c.points !== null && c.points !== 0).slice(0, 3);
  return (
    <Card className="p-2">
      <View className="flex-row gap-2">
        <Ring label={t("evidence.ringRecovery")} variant="recovery" m={d.recovery} unit="%" />
        <Ring label={t("evidence.ringSleep")} variant="sleep" m={d.sleep.performance} unit="%" />
        <Ring label={t("evidence.ringStrain")} variant="strain" m={d.strain} />
      </View>
      {moved.length > 0 && (
        <View className="px-2 pb-1.5 pt-3">
          <Text className="text-xs font-medium text-muted-foreground">{t("evidence.moved")}</Text>
          {moved.map((c, i) => (
            <View key={c.label} className={cn("flex-row items-center justify-between gap-3 py-1.5", i > 0 && "border-t border-border")}>
              <Text className="text-sm text-foreground-secondary">{c.label}</Text>
              <Text className={cn("font-numeric text-sm font-semibold", c.points! > 0 ? "text-recovery-green" : "text-recovery-red-text")}>
                {t("evidence.points", { value: `${c.points! > 0 ? "+" : "−"}${Math.abs(c.points!)}` })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export function Evidence({ name, output }: { name: string; output: unknown }) {
  const { t } = useTranslation("coach");
  if (!output || typeof output !== "object") return null;
  if (name === "get_day") {
    const d = output as DayDigest;
    return (
      <View className="gap-2">
        <DayCard d={d} />
        <BasedOn href={`/recovery?d=${d.day}`}>{t("evidence.dayTitle", { day: d.day })}</BasedOn>
      </View>
    );
  }
  if (name === "get_trend") {
    const d = output as CoachOutputs["get_trend"];
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.trendTitle", { metric: d.metric, start: d.start, end: d.end })}>
          <KeyStatRow variant="row" label={t("evidence.periodAverage")} metric={metric(d.average)} unit={d.unit ?? undefined} format="decimal1" direction="none" average={d.previous.average.value} averageLabel={t("evidence.previousPeriod")} caption={t("evidence.daysMeasured", { observed: d.observedDays, calendar: d.calendarDays })} />
          <Sparkline values={d.points.map((p) => p.value)} className="mt-2 h-14" />
        </EvidenceCard>
        <BasedOn href="/trends">{t("evidence.trendTitle", { metric: d.metric, start: d.start, end: d.end })}</BasedOn>
      </View>
    );
  }
  if (name === "get_sleep") {
    const d = output as CoachOutputs["get_sleep"];
    const debt = d.details.find((v) => v.key === "debt");
    const time = (ms: number) => new Intl.DateTimeFormat(i18n.language, { timeZone: d.timeZone, hour: "numeric", minute: "2-digit" }).format(ms);
    const plan = d.planner.value;
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.sleepTitle", { day: d.day })}>
          <KeyStatRow variant="row" label={t("evidence.timeAsleep")} metric={metric(d.asleepMinutes)} unit="min" format="int" direction="none" />
          {d.summary
            .filter((v) => v.key === "efficiency" || v.key === "consistency")
            .map((v) => (
              <KeyStatRow key={v.key} variant="row" label={v.label} metric={metric(v)} unit={v.unit ?? undefined} format="int" average={v.baseline} direction="up" />
            ))}
          {debt && <KeyStatRow variant="row" label={t("evidence.sleepDebt")} metric={metric(debt)} unit="min" format="int" direction="down" />}
          {plan && (
            <Text className={cn(NOTE, "mt-2 text-foreground-secondary")}>
              {t("evidence.plan", { wake: time(plan.wakeAt), plans: plan.plans.map((v) => t("evidence.planItem", { label: v.label.toLowerCase(), time: time(v.bedtimeAt) })).join("; ") })}
            </Text>
          )}
        </EvidenceCard>
        <BasedOn href={`/sleep?d=${d.day}`}>{t("evidence.plannerTitle", { day: d.day })}</BasedOn>
      </View>
    );
  }
  if (name === "get_activities") {
    const d = output as CoachOutputs["get_activities"];
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.workoutsTitle", { start: d.start, end: d.end })}>
          {d.workouts.length ? (
            d.workouts.slice(0, 5).map((v) => <KeyStatRow key={v.id} variant="row" label={v.name} metric={metric(v.strain)} unit="%" format="int" direction="none" caption={t("evidence.workoutCaption", { day: v.day, minutes: v.minutes })} href={`/activity/${encodeURIComponent(v.id)}`} />)
          ) : (
            <Text className={NOTE}>{t("evidence.noWorkouts")}</Text>
          )}
          {d.total > 5 && <Text className={cn(NOTE, "mt-2 text-xs")}>{t("evidence.showing", { total: d.total })}</Text>}
        </EvidenceCard>
        <BasedOn href="/activities">{t("evidence.recordedTitle", { start: d.start, end: d.end })}</BasedOn>
      </View>
    );
  }
  if (name === "get_activity") {
    const a = (output as CoachOutputs["get_activity"]).workout;
    if (!a) return <Text className={NOTE}>{t("evidence.unavailable")}</Text>;
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.workoutTitle", { name: a.name, day: a.day })}>
          <KeyStatRow variant="row" label={t("evidence.activityStrain")} metric={metric(a.strain)} unit="%" format="int" direction="none" />
          {a.stats.slice(0, 3).map((v) => (
            <KeyStatRow key={v.label} variant="row" label={v.label} metric={metric(v)} unit={v.unit ?? undefined} format="decimal1" average={v.baseline} direction="none" />
          ))}
          <ZoneBars variant="rows" data={zoneBars(a.zones)} note={a.zoneNote} />
        </EvidenceCard>
        <BasedOn href={`/activity/${encodeURIComponent(a.id)}`}>{t("evidence.workoutTitle", { name: a.name, day: a.day })}</BasedOn>
      </View>
    );
  }
  if (name === "get_journal_impacts") {
    const d = output as CoachOutputs["get_journal_impacts"];
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.habitsTitle", { outcome: d.outcome })}>
          <Text className="text-xs leading-4 text-muted-foreground">{t("evidence.habitsNote")}</Text>
          {d.effects.slice(0, 3).map((v) => (
            <View key={v.behaviour}>
              <KeyStatRow variant="row" label={v.behaviour} metric={metric({ value: v.delta })} unit={d.unit} format="signed1" direction="none" caption={t("evidence.withWithout", { yes: v.yesDays, no: v.noDays })} />
              {v.confidenceInterval && (
                <Text className="pb-2 text-xs leading-4 text-muted-foreground">
                  {t(v.effect === "none" ? "evidence.intervalNone" : "evidence.interval", { from: localeFixed(v.confidenceInterval[0], 1), to: localeFixed(v.confidenceInterval[1], 1), unit: d.unit })}
                </Text>
              )}
            </View>
          ))}
          {!d.effects.length && <Text className={cn(NOTE, "mt-2")}>{t("evidence.noHabits")}</Text>}
        </EvidenceCard>
        <BasedOn href="/journal/insights">{t("evidence.insights")}</BasedOn>
      </View>
    );
  }
  if (name === "get_health") {
    const d = output as CoachOutputs["get_health"];
    return (
      <View className="gap-2">
        <EvidenceCard title={t("evidence.healthTitle", { day: d.day })}>
          {d.vitals.map((v) => (
            <KeyStatRow key={v.vital} variant="row" label={v.vital} metric={metric(v)} unit={v.unit} format="decimal1" direction="none" caption={String(v.status).replaceAll("_", " ")} />
          ))}
        </EvidenceCard>
        <BasedOn href={`/health/monitor?d=${d.day}`}>{t("evidence.healthTitle", { day: d.day })}</BasedOn>
      </View>
    );
  }
  if (name === "get_report") {
    const d = output as CoachOutputs["get_report"];
    if (!("scores" in d) || !d.scores) return <Text className={NOTE}>{t("evidence.noReport")}</Text>;
    return (
      <View className="gap-2">
        <EvidenceCard title={t(d.partial ? "evidence.reportPartial" : "evidence.reportTitle", { start: d.start, end: d.end })}>
          {d.scores.map((v) => (
            <KeyStatRow key={v.score} variant="row" label={v.score} metric={metric(v)} format="decimal1" direction="none" />
          ))}
        </EvidenceCard>
        <BasedOn href={`/reports/${encodeURIComponent(d.period)}`}>{t("evidence.reportTitle", { start: d.start, end: d.end })}</BasedOn>
      </View>
    );
  }
  if (name === "get_profile") return <BasedOn href="/settings?s=profile">{t("evidence.profile")}</BasedOn>;
  return null;
}
