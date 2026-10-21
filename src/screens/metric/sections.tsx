// A metric screen's own sections (web: metric/[key]/sections.tsx): what the metric is made of, by kind.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { clock, clockTick, DAY, durationWords, formatDay, formatValue, hmm } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { activityHref } from "@/lib/url";
import type { MetricDetailVM, Section } from "@/queries/metric";
import { cardOf, Divided } from "@/screens/trends/parts";
import { CAPTION, LABEL, statProps } from "@/screens/_lib/view";
import { ColumnChart } from "@/ui/charts/ColumnChart";
import { cn } from "@/ui/cn";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { EmptyState } from "@/ui/shells/EmptyState";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { INSET_ROW } from "@/ui/Card";
import { BAR_CORNERS } from "@/ui/radius";

type Ctx = { vm: MetricDetailVM; timeZone?: string };

/** The inset strip under a card's rows (the web's LEGEND: the class has text styles a View cannot pass down). */
function Legend({ children }: { children: ReactNode }) {
  return (
    <View className={cn(INSET_ROW, "mb-3 mt-1 py-2")}>
      <Text className="text-xs font-medium leading-4 text-foreground-secondary">{children}</Text>
    </View>
  );
}

const ok = (v: number): Metric<number> => ({ value: v, reason: null, provisional: false });

export function MetricSection({ s, ...c }: Ctx & { s: Section }) {
  const { t } = useTranslation("trends");
  switch (s.kind) {
    case "hourly":
      return <Hourly s={s} {...c} />;
    case "goal":
      return (
        <SectionShell variant="card" title={t("section.goalTitle", { target: formatValue("grouped", s.target) })} info={{ title: t("section.goalInfoTitle"), body: t("section.goalInfoBody") }}>
          <Divided>
            <KeyStatRow variant="row" label={t("section.currentStreak")} metric={ok(s.streak)} unit={t("section.dayUnit", { count: s.streak })} format="int" direction="none" />
            <KeyStatRow variant="row" label={t("section.longestStreak")} caption={t("section.inPastYear")} metric={ok(s.longest)} unit={t("section.dayUnit", { count: s.longest })} format="int" direction="none" />
            <KeyStatRow variant="row" label={t("section.daysReached")} caption={t("section.inLastDays", { count: s.days })} metric={ok(s.met)} unit={t("rangeStats.ofTotal", { total: s.days })} format="int" direction="none" />
          </Divided>
          <Legend>{t("section.stepReference")}</Legend>
        </SectionShell>
      );
    case "weekday": {
      const best = Math.max(...s.days.map((d) => d.value ?? -Infinity));
      return (
        <SectionShell variant="card" {...cardOf("By weekday", t("section.byWeekday"))}>
          <ColumnChart
            summary={t("section.weekdaySummary", { label: c.vm.label, count: s.weeks, list: s.days.map((d) => `${d.label} ${formatValue(c.vm.format, d.value)}`).join(", ") })}
            data={s.days.map((d) => ({ label: d.label, value: d.value, highlight: d.value === best }))}
            format={c.vm.format}
            unit={c.vm.unit}
          />
          <Text className={cn(CAPTION, "mt-2")}>{t("section.weekdayCaption", { count: s.weeks })}</Text>
        </SectionShell>
      );
    }
    case "weekly":
      return <Weekly s={s} {...c} />;
    case "intensity":
      return (
        <SectionShell variant="card" {...cardOf("Minutes by intensity", t("section.minutesByIntensity"))}>
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k)} />)}</Divided>
          <Legend>{t("section.intensityLegend")}</Legend>
        </SectionShell>
      );
    case "workouts": {
      const burned = s.items.reduce((a, w) => a + (w.calories ?? 0), 0);
      return (
        <SectionShell variant="card" {...cardOf("Workouts", t("section.workouts"))}>
          {s.items.length ? (
            <>
              <Divided>
                {s.items.map((w) => (
                  <KeyStatRow
                    key={w.id}
                    variant="row"
                    label={w.name}
                    caption={`${clock(w.start, c.timeZone)} - ${clock(w.end, c.timeZone)}`}
                    metric={w.calories === null ? { value: null, reason: "no_data", provisional: false } : ok(w.calories)}
                    unit="kcal"
                    format="grouped"
                    direction="none"
                    href={activityHref(w.id)}
                  />
                ))}
              </Divided>
              {s.active !== null && burned > 0 && (
                <Legend>
                  {t("section.workoutsBurned", { burned: formatValue("grouped", burned), active: formatValue("grouped", s.active) })}
                </Legend>
              )}
            </>
          ) : (
            <EmptyState body={t("section.noWorkouts")} className="py-4" />
          )}
        </SectionShell>
      );
    }
    case "entries":
      return (
        <SectionShell variant="card" {...cardOf("Logged entries", t("section.loggedEntries"))}>
          {s.items.length ? (
            <Divided>
              {s.items.map((e) => (
                <View key={e.id} className="min-h-[52px] flex-row items-center gap-3 py-2">
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className={LABEL}>{e.title}</Text>
                    <Text numberOfLines={1} className={cn(CAPTION, "mt-0.5")}>{e.detail}</Text>
                  </View>
                  <Text className="shrink-0 font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">{clock(e.ts * 1000, c.timeZone)}</Text>
                </View>
              ))}
            </Divided>
          ) : (
            <EmptyState body={t("section.noEntries")} className="py-4" />
          )}
        </SectionShell>
      );
    case "balance":
      return (
        <SectionShell variant="card" {...cardOf("Eaten vs. burned", t("section.eatenVsBurned"))}>
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k, undefined, false)} />)}</Divided>
        </SectionShell>
      );
    case "macros":
      return (
        <SectionShell variant="card" {...cardOf("Macros", t("section.macros"))}>
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k, undefined, false)} />)}</Divided>
        </SectionShell>
      );
    case "readings":
      return (
        <SectionShell variant="card" {...cardOf("Readings", t("section.readings"))}>
          <Divided>
            {s.changes.map((k) => (
              <KeyStatRow key={k.key} variant="row" {...statProps(k, undefined, false)} />
            ))}
            {s.items.map((r) => (
              <KeyStatRow key={r.day} variant="row" label={formatDay(r.day, DAY.short)} metric={ok(r.value)} unit={c.vm.unit} format={c.vm.format} direction="none" />
            ))}
          </Divided>
        </SectionShell>
      );
    case "outliers": {
      const range = `${formatValue(c.vm.format, s.mean - s.sd)} - ${formatValue(c.vm.format, s.mean + s.sd)}${c.vm.unit ? ` ${c.vm.unit}` : ""}`;
      return (
        <SectionShell variant="card" {...cardOf("Unusual days", t("section.unusualDays"))}>
          <Text className={cn(CAPTION, "mb-2")}>{t("section.usualRange", { range })}</Text>
          {s.items.length ? (
            <Divided>
              {s.items.map((o) => (
                <KeyStatRow
                  key={o.day}
                  variant="row"
                  label={formatDay(o.day, DAY.short)}
                  caption={t(o.dir === "high" ? "section.aboveUsual" : "section.belowUsual")}
                  metric={ok(o.value)}
                  unit={c.vm.unit}
                  format={c.vm.format}
                  direction="none"
                />
              ))}
            </Divided>
          ) : (
            <EmptyState body={t("section.noUnusual")} className="py-4" />
          )}
        </SectionShell>
      );
    }
  }
}

function Hourly({ s, vm, timeZone }: Ctx & { s: Extract<Section, { kind: "hourly" }> }) {
  const { t } = useTranslation("trends");
  const sedentary = vm.key === "sedentary_minutes";
  return (
    <SectionShell variant="card" {...(sedentary ? cardOf("Movement by hour", t("section.movementByHour")) : cardOf("Steps by hour", t("section.stepsByHour")))}>
      <MetricState metric={s.hours} skeleton={<ColumnChart.Skeleton />} renderReason={() => <EmptyState body={t("section.noMinuteSteps")} className="py-10" />}>
        {(hours) => {
          const done = hours.filter((h) => h.value !== null);
          const peak = done.reduce((a, h) => ((h.value ?? 0) > (a?.value ?? 0) ? h : a), done[0]);
          return (
            <>
              <ColumnChart
                summary={peak?.value ? t("section.stepsByHourPeak", { label: peak.label, value: formatValue("grouped", peak.value) }) : t("section.stepsByHourSummary")}
                data={hours.map((h, i) => ({ label: h.label, title: t("section.hourSpan", { from: h.label, to: hours[i + 1]?.label ?? clockTick(h.t + 3_600_000, timeZone) }), value: h.value }))}
                format="grouped"
                unit={t("section.stepsUnit")}
                tickEvery={6}
              />
              {sedentary && s.still && (
                <Legend>
                  {t("section.longestStill", { duration: durationWords(s.still.minutes), from: clock(s.still.from, timeZone), to: clock(s.still.to, timeZone) })}
                </Legend>
              )}
            </>
          );
        }}
      </MetricState>
    </SectionShell>
  );
}

function Weekly({ s, vm }: Ctx & { s: Extract<Section, { kind: "weekly" }> }) {
  const { t } = useTranslation("trends");
  const pct = Math.min(100, (s.week.total / s.target) * 100);
  return (
    <SectionShell variant="card" {...cardOf("This week", t("section.thisWeek"))}>
      <Text className="font-numeric text-[28px] font-bold leading-8 tabular-nums">
        {hmm(s.week.total)}
        <Text className="text-sm font-medium leading-5 text-foreground-secondary">{t("section.ofTarget", { target: hmm(s.target) })}</Text>
      </Text>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t("section.weekAria", { label: vm.label })}
        accessibilityValue={{ min: 0, max: s.target, now: Math.round(s.week.total) }}
        className={cn("mb-1 mt-2 h-2 overflow-hidden bg-dial-track", BAR_CORNERS)}
      >
        <View className="h-full bg-optimal" style={{ width: `${pct}%` }} />
      </View>
      <Text className={cn(CAPTION, "mb-4")}>
        {t("section.weekCaption", { from: formatDay(s.week.from, DAY.monthDay), to: formatDay(s.week.to, DAY.monthDay), target: s.target })}
      </Text>
      <ColumnChart
        summary={t("section.weeklySummary", { label: vm.label, count: s.weeks.length, met: s.met })}
        data={s.weeks.map((w) => ({ label: formatDay(w.from, DAY.monthDay), title: t("section.weekOf", { day: formatDay(w.from, DAY.monthDay) }), value: w.value, highlight: (w.value ?? 0) >= s.target }))}
        format="duration"
        tickEvery={3}
        reference={{ y: s.target, label: hmm(s.target) }}
      />
      <Text className={cn(CAPTION, "mt-2")}>
        {t("section.targetMet", { met: s.met, count: s.weeks.length })}
      </Text>
    </SectionShell>
  );
}
