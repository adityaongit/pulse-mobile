import { useState } from "react";
import { View } from "react-native";
import { Path, RoundedRect } from "@shopify/react-native-skia";
import { DATA_COLORS } from "@/lib/bands";
import { clock, durationWords } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { hourTicks, hypnogramSeries, STAGES, type Stage, type StageSegment } from "@/lib/charts";
import { alpha } from "../color";
import { ReasonPlaceholder } from "../metrics/ReasonPlaceholder";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { Skeleton } from "../Skeleton";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, DashedLine, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine } from "./ChartFrame";
import { linePath, linearScale } from "./geometry";

export type HypnogramNight = { bed: number; wake: number; segments: StageSegment[] };
export type HypnogramProps = {
  /** null or no segments: the night has no stage data (Fitbit only stages sleeps over about 3 h). */
  data: Metric<HypnogramNight> | null | undefined;
};

const STAGE_NAME: Record<Stage, string> = { awake: "Awake", rem: "REM", light: "Light", deep: "Deep" };
const LANE_NAME = ["Deep", "Light", "REM", "Awake"];
const LANE_STAGE: Stage[] = ["deep", "light", "rem", "awake"];
const HEIGHT = 176; // h-44
const AXIS_H = 30;

/**
 * The night as one step line over four lanes, Awake on top to Deep at the bottom, as sleep apps draw it. Touch or drag
 * to step through the stretches; the tooltip names the stage and its times.
 */
export function HypnogramChart({ night }: { night: HypnogramNight }) {
  const { c, css } = useTheme();
  const tz = useOptionalShellCalendar()?.timeZone;
  const [x, setX] = useState<number | null>(null);
  const span = night.wake - night.bed;
  // Hours between the bed and wake times: every other hour past 7 h, none within 24% of either end, so the bold end
  // times never touch a neighbour even at 320 px.
  const hours = hourTicks(night.bed, night.wake, span > 7 * 3_600_000 ? 2 : 1, tz).filter((h) => h - night.bed > span * 0.24 && night.wake - h > span * 0.24);
  const { connector } = hypnogramSeries(night.segments);
  const total = night.segments.reduce((a, s) => a + (s.end - s.start), 0);
  const minutes = (st: Stage) => night.segments.filter((s) => s.stage === st).reduce((a, s) => a + s.end - s.start, 0) / 60_000;
  const summary = `Sleep stages from ${clock(night.bed, tz)} to ${clock(night.wake, tz)}, ${night.segments.length} stretches: ${STAGES.map(
    (s) => `${STAGE_NAME[s]} ${durationWords(minutes(s))}, ${Math.round(((minutes(s) * 60_000) / (total || 1)) * 100)} percent`,
  ).join("; ")}.`;
  // The connector's last point is the wake time, the end of the last stretch: it reads as that stretch.
  const segAt = (t: number) => night.segments.find((s) => s.start <= t && t < s.end) ?? night.segments.findLast((s) => s.end === t);
  const LANE = { awake: 3, rem: 2, light: 1, deep: 0 } as const;

  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const x0 = 52;
        const x1 = width - 8;
        const y0 = 12;
        const y1 = height - AXIS_H;
        const tx = linearScale([night.bed, night.wake], [x0, x1]);
        // domain [0, 3] over the plot: lane 0 (Deep) on the floor, lane 3 (Awake) on the top edge
        const y = linearScale([0, 3], [y1, y0]);
        const t = x === null ? null : Math.min(Math.max(night.bed + ((x - x0) / (x1 - x0)) * span, night.bed), night.wake);
        const seg = t === null ? undefined : segAt(t);
        return (
          <>
            <PlotCanvas width={width} height={height}>
              {/* A faint track under each lane (Google Health's sleep chart), so a short stretch still reads as its row. */}
              {LANE_STAGE.map((_, lane) => (
                <RoundedRect key={lane} x={x0} y={y(lane) - 7} width={x1 - x0} height={14} r={0} color={alpha(c.foreground, 0.07)} />
              ))}
              <Path path={linePath(connector.map((p) => ({ x: tx(p.t), y: p.lane === null ? null : y(p.lane) })), "stepAfter")} style="stroke" strokeWidth={1} color={alpha(c.foreground, 0.22)} />
              {/* one stroke per stretch, 14 px thick with butt ends: a block in its stage colour */}
              {night.segments.map((s) => (
                <Path key={`${s.stage}-${s.start}`} path={`M${tx(s.start)},${y(LANE[s.stage])}H${tx(s.end)}`} style="stroke" strokeWidth={14} strokeCap="butt" color={css(DATA_COLORS[`stage-${s.stage}`].css)} />
              ))}
              {seg && t !== null && <DashedLine x1={x!} x2={x!} y1={y0} y2={y1} color={c["chart-cursor"]} />}
            </PlotCanvas>
            {[0, 1, 2, 3].map((lane) => (
              <ChartLabel key={lane} x={x0 - 8} y={y(lane)} anchor="end" w={x0 - 8} className="text-[11px] font-bold" color={css(DATA_COLORS[`stage-${LANE_STAGE[lane]}`].css)}>{LANE_NAME[lane]}</ChartLabel>
            ))}
            {/* Bed and wake times at the ends, bold (WHOOP), and the whole hours between that keep clear of them. */}
            <ChartLabel x={x0} y={y1 + 16} anchor="start" className="font-bold text-foreground">{clock(night.bed, tz)}</ChartLabel>
            {hours.map((h) => (
              <ChartLabel key={h} x={tx(h)} y={y1 + 16}>{clock(h, tz)}</ChartLabel>
            ))}
            <ChartLabel x={x1} y={y1 + 16} anchor="end" className="font-bold text-foreground">{clock(night.wake, tz)}</ChartLabel>
            <ScrubLayer width={width} height={height} onScrub={setX} />
            <ScrubTick index={seg ? seg.start : -1} />
            {seg && x !== null && (
              <TooltipCard x={x} width={width} title={`${clock(seg.start, tz)} to ${clock(seg.end, tz)}`}>
                <TooltipLine color={css(DATA_COLORS[`stage-${seg.stage}`].css)}>{`${STAGE_NAME[seg.stage]}, ${Math.round((seg.end - seg.start) / 60000)} min`}</TooltipLine>
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

/** Last night's stages as a step chart over four lanes (spec §5.6, derived design). */
export function Hypnogram({ data }: HypnogramProps) {
  const empty = (
    <View className="items-center">
      <EmptyState body="No stage data for this sleep. Fitbit only stages sleeps longer than about 3 hours." />
    </View>
  );
  return (
    <MetricState
      metric={data}
      skeleton={<HypnogramSkeleton />}
      empty={empty}
      renderReason={(r) => (
        <View className="items-center">
          <ReasonPlaceholder reason={r} size="md" />
        </View>
      )}
    >
      {(night) => (night.segments.length ? <HypnogramChart night={night} /> : empty)}
    </MetricState>
  );
}

export function HypnogramSkeleton() {
  return <Skeleton className="h-44 rounded-lg bg-muted/60" />;
}
Hypnogram.Skeleton = HypnogramSkeleton;
