// A metric screen's own sections (web: metric/[key]/sections.tsx): what the metric is made of, by kind.
import type { ReactNode } from "react";
import { View } from "react-native";
import { clock, DAY, durationWords, formatDay, formatValue, hmm } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { activityHref } from "@/lib/url";
import type { MetricDetailVM, Section } from "@/queries/metric";
import { Divided } from "@/screens/trends/parts";
import { CAPTION, LABEL, statProps } from "@/screens/_lib/view";
import { ColumnChart } from "@/ui/charts/ColumnChart";
import { cn } from "@/ui/cn";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { EmptyState } from "@/ui/shells/EmptyState";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";

type Ctx = { vm: MetricDetailVM; timeZone?: string };

/** The inset strip under a card's rows (the web's LEGEND: the class has text styles a View cannot pass down). */
function Legend({ children }: { children: ReactNode }) {
  return (
    <View className="mb-3 mt-1 rounded-lg bg-inset px-3 py-2">
      <Text className="text-xs font-medium leading-4 text-foreground-secondary">{children}</Text>
    </View>
  );
}

const ok = (v: number): Metric<number> => ({ value: v, reason: null, provisional: false });

export function MetricSection({ s, ...c }: Ctx & { s: Section }) {
  switch (s.kind) {
    case "hourly":
      return <Hourly s={s} {...c} />;
    case "goal":
      return (
        <SectionShell variant="card" title={`${formatValue("grouped", s.target)}-step days`} info={{ title: "Days reaching the step reference", body: "Recorded days that reached the displayed step reference. Missing data does not count as a completed day." }}>
          <Divided>
            <KeyStatRow variant="row" label="Current streak" metric={ok(s.streak)} unit={s.streak === 1 ? "day" : "days"} format="int" direction="none" />
            <KeyStatRow variant="row" label="Longest streak" caption="In the past year" metric={ok(s.longest)} unit={s.longest === 1 ? "day" : "days"} format="int" direction="none" />
            <KeyStatRow variant="row" label="Days reached" caption={`In the last ${s.days} days`} metric={ok(s.met)} unit={`of ${s.days}`} format="int" direction="none" />
          </Divided>
          <Legend>About 7,000 steps a day goes with markedly lower health risks in a 2025 review of 57 studies. It is a reference, not a goal you set.</Legend>
        </SectionShell>
      );
    case "weekday": {
      const best = Math.max(...s.days.map((d) => d.value ?? -Infinity));
      return (
        <SectionShell variant="card" title="By weekday">
          <ColumnChart
            summary={`Average ${c.vm.label} by weekday over the last ${s.weeks} weeks: ${s.days.map((d) => `${d.label} ${formatValue(c.vm.format, d.value)}`).join(", ")}.`}
            data={s.days.map((d) => ({ label: d.label, value: d.value, highlight: d.value === best }))}
            format={c.vm.format}
            unit={c.vm.unit}
          />
          <Text className={cn(CAPTION, "mt-2")}>Daily average for each weekday over the last {s.weeks} weeks.</Text>
        </SectionShell>
      );
    }
    case "weekly":
      return <Weekly s={s} {...c} />;
    case "intensity":
      return (
        <SectionShell variant="card" title="Minutes by intensity">
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k)} />)}</Divided>
          <Legend>This day vs. its prior 30 days</Legend>
        </SectionShell>
      );
    case "workouts": {
      const burned = s.items.reduce((a, w) => a + (w.calories ?? 0), 0);
      return (
        <SectionShell variant="card" title="Workouts">
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
                  Workouts burned {formatValue("grouped", burned)} of the day’s {formatValue("grouped", s.active)} active kcal.
                </Legend>
              )}
            </>
          ) : (
            <EmptyState body="No workouts recorded on this day." className="py-4" />
          )}
        </SectionShell>
      );
    }
    case "entries":
      return (
        <SectionShell variant="card" title="Logged entries">
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
            <EmptyState body="Nothing logged in Pulse on this day. Entries made in other apps count in the total once they sync." className="py-4" />
          )}
        </SectionShell>
      );
    case "balance":
      return (
        <SectionShell variant="card" title="Eaten vs. burned">
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k, undefined, false)} />)}</Divided>
        </SectionShell>
      );
    case "macros":
      return (
        <SectionShell variant="card" title="Macros">
          <Divided>{s.rows.map((k) => <KeyStatRow key={k.key} variant="row" {...statProps(k, undefined, false)} />)}</Divided>
        </SectionShell>
      );
    case "readings":
      return (
        <SectionShell variant="card" title="Readings">
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
        <SectionShell variant="card" title="Unusual days">
          <Text className={cn(CAPTION, "mb-2")}>Your usual range over the last 90 days is {range}. Days far outside it are listed here.</Text>
          {s.items.length ? (
            <Divided>
              {s.items.map((o) => (
                <KeyStatRow
                  key={o.day}
                  variant="row"
                  label={formatDay(o.day, DAY.short)}
                  caption={o.dir === "high" ? "Above your usual range" : "Below your usual range"}
                  metric={ok(o.value)}
                  unit={c.vm.unit}
                  format={c.vm.format}
                  direction="none"
                />
              ))}
            </Divided>
          ) : (
            <EmptyState body="No unusual days in the last 90 days." className="py-4" />
          )}
        </SectionShell>
      );
    }
  }
}

function Hourly({ s, vm, timeZone }: Ctx & { s: Extract<Section, { kind: "hourly" }> }) {
  const sedentary = vm.key === "sedentary_minutes";
  return (
    <SectionShell variant="card" title={sedentary ? "Movement by hour" : "Steps by hour"}>
      <MetricState metric={s.hours} skeleton={<ColumnChart.Skeleton />} renderReason={() => <EmptyState body="No per-minute steps for this day." className="py-10" />}>
        {(hours) => {
          const done = hours.filter((h) => h.value !== null);
          const peak = done.reduce((a, h) => ((h.value ?? 0) > (a?.value ?? 0) ? h : a), done[0]);
          return (
            <>
              <ColumnChart
                summary={`Steps by hour${peak?.value ? `, most at ${peak.label} with ${formatValue("grouped", peak.value)}` : ""}.`}
                data={hours.map((h, i) => ({ label: h.label, title: `${h.label} - ${hours[i + 1]?.label ?? "24:00"}`, value: h.value }))}
                format="grouped"
                unit="steps"
                tickEvery={6}
              />
              {sedentary && s.still && (
                <Legend>
                  Longest daytime stretch without steps: {durationWords(s.still.minutes)}, {clock(s.still.from, timeZone)} - {clock(s.still.to, timeZone)}
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
  const pct = Math.min(100, (s.week.total / s.target) * 100);
  return (
    <SectionShell variant="card" title="This week">
      <Text className="font-numeric text-[28px] font-bold leading-8 tabular-nums">
        {hmm(s.week.total)}
        <Text className="text-sm font-medium leading-5 text-foreground-secondary"> of {hmm(s.target)}</Text>
      </Text>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`${vm.label} this week`}
        accessibilityValue={{ min: 0, max: s.target, now: Math.round(s.week.total) }}
        className="mb-1 mt-2 h-2 overflow-hidden rounded-full bg-dial-track"
      >
        <View className="h-full rounded-full bg-optimal" style={{ width: `${pct}%` }} />
      </View>
      <Text className={cn(CAPTION, "mb-4")}>
        {formatDay(s.week.from, DAY.monthDay)} - {formatDay(s.week.to, DAY.monthDay)}, toward the {s.target} minutes a week the WHO recommends
      </Text>
      <ColumnChart
        summary={`${vm.label} per week, last ${s.weeks.length} weeks. Target met in ${s.met}.`}
        data={s.weeks.map((w) => ({ label: formatDay(w.from, DAY.monthDay), title: `Week of ${formatDay(w.from, DAY.monthDay)}`, value: w.value, highlight: (w.value ?? 0) >= s.target }))}
        format="duration"
        tickEvery={3}
        reference={{ y: s.target, label: hmm(s.target) }}
      />
      <Text className={cn(CAPTION, "mt-2")}>
        Target met in {s.met} of the last {s.weeks.length} weeks
      </Text>
    </SectionShell>
  );
}
