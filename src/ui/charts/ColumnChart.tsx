import { useState } from "react";
import { Group, RoundedRect } from "@shopify/react-native-skia";
import { DATA_COLORS } from "@/lib/bands";
import { formatValue, type FormatKey } from "@/lib/format";
import { alpha } from "../color";
import { Skeleton } from "../Skeleton";
import { useTheme } from "../theme";
import { evenTicks, bandCenters, linearScale, nearestIndex } from "./geometry";
import { ChartFigure, ChartLabel, DashedLine, GridLines, labelGutter, Pill, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine } from "./ChartFrame";

export type Column = {
  /** Axis label ("06:00", "Mon", "Sep 21"). */
  label: string;
  /** Tooltip heading; defaults to `label`. */
  title?: string;
  value: number | null;
  /** The column the card is about (the selected hour, the best weekday, this week): full colour; the rest muted. */
  highlight?: boolean;
};

export type ColumnChartProps = {
  /** The figure's spoken summary. */
  summary: string;
  data: Column[];
  format: FormatKey;
  unit?: string;
  /** Show every `tickEvery`-th label (hours: 6). */
  tickEvery?: number;
  /** A dashed target line ("150 min"). */
  reference?: { y: number; label: string };
};

const HEIGHT = 176; // h-44
const AXIS_H = 30; // Recharts' default x-axis band: the ticks' room under the plot
const MAX_BAR = 28;

/**
 * Category columns: steps by hour, the weekday pattern, weekly totals against a target (metric detail, spec §11 MD1).
 * Columns with `highlight` take the data colour; when none is highlighted every column does. Tap or drag to read one.
 */
export function ColumnChart({ summary, data, format, unit, tickEvery = 1, reference }: ColumnChartProps) {
  const { css, c } = useTheme();
  const [x, setX] = useState<number | null>(null);
  const ON = css(DATA_COLORS["chart-5"].css);
  const any = data.some((d) => d.highlight);
  const unitText = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  const margin = { top: 8, right: labelGutter([reference?.label], 12), bottom: 0, left: 12 };
  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const [x0, x1] = [margin.left, width - margin.right];
        const [y0, y1] = [margin.top, height - margin.bottom - AXIS_H];
        const max = Math.max(...data.map((d) => d.value ?? 0), reference?.y ?? 0);
        const top = evenTicks(0, max || 1, 5).at(-1)!;
        const y = linearScale([0, top], [y1, y0]);
        const { step, centers } = bandCenters(data.length, x0, x1, 0.1);
        const bw = Math.min(MAX_BAR, step * 0.9);
        const active = x === null ? -1 : nearestIndex(centers, x);
        const a = data[active];
        return (
          <>
            <PlotCanvas width={width} height={height}>
              <GridLines ys={evenTicks(0, top, 5).map(y)} x0={x0} x1={x1} />
              {/* the cursor: a faint column behind the one being read */}
              {active >= 0 && <RoundedRect x={centers[active] - step / 2} y={y0} width={step} height={y1 - y0} r={0} color={alpha(c.foreground, 0.05)} />}
              {reference && <DashedLine x1={x0} x2={x1} y1={y(reference.y)} y2={y(reference.y)} color={c["chart-cursor"]} />}
              {data.map((d, i) => {
                const fill = !any || d.highlight ? ON : c["dial-track"];
                const bx = centers[i] - bw / 2;
                return (
                  <Group key={i}>
                    {/* A dim full-height track behind each column, so the scale reads without a y-axis. */}
                    <RoundedRect x={bx} y={y0} width={bw} height={y1 - y0} r={4} color={alpha(c.foreground, 0.04)} />
                    {d.value !== null && d.value > 0 && <RoundedRect x={bx} y={y(d.value)} width={bw} height={y1 - y(d.value)} r={4} color={fill} />}
                  </Group>
                );
              })}
            </PlotCanvas>
            {data.map((d, i) => (i % tickEvery === 0 ? <ChartLabel key={i} x={centers[i]} y={y1 + 8 + 8} anchor="middle" w={Math.max(36, step * tickEvery)}>{d.label}</ChartLabel> : null))}
            {reference && <Pill x={x1 + 4} y={y(reference.y)} text={reference.label} />}
            <ScrubLayer width={width} height={height} onScrub={setX} />
            <ScrubTick index={active} />
            {a && (
              <TooltipCard x={centers[active]} width={width} title={a.title ?? a.label}>
                <TooltipLine color={!any || a.highlight ? ON : c["dial-track"]}>{a.value === null ? "No data" : `${formatValue(format, a.value)}${unitText}`}</TooltipLine>
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

export function ColumnChartSkeleton() {
  return <Skeleton className="h-44 rounded-lg bg-muted/60" />;
}
ColumnChart.Skeleton = ColumnChartSkeleton;
