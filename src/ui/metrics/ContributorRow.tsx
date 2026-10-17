import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Triangle } from "lucide-react-native";
import { deltaTone, type GoodDirection, type Tone } from "@/lib/bands";
import { formatValue, isSymbolUnit, MISSING, spoken, type FormatKey } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { cn } from "../cn";
import { mix } from "../color";
import { MetricState, type MetricMeta } from "../shells/MetricState";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { CAPTION, LABEL, ValueUnit } from "./primitives";
import { push } from "../navigate";
import { Press } from "../Press";
import { BAR_CORNERS } from "@/ui/radius";

type Common = {
  icon?: ReactNode;
  label: string;
  metric: Metric<number> | null | undefined;
  unit?: string;
  format: FormatKey;
  reasonCopy?: string;
  className?: string;
};

export type ContributorRowProps =
  | (Common & {
      variant: "recovery";
      href?: string;
      /** The personal normal: mean ± 1 σ is shaded, the track spans mean ± 3 σ. */
      baseline: { mean: number; sd: number };
      points: number | null;
      direction: GoodDirection;
    })
  | (Common & {
      variant: "healthspan";
      /** `metric` is the 6-month mean; this is the 30-day mean, null when unknown. */
      recent: number | null;
      domain: [number, number];
      /** Years this input adds (positive, older) or removes (negative, younger). */
      years: number | null;
      higherIsBetter: boolean;
      /** Opens the factor's sheet. */
      onSelect?: () => void;
    });

const pct = (v: number, lo: number, hi: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%` as const;
const MARKER: Record<Tone, string> = { good: "bg-optimal", bad: "bg-warning", neutral: "bg-foreground" };

function Header({ p, value, right }: { p: Common; value: number | null; right?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-3">
      {!!p.icon && <View className="size-5 shrink-0 items-center justify-center">{p.icon}</View>}
      {/* Long labels must wrap because tracked capitals can exceed narrow phone widths. */}
      <Text className={cn(LABEL, "min-w-0 flex-1")}>{p.label}</Text>
      <View className="shrink-0 flex-row items-center gap-2">
        <ValueUnit value={formatValue(p.format, value)} unit={p.unit} className={cn("font-numeric text-xl font-bold leading-6", value === null && "text-muted-foreground")} />
        {right}
      </View>
    </View>
  );
}

function RecoveryRow({ p, value, meta }: { p: Extract<ContributorRowProps, { variant: "recovery" }>; value: number | null; meta?: MetricMeta }) {
  const { mean, sd } = p.baseline;
  const lo = mean - 3 * sd;
  const hi = mean + 3 * sd;
  const tone = value === null ? "neutral" : deltaTone(p.direction, value, mean, sd).tone;
  const pts = value === null ? null : p.points;
  const unitSpoken = (v: number) => spoken(formatValue(p.format, v), p.unit);
  const sentence =
    value === null
      ? `${p.label}: ${p.reasonCopy ?? "Not measured: left out of today’s score"}`
      : `${p.label} ${unitSpoken(value)}, ${value > mean + sd ? "above" : value < mean - sd ? "below" : "within"} your normal range of ${formatValue(p.format, mean - sd)} to ${formatValue(p.format, mean + sd)}${pts === null ? "" : pts === 0 ? ", no change" : `, ${pts > 0 ? "added" : "took off"} ${Math.abs(Math.round(pts))} points`}`;
  const body = (
    <View accessible accessibilityLabel={sentence} className="gap-2">
      <Header
        p={p}
        value={value}
        right={
          pts !== null && (
            <Text className={cn("font-numeric text-base font-bold tabular-nums", pts > 0 ? "text-optimal-text" : pts < 0 ? "text-warning-text" : "text-muted-foreground")}>
              {formatValue("signedInt", pts)}
              <Text className="text-[13px] font-semibold leading-4 text-foreground-secondary">{" pts"}</Text>
            </Text>
          )
        }
      />
      <View className={cn("h-1.5 bg-dial-track", BAR_CORNERS)}>
        <View className={cn("absolute inset-y-0 bg-foreground/20", BAR_CORNERS)} style={{ left: pct(mean - sd, lo, hi), width: `${(100 * 2) / 6}%` }} />
        {value !== null && <View className={cn("absolute size-3.5 rounded-full border-2 border-card", MARKER[tone])} style={{ left: pct(value, lo, hi), top: -4, marginLeft: -7 }} />}
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className={CAPTION}>
          {value === null
            ? (p.reasonCopy ?? "Not measured: left out of today’s score")
            : `Baseline ${formatValue(p.format, mean)} ± ${formatValue(p.format, sd).replace(/^\+/, "")}${p.unit ? (isSymbolUnit(p.unit) ? p.unit : ` ${p.unit}`) : ""}`}
        </Text>
      </View>
    </View>
  );
  if (p.href)
    return (
      <Press activeBg="bg-accent" accessibilityRole="link" accessibilityLabel={sentence} onPress={() => p.href && push(p.href)} className={cn("rounded-lg py-3", p.className)}>
        {body}
      </Press>
    );
  return <View className={cn("py-3", p.className)}>{body}</View>;
}

/** health-03's bar: ten segments from poor (orange) to good (green); the one holding the 6-month mean is lit. */
const SEGMENTS = 10;

/** A marker's label centred on its triangle, kept inside the bar's ends. `track` is the bar's width in px. */
function MarkerLabel({ at, track, children, edge }: { at: number; track: number; children: ReactNode; edge: "top" | "bottom" }) {
  const t = Math.min(1, Math.max(0, at));
  return (
    <View className={cn("absolute items-center", edge === "top" ? "top-0" : "bottom-0")} style={{ left: Math.min(Math.max(t * track - 50, 0), Math.max(0, track - 100)), width: 100 }}>
      {children}
    </View>
  );
}

/**
 * A Healthspan factor (health-03): the label, then a ten-segment bar from poor to good with its end values, the
 * 6-month mean marked above (white) and the 30-day mean below (grey), and the years it adds or takes off at the right.
 */
function HealthspanRow({ p, value, meta }: { p: Extract<ContributorRowProps, { variant: "healthspan" }>; value: number | null; meta?: MetricMeta }) {
  const { c } = useTheme();
  const [track, setTrack] = useState(0);
  const [lo, hi] = p.domain;
  const at = (v: number) => (v - lo) / (hi - lo);
  // Under 0.05 years rounds to "0.0": no change, neither younger nor older.
  const years = value === null || p.years === null ? null : Math.abs(p.years) < 0.05 ? 0 : p.years;
  const [loText, hiText] = [formatValue(p.format, lo), formatValue(p.format, hi)];
  const withUnit = (v: number) => `${formatValue(p.format, v)}${p.unit && isSymbolUnit(p.unit) ? p.unit : ""}`;
  const lit = value === null ? -1 : Math.min(SEGMENTS - 1, Math.max(0, Math.floor(at(value) * SEGMENTS)));
  const recent = value === null ? null : p.recent;
  const sentence =
    value === null
      ? `${p.label}: ${p.reasonCopy ?? "No data"}`
      : `${p.label}: 6-month average ${spoken(formatValue(p.format, value), p.unit)}${recent === null ? "" : `, 30-day average ${spoken(formatValue(p.format, recent), p.unit)}`}${years === null ? "" : years === 0 ? ", no change in years" : `, ${formatValue("decimal1", Math.abs(years))} years ${years < 0 ? "younger" : "older"}`}`;
  const body = (
    <View accessible accessibilityLabel={sentence} className="gap-1">
      <View className="flex-row items-center gap-3">
        {!!p.icon && <View className="size-5 shrink-0 items-center justify-center">{p.icon}</View>}
        <Text className={cn(LABEL, "min-w-0 flex-1")}>{p.label}</Text>
      </View>
      <View className="flex-row items-center gap-4">
        <View className="min-w-0 flex-1 pb-10 pt-11" onLayout={(e) => setTrack(e.nativeEvent.layout.width)}>
          {value !== null && (
            <MarkerLabel at={at(value)} track={track} edge="top">
              <Text className="text-xs font-medium leading-4 text-foreground-secondary">6 Month avg.</Text>
              <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{withUnit(value)}</Text>
              <Triangle size={10} color={c.foreground} fill={c.foreground} strokeWidth={0} style={{ transform: [{ rotate: "180deg" }] }} />
            </MarkerLabel>
          )}
          <View className="h-6 flex-row gap-0.5 overflow-hidden rounded-sm">
            {Array.from({ length: SEGMENTS }, (_, i) => {
              const good = p.higherIsBetter ? i / (SEGMENTS - 1) : 1 - i / (SEGMENTS - 1);
              return <View key={i} className={cn("flex-1", i === lit && "bg-foreground/45")} style={i === lit ? undefined : { backgroundColor: mix(c.optimal, c.warning, good), opacity: 0.35 }} />;
            })}
            <Text className={cn("absolute left-1.5 top-1.5 font-numeric text-[11px] font-bold leading-3 tabular-nums", lit === 0 ? "text-foreground" : p.higherIsBetter ? "text-warning-text" : "text-optimal-text")}>{loText}</Text>
            <Text className={cn("absolute right-1.5 top-1.5 font-numeric text-[11px] font-bold leading-3 tabular-nums", lit === SEGMENTS - 1 ? "text-foreground" : p.higherIsBetter ? "text-optimal-text" : "text-warning-text")}>{hiText}</Text>
          </View>
          {recent !== null && (
            <MarkerLabel at={at(recent)} track={track} edge="bottom">
              <Triangle size={10} color={c["muted-foreground"]} fill={c["muted-foreground"]} strokeWidth={0} />
              <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{withUnit(recent)}</Text>
              <Text className="text-xs font-medium leading-4 text-foreground-secondary">30 Day avg.</Text>
            </MarkerLabel>
          )}
        </View>
        <View className="w-12 shrink-0 items-end">
          <Text className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", years === null ? "text-muted-foreground" : years < 0 ? "text-optimal-text" : years > 0 ? "text-warning-text" : "text-foreground-secondary")}>
            {years === null ? MISSING : formatValue("decimal1", years)}
          </Text>
          <Text className="text-[13px] font-semibold leading-4 text-foreground-secondary">years</Text>
        </View>
      </View>
      {/* Reason copy can be a sentence; it gets its own line. */}
      {value === null && <Text className="text-xs font-medium leading-4 text-muted-foreground">{p.reasonCopy ?? "No data"}</Text>}
    </View>
  );
  if (p.onSelect)
    return (
      <Press activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={sentence} onPress={p.onSelect} className={cn("py-3", p.className)}>
        {body}
      </Press>
    );
  return <View className={cn("py-3", p.className)}>{body}</View>;
}

export function ContributorRow(p: ContributorRowProps) {
  const render = (value: number | null, meta?: MetricMeta) => (p.variant === "recovery" ? <RecoveryRow p={p} value={value} meta={meta} /> : <HealthspanRow p={p} value={value} meta={meta} />);
  return (
    <MetricState metric={p.metric} skeleton={<ContributorRowSkeleton variant={p.variant} />} empty={render(null)} renderReason={(_, meta) => render(null, meta)}>
      {(v, meta) => render(v, meta)}
    </MetricState>
  );
}

export function ContributorRowSkeleton({ variant = "recovery" }: { variant?: ContributorRowProps["variant"] }) {
  if (variant === "healthspan")
    return (
      <View accessibilityElementsHidden className="gap-1 py-3">
        <SkeletonText className="w-36" />
        <View className="flex-row items-center gap-4">
          <View className="flex-1 pb-10 pt-11">
            <View className="h-6 rounded-sm bg-dial-track" />
          </View>
          <View className="w-12">
            <SkeletonText lh={24} fs={20} />
          </View>
        </View>
      </View>
    );
  return (
    <View accessibilityElementsHidden className="gap-2 py-3">
      <View className="flex-row items-center gap-3">
        <SkeletonText className="w-36 flex-1" />
        <View className="w-14">
          <SkeletonText lh={24} fs={20} />
        </View>
      </View>
      <View className={cn("h-1.5 bg-dial-track", BAR_CORNERS)} />
      <SkeletonText className="w-28" />
    </View>
  );
}
ContributorRow.Skeleton = ContributorRowSkeleton;
