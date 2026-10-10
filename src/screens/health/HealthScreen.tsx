// The web sizes skeleton bars in `ch` (the width of a digit); React Native has no such unit, so a digit is taken as 0.52 em of the
// Barlow numerals and the widths are written in px.
// Health hub `/health` (spec §7.6): today's values; each card links to its detail screen. Ported from pulse
// src/app/(app)/health/page.tsx and loading.tsx (the skeleton shows while the query runs).
import { View } from "react-native";
import { Activity, Check, Droplet, Heart, Thermometer, TriangleAlert, Wind, type LucideIcon } from "lucide-react-native";
import type { ChipTone } from "@/lib/bands";
import { formatValue, hmm } from "@/lib/format";
import { getHealthHub } from "@/queries/health";
import type { HealthHubVM, VitalKey } from "@/queries/types";
import { StressChart, StressChartSkeleton } from "@/ui/charts/StressChart";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { TickScale, TickScaleSkeleton } from "@/ui/metrics/TickScale";
import { MetricState } from "@/ui/shells/MetricState";
import { PageShell } from "@/ui/shells/PageShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { AgeOrb } from "./AgeOrb";
import { CardButton } from "./CardButton";
import { ErrorView } from "./ErrorView";
import { categoryTone, categoryWord, ordinal } from "./format";
import { LastReading } from "./LastReading";
import { FAST, SLOW } from "./pace";

const TILE = "font-numeric text-4xl leading-10 font-bold tracking-[-0.01em]";
const EMPTY = "text-[15px] leading-[22px] text-foreground-secondary";

const VITAL_ICON: Record<VitalKey, LucideIcon> = { resp: Wind, spo2: Droplet, restingHr: Heart, hrv: Activity, skinTempDev: Thermometer };
const VITAL_ORDER: { key: VitalKey; short: string }[] = [
  { key: "resp", short: "Resp" },
  { key: "spo2", short: "SpO2" },
  { key: "restingHr", short: "RHR" },
  { key: "hrv", short: "HRV" },
  { key: "skinTempDev", short: "Temp" },
];
const ACWR_WORD: Record<ChipTone, string> = { optimal: "Optimal", warning: "Pushing", alert: "High risk", neutral: "Detraining" };

const skeleton = <Skeleton className="h-16 w-full" />;
const Chip = () => <Skeleton className="h-6 w-24 rounded-md" />;

/** "Slower vs. last week" / "Faster vs. last week" / "No change vs. last week" (spec §6), from the week-on-week pace change. */
function paceChip(delta: number | null) {
  if (delta === null) return null;
  if (Math.abs(delta) < 0.05) return { tone: "neutral" as const, dir: "flat" as const, text: "No change vs. last week" };
  return delta < 0 ? { tone: "optimal" as const, dir: "down" as const, text: "Slower vs. last week" } : { tone: "warning" as const, dir: "up" as const, text: "Faster vs. last week" };
}

/**
 * The hub's age block (health-02, health-04): the orb on the page with no card around it, then the Pace of Aging card
 * (the ruler and its week-on-week chip) ending in GO TO HEALTHSPAN.
 */
function AgeBlock({ m }: { m: HealthHubVM["healthspan"] }) {
  return (
    <MetricState
      metric={m}
      skeleton={skeleton}
      renderReason={() => (
        <SectionShell variant="card" title="Healthspan" href="/health/healthspan">
          <Text className={EMPTY}>Healthspan needs 20 days of data.</Text>
        </SectionShell>
      )}
    >
      {(v, meta) => {
        const chip = paceChip(v.paceDelta);
        return (
          <View className="gap-6">
            <View className="items-center py-2">
              <AgeOrb age={v.pulseAge} deltaYears={v.deltaYears} provisional={meta.provisional} size={260} />
            </View>
            <SectionShell
              variant="card"
              title="Pace of Aging"
              action={
                chip && (
                  <StatusChip tone={chip.tone} delta={chip.dir}>
                    {chip.text}
                  </StatusChip>
                )
              }
            >
              <View className="gap-5">
                <TickScale
                  variant="marker"
                  label="Pace of Aging"
                  metric={{ value: v.pace, reason: null, provisional: meta.provisional }}
                  min={-1}
                  max={3}
                  format="decimal1"
                  unit="x"
                  describe={v.pace < 1 ? "aging slower than your 6-month average" : v.pace > 1 ? "aging faster than your 6-month average" : "aging at the normal rate"}
                  ends={["−1.0x", "1.0x", "3.0x"]}
                  leading={SLOW}
                  trailing={FAST}
                />
                <CardButton href="/health/healthspan">Go to Healthspan</CardButton>
              </View>
            </SectionShell>
          </View>
        );
      }}
    </MetricState>
  );
}

function Monitor({ m }: { m: HealthHubVM["monitor"] }) {
  const readings = (v?: NonNullable<HealthHubVM["monitor"]["value"]>) => (
    <View className="flex-row">
      {VITAL_ORDER.map(({ key, short }, i) => {
        const status = v?.vitals.find((x) => x.key === key)?.status ?? "no_data";
        const ok = status === "in_range";
        const label = `${short}: ${status === "no_data" ? "no reading" : ok ? "within range" : "out of range"}`;
        return (
          <View key={key} accessible accessibilityLabel={label} className={cn("min-w-0 flex-1 items-center gap-2 px-1", i > 0 && "border-l border-border")}>
            <Icon icon={VITAL_ICON[key]} size={24} tone="muted-foreground" strokeWidth={1.75} />
            <Text accessibilityElementsHidden numberOfLines={1} className={cn(LABEL, "w-full text-center")}>
              {short}
            </Text>
            <View accessibilityElementsHidden className={cn("size-5 items-center justify-center rounded-sm", status === "no_data" ? "bg-secondary" : ok ? "bg-optimal/15" : "bg-warning/15")}>
              {status === "no_data" ? (
                <Text className="font-numeric text-[10px] font-bold text-muted-foreground">--</Text>
              ) : ok ? (
                <Icon icon={Check} size={14} tone="optimal-text" strokeWidth={2.5} />
              ) : (
                <Icon icon={TriangleAlert} size={12} tone="warning-text" strokeWidth={2.5} />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
  return (
    <MetricState
      metric={m}
      skeleton={skeleton}
      renderReason={() => (
        <View className="gap-3">
          {readings()}
          <Text className={EMPTY}>No readings from last night</Text>
        </View>
      )}
    >
      {(v) => {
        const all = v.inRange === v.total;
        return (
          <View className="gap-4">
            {readings(v)}
            <View className="flex-row items-center gap-3 rounded-lg bg-inset px-3 py-2.5">
              <View className={cn("size-5 shrink-0 items-center justify-center rounded-sm", all ? "bg-optimal" : "bg-warning")}>
                {all ? <Icon icon={Check} size={14} tone="background" strokeWidth={3} /> : <Icon icon={TriangleAlert} size={12} tone="primary-foreground" strokeWidth={2.5} />}
              </View>
              <Text className="text-[15px] leading-[22px] tabular-nums">
                {v.inRange}/{v.total} within range
              </Text>
            </View>
          </View>
        );
      }}
    </MetricState>
  );
}

function Stress({ m }: { m: HealthHubVM["stress"] }) {
  return (
    <MetricState metric={m} skeleton={skeleton} renderReason={() => <Text className={EMPTY}>No still minutes yet today</Text>}>
      {(v, meta) => {
        const typical = v.typicalHighMin;
        const dir = typical === null ? null : v.highMin < typical - 1 ? "down" : v.highMin > typical + 1 ? "up" : "flat";
        const tone: ChipTone = dir === "down" ? "optimal" : dir === "up" ? "warning" : "neutral";
        const spark = { value: { points: v.spark.map((p) => ({ t: p.t, value: p.v })) }, reason: null, provisional: meta.provisional };
        return (
          <View className="flex-row items-end gap-4">
            <View className="gap-2">
              <Text className={LABEL}>Today’s high stress</Text>
              <ValueUnit value={hmm(v.highMin)} unit="hrs" className={TILE} />
              {dir && (
                <StatusChip tone={tone} delta={dir}>
                  vs. typical {v.weekday}
                </StatusChip>
              )}
            </View>
            <View className="min-w-0 flex-1">
              <StressChart variant="spark" data={spark} />
            </View>
          </View>
        );
      }}
    </MetricState>
  );
}

function Fitness({ m }: { m: HealthHubVM["fitness"] }) {
  return (
    <MetricState metric={m} skeleton={skeleton} renderReason={() => <Text className={EMPTY}>No VO2 max yet. Fitbit estimates it from runs and resting heart rate.</Text>}>
      {(v) => (
        <View className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 shrink gap-1">
            <ValueUnit value={formatValue("decimal1", v.vo2max)} unit="ml/kg/min" className={TILE} />
            <Text className={cn(LABEL, categoryTone(v.category))}>{categoryWord(v.category)}</Text>
            <Text className={CAPTION}>{ordinal(v.percentile)} percentile for your age</Text>
          </View>
          {v.acwr !== null && v.acwrTone && (
            <View className="shrink-0 items-end gap-1">
              <Text className={LABEL}>Training load</Text>
              <Text className="font-numeric text-xl font-bold leading-6 tabular-nums">{formatValue("decimal2", v.acwr)}</Text>
              <StatusChip tone={v.acwrTone}>{ACWR_WORD[v.acwrTone]}</StatusChip>
            </View>
          )}
        </View>
      )}
    </MetricState>
  );
}

function HeartRate({ hr, now }: { hr: HealthHubVM["heartRate"]; now: number }) {
  if (!hr) return <Text className={EMPTY}>No heart-rate readings yet. They show here once your band syncs.</Text>;
  return (
    <View className="gap-1">
      <ValueUnit value={String(hr.bpm)} unit="bpm" className={TILE} />
      <LastReading t={hr.t} now={now} />
    </View>
  );
}

const FOOTNOTE = "Estimates for personal insight, not medical advice.";

export function HealthScreen() {
  // `now` is the query's clock (epoch ms): "2 minutes ago" is as of the load.
  const { data, error, reload } = useScreen(async (ctx) => ({ vm: await getHealthHub(ctx), now: ctx.now * 1000 }), []);
  if (!data) return error ? <ErrorView retry={reload} /> : <HealthLoading />;
  const { vm, now } = data;
  return (
    <PageShell title="Health">
      {/* The reference app's order (health-01, 02, 04): Stress Monitor, the age block, then Health Monitor; Pulse's
          Fitness and Heart rate follow. */}
      <View className="gap-3">
        <SectionShell variant="card" title="Stress Monitor" info={false} href="/health/stress">
          <Stress m={vm.stress} />
        </SectionShell>
        <AgeBlock m={vm.healthspan} />
        <SectionShell variant="card" title="Health Monitor" info={false} href="/health/monitor">
          <Monitor m={vm.monitor} />
        </SectionShell>
        <SectionShell variant="card" title="Fitness" href="/health/fitness">
          <Fitness m={vm.fitness} />
        </SectionShell>
        <SectionShell variant="card" title="Heart rate" href="/health/heart-rate">
          <HeartRate hr={vm.heartRate} now={now} />
        </SectionShell>
      </View>
      <Text className={cn(CAPTION, "text-center")}>{FOOTNOTE}</Text>
    </PageShell>
  );
}

/** Health hub loading (spec §7.6, §5.19, R42): Stress Monitor, the orb and the Pace of Aging card, then the linked cards, each body laid out as the real one with its static labels; then the footnote. */
function HealthLoading() {
  return (
    <PageShell loading title="Health">
      <View className="gap-3">
        <SectionShell variant="card" title="Stress Monitor" info={false} href="/health/stress">
          <View accessibilityElementsHidden className="flex-row items-end gap-4">
            <View className="gap-2">
              <Text className={LABEL}>Today’s high stress</Text>
              <SkeletonText lh={40} fs={36} className="w-[75px]" />
              <Chip />
            </View>
            <View className="min-w-0 flex-1">
              <StressChartSkeleton variant="spark" />
            </View>
          </View>
        </SectionShell>
        <View accessibilityElementsHidden className="gap-6">
          <View className="items-center py-2">
            <View className="size-[260px] items-center justify-center rounded-full border-2 border-dial-track">
              <SkeletonText lh={40} fs={40} className="w-[83px]" />
            </View>
          </View>
          <SectionShell variant="card" title="Pace of Aging" action={<Chip />}>
            <View className="gap-5">
              <TickScaleSkeleton variant="marker" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </View>
          </SectionShell>
        </View>
        <SectionShell variant="card" title="Health Monitor" info={false} href="/health/monitor">
          <View accessibilityElementsHidden className="gap-4">
            <View className="flex-row">
              {Array.from({ length: 5 }, (_, i) => (
                <View key={i} className={cn("flex-1 items-center gap-2 px-1", i > 0 && "border-l border-border")}>
                  <Skeleton className="size-6 rounded-md" />
                  <SkeletonText lh={16} fs={12} className="w-[25px]" />
                  <Skeleton className="size-5 rounded-sm" />
                </View>
              ))}
            </View>
            <View className="flex-row items-center gap-3 rounded-lg bg-inset px-3 py-2.5">
              <Skeleton className="size-5 shrink-0 rounded-sm" />
              <SkeletonText lh={22} fs={15} className="w-32" />
            </View>
          </View>
        </SectionShell>
        <SectionShell variant="card" title="Fitness" href="/health/fitness">
          <View accessibilityElementsHidden className="flex-row items-start justify-between gap-4">
            <View className="gap-1">
              <SkeletonText lh={40} fs={36} className="w-[75px]" />
              <SkeletonText lh={16} fs={12} className="w-20" />
              <SkeletonText lh={16} fs={12} className="w-40" />
            </View>
            <View className="items-end gap-1">
              <Text className={LABEL}>Training load</Text>
              <SkeletonText lh={24} fs={20} className="w-[42px]" />
              <Chip />
            </View>
          </View>
        </SectionShell>
        <SectionShell variant="card" title="Heart rate" href="/health/heart-rate">
          <View accessibilityElementsHidden className="gap-1">
            <SkeletonText lh={40} fs={36} className="w-[75px]" />
            <SkeletonText lh={16} fs={12} className="w-28" />
          </View>
        </SectionShell>
      </View>
      <Text className={cn(CAPTION, "text-center")}>{FOOTNOTE}</Text>
    </PageShell>
  );
}
