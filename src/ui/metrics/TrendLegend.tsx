import { i18n } from "@/i18n/config";
import type { ReactNode } from "react";
import { View } from "react-native";
import { partColor } from "@/lib/bands";
import { cn } from "../cn";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { LABEL } from "./primitives";

/**
 * The legend over a Trend View chart, top right as the reference app sets it: the typical-range swatch on vitals,
 * square swatches for a stack (top part first), rings for a pair of lines.
 */
export function TrendLegend({ chart, series, typical, className }: { chart: string; series?: readonly { key: string; label: string }[]; typical?: boolean; className?: string }) {
  const { css } = useTheme();
  const items: { key: string; label: string; swatch: ReactNode }[] = typical
    ? [{ key: "typical", label: i18n.t("ui:sleepStages.typicalRange"), swatch: <View className="size-2.5 rounded-xs border border-foreground/15 bg-chart-band" /> }]
    : series && chart === "stack"
      ? [...series].reverse().map((s) => ({ key: s.key, label: s.label, swatch: <View className="size-2.5 rounded-xs" style={{ backgroundColor: css(partColor(s.key)) }} /> }))
      : series && chart === "pair"
        ? series.map((s) => ({ key: s.key, label: s.label, swatch: <View className="size-2.5 rounded-full border-2" style={{ borderColor: css(partColor(s.key)) }} /> }))
        : [];
  if (!items.length) return null;
  return (
    <View className={cn("mb-2 flex-row flex-wrap items-center justify-end gap-x-4 gap-y-1", className)}>
      {items.map((i) => (
        <View key={i.key} className="flex-row items-center gap-1.5">
          {i.swatch}
          <Text className={cn(LABEL, "text-[11px] text-foreground-secondary")}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}
