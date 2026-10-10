import { useState } from "react";
import { View } from "react-native";
import { DashPathEffect, Group, LinearGradient, Path, RoundedRect, vec } from "@shopify/react-native-skia";
import { DATA_COLORS, deltaTone, recoveryBand, recoveryColor, STRESS_COLOR, stressLevel, type GoodDirection } from "@/lib/bands";
import { DAY, dayLabel, formatDay, formatValue, spoken, type FormatKey } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { RANGE_DAYS, type TrendRange } from "@/lib/url";
import { alpha } from "../color";
import { cn } from "../cn";
import type { Band } from "@/lib/charts";
import { StatusChip, ValueUnit } from "../metrics/primitives";
import { Segmented } from "../Segmented";
import { Skeleton, SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { useOptionalShellCalendar } from "../shells/ShellStatus";
import { ChartFigure, ChartLabel, DashedLine, GlowDot, GridLines, labelGutter, Pill, PlotCanvas, ScrubLayer, ScrubTick, wholeTick } from "./ChartFrame";
import { areaPath, bandCenters, evenTicks, linePath, linearScale, nearestIndex } from "./geometry";
import { bandPaint, FadeFill, StrokePath } from "./paint";

export type TrendPoint = {
  date: string;
  value: number | null;
  provisional?: boolean;
  /** With `stack`: the parts of `value` by series key; null when the day has a total but no breakdown. */
  parts?: Record<string, number> | null;
};
/** One stacked part, bottom first. `color` is a CSS colour (a token's `var()`). */
export type TrendSeries = { key: string; label: string; color: string };

export type TrendChartProps = {
  label: string;
  /** Oldest first, with enough days for the longest enabled range. */
  data: Metric<TrendPoint[]> | null | undefined;
  unit?: string;
  format: FormatKey;
  colorBy: "band" | "strain" | "sleep" | "single" | "stress";
  /** Gives the delta chip a good/bad tone; omit for neutral metrics. */
  direction?: GoodDirection;
  /** Range average minus the prior range average. */
  deltas?: Partial<Record<TrendRange, number | null>>;
  /** Shades mean ± 1 σ ("Shaded: your normal range"). */
  baseline?: { mean: number; sd: number } | null;
  target?: [number, number] | null;
  /** Pins one range and hides the toggle (Stress 30-day trend). */
  fixedRange?: TrendRange;
  /** Range to open on (default `m`; Fitness VO2 max uses `6m`). The web keeps the range in `?r=`; here it is the chart's own state. */
  defaultRange?: TrendRange;
  /** The toggle's ranges (default W, M, 6M; Trends adds 1Y). `data` must hold enough days for the longest. */
  ranges?: readonly TrendRange[];
  reference?: { y: number; label: string };
  /** Missing parts leave the total intact; W/M use stacked bars, longer ranges use a total line. */
  stack?: readonly TrendSeries[];
  /** `day`: the header shows the selected (last) day's value instead of the range average. */
  headline?: "average" | "day";
  /** Draws a line of the trailing `smooth`-day average over the bars or dots (weight's 7-day average). */
  smooth?: number;
  /** Lines at every range; otherwise W/M use bars. */
  line?: boolean;
};

const RANGE_ARIA: Record<TrendRange, string> = { w: "1 week", m: "1 month", "6m": "6 months", "1y": "1 year" };
const RANGE_PRIOR: Record<TrendRange, string> = { w: "vs. prior week", m: "vs. prior month", "6m": "vs. prior 6 months", "1y": "vs. prior year" };
const RANGE_WORD: Record<TrendRange, string> = { w: "week", m: "month", "6m": "6 months", "1y": "year" };
const RANGE_LABEL: Record<TrendRange, string> = { w: "W", m: "M", "6m": "6M", "1y": "1Y" };
const DEFAULT_RANGES: readonly TrendRange[] = ["w", "m", "6m"];
const HEIGHT = 200;
const AXIS_H = 30;
const MAX_BAR = 28;

function trailingMean(points: TrendPoint[], i: number, days: number) {
  const xs = points.slice(Math.max(0, i - days + 1), i + 1).flatMap((x) => (x.value === null ? [] : [x.value]));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function colorFor(colorBy: TrendChartProps["colorBy"], v: number) {
  if (colorBy === "band") return DATA_COLORS[recoveryColor(v)].css;
  if (colorBy === "stress") return DATA_COLORS[STRESS_COLOR[stressLevel(v)]].css;
  if (colorBy === "strain") return DATA_COLORS.strain.css;
  if (colorBy === "sleep") return DATA_COLORS.sleep.css;
  return DATA_COLORS["chart-5"].css;
}

function bandsFor(colorBy: TrendChartProps["colorBy"]): Band[] | null {
  if (colorBy === "band") return [0, 34, 67].map((from) => ({ from, color: DATA_COLORS[recoveryColor(from)].css }));
  if (colorBy === "stress") return [0, 1, 2].map((from) => ({ from, color: DATA_COLORS[STRESS_COLOR[stressLevel(from)]].css }));
  return null;
}

const BAND_TICK = { green: "recovery-green", yellow: "recovery-yellow", red: "recovery-red-text" } as const;
const headerClass = (ranges: readonly TrendRange[]) => cn("mb-4 gap-3", ranges.length > 3 ? "flex-col-reverse" : "flex-row items-start justify-between");

function Trend({ points, p }: { points: TrendPoint[]; p: TrendChartProps }) {
  const { css, c } = useTheme();
  const today = useOptionalShellCalendar()?.today ?? points.at(-1)?.date ?? "";
  const fallback = p.defaultRange ?? "m";
  const ranges = p.ranges ?? DEFAULT_RANGES;
  const [chosen, setRange] = useState<TrendRange>(ranges.includes(fallback) ? fallback : ranges[0]);
  const range = p.fixedRange ?? chosen;
  const [x, setX] = useState<number | null>(null);

  const n = RANGE_DAYS[range];
  const rows = points.slice(-n).map((pt, i) => ({
    ...pt,
    fill: pt.value === null ? undefined : css(colorFor(p.colorBy, pt.value)),
    fillOpacity: pt.provisional ? 0.45 : 1,
    text: pt.value === null ? "" : formatValue(p.format, pt.value),
    smooth: p.smooth ? trailingMean(points, points.length - Math.min(n, points.length) + i, p.smooth) : null,
  }));
  const values = rows.map((r) => r.value).filter((v): v is number => v !== null);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const delta = p.deltas?.[range] ?? null;
  const tone = delta === null || !p.direction || delta === 0 ? null : deltaTone(p.direction, delta, 0).tone;
  const byDay = p.headline === "day";
  const line = !!p.line || range === "6m" || range === "1y";
  const bands = bandsFor(p.colorBy);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 0;
  // Durations always read h:mm ("3:00"); wholeTick would print a whole number of minutes raw ("180").
  const fmtTick = p.format === "duration" ? (v: number) => formatValue(p.format, v) : wholeTick((v) => formatValue(p.format, v));
  const showAvg = !line && range !== "w" && avg !== null;
  const gutter = labelGutter([p.reference?.label, showAvg && "Avg"]);
  // Reserve room for the widest tick and a rounded-up top tick, using about 7 px per character.
  const widest = formatValue(p.format, Math.max(0, ...rows.map((r) => r.value ?? 0))).length;
  const axisWidth = widest <= 3 ? 32 : 15 + 7 * widest;
  const bandTicks = p.colorBy === "band" ? [33, 67, 100] : p.colorBy === "stress" ? [1, 2, 3] : undefined;

  const partAvg = (key: string) => {
    const xs = rows.map((r) => r.parts?.[key]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const summary = values.length
    ? `${p.label} over the last ${RANGE_WORD[range]}: average ${spoken(formatValue(p.format, avg), p.unit)}, range ${formatValue(p.format, Math.min(...values))} to ${formatValue(p.format, Math.max(...values))}${rows.length - values.length ? `, ${rows.length - values.length} ${rows.length - values.length === 1 ? "day" : "days"} missing` : ""}.${
        p.stack ? ` Average split: ${p.stack.map((s) => `${s.label} ${formatValue(p.format, partAvg(s.key))}`).join(", ")}.` : ""
      }`
    : `No ${p.label} data in the last ${RANGE_WORD[range]}.`;

  const geometry = (width: number, height: number) => {
            const margin = { top: range === "w" ? 18 : 8, right: p.line && range === "w" ? Math.max(gutter, 14) : gutter, left: 4 };
            const x0 = margin.left + axisWidth;
            const x1 = width - margin.right;
            const y0 = margin.top;
            const y1 = height - AXIS_H;

            // Y domain, as Recharts picks it: fixed for bands and stress, the data's own for a free-floating line, else zero to a round top.
            const extra = [p.baseline && p.baseline.mean + p.baseline.sd, p.baseline && p.baseline.mean - p.baseline.sd, p.reference?.y, p.target?.[0], p.target?.[1]].filter((v): v is number => v != null);
            const all = [...values, ...extra];
            const auto = line && (p.colorBy === "single" || p.line);
            const ticksAuto = auto ? evenTicks(Math.min(...all), Math.max(...all), 3) : evenTicks(0, Math.max(...all, 1), 3);
            const domain: [number, number] = p.colorBy === "band" ? [0, 100] : p.colorBy === "stress" ? [0, 3] : [ticksAuto[0], ticksAuto.at(-1)!];
            const yTicks = line ? (p.colorBy === "band" ? [0, 50, 100] : p.colorBy === "stress" ? [0, 1.5, 3] : ticksAuto) : (bandTicks ?? ticksAuto);
            const y = linearScale(domain, [y1, y0]);

            // X: a line runs edge to edge (a point scale); bars sit in category bands.
            const band = bandCenters(rows.length, x0, x1, 0.1);
            const xs = line ? rows.map((_, i) => (rows.length === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (rows.length - 1))) : band.centers;
            const bw = Math.min(MAX_BAR, band.step * 0.9);
            const ticks =
              range === "w"
                ? rows.map((_, i) => i)
                : range === "m"
                  ? rows.flatMap((_, i) => ((rows.length - 1 - i) % 7 === 0 ? [i] : []))
                  : rows.flatMap((r, i) => (i > 0 && r.date.slice(0, 7) !== rows[i - 1].date.slice(0, 7) ? [i] : []));
            const tickFormat = (d: string) => formatDay(d, range === "w" ? { weekday: "narrow" } : range === "m" ? DAY.monthDay : { month: "short" });

            const lineDraw = line ? linePath(rows.map((r, i) => ({ x: xs[i], y: r.value === null ? null : y(r.value) })), p.line ? "linear" : "monotone") : "";
            const areaDraw = line ? areaPath(rows.map((r, i) => ({ x: xs[i], y: r.value === null ? null : y(r.value) })), y1, p.line ? "linear" : "monotone") : "";
            const lineColor = bands ? bandPaint(hi, lo, bands, y, css) : { color: c["foreground-secondary"] };
            const smoothDraw = p.smooth ? linePath(rows.flatMap((r, i) => (r.smooth === null ? [] : [{ x: xs[i], y: y(r.smooth) }])), "monotone") : "";
            const avgColor = css(colorFor(p.colorBy, avg ?? 0));
            const UNSPLIT = c["muted-foreground"];

    return { x0, x1, y0, y1, y, xs, band, bw, yTicks, ticks, tickFormat, lineDraw, areaDraw, lineColor, smoothDraw, avgColor, UNSPLIT };
  };
  const [width, setWidth] = useState(0);
  const g = width > 0 ? geometry(width, HEIGHT) : null;
  const ai = g && x !== null ? nearestIndex(g.xs, x) : -1;
  const aRow = ai >= 0 ? rows[ai] : null;
  const scrubbed = aRow;
  const shown = scrubbed ?? (byDay || p.stack ? (rows.at(-1) ?? null) : null);

  return (
    <View className="min-w-0">
      <View className={headerClass(ranges)}>
        <View className="min-w-0 shrink">
          <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] tabular-nums text-muted-foreground">{scrubbed || byDay ? dayLabel(shown?.date ?? today, today) : "Average"}</Text>
          <ValueUnit value={formatValue(p.format, scrubbed || byDay ? (shown?.value ?? null) : avg)} unit={p.unit} className="font-numeric text-[28px] font-bold leading-8" />
          {p.stack && <StackLegend series={p.stack} point={scrubbed || byDay ? shown : { date: "", value: avg, parts: Object.fromEntries(p.stack.map((s) => [s.key, partAvg(s.key) ?? 0])) }} format={p.format} />}
          {shown?.provisional && <Text className="mt-1 text-xs font-medium text-muted-foreground">{p.stack ? "So far" : "Provisional"}</Text>}
          {!scrubbed && !byDay && delta !== null && (
            <View className="mt-1">
              <StatusChip tone={tone === "good" ? "optimal" : tone === "bad" ? "warning" : "neutral"} delta={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                {`${formatValue(p.format, Math.abs(delta))}${p.unit === "%" ? "%" : p.unit ? ` ${p.unit}` : ""} ${RANGE_PRIOR[range]}`}
              </StatusChip>
            </View>
          )}
        </View>
        {!p.fixedRange && (
          <Segmented
            label="Range"
            value={range}
            fill={ranges.length > 3}
            options={ranges.map((r) => ({ value: r, label: RANGE_LABEL[r], accessibilityLabel: RANGE_ARIA[r] }))}
            onChange={(r) => {
              setRange(r);
              setX(null);
            }}
          />
        )}
      </View>

      {values.length === 0 ? (
        <View className="h-[200px] items-center justify-center">
          <EmptyState body="No data in this range yet." />
        </View>
      ) : (
        <ChartFigure summary={summary} height={HEIGHT} onWidth={setWidth}>
          {({ width, height }) => {
            const { x0, x1, y0, y1, y, xs, band, bw, yTicks, ticks, tickFormat, lineDraw, areaDraw, lineColor, smoothDraw, avgColor, UNSPLIT } = g!;
            return (
              <>
                <PlotCanvas width={width} height={height}>
                  <GridLines ys={yTicks.map(y)} x0={x0} x1={x1} />
                  {p.baseline && <RoundedRect x={x0} y={y(p.baseline.mean + p.baseline.sd)} width={x1 - x0} height={Math.max(0, y(p.baseline.mean - p.baseline.sd) - y(p.baseline.mean + p.baseline.sd))} r={0} color={c["chart-band"]} />}
                  {p.reference && <DashedLine x1={x0} x2={x1} y1={y(p.reference.y)} y2={y(p.reference.y)} color={c["chart-cursor"]} dash={[4, 4]} />}
                  {showAvg && <DashedLine x1={x0} x2={x1} y1={y(avg!)} y2={y(avg!)} color={c["chart-cursor"]} />}
                  {p.target && <RoundedRect x={x0} y={y(p.target[1])} width={x1 - x0} height={Math.max(0, y(p.target[0]) - y(p.target[1]))} r={0} color={alpha(c["dial-target"], 0.3)} />}
                  {/* the cursor: a vertical dashed line on a line chart, a faint column behind a bar */}
                  {aRow && line && <DashedLine x1={xs[ai]} x2={xs[ai]} y1={y0} y2={y1} color={c["chart-cursor"]} />}
                  {aRow && !line && <RoundedRect x={xs[ai] - band.step / 2} y={y0} width={band.step} height={y1 - y0} r={0} color={alpha(c.foreground, 0.05)} />}

                  {line && <FadeFill path={areaDraw} color={bands ? c.foreground : avgColor} y0={y(hi)} y1={y1} from={0.18} to={0} />}
                  {line && <StrokePath path={lineDraw} width={bands ? 2 : 1.5} paint={lineColor} />}
                  {line &&
                    rows.map((r, i) => {
                      if (r.value === null || !r.fill) return null;
                      const last = i === rows.length - 1;
                      return p.line && range === "w" ? (
                        <Group key={r.date} opacity={r.fillOpacity}>
                          <Path path={circle(xs[i], y(r.value), 5.5)} color={r.fill} />
                          <Path path={circle(xs[i], y(r.value), 3.5)} color={c.card} />
                        </Group>
                      ) : (
                        <Group key={r.date} opacity={r.fillOpacity}>
                          {last && <Path path={circle(xs[i], y(r.value), 5)} color={c.card} />}
                          <Path path={circle(xs[i], y(r.value), last ? 4 : 2.5)} color={r.fill} />
                        </Group>
                      );
                    })}

                  {!line &&
                    !p.stack &&
                    rows.map((r, i) =>
                      r.value === null || !r.fill ? null : (
                        // CapBar: a fade from the bar's colour to 50 % at the floor, with a 2 px solid cap on top.
                        <Group key={r.date} opacity={r.fillOpacity} clip={{ x: xs[i] - bw / 2, y: 0, width: bw, height: y1 }}>
                          <RoundedRect x={xs[i] - bw / 2} y={y(r.value)} width={bw} height={y1 - y(r.value) + 4} r={4}>
                            <LinearGradient start={vec(0, y(r.value))} end={vec(0, y1)} colors={[r.fill, alpha(r.fill, 0.5)]} />
                          </RoundedRect>
                          <RoundedRect x={xs[i] - bw / 2} y={y(r.value)} width={bw} height={Math.min(2, y1 - y(r.value))} r={2} color={r.fill} />
                        </Group>
                      ),
                    )}
                  {!line &&
                    p.stack &&
                    rows.map((r, i) => {
                      if (r.value === null) return null;
                      if (!r.parts) {
                        // An outline distinguishes a missing breakdown from a coloured part.
                        return (
                          <Group key={r.date} opacity={r.fillOpacity} clip={{ x: xs[i] - bw / 2 - 1, y: 0, width: bw + 2, height: y1 }}>
                            <RoundedRect x={xs[i] - bw / 2} y={y(r.value)} width={bw} height={y1 - y(r.value) + 3} r={3} color={alpha(c.foreground, 0.04)} />
                            <RoundedRect x={xs[i] - bw / 2} y={y(r.value)} width={bw} height={y1 - y(r.value) + 3} r={3} color={UNSPLIT} style="stroke" strokeWidth={1}>
                              <DashPathEffect intervals={[3, 2]} />
                            </RoundedRect>
                          </Group>
                        );
                      }
                      let base = 0;
                      return (
                        <Group key={r.date} opacity={r.fillOpacity} clip={{ x: xs[i] - bw / 2, y: 0, width: bw, height: y1 }}>
                          {p.stack!.map((s, k) => {
                            const v = r.parts?.[s.key] ?? 0;
                            const top = base + v;
                            const rect = { y: y(top), h: y(base) - y(top) };
                            base = top;
                            if (v <= 0) return null;
                            // Only the top part is rounded, as the web rounds the bar that carries the label.
                            return <RoundedRect key={s.key} x={xs[i] - bw / 2} y={rect.y} width={bw} height={rect.h + (k === p.stack!.length - 1 ? 3 : 0)} r={k === p.stack!.length - 1 ? 3 : 0} color={css(s.color)} />;
                          })}
                        </Group>
                      );
                    })}
                  {smoothDraw && <StrokePath path={smoothDraw} width={2} paint={{ color: c.foreground }} />}
                  {aRow && line && aRow.value !== null && aRow.fill && <GlowDot x={xs[ai]} y={y(aRow.value)} fill={aRow.fill} />}
                </PlotCanvas>

                {/* Y ticks, right-aligned in the axis gutter; zero is the floor every bar stands on, so it gets no label there. */}
                {yTicks.map((t) => {
                  if (!line && t === 0) return null;
                  const bandTone = p.colorBy === "band" && !line;
                  return (
                    <ChartLabel key={t} x={x0 - 8} y={y(t)} anchor="end" w={axisWidth} className={bandTone ? "font-semibold" : undefined} color={bandTone ? css(`var(--${BAND_TICK[recoveryBand(t)]})`) : undefined}>
                      {fmtTick(t)}
                    </ChartLabel>
                  );
                })}
                {ticks.map((i) => {
                  const on = range === "w" && rows[i].date === shown?.date;
                  return (
                    <ChartLabel key={rows[i].date} x={xs[i]} y={y1 + 16} anchor="middle" className={on ? "font-bold text-foreground" : undefined} w={48}>
                      {tickFormat(rows[i].date)}
                    </ChartLabel>
                  );
                })}
                {p.reference && <Pill x={x1 + 4} y={y(p.reference.y)} text={p.reference.label} color={c["muted-foreground"]} />}
                {showAvg && <Pill x={x1 + 4} y={y(avg!)} text="Avg" />}
                {/* Value labels over the bars (W) and over a labelled line's dots. */}
                {range === "w" && !p.stack && !line && rows.map((r, i) => (r.value === null ? null : <ChartLabel key={r.date} x={xs[i]} y={y(r.value) - 11} className="text-[11px] text-foreground">{r.text}</ChartLabel>))}
                {range === "w" && p.line && rows.map((r, i) => (r.value === null ? null : <ChartLabel key={r.date} x={xs[i]} y={y(r.value) - 18} className="font-semibold text-foreground-secondary">{`${r.text}${p.unit === "%" ? "%" : ""}`}</ChartLabel>))}
                {range === "w" && p.stack && rows.map((r, i) => (r.value === null ? null : <ChartLabel key={r.date} x={xs[i]} y={y(r.value) - 11} className="text-[11px] text-foreground">{formatValue(p.format, r.value)}</ChartLabel>))}
                <ScrubLayer width={width} height={height} onScrub={setX} />
                <ScrubTick index={ai} />
              </>
            );
          }}
        </ChartFigure>
      )}
      {(p.baseline || p.target || p.smooth) && values.length > 0 && (
        <Text className="mt-2 text-xs font-medium leading-4 text-muted-foreground">{p.target ? "Shaded: your Strain Target" : p.baseline ? "Shaded: your normal range" : `Line: ${p.smooth}-day average`}</Text>
      )}
    </View>
  );
}

/** A circle as a path (Skia's <Circle> inside a Group with opacity works too, but one path keeps the dot count down). */
const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;

function StackLegend({ series, point, format }: { series: readonly TrendSeries[]; point: TrendPoint | null; format: FormatKey }) {
  const { css, c } = useTheme();
  const parts = point?.parts;
  return (
    <View className="mt-1.5 flex-row flex-wrap items-center gap-x-4 gap-y-1">
      {point?.value != null && !parts ? (
        <View className="flex-row items-center gap-1.5">
          <View className="size-2 rounded-[2px] border border-dashed" style={{ borderColor: c["muted-foreground"] }} />
          <Text className="text-xs font-medium leading-4 text-muted-foreground">No breakdown for this day</Text>
        </View>
      ) : (
        [...series].reverse().map((s) => (
          <View key={s.key} className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-[2px]" style={{ backgroundColor: css(s.color) }} />
            <Text className="text-xs font-medium leading-4 text-muted-foreground">
              {s.label} <Text className="font-numeric font-semibold tabular-nums text-foreground-secondary">{formatValue(format, parts?.[s.key])}</Text>
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

export function TrendChart(p: TrendChartProps) {
  return (
    <MetricState metric={p.data} skeleton={<TrendChartSkeleton ranges={p.ranges} day={p.headline === "day"} legend={!!p.stack} />} empty={<EmptyState body="No data in this range yet." />}>
      {(points) => <Trend points={points} p={p} />}
    </MetricState>
  );
}

export function TrendChartSkeleton({ chip = false, caption = false, ranges = DEFAULT_RANGES, day = false, legend = false }: { chip?: boolean; caption?: boolean; ranges?: readonly TrendRange[]; day?: boolean; legend?: boolean } = {}) {
  return (
    <View accessibilityElementsHidden className="min-w-0">
      <View className={headerClass(ranges)}>
        <View className="min-w-0">
          {day ? <SkeletonText className="w-16" fs={12} lh={16} /> : <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">Average</Text>}
          <SkeletonText className="w-14" fs={28} lh={32} />
          {legend && <SkeletonText className="mt-1.5 w-40" />}
          {chip && <Skeleton className="mt-1 h-6 w-28" />}
        </View>
        <View className={cn("flex-row gap-0.5 rounded-lg bg-muted p-0.5", ranges.length > 3 && "w-full")}>
          {ranges.map((r) => (
            <View key={r} className={cn("h-10 min-w-11 items-center justify-center rounded-md px-3", ranges.length > 3 && "flex-1")}>
              <Text className="font-numeric text-[13px] font-bold text-muted-foreground/60">{RANGE_LABEL[r]}</Text>
            </View>
          ))}
        </View>
      </View>
      <Skeleton className="h-[200px] rounded-lg bg-muted/60" />
      {caption && <SkeletonText className="mt-2 w-48" />}
    </View>
  );
}
TrendChart.Skeleton = TrendChartSkeleton;
