import { useState } from "react";
import { View } from "react-native";
import { Circle, Group } from "@shopify/react-native-skia";
import { clock } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { bandColor, clockTicks, hourTicks, paddedDomain } from "@/lib/charts";
import { ReasonPlaceholder } from "../metrics/ReasonPlaceholder";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { Skeleton } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine } from "./ChartFrame";
import { areaPath, linePath, linearScale, nearestIndex, thin, ticksIn } from "./geometry";
import { bandPaint, FadeFill, StrokePath } from "./paint";
import { SpanFills, SpanHeads, zoneBands, zoneStrips, ZoneStripBars, ZoneStripLabels, type ChartSpan, type HrZone } from "./spans";

export type { ChartSpan, HrZone };

export type HrSeries = {
  /** Per-minute heart rate (epoch ms); null is a gap, never interpolated. */
  points: { t: number; bpm: number | null }[];
  zones?: HrZone[];
  spans?: ChartSpan[];
  /** Today only: the dashed "now" line. */
  now?: number;
};

export type IntradayHrChartProps = {
  data: Metric<HrSeries> | null | undefined;
  /** `day`: 200 px with 6-hourly ticks. `activity`: 180 px for one workout window. */
  variant?: "day" | "activity";
};

const AXIS_H = 30;

function Chart({ hr, variant }: { hr: HrSeries; variant: "day" | "activity" }) {
  const { c, css } = useTheme();
  const tz = useOptionalShellCalendar()?.timeZone;
  const [x, setX] = useState<number | null>(null);
  const first = hr.points[0]?.t ?? 0;
  const last = hr.points.at(-1)?.t ?? 0;
  const domain = paddedDomain(hr.points.map((p) => p.bpm));
  const bpms = hr.points.map((p) => p.bpm).filter((b): b is number => b !== null);
  const zoneOf = (bpm: number) => hr.zones?.find((z) => bpm >= z.min && bpm <= z.max)?.label;
  const summary = `Heart rate from ${clock(first, tz)} to ${clock(last, tz)}: low ${Math.min(...bpms)}, high ${Math.max(...bpms)} beats per minute.`;
  // The day chart draws heart rate grey and colours it by zone only inside workouts (WHOOP's day view); an activity is all workout.
  const workouts = (hr.spans ?? []).filter((s) => s.kind === "workout");
  const inWorkout = (t: number) => variant === "activity" || workouts.some((s) => t >= s.start && t <= s.end);
  const rows = hr.points.map((p, i) => {
    const on = inWorkout(p.t);
    // A minute at the edge of a workout belongs to both series, so the two strokes meet.
    const edge = i > 0 && inWorkout(hr.points[i - 1].t) !== on;
    return { t: p.t, bpm: p.bpm, hot: on || edge ? p.bpm : null, cool: !on || edge ? p.bpm : null };
  });
  const hot = rows.flatMap((r) => (r.hot == null ? [] : [r.hot]));
  const hotTop = hot.length ? Math.max(...hot) : 0;
  const hotBottom = hot.length ? Math.min(...hot) : 0;
  const bands = zoneBands(hr.zones ?? []);
  // An activity marks its start and end with dashed lines and bold times under them.
  const workout = variant === "activity" ? workouts[0] : undefined;
  const height = variant === "day" ? 200 : 180;

  return (
    <ChartFigure summary={summary} height={height}>
      {({ width, height: h }) => {
        const margin = { top: workout ? 8 : 18, right: workout ? 8 : 28 };
        const x0 = 32;
        const x1 = width - margin.right;
        const y0 = margin.top;
        const y1 = h - AXIS_H;
        const tx = linearScale([first, last], [x0, x1]);
        const y = linearScale(domain, [y1, y0]);
        const yTicks = ticksIn(domain[0], domain[1], 4);
        const tickTimes = workout ? [workout.start, workout.end] : variant === "day" ? hourTicks(first, last, 6, tz) : clockTicks(first, last, last - first <= 3_600_000 ? 15 : last - first <= 3 * 3_600_000 ? 30 : 60, tz);
        const shownTicks = workout ? tickTimes : thin(tickTimes, tx, 24 + 30);
        const mk = (key: "hot" | "cool") => rows.map((r) => ({ x: tx(r.t), y: r[key] === null ? null : y(r[key]!) }));
        const strips = variant === "day" ? zoneStrips(hr.zones, domain, y, x1) : [];
        const valid = rows.filter((r) => r.bpm !== null);
        const vx = valid.map((r) => tx(r.t));
        const ai = x === null ? -1 : nearestIndex(vx, x);
        const a = ai >= 0 ? valid[ai] : null;
        const hotPaint = bandPaint(hotTop, hotBottom, bands, y, css);

        return (
          <>
            <PlotCanvas width={width} height={h}>
              <GridLines ys={yTicks.map(y)} x0={x0} x1={x1} />
              {variant === "day" && <SpanFills spans={hr.spans} x={tx} x0={x0} x1={x1} y0={y0} y1={y1} />}
              {variant === "day" && <ZoneStripBars strips={strips} css={css} />}
              {workout &&
                [workout.start, workout.end].map((t) => (
                  <Group key={t}>
                    <DashedLine x1={tx(t)} x2={tx(t)} y1={y0} y2={y1} color={c["foreground-secondary"]} />
                    <Circle cx={tx(t)} cy={y1} r={2.5} color={c.foreground} />
                  </Group>
                ))}
              {hr.now && <DashedLine x1={tx(hr.now)} x2={tx(hr.now)} y1={y0} y2={y1} color={c["chart-cursor"]} dash={[4, 4]} />}
              {a && <DashedLine x1={tx(a.t)} x2={tx(a.t)} y1={y0} y2={y1} color={c["chart-cursor"]} />}
              <FadeFill path={areaPath(mk("cool"), y1, "monotone")} color={c.foreground} y0={y0} y1={y1} from={0.1} to={0} />
              <StrokePath path={linePath(mk("cool"), "monotone")} width={1.25} paint={{ color: c["muted-foreground"] }} />
              {hotTop > domain[0] && <FadeFill path={areaPath(mk("hot"), y1, "monotone")} color={css(bandColor(hotTop, bands))} y0={y(hotTop)} y1={y1} from={0.3} to={0} />}
              <StrokePath path={linePath(mk("hot"), "monotone")} width={1.75} paint={hotPaint} />
              {a && a.bpm !== null && <GlowDot x={tx(a.t)} y={y(a.bpm)} fill={css(bandColor(a.bpm, bands))} />}
            </PlotCanvas>
            {variant === "day" && <SpanHeads spans={hr.spans} x={tx} x0={x0} x1={x1} y0={y0} />}
            {variant === "day" && <ZoneStripLabels strips={strips} css={css} />}
            {yTicks.map((t) => (
              <ChartLabel key={t} x={x0 - 8} y={y(t)} anchor="end" w={x0 - 8}>{String(t)}</ChartLabel>
            ))}
            {shownTicks.map((t) => (
              <ChartLabel key={t} x={tx(t)} y={y1 + 16} className={workout ? "text-xs font-bold text-foreground" : undefined}>{clock(t, tz)}</ChartLabel>
            ))}
            <ScrubLayer width={width} height={h} onScrub={setX} />
            <ScrubTick index={ai} />
            {a && a.bpm !== null && (
              <TooltipCard x={tx(a.t)} width={width} title={clock(a.t, tz)}>
                <TooltipLine color={css(bandColor(a.bpm, bands))}>{`${a.bpm} bpm`}</TooltipLine>
                {zoneOf(a.bpm) && <ZoneName name={zoneOf(a.bpm)!} />}
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

function ZoneName({ name }: { name: string }) {
  return <Text className="text-xs font-medium leading-4 text-muted-foreground">{name}</Text>;
}

/** Heart rate across the day or an activity, with zones and markers (spec §5.7). */
export function IntradayHrChart({ data, variant = "day" }: IntradayHrChartProps) {
  const empty = (
    <View className="items-center">
      <EmptyState body="No heart-rate data for this day." />
    </View>
  );
  return (
    <MetricState
      metric={data}
      skeleton={<IntradayHrChartSkeleton variant={variant} />}
      empty={empty}
      renderReason={(r) => (
        <View className="items-center">
          <ReasonPlaceholder reason={r} size="md" />
        </View>
      )}
    >
      {(hr) => (hr.points.some((p) => p.bpm !== null) ? <Chart hr={hr} variant={variant} /> : empty)}
    </MetricState>
  );
}

export function IntradayHrChartSkeleton({ variant = "day" }: { variant?: "day" | "activity" }) {
  return <Skeleton className={`${variant === "day" ? "h-[200px]" : "h-[180px]"} rounded-lg bg-muted/60`} />;
}
IntradayHrChart.Skeleton = IntradayHrChartSkeleton;
