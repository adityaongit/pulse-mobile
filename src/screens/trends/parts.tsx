// Shared by the Trends, Metric detail and Reports screens (web: trends/parts.tsx and the loading shapes).
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { RANGES, type TrendRange } from "@/lib/url";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { TrendChart, type TrendChartProps } from "@/ui/charts/TrendChart";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";

export const PERIOD: Record<TrendRange, { label: string; prior: string }> = {
  w: { label: "Last 7 days", prior: "the 7 days before" },
  m: { label: "Last 30 days", prior: "the 30 days before" },
  "6m": { label: "Last 6 months", prior: "the 6 months before" },
  "1y": { label: "Last 12 months", prior: "the year before" },
};

const RANGE_LABEL: Record<TrendRange, string> = { w: "W", m: "M", "6m": "6M", "1y": "1Y" };
const RANGE_ARIA: Record<TrendRange, string> = { w: "1 week", m: "1 month", "6m": "6 months", "1y": "1 year" };

/** Sets the route's `?r=` (the web's toggle writes it too, so the range survives a metric change). */
export const setRange = (r: TrendRange) => router.setParams({ r });

/**
 * TrendChart with all four ranges and the range in the route's `r` param, not in the chart: the Averages card and the
 * metric picker read the same range. The kit's chart keeps its own toggle state and has no callback, so this pins its
 * range (`fixedRange`, which hides its toggle) and draws the same full-width toggle above it, in the same place.
 */
export function RangedTrendChart({ range, ...p }: Omit<TrendChartProps, "ranges" | "fixedRange" | "defaultRange"> & { range: TrendRange }) {
  const shown = !!p.data?.value?.length;
  return (
    <View className="min-w-0">
      {shown && (
        <View className="mb-3">
          <Segmented label="Range" fill value={range} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r], accessibilityLabel: RANGE_ARIA[r] }))} onChange={setRange} />
        </View>
      )}
      {/* The key resets the scrub cursor with the range. */}
      <TrendChart key={range} {...p} ranges={RANGES} fixedRange={range} />
    </View>
  );
}

/** A whole-card button: the card material, pressing in (the web's CARD_LINK on a button). */
export function CardButton({ onPress, className, accessibilityLabel, children }: { onPress: () => void; className?: string; accessibilityLabel?: string; children: ReactNode }) {
  const shadow = useCardStyle();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} className={cn(CARD_CLASS, "active:scale-[0.96]", className)} style={shadow}>
      <CardFill />
      {children}
    </Pressable>
  );
}

/** The web's error view for every route: the shell stays, the screen offers a retry (spec §7). */
export function LoadError({ title, reload }: { title: string; reload: () => void }) {
  return <DetailShell title={title} primary={<View accessibilityRole="alert" className="pt-16"><EmptyState icon={CircleAlert} body="Couldn’t load this screen." action={{ label: "Try again", onClick: reload }} /></View>} />;
}

/** The web's `divide-y divide-border`: a hairline between neighbouring children (the kit's copy lives in its demo screen). */
export function Divided({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <View className="h-px bg-border" />}
          {child}
        </Fragment>
      ))}
    </>
  );
}
