// Health Monitor `/health/monitor` for `d` (spec §7.8). Ported from pulse src/app/(app)/health/monitor/page.tsx and
// loading.tsx (the skeleton shows while the query runs).
import { Children, type ReactNode } from "react";
import { View } from "react-native";
import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { metricLabel } from "@/lib/metricLabels";
import { reasonCopy } from "@/lib/reasons";
import { dayHref, metricHref } from "@/lib/url";
import { getMonitor } from "@/queries/health";
import type { MonitorVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { StatusChip } from "@/ui/metrics/primitives";
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
  within: { tone: "optimal", key: "monitor.within" },
  out: { tone: "warning", key: "monitor.out" },
  illness: { tone: "alert", key: "monitor.out" },
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
  const { t } = useTranslation("health");
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
            averageLabel={t("monitor.priorAverage")}
            sd={m.sd}
            direction="neutral"
            href={at(metricHref(m.key))}
          />
        ))}
      </Divided>
      <Text className={LEGEND}>{t("monitor.legend")}</Text>
    </Card>
  );
}

/** "4/5": the hero. */
function Count({ count }: { count: MonitorVM["count"] }) {
  const { t } = useTranslation("health");
  const v = count.value;
  const reason = v ? null : reasonCopy(count.reason);
  const chip = v ? CHIP[v.status] : null;
  return (
    <View className="items-center gap-3 py-4">
      {/* One sentence for a screen reader; the parts below are hidden from it. */}
      <View accessible accessibilityLabel={v ? t("monitor.countAria", { inRange: v.inRange, total: v.total }) : t("monitor.countUnavailable", { reason: reason!.long })} className="items-center gap-3">
        <Text accessibilityElementsHidden className={cn("font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.01em] tabular-nums", !v && "text-muted-foreground")}>
          {v ? v.inRange : "--"}
          <Text className="text-[35px] text-foreground-secondary">/{v?.total ?? 5}</Text>
        </Text>
        <Text accessibilityElementsHidden className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          {t("monitor.metricsWithin")}
        </Text>
      </View>
      {chip && (
        <StatusChip tone={chip.tone} className="self-center">
          {t(chip.key)}
        </StatusChip>
      )}
      {reason && <Text className="max-w-72 text-center text-xs font-medium leading-4 text-muted-foreground">{reason.long}</Text>}
    </View>
  );
}

function IllnessAlert() {
  const { c } = useTheme();
  const { t } = useTranslation("health");
  return (
    <Card ring={c["alert-ring"]} className="flex-row gap-3 px-4 py-3">
      {/* min-w-0 flex-1: the card's width, so the sentence wraps in it (an auto-width row would size it to its content). */}
      <View accessibilityRole="alert" className="min-w-0 flex-1 flex-row gap-3">
        <View className="mt-px">
          <Icon icon={CircleAlert} size={20} tone="recovery-red-text" strokeWidth={1.75} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-semibold leading-[22px]">{t("monitor.illnessTitle")}</Text>
          <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("monitor.illnessBody")}</Text>
        </View>
      </View>
    </Card>
  );
}

export function MonitorScreen() {
  const { t } = useTranslation("health");
  const { data, error, reload } = useDayScreen("monitor", getMonitor);
  if (!data) return error ? <ErrorView detail retry={reload} /> : <MonitorLoading />;
  const { vm, d, today } = data;
  return (
    <DetailShell
      title="Health Monitor"
      dateSwitcher={{ mode: "day" }}
      info={MONITOR_INFO}
      hero={<Count count={vm.count} />}
      summary={vm.illness && <IllnessAlert />}
      bodySkeleton={readingsSkeleton()}
      primary={
        <SectionShell variant="section" title={t("title.lastNight")}>
          <VitalTiles vitals={vm.vitals} day={d} today={today} />
        </SectionShell>
      }
      footer={
        <View className="gap-8">
          {/* ECG and irregular rhythm notifications come only from the Google Health API, which Pulse no longer reads:
              Health Connect has neither, so the section shows only if an older import left readings. */}
          {(vm.heartRhythm.ecg.length > 0 || vm.heartRhythm.irn.count > 0) && (
            <SectionShell variant="section" title={t("title.heartRhythm")}>
              <HeartRhythm rhythm={vm.heartRhythm} />
            </SectionShell>
          )}
          <SectionShell variant="section" title={t("title.measurements")}>
            <Measurements rows={vm.measurements} at={(href) => dayHref(href, d, today)} />
          </SectionShell>
        </View>
      }
    />
  );
}

const readingsSkeleton = () => (
  <SectionShell variant="section" title={i18n.t("health:title.lastNight")}>
    <VitalTilesSkeleton />
  </SectionShell>
);

/**
 * Health Monitor loading (spec §7.8, §5.19): the date row, the count hero, the five vital tiles with the note, then
 * the two measurements every user has (Heart rhythm shows only with readings, so it is not drawn ahead).
 */
function MonitorLoading() {
  const { t } = useTranslation("health");
  return (
    <DetailShell
      loading
      title="Health Monitor"
      dateSwitcher={{ mode: "day" }}
      hero={
        <View accessibilityElementsHidden className="items-center gap-3 py-4">
          <SkeletonText lh={64} fs={64} className="w-[83px]" />
          <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">{t("monitor.metricsWithin")}</Text>
          <Skeleton className="h-6 w-28 rounded-md" />
        </View>
      }
      primary={readingsSkeleton()}
      bodySkeleton={readingsSkeleton()}
      footer={
        <View className="gap-8">
          <SectionShell variant="section" title={t("title.measurements")}>
            <Card className="gap-0 px-4 py-1">
              <Divided>
                <KeyStatRowSkeleton variant="row" label={metricLabel("weight")} icon={STAT_ICON.weight ? <Icon icon={STAT_ICON.weight} size={20} tone="muted-foreground" /> : undefined} />
                <KeyStatRowSkeleton variant="row" label={metricLabel("body_fat")} icon={STAT_ICON.body_fat ? <Icon icon={STAT_ICON.body_fat} size={20} tone="muted-foreground" /> : undefined} />
              </Divided>
            </Card>
          </SectionShell>
        </View>
      }
    />
  );
}
