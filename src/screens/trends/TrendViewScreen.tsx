// Trend View `/trend/[key]?d=&r=&p=` (web: (app)/trend/[key]/page.tsx, spec §11 R29): one metric over a W / M / 6M window,
// stepped back `p` periods, against the window before it, with a verdict, a breakdown and an explainer.
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight, Info, Plus, Target } from "lucide-react-native";
import { push } from "@/ui/navigate";
import { chartDef } from "@/queries/chart";
import { chartHref } from "@/screens/chart/href";
import { formatValue } from "@/lib/format";
import { CARD_BUTTON } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { getTrendView, isTrendViewKey, priorLabel, type TrendViewKey, type TrendViewVM } from "@/queries/trendView";
import { useScreen } from "@/screens/useScreen";
import { STAT_ICON } from "@/screens/_lib/view";
import { ADD_ACTIVITY_INFO } from "@/screens/_lib/info";
import { BreakdownBar } from "@/ui/metrics/BreakdownBar";
import { LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { TrendLegend } from "@/ui/metrics/TrendLegend";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { InfoCardTrigger } from "@/ui/shells/InfoButton";
import { ActionLink, SectionShell } from "@/ui/shells/SectionShell";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { parseOffset, parseTrendRange, TREND_VIEW_RANGES, type TrendViewRange } from "@/lib/trend";
import { LoadError } from "./parts";
import { TrendMetricMenu } from "./TrendMetricMenu";
import { TrendViewChart } from "./TrendViewChart";
import { Press } from "@/ui/Press";

const RANGE_TEXT: Record<TrendViewRange, string> = { w: "W", m: "M", "6m": "6M" };
const RANGE_ARIA: Record<TrendViewRange, string> = { w: "1 week", m: "1 month", "6m": "6 months" };

/** The route's `?r=` and `?p=`, replaced in place, so Back leaves the screen. */
const go = (o: { r?: TrendViewRange; p?: number }) => router.setParams({ ...(o.r !== undefined && { r: o.r }), ...(o.p !== undefined && { p: o.p ? String(o.p) : "" }) });

export default function TrendViewScreen() {
  const { key, r, p } = useLocalSearchParams<{ key: string; r?: string; p?: string }>();
  const [d] = useSelectedDay();
  const range = parseTrendRange(r);
  const offset = parseOffset(p);
  const valid = isTrendViewKey(key);
  const { data, error, reload } = useScreen((ctx) => getTrendView(key as TrendViewKey, d, range, offset, ctx), ["trendView", key, d, range, offset]);
  // A range, period or day change keeps the old view model on screen until the new one lands (the web keeps the page while
  // it navigates); another metric never draws the old one under its title.
  const vm = data?.key === key ? data : undefined;

  if (!valid) return <DetailShell title="Trend view" primary={<EmptyState body="This metric has no trend view." />} />;
  if (error && !vm) return <LoadError title="Trend view" reload={reload} />;
  if (!vm) return <DetailShell loading title="Trend view" />;

  return (
    <DetailShell
      title="Trend view"
      primary={
        <View className="gap-6">
          <TrendMetricMenu
            current={key}
            options={vm.options.map((o) => ({ key: o.key, label: o.label, icon: STAT_ICON[o.key] }))}
            // A choice keeps the range and the day, and starts at the latest period.
            onSelect={(k) => router.setParams({ key: k, p: "" })}
          />
          <Headline vm={vm} />
          <Text className="text-[17px] font-medium leading-6">{vm.verdict}</Text>
          <View className="min-w-0">
            <TrendLegend chart={vm.chart} series={vm.series} typical={!!vm.typical} />
            <TrendViewChart
              label={vm.label}
              bars={vm.bars}
              chart={vm.chart}
              range={vm.range}
              colorBy={vm.colorBy}
              format={vm.format}
              unit={vm.unit}
              direction={vm.direction}
              series={vm.series}
              domain={vm.domain}
              typical={vm.typical}
              average={vm.value}
              segments={vm.segments}
            />
            {/* The whole history, zoomable, in the chart explorer. */}
            {chartDef(key) && (
              <View className="mt-3 items-end">
                <ActionLink label="Explore" href={chartHref({ metric: key, r: vm.range, d })} />
              </View>
            )}
            {!!vm.footnote && (
              <View className="mt-3 flex-row items-start gap-2">
                <View className="mt-0.5"><Icon icon={Info} size={16} tone="muted-foreground" strokeWidth={2} /></View>
                <Text className="flex-1 text-[13px] leading-5 text-muted-foreground">{vm.footnote}</Text>
              </View>
            )}
          </View>
          {/* Pulse imports workouts, so Add activity explains where they come from (§11 R2). The goal button opens
              Settings › Goals, where the daily goals and the Weekly plan's targets are set. */}
          {!!vm.actions.goal && (
            <Press accessibilityRole="link" activeScale={0.96} onPress={() => (haptic.tap(), push("/settings?s=goals"))} className={CARD_BUTTON}>
              <Icon icon={Target} size={20} tone="foreground" strokeWidth={2} />
              <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">{vm.actions.goal}</Text>
            </Press>
          )}
          {vm.actions.addActivity && (
            <InfoCardTrigger info={ADD_ACTIVITY_INFO} activeScale={0.96} className={CARD_BUTTON}>
              <Icon icon={Plus} size={20} tone="foreground" strokeWidth={2} />
              <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">Add activity</Text>
            </InfoCardTrigger>
          )}
        </View>
      }
      secondary={[
        vm.breakdown && <BreakdownBar key="breakdown" {...vm.breakdown} />,
        <SectionShell key="about" variant="card" title={vm.about.title}>
          <View className="gap-3">
            {vm.about.body.map((t) => (
              <Text key={t} className="text-[15px] leading-[22px] text-foreground-secondary">{t}</Text>
            ))}
          </View>
        </SectionShell>,
      ].filter(Boolean)}
    />
  );
}

function Headline({ vm }: { vm: TrendViewVM }) {
  const { c } = useTheme();
  const arrow = "size-10 items-center justify-center rounded-full";
  return (
    <View className="flex-row items-start gap-x-3">
      <View className="min-w-0 flex-1">
        <Text className={cn(LABEL, "text-muted-foreground")}>{vm.caption}</Text>
        <ValueUnit value={formatValue(vm.format, vm.value)} unit={vm.format === "duration" ? "hr" : vm.unit} className="font-numeric text-[34px] font-bold leading-10" fit />
        {vm.change !== null && (
          <StatusChip tone={vm.tone === "good" ? "optimal" : vm.tone === "bad" ? "warning" : "neutral"} delta={vm.change > 0 ? "up" : vm.change < 0 ? "down" : "flat"} className="mt-1">
            {Math.abs(vm.change)}% {priorLabel(vm.range)}
          </StatusChip>
        )}
      </View>
      <View className="shrink-0 items-end gap-2">
        {/* Three 56 px segments: the web's `min-w-14` on each. */}
        <View className="w-44">
          <Segmented label="Range" fill value={vm.range} options={TREND_VIEW_RANGES.map((r) => ({ value: r, label: RANGE_TEXT[r], accessibilityLabel: RANGE_ARIA[r] }))} onChange={(r) => go({ r, p: 0 })} />
        </View>
        <View accessibilityRole="toolbar" accessibilityLabel="Period" className="flex-row items-center gap-1">
          <PeriodStep dir="prev" enabled={vm.canPrev} onPress={() => go({ p: vm.offset + 1 })} className={arrow} color={c.foreground} dim={c["muted-foreground"]} />
          <Text className="whitespace-nowrap font-numeric text-[13px] font-bold uppercase leading-4 tracking-[0.06em] tabular-nums">{vm.period}</Text>
          <PeriodStep dir="next" enabled={vm.offset > 0} onPress={() => go({ p: vm.offset - 1 })} className={arrow} color={c.foreground} dim={c["muted-foreground"]} />
        </View>
      </View>
    </View>
  );
}

/** The period stepper's arrow: a 40 px button, or a dim glyph where there is nothing further. */
function PeriodStep({ dir, enabled, onPress, className, color, dim }: { dir: "prev" | "next"; enabled: boolean; onPress: () => void; className: string; color: string; dim: string }) {
  const Glyph = dir === "prev" ? ChevronLeft : ChevronRight;
  const label = `${dir === "prev" ? "Previous" : "Next"} period`;
  return enabled ? (
    <Press accessibilityRole="button" accessibilityLabel={label} onPress={() => (haptic.tap(), onPress())} activeScale={0.96} activeBg="bg-fill-pressed" className={className}>
      <Glyph size={20} color={color} strokeWidth={2.5} />
    </Press>
  ) : (
    <View accessibilityElementsHidden className={className}>
      <Glyph size={20} color={dim} strokeWidth={2.5} style={{ opacity: 0.4 }} />
    </View>
  );
}
