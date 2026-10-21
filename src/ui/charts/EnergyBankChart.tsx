import { i18n } from "@/i18n/config";
import { useState } from "react";
import { View } from "react-native";
import { Circle } from "@shopify/react-native-skia";
import { DATA_COLORS, recoveryColor } from "@/lib/bands";
import { clock, clockTick, formatValue } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { bandColor, hourTicks, type Band } from "@/lib/charts";
import { ReasonPlaceholder } from "../metrics/ReasonPlaceholder";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { Skeleton } from "../Skeleton";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, PlotCanvas, ScrubLayer, ScrubTick, TooltipCard, TooltipLine, xTickY, yTickX } from "./ChartFrame";
import { areaPath, linePath, linearScale, nearestIndex, preserveStartEnd, tickTextWidth } from "./geometry";
import { bandPaint, FadeFill, StrokePath } from "./paint";
import { SpanFills, SpanHeads } from "./spans";

export type EnergySeries = {
  /** Reserve 0-100 from wake to now (today) or to sleep (past days). */
  points: { t: number; value: number | null }[];
  /** Drains; the chart dots the three biggest (the card lists them below, so no labels cover the line). `amount` is positive ("−18 Run" for 18). */
  drains?: { t: number; amount: number; label: string }[];
  naps?: { start: number; end: number }[];
};

export type EnergyBankChartProps = { data: Metric<EnergySeries> | null | undefined };

// Energy bands like Recovery: red ≤ 33, yellow 34-66, green ≥ 67.
const BANDS: Band[] = [0, 34, 67].map((from) => ({ from, color: DATA_COLORS[recoveryColor(from)].css }));
const HEIGHT = 140;
const AXIS_H = 30;

function Chart({ e }: { e: EnergySeries }) {
  const { c, css } = useTheme();
  const tz = useOptionalShellCalendar()?.timeZone;
  const [x, setX] = useState<number | null>(null);
  const vals = e.points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const top = Math.max(...vals);
  const bottom = Math.min(...vals);
  const first = e.points[0]?.t ?? 0;
  const last = e.points.at(-1)?.t ?? 0;
  const latest = [...e.points].reverse().find((p) => p.value !== null);
  const valueAt = (t: number) => e.points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), e.points[0]).value;
  const drains = [...(e.drains ?? [])].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const startV = e.points.find((p) => p.value !== null)?.value;
  const summary = i18n.t("ui:energy.summary", { start: clock(first, tz), from: formatValue("int", startV), now: formatValue("int", latest?.value) });

  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const x0 = 28;
        const x1 = width - 8;
        const y0 = 18;
        const y1 = height - AXIS_H;
        const tx = linearScale([first, last], [x0, x1]);
        const y = linearScale([0, 100], [y1, y0]);
        const pts = e.points.map((p) => ({ x: tx(p.t), y: p.value === null ? null : y(p.value) }));
        const hours = hourTicks(first, last, 6, tz);
        // The web's interval="preserveStartEnd" minTickGap={24}.
        const ticks = preserveStartEnd(hours.map((t) => ({ x: tx(t), size: tickTextWidth(clockTick(t, tz)) })), 0, width, 24).map((k) => ({ t: hours[k.index], x: k.x }));
        const valid = e.points.filter((p) => p.value !== null);
        const ai = x === null ? -1 : nearestIndex(valid.map((p) => tx(p.t)), x);
        const a = ai >= 0 ? valid[ai] : null;
        const naps = e.naps?.map((n) => ({ kind: "sleep" as const, start: n.start, end: n.end, label: i18n.t("ui:timeline.nap") }));
        return (
          <>
            <PlotCanvas width={width} height={height}>
              <GridLines ys={[33, 67, 100].map(y)} x0={x0} x1={x1} />
              <SpanFills spans={naps} x={tx} x0={x0} x1={x1} y0={y0} y1={y1} />
              {a && <DashedLine x1={tx(a.t)} x2={tx(a.t)} y1={y0} y2={y1} color={c["chart-cursor"]} />}
              <FadeFill path={areaPath(pts, y1, "monotone")} color={css(bandColor(latest?.value ?? top, BANDS))} y0={y(top)} y1={y1} from={0.24} to={0} />
              <StrokePath path={linePath(pts, "monotone")} width={2} paint={bandPaint(top, bottom, BANDS, y, css)} />
              {drains.map((d) => {
                const v = valueAt(d.t);
                return v === null ? null : <Circle key={d.t} cx={tx(d.t)} cy={y(v)} r={3} color={c.warning} />;
              })}
              {latest?.value != null && (
                <>
                  <Circle cx={tx(latest.t)} cy={y(latest.value)} r={6} color={c.card} />
                  <Circle cx={tx(latest.t)} cy={y(latest.value)} r={4} color={css(DATA_COLORS[recoveryColor(latest.value)].css)} />
                </>
              )}
              {a && a.value !== null && <GlowDot x={tx(a.t)} y={y(a.value)} fill={css(DATA_COLORS[recoveryColor(a.value)].css)} />}
            </PlotCanvas>
            <SpanHeads spans={naps} x={tx} x0={x0} x1={x1} y0={y0} />
            {[33, 67, 100].map((v) => (
              <ChartLabel key={v} x={yTickX(x0, 4)} y={y(v)} anchor="end" w={24}>{String(v)}</ChartLabel>
            ))}
            {ticks.map(({ t, x }) => (
              <ChartLabel key={t} x={x} y={xTickY(y1)}>{clockTick(t, tz)}</ChartLabel>
            ))}
            <ScrubLayer width={width} height={height} onScrub={setX} />
            <ScrubTick index={ai} />
            {a && a.value !== null && (
              <TooltipCard x={tx(a.t)} width={width} title={clock(a.t, tz)}>
                <TooltipLine color={css(DATA_COLORS[recoveryColor(a.value)].css)}>{`${formatValue("int", a.value)}%`}</TooltipLine>
              </TooltipCard>
            )}
          </>
        );
      }}
    </ChartFigure>
  );
}

/** another app's Energy Bank in the reference app's language (spec §5.9). */
export function EnergyBankChart({ data }: EnergyBankChartProps) {
  const empty = (
    <View className="items-center">
      <EmptyState body={i18n.t("ui:energy.empty")} />
    </View>
  );
  return (
    <MetricState
      metric={data}
      skeleton={<EnergyBankChartSkeleton />}
      empty={empty}
      renderReason={(r, meta) => (
        <View className="items-center">
          <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" />
        </View>
      )}
    >
      {(e) => (e.points.some((p) => p.value !== null) ? <Chart e={e} /> : empty)}
    </MetricState>
  );
}

export function EnergyBankChartSkeleton() {
  return <Skeleton className="h-[140px] rounded-lg" />;
}
EnergyBankChart.Skeleton = EnergyBankChartSkeleton;
