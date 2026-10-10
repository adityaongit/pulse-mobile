// Fitness (CTL), fatigue (ATL) and form (TSB) over 90 days (spec §7.10). Ported from pulse
// src/app/(app)/health/fitness/LoadChart.tsx: Recharts' ComposedChart as Skia marks on the kit's chart frame.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { Path } from "@shopify/react-native-skia";
import { DAY, formatDay, formatValue } from "@/lib/format";
import type { FitnessVM } from "@/queries/types";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, PlotCanvas, ScrubLayer, TooltipCard, TooltipLine } from "@/ui/charts/ChartFrame";
import { areaPath, bandCenters, evenTicks, linePath, linearScale, nearestIndex } from "@/ui/charts/geometry";
import { FadeFill, StrokePath } from "@/ui/charts/paint";
import { alpha } from "@/ui/color";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const LABELS = { ctl: "Fitness", atl: "Fatigue", tsb: "Form" } as const;
const HEIGHT = 220;
const AXIS_H = 30;
const MAX_BAR = 4;

const finite = (v: number | null): v is number => v !== null;

export function LoadChart({ load }: { load: FitnessVM["load"] }) {
  const { c } = useTheme();
  const [x, setX] = useState<number | null>(null);
  const last = [...load].reverse().find((p) => p.ctl !== null);
  const summary = last
    ? `Training load over 90 days: fitness ${formatValue("int", last.ctl)}, fatigue ${formatValue("int", last.atl)}, form ${formatValue("signedInt", last.tsb)} today.`
    : "No training load data yet.";
  // The y axis: zero is always in, then the data, then round ticks (Recharts' auto domain with tickCount 4).
  const ticks = useMemo(() => {
    const all = load.flatMap((p) => [p.ctl, p.atl, p.tsb]).filter(finite);
    return evenTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  }, [load]);
  const months = useMemo(() => load.flatMap((p, i) => (i > 0 && p.day.slice(0, 7) !== load[i - 1].day.slice(0, 7) ? [i] : [])), [load]);

  return (
    <View>
      <ChartFigure summary={summary} height={HEIGHT}>
        {({ width, height }) => {
          const x0 = 4 + 32;
          const x1 = width - 4;
          const y0 = 8;
          const y1 = height - AXIS_H;
          const y = linearScale([ticks[0], ticks.at(-1)!], [y1, y0]);
          const band = bandCenters(load.length, x0, x1, 0);
          const xs = band.centers;
          const bw = Math.min(MAX_BAR, band.step * 0.9);
          const line = (key: "ctl" | "atl") => load.map((p, i) => ({ x: xs[i], y: p[key] === null ? null : y(p[key]) }));
          const ctl = line("ctl");
          const rects = (neg: boolean) =>
            load
              .flatMap((p, i) => (p.tsb !== null && (p.tsb < 0) === neg ? [`M${xs[i] - bw / 2},${y(0)}H${xs[i] + bw / 2}V${y(p.tsb)}H${xs[i] - bw / 2}Z`] : []))
              .join("");
          const top = Math.max(...load.flatMap((p) => (p.ctl === null ? [] : [p.ctl])), 0);
          const ai = x !== null ? nearestIndex(xs, x) : -1;
          const a = ai >= 0 ? load[ai] : null;
          return (
            <>
              <PlotCanvas width={width} height={height}>
                <GridLines ys={ticks.map(y)} x0={x0} x1={x1} />
                <Path path={`M${x0},${y(0)}H${x1}`} style="stroke" strokeWidth={1} color={c["chart-cursor"]} />
                {a && <DashedLine x1={xs[ai]} x2={xs[ai]} y1={y0} y2={y1} color={c["chart-cursor"]} />}
                <Path path={rects(true)} color={alpha(c.warning, 0.6)} />
                <Path path={rects(false)} color={alpha(c["chart-2"], 0.6)} />
                <FadeFill path={areaPath(ctl, y(0), "monotone")} color={c["chart-1"]} y0={y(top)} y1={y(0)} from={0.22} to={0} />
                <StrokePath path={linePath(ctl, "monotone")} width={2} paint={{ color: c["chart-1"] }} />
                <StrokePath path={linePath(line("atl"), "monotone")} width={1.5} paint={{ color: c["chart-4"] }} />
                {a && a.ctl !== null && <GlowDot x={xs[ai]} y={y(a.ctl)} fill={c["chart-1"]} />}
                {a && a.atl !== null && <GlowDot x={xs[ai]} y={y(a.atl)} fill={c["chart-4"]} />}
              </PlotCanvas>
              {ticks.map((t) => (
                <ChartLabel key={t} x={x0 - 4} y={y(t)} anchor="end" w={32}>
                  {formatValue("int", t)}
                </ChartLabel>
              ))}
              {months.map((i) => (
                <ChartLabel key={load[i].day} x={xs[i]} y={y1 + 16} anchor="middle" w={48}>
                  {formatDay(load[i].day, { month: "short" })}
                </ChartLabel>
              ))}
              <ScrubLayer width={width} height={height} onScrub={setX} />
              {a && (
                <TooltipCard x={xs[ai]} width={width} title={formatDay(a.day, DAY.short)}>
                  {/* In the plot's order: the bars, then the two lines. */}
                  {a.tsb !== null && (
                    <TooltipLine color={a.tsb < 0 ? c.warning : c["chart-2"]}>
                      <Text className="font-numeric text-xs font-medium leading-4 text-muted-foreground">{LABELS.tsb}</Text> {formatValue("signedInt", a.tsb)}
                    </TooltipLine>
                  )}
                  {a.ctl !== null && (
                    <TooltipLine color={c["chart-1"]}>
                      <Text className="font-numeric text-xs font-medium leading-4 text-muted-foreground">{LABELS.ctl}</Text> {formatValue("int", a.ctl)}
                    </TooltipLine>
                  )}
                  {a.atl !== null && (
                    <TooltipLine color={c["chart-4"]}>
                      <Text className="font-numeric text-xs font-medium leading-4 text-muted-foreground">{LABELS.atl}</Text> {formatValue("int", a.atl)}
                    </TooltipLine>
                  )}
                </TooltipCard>
              )}
            </>
          );
        }}
      </ChartFigure>
      {/* Each series' mark as drawn (two lines, then the bars) with today's value, in the plot's order. */}
      {last && (
        <View accessibilityElementsHidden className="mt-3 flex-row flex-wrap justify-center gap-x-5 gap-y-1">
          {(
            [
              ["ctl", <View key="m" className="h-0.5 w-3.5 rounded-full bg-chart-1" />, formatValue("int", last.ctl)],
              ["atl", <View key="m" className="h-0.5 w-3.5 rounded-full bg-chart-4" />, formatValue("int", last.atl)],
              ["tsb", <View key="m" className="h-2.5 w-1 rounded-[1px] bg-chart-2" />, formatValue("signedInt", last.tsb)],
            ] as const
          ).map(([k, mark, v]) => (
            <View key={k} className="flex-row items-center gap-1.5">
              {mark}
              <Text className="text-xs font-medium leading-4 text-muted-foreground">
                {LABELS[k]} <Text className="font-numeric font-semibold tabular-nums text-foreground-secondary">{v}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
