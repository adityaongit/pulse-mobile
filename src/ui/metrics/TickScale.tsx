import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { DATA_COLORS, recoveryColor } from "@/lib/bands";
import { formatValue, spoken, type FormatKey } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { cn } from "../cn";
import { MetricState } from "../shells/MetricState";
import { Skeleton } from "../Skeleton";
import { Text } from "../Text";
import { ValueUnit } from "./primitives";

export type TickScaleProps = {
  /** `marker`: the reference app's ruler (Pace of Aging, ACWR). `meter`: another app's segmented meter (Energy). */
  variant: "marker" | "meter";
  /** Spoken name for the meter: "Pace of Aging", "Energy". */
  label: string;
  metric: Metric<number> | null | undefined;
  min: number;
  max: number;
  format: FormatKey;
  unit?: string;
  /** Appended to the spoken value: "aging slower than your 6-month average". */
  describe?: string;
  /** Marker variant: tint ticks inside a range (ACWR 0.8-1.3 optimal, above 1.5 warning). */
  bands?: { from: number; to: number; tone: "optimal" | "warning" }[];
  /** End labels under the ticks, spread edge to edge ("−1.0x", "1.0x", "3.0x"). */
  ends?: string[];
  /** Marker variant: "Slow" / "Fast" with Turtle / Rabbit (a node: icon and <Text>). */
  leading?: ReactNode;
  trailing?: ReactNode;
};

const COUNT = 48;
const BAND_TICK = { optimal: "bg-optimal/60", warning: "bg-warning/60" };

/** A tick ruler or meter (spec §5.15, D5). */
export function TickScale(p: TickScaleProps) {
  return (
    <MetricState metric={p.metric} skeleton={<TickScaleSkeleton variant={p.variant} />} empty={<Scale p={p} value={null} />} renderReason={() => <Scale p={p} value={null} />}>
      {(v, meta) => <Scale p={p} value={v} provisional={meta.provisional} />}
    </MetricState>
  );
}

function Scale({ p, value, provisional }: { p: TickScaleProps; value: number | null; provisional?: boolean }) {
  const { t } = useTranslation("ui");
  const [rowW, setRowW] = useState(0);
  const span = p.max - p.min;
  const at = (i: number) => p.min + (i / (COUNT - 1)) * span;
  const frac = value === null ? null : Math.min(1, Math.max(0, (value - p.min) / span));
  const near = frac === null ? -9 : Math.round(frac * (COUNT - 1));
  const text = formatValue(p.format, value);
  const fill = value === null ? null : DATA_COLORS[recoveryColor(value)].bg;
  const valueText = value === null ? t("tickScale.noData", { label: p.label }) : t(p.describe ? "tickScale.valueDescribed" : "tickScale.value", { label: p.label, value: spoken(text, p.unit), describe: p.describe });

  const tickClass = (i: number) => {
    if (p.variant === "meter") return cn("h-5 w-0.5 rounded-full", fill && i <= near ? fill : "bg-dial-track");
    if (Math.abs(i - near) <= 1) return "h-8 w-[3px] rounded-full bg-foreground";
    const band = p.bands?.find((b) => at(i) >= b.from && at(i) <= b.to);
    return cn("h-5 w-0.5 rounded-full", band ? BAND_TICK[band.tone] : "bg-dial-track");
  };

  const label = (
    <View className="flex-row items-center gap-2">
      <ValueUnit
        value={text}
        unit={p.unit}
        className={cn("font-numeric font-bold text-foreground", p.variant === "meter" ? "text-2xl leading-8" : "text-[22px] leading-7", value === null && "text-muted-foreground")}
        unitClassName={p.unit === "%" || p.unit === "x" ? cn("font-bold text-foreground", p.variant === "meter" ? "text-[17px] leading-5" : "text-[15px] leading-5") : undefined}
      />
    </View>
  );

  const ticks = (
    // flex-1 only beside the meter's label (a row). In the marker's column it would make the 32 px box's height
    // flex-basis 0, which collapses to 0 in a layout pass before the page settles: the ticks then drew over the row above.
    <View accessibilityElementsHidden className={cn("h-8 min-w-0 flex-row items-end justify-between", p.variant === "meter" ? "flex-1" : "w-full")}>
      {Array.from({ length: COUNT }, (_, i) => (
        <View key={i} className={tickClass(i)} />
      ))}
    </View>
  );

  return (
    <View accessible accessibilityRole="adjustable" accessibilityLabel={valueText} accessibilityValue={value === null ? undefined : { min: p.min, max: p.max, now: value, text: valueText }} className="min-w-0">
      {p.variant === "meter" ? (
        <View className="flex-row items-end gap-3">
          <View className="shrink-0">{label}</View>
          {ticks}
        </View>
      ) : (
        <>
          <View className="relative mb-1 h-7 flex-row items-center justify-between" onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
            <View className="flex-row items-center gap-1.5">{p.leading}</View>
            <View className="flex-row items-center gap-1.5">{p.trailing}</View>
            {/* The value rides above the marker: centred at its fraction of the row, kept 12-88 % across. */}
            <View accessibilityElementsHidden className="absolute items-center" style={{ left: Math.min(88, Math.max(12, (frac ?? 0.5) * 100)) * (rowW / 100) - 60, width: 120 }}>
              {label}
            </View>
          </View>
          {ticks}
        </>
      )}
      {p.ends && (
        <View accessibilityElementsHidden className="mt-1 flex-row justify-between">
          {p.ends.map((e) => (
            <Text key={e} className="font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground">
              {e}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** The scale's box: the meter's 32 px row, or the marker's 84 px (value row, ticks, end labels). */
export function TickScaleSkeleton({ variant = "meter" }: { variant?: TickScaleProps["variant"] }) {
  return <Skeleton className={variant === "marker" ? "h-[84px] w-full rounded-lg" : "h-8 w-full"} />;
}
TickScale.Skeleton = TickScaleSkeleton;
