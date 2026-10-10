import { useState } from "react";
import { View } from "react-native";
import { Circle } from "@shopify/react-native-skia";
import { DATA_COLORS, STRESS_COLOR, STRESS_WORD, stressLevel } from "@/lib/bands";
import { clock, formatValue } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { bandColor, hourTicks, type Band } from "@/lib/charts";
import { ReasonPlaceholder } from "../metrics/ReasonPlaceholder";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { Skeleton } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine } from "./ChartFrame";
import { areaPath, linePath, linearScale, nearestIndex, thin } from "./geometry";
import { bandPaint, FadeFill, StrokePath } from "./paint";
import { SpanFills, SpanHeads, type ChartSpan } from "./spans";

export type StressSeries = {
  /** 0-3 per still minute; moving minutes are null (gaps). */
  points: { t: number; value: number | null }[];
  spans?: ChartSpan[];
  /** Today only: the dashed "now" line. */
  now?: number;
};

export type StressChartProps = {
  data: Metric<StressSeries> | null | undefined;
  /** `full`: 200 px with axes (Stress Monitor). `spark`: 44 px, no axes (Home, Health hub). */
  variant: "full" | "spark";
};

// Low from 0, medium from 1, high from 2: one continuous line whose colour follows the level (Bevel's stress chart).
const BANDS: Band[] = (["low", "medium", "high"] as const).map((l, i) => ({ from: i, color: DATA_COLORS[STRESS_COLOR[l]].css }));
const AXIS_H = 30;

function Chart({ s, variant }: { s: StressSeries; variant: "full" | "spark" }) {
  const { c, css } = useTheme();
  const tz = useOptionalShellCalendar()?.timeZone;
  const [x, setX] = useState<number | null>(null);
  const vals = s.points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const top = Math.max(...vals);
  const bottom = Math.min(...vals);
  const first = s.points[0]?.t ?? 0;
  const last = s.now ?? s.points.at(-1)?.t ?? 0;
  const latest = [...s.points].reverse().find((p) => p.value !== null);
  const full = variant === "full";
  const summary =
    latest?.value != null ? `Stress through the day, latest ${formatValue("decimal1", latest.value)}, ${STRESS_WORD[stressLevel(latest.value)].toLowerCase()}, at ${clock(latest.t, tz)}.` : "Stress through the day.";

  return (
    <ChartFigure summary={summary} height={full ? 200 : 44}>
      {({ width, height }) => {
        const m = full ? { top: 16, right: 8, bottom: 0, left: 0 } : { top: 4, right: 4, bottom: 4, left: 4 };
        const x0 = m.left + (full ? 28 : 0);
        const x1 = width - m.right;
        const y0 = m.top;
        const y1 = height - m.bottom - (full ? AXIS_H : 0);
        const tx = linearScale([first, last], [x0, x1]);
        const y = linearScale([0, 3], [y1, y0]);
        const pts = s.points.map((p) => ({ x: tx(p.t), y: p.value === null ? null : y(p.value) }));
        const ticks = full ? (s.now ? [...hourTicks(first, last, 6, tz).filter((t) => last - t >= 5 * 3_600_000), s.now] : hourTicks(first, last, 4, tz)) : [];
        const shown = s.now ? ticks : thin(ticks, tx, 24 + 30);
        const valid = s.points.filter((p) => p.value !== null);
        const ai = full && x !== null ? nearestIndex(valid.map((p) => tx(p.t)), x) : -1;
        const a = ai >= 0 ? valid[ai] : null;
        const paint = bandPaint(top, bottom, BANDS, y, css);
        return (
          <>
            <PlotCanvas width={width} height={height}>
              {full && <GridLines ys={[1, 2, 3].map(y)} x0={x0} x1={x1} />}
              {full && <SpanFills spans={s.spans} x={tx} x0={x0} x1={x1} y0={y0} y1={y1} />}
              {full && s.now && <DashedLine x1={tx(s.now)} x2={tx(s.now)} y1={y0} y2={y1} color={c["chart-cursor"]} dash={[4, 4]} />}
              {a && <DashedLine x1={tx(a.t)} x2={tx(a.t)} y1={y0} y2={y1} color={c["chart-cursor"]} />}
              {full && top > 0 && <FadeFill path={areaPath(pts, y1, "monotone")} color={css(bandColor(top, BANDS))} y0={y(top)} y1={y1} from={0.22} to={0} />}
              <StrokePath path={linePath(pts, "monotone")} width={full ? 2 : 1.5} paint={paint} />
              {/* The latest reading: a white dot, as the reference app ends its line (health-01, dashboard-08). */}
              {latest?.value != null && <Circle cx={tx(latest.t)} cy={y(latest.value)} r={full ? 4 : 3} color={c.foreground} />}
              {a && a.value !== null && <GlowDot x={tx(a.t)} y={y(a.value)} fill={css(DATA_COLORS[STRESS_COLOR[stressLevel(a.value)]].css)} />}
            </PlotCanvas>
            {full && <SpanHeads spans={s.spans} x={tx} x0={x0} x1={x1} y0={y0} iconOnly />}
            {full &&
              [0, 1, 2, 3].map((v) => (
                <ChartLabel key={v} x={x0 - 4} y={y(v)} anchor="end" w={24}>{formatValue("decimal1", v)}</ChartLabel>
              ))}
            {/* The hours, then the time now in bold at the end of the line (dashboard-08), clear of the last hour. */}
            {shown.map((t) => {
              const isNow = t === s.now;
              return (
                <ChartLabel key={t} x={tx(t)} y={y1 + 8 + 0.9 * 12} anchor={isNow ? "end" : t <= first ? "start" : "middle"} className={isNow ? "font-bold text-foreground" : "font-normal"}>
                  {clock(t, tz)}
                </ChartLabel>
              );
            })}
            {full && <ScrubLayer width={width} height={height} onScrub={setX} />}
            <ScrubTick index={ai} />
            {a && a.value !== null && (
              <TooltipCard x={tx(a.t)} width={width} title={clock(a.t, tz)}>
                <TooltipLine color={css(DATA_COLORS[STRESS_COLOR[stressLevel(a.value)]].css)}>{`${formatValue("decimal1", a.value)} ${STRESS_WORD[stressLevel(a.value)]}`}</TooltipLine>
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

/** Intraday stress 0-3 with level-coloured lines (spec §5.10). */
export function StressChart({ data, variant }: StressChartProps) {
  const empty =
    variant === "full" ? (
      <View className="items-center">
        <EmptyState body="No still minutes to score yet today. Stress is measured only while you are not moving." />
      </View>
    ) : (
      <View className="h-11 justify-center">
        <Text className="text-xs font-medium leading-4 text-muted-foreground">No still minutes yet</Text>
      </View>
    );
  return (
    <MetricState
      metric={data}
      skeleton={<StressChartSkeleton variant={variant} />}
      empty={empty}
      reasonSize={variant === "full" ? "md" : "sm"}
      renderReason={(r) =>
        variant === "full" ? (
          <View className="items-center">
            <ReasonPlaceholder reason={r} size="md" />
          </View>
        ) : (
          <View className="h-11 justify-center">
            <ReasonPlaceholder reason={r} size="sm" />
          </View>
        )
      }
    >
      {(s) => (s.points.some((p) => p.value !== null) ? <Chart s={s} variant={variant} /> : empty)}
    </MetricState>
  );
}

export function StressChartSkeleton({ variant }: { variant: "full" | "spark" }) {
  return <Skeleton className={`${variant === "full" ? "h-[200px]" : "h-11"} rounded-lg`} />;
}
StressChart.Skeleton = StressChartSkeleton;
