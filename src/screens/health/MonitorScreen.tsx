// Health Monitor `/health/monitor` for `d` (spec §7.8). Ported from pulse src/app/(app)/health/monitor/page.tsx and
// loading.tsx (the skeleton shows while the query runs).
import { Children, type ReactNode } from "react";
import { View } from "react-native";
import { CircleAlert } from "lucide-react-native";
import { reasonCopy } from "@/lib/reasons";
import { dayHref, metricHref } from "@/lib/url";
import { getMonitor } from "@/queries/health";
import type { MonitorVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { StatusChip } from "@/ui/metrics/primitives";
import { alpha } from "@/ui/color";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { LEGEND, STAT_ICON } from "../_lib/view";
import { useDayScreen } from "./day";
import { ErrorView } from "./ErrorView";
import { HeartRhythm } from "./HeartRhythm";
import { MONITOR_INFO } from "./info";
import { VitalTiles, VitalTilesSkeleton } from "./VitalTiles";

const CHIP = {
  within: { tone: "optimal", text: "Within range" },
  out: { tone: "warning", text: "Out of range" },
  illness: { tone: "alert", text: "Out of range" },
} as const;

/** The web's `divide-y divide-border`. */
function Divided({ children }: { children: ReactNode }) {
  return (
    <View>
      {Children.toArray(children).map((c, i) => (
        <View key={i} className={cn(i > 0 && "border-t border-border")}>
          {c}
        </View>
      ))}
    </View>
  );
}

function Measurements({ rows, at }: { rows: MonitorVM["measurements"]; at: (href: string) => string }) {
  return (
    <Card className="gap-0 px-4 py-1">
      <Divided>
        {rows.map((m) => (
          <KeyStatRow
            key={m.key}
            variant="row"
            icon={STAT_ICON[m.key] ? <Icon icon={STAT_ICON[m.key]} size={20} tone="muted-foreground" /> : undefined}
            label={m.label}
            caption={m.caption}
            metric={m.metric}
            unit={m.unit}
            format={m.format}
            average={m.average}
            averageLabel="prior 30-day average"
            sd={m.sd}
            direction="neutral"
            href={at(metricHref(m.key))}
          />
        ))}
      </Divided>
      <Text className={LEGEND}>Latest reading vs. the 30 days before it</Text>
    </Card>
  );
}

/** "4/5": the hero. */
function Count({ count }: { count: MonitorVM["count"] }) {
  const v = count.value;
  const reason = v ? null : reasonCopy(count.reason);
  const chip = v ? CHIP[v.status] : null;
  return (
    <View className="items-center gap-3 py-4">
      {/* One sentence for a screen reader; the parts below are hidden from it. */}
      <View accessible accessibilityLabel={v ? `${v.inRange} of ${v.total} metrics within range` : `Metrics within range unavailable: ${reason!.long}`} className="items-center gap-3">
        <Text accessibilityElementsHidden className={cn("font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.01em] tabular-nums", !v && "text-muted-foreground")}>
          {v ? v.inRange : "--"}
          <Text className="text-[35px] text-foreground-secondary">/{v?.total ?? 5}</Text>
        </Text>
        <Text accessibilityElementsHidden className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          Metrics within range
        </Text>
      </View>
      {chip && <StatusChip tone={chip.tone}>{chip.text}</StatusChip>}
      {reason && <Text className="max-w-72 text-center text-xs font-medium leading-4 text-muted-foreground">{reason.long}</Text>}
    </View>
  );
}

function IllnessAlert() {
  const { c } = useTheme();
  return (
    <Card ring={alpha(c["recovery-red"], 0.6)} className="flex-row gap-3 px-4 py-3">
      <View accessibilityRole="alert" className="flex-row gap-3">
        <View className="mt-px">
          <Icon icon={CircleAlert} size={20} tone="recovery-red-text" strokeWidth={1.75} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-semibold leading-[22px]">Possible illness signal</Text>
          <Text className="text-[15px] leading-[22px] text-foreground-secondary">
            Several vitals moved away from your normal range together, a pattern that often comes before feeling unwell. Consider an easier day and extra sleep.
          </Text>
        </View>
      </View>
    </Card>
  );
}

export function MonitorScreen() {
  const { data, error, reload } = useDayScreen(getMonitor);
  if (!data) return error ? <ErrorView detail retry={reload} /> : <MonitorLoading />;
  const { vm, d, today } = data;
  return (
    <DetailShell
      title="Health Monitor"
      dateSwitcher={{ mode: "day" }}
      info={MONITOR_INFO}
      hero={<Count count={vm.count} />}
      summary={vm.illness && <IllnessAlert />}
      primary={
        <SectionShell variant="section" title="Last night’s readings">
          <VitalTiles vitals={vm.vitals} day={d} today={today} />
        </SectionShell>
      }
      footer={
        <View className="gap-8">
          <SectionShell variant="section" title="Heart rhythm">
            <HeartRhythm rhythm={vm.heartRhythm} />
          </SectionShell>
          <SectionShell variant="section" title="Measurements">
            <Measurements rows={vm.measurements} at={(href) => dayHref(href, d, today)} />
          </SectionShell>
        </View>
      }
    />
  );
}

/**
 * Health Monitor loading (spec §7.8, §5.19): the date row, the count hero, the five vital tiles with the note, then
 * Heart rhythm at its one-row size and the two measurements every owner has.
 */
function MonitorLoading() {
  return (
    <DetailShell
      loading
      title="Health Monitor"
      dateSwitcher={{ mode: "day" }}
      hero={
        <View accessibilityElementsHidden className="items-center gap-3 py-4">
          <SkeletonText lh={64} fs={64} className="w-[83px]" />
          <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">Metrics within range</Text>
          <Skeleton className="h-6 w-28 rounded-md" />
        </View>
      }
      primary={
        <SectionShell variant="section" title="Last night’s readings">
          <VitalTilesSkeleton />
        </SectionShell>
      }
      footer={
        <View className="gap-8">
          <SectionShell variant="section" title="Heart rhythm">
            <Skeleton className="h-14 w-full rounded-2xl" />
          </SectionShell>
          <SectionShell variant="section" title="Measurements">
            <Card className="gap-0 px-4 py-1">
              <Divided>
                <KeyStatRowSkeleton variant="row" label="Weight" icon={STAT_ICON.weight ? <Icon icon={STAT_ICON.weight} size={20} tone="muted-foreground" /> : undefined} />
                <KeyStatRowSkeleton variant="row" label="Body fat" icon={STAT_ICON.body_fat ? <Icon icon={STAT_ICON.body_fat} size={20} tone="muted-foreground" /> : undefined} />
              </Divided>
            </Card>
          </SectionShell>
        </View>
      }
    />
  );
}
