import { useMemo, useState } from "react";
import { View } from "react-native";
import { Circle } from "@shopify/react-native-skia";
import { clock } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { paddedDomain } from "@/lib/charts";
import { ReasonPlaceholder } from "../metrics/ReasonPlaceholder";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { Skeleton } from "../Skeleton";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, Pill, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine } from "./ChartFrame";
import { areaPath, linePath, linearScale, nearestIndex } from "./geometry";
import { FadeFill, StrokePath } from "./paint";

export type SleepHr = {
  /** Epoch ms of the main sleep's start and end. */
  bed: number;
  wake: number;
  /** Per-minute heart rate, a little past both ends; null is a gap, never interpolated. */
  points: { t: number; v: number | null }[];
};

export type SleepHrChartProps = {
  data: Metric<SleepHr> | null | undefined;
  /** The chosen stage's intervals: its heart rate is drawn bright with a fill, the rest of the night dim. Omit to light the whole night. */
  highlight?: { start: number; end: number }[];
};

const HEIGHT = 180;
const AXIS_H = 30;
const MIN = 60_000;

function Chart({ hr, highlight }: { hr: SleepHr; highlight?: { start: number; end: number }[] }) {
  const { c } = useTheme();
  const tz = useOptionalShellCalendar()?.timeZone;
  const [x, setX] = useState<number | null>(null);
  const { bed, wake, points } = hr;
  // Three series on one axis: outside the sleep (faint), the night (dim), the chosen stage (bright, filled).
  // A minute joins a stage when it or the next minute overlaps one, so a 1-minute wake still draws a stroke.
  const rows = useMemo(
    () =>
      points.map(({ t, v }) => {
        const inside = t >= bed && t <= wake;
        const lit = inside && (!highlight || highlight.some((s) => t < s.end && t + 2 * MIN > s.start));
        return { t, v, out: inside ? null : v, night: inside ? v : null, lit: lit ? v : null };
      }),
    [points, bed, wake, highlight],
  );
  // Even 20 bpm steps, as in the reference app's 30-50-70-90-110.
  const [lo, hi] = paddedDomain(points.map((p) => p.v));
  const yTicks = Array.from({ length: Math.ceil(hi / 20) - Math.floor(lo / 20) + 1 }, (_, i) => (Math.floor(lo / 20) + i) * 20);
  const night = points.filter((p) => p.t >= bed && p.t < wake && p.v !== null).map((p) => p.v!);
  const avg = night.length ? Math.round(night.reduce((a, b) => a + b, 0) / night.length) : null;
  // The night's lowest minute, marked as a point with a pill: the number people look for on this chart.
  const low = points.reduce<{ t: number; v: number } | null>((m, p) => (p.t >= bed && p.t < wake && p.v !== null && (!m || p.v < m.v) ? { t: p.t, v: p.v } : m), null);
  const summary = `Heart rate during sleep from ${clock(bed, tz)} to ${clock(wake, tz)}: low ${Math.min(...night)}, average ${avg}, high ${Math.max(...night)} beats per minute.`;

  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const x0 = 32;
        const x1 = width - 8;
        const y0 = 8;
        const y1 = height - AXIS_H;
        const tx = linearScale([points[0].t, points.at(-1)!.t], [x0, x1]);
        const y = linearScale([yTicks[0], yTicks.at(-1)!], [y1, y0]);
        const mk = (key: "out" | "night" | "lit") => rows.map((r) => ({ x: tx(r.t), y: r[key] === null ? null : y(r[key]!) }));
        const valid = rows.filter((r) => r.v !== null);
        const ai = x === null ? -1 : nearestIndex(valid.map((r) => tx(r.t)), x);
        const a = ai >= 0 ? valid[ai] : null;
        const litTop = Math.min(...rows.flatMap((r) => (r.lit === null ? [] : [y(r.lit)])), y1);
        return (
          <>
            <PlotCanvas width={width} height={height}>
              <GridLines ys={yTicks.map(y)} x0={x0} x1={x1} />
              {/* the reference app's dashed bed and wake markers */}
              {[bed, wake].map((t) => (
                <DashedLine key={t} x1={tx(t)} x2={tx(t)} y1={y0} y2={y1} color={c["foreground-secondary"]} dash={[2, 3]} />
              ))}
              {low && (
                <>
                  <Circle cx={tx(low.t)} cy={y(low.v)} r={5.5} color={c.card} />
                  <Circle cx={tx(low.t)} cy={y(low.v)} r={3.5} color={c.foreground} />
                </>
              )}
              {a && <DashedLine x1={tx(a.t)} x2={tx(a.t)} y1={y0} y2={y1} color={c["chart-cursor"]} />}
              <StrokePath path={linePath(mk("out"), "monotone")} width={1} paint={{ color: c["muted-foreground"] }} opacity={0.45} />
              <StrokePath path={linePath(mk("night"), "monotone")} width={1.25} paint={{ color: c["muted-foreground"] }} />
              <FadeFill path={areaPath(mk("lit"), y1, "monotone")} color={c.foreground} y0={litTop} y1={y1} from={0.28} to={0} />
              <StrokePath path={linePath(mk("lit"), "monotone")} width={1.5} paint={{ color: c.foreground }} />
              {a && a.v !== null && <GlowDot x={tx(a.t)} y={y(a.v)} fill={c.foreground} />}
            </PlotCanvas>
            {yTicks.map((t) => (
              <ChartLabel key={t} x={x0 - 8} y={y(t)} anchor="end" w={x0 - 8}>{String(t)}</ChartLabel>
            ))}
            {[bed, wake].map((t) => (
              <ChartLabel key={t} x={tx(t)} y={y1 + 16} color={c["foreground-secondary"]}>{clock(t, tz)}</ChartLabel>
            ))}
            {low && <Pill x={tx(low.t)} y={y(low.v) + 14} anchor="middle" text={`Low ${low.v}`} />}
            <ScrubLayer width={width} height={height} onScrub={setX} />
            <ScrubTick index={ai} />
            {a && a.v !== null && (
              <TooltipCard x={tx(a.t)} width={width} title={clock(a.t, tz)}>
                <TooltipLine color={c.foreground}>{`${a.v} bpm`}</TooltipLine>
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

/** Heart rate across the main sleep with its bed and wake markers; the chosen stage lit (spec §7.5, §11 R9). */
export function SleepHrChart({ data, highlight }: SleepHrChartProps) {
  const empty = (
    <View className="items-center">
      <EmptyState body="No heart-rate data for this night." />
    </View>
  );
  return (
    <MetricState
      metric={data}
      skeleton={<SleepHrChartSkeleton />}
      empty={empty}
      renderReason={(r) => (
        <View className="items-center">
          <ReasonPlaceholder reason={r} size="md" />
        </View>
      )}
    >
      {(hr) => (hr.points.some((p) => p.v !== null) ? <Chart hr={hr} highlight={highlight} /> : empty)}
    </MetricState>
  );
}

export function SleepHrChartSkeleton() {
  return <Skeleton className="h-[180px] rounded-lg bg-muted/60" />;
}
SleepHrChart.Skeleton = SleepHrChartSkeleton;
