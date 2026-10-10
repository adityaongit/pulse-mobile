// The Trend View's chart (web: components/charts/TrendViewChart.tsx, Recharts). One Skia <Canvas> of marks with every
// piece of text laid over it as React Native <Text>, as the kit's charts are built (src/ui/charts). The numbers (domain,
// ticks, rows) come from trendViewLayout.ts, once per data set; the plot below only maps them to pixels.
import { useMemo } from "react";
import { Group, Path, RoundedRect, DashPathEffect } from "@shopify/react-native-skia";
import { DATA_COLORS, deltaTone, partColor, recoveryColor, type GoodDirection } from "@/lib/bands";
import { formatDay, formatValue, hmm } from "@/lib/format";
import { ChartFigure, ChartLabel, GridLines, HollowDot, Pill, PlotCanvas, wholeTick } from "@/ui/charts/ChartFrame";
import { areaPath, bandCenters, linePath, linearScale } from "@/ui/charts/geometry";
import { FadeFill } from "@/ui/charts/paint";
import type { Palette } from "@/ui/palette";
import { useTheme } from "@/ui/theme";
import { buildModel, clockOf, colorOf, type Model, type TrendViewChartProps } from "./trendViewLayout";

export type { TrendViewChartProps };

const MAX_BAR = 28;
/** The web's axis tick margin: ticks sit 8 px from the plot. */
const TICK_GAP = 8;

/** A bar with its top corners rounded (the web's `radius={[3, 3, 0, 0]}`). */
const barPath = (x: number, top: number, w: number, bottom: number, r: number) => {
  const h = bottom - top;
  if (h <= 0) return "";
  const k = Math.min(r, h, w / 2);
  return `M${x},${bottom}V${top + k}A${k},${k} 0 0 1 ${x + k},${top}H${x + w - k}A${k},${k} 0 0 1 ${x + w},${top + k}V${bottom}Z`;
};

/** A bed-to-wake bar: all four corners rounded. */
const roundedPath = (x: number, top: number, w: number, h: number, r: number) => {
  const k = Math.min(r, h / 2, w / 2);
  return `M${x + k},${top}H${x + w - k}A${k},${k} 0 0 1 ${x + w},${top + k}V${top + h - k}A${k},${k} 0 0 1 ${x + w - k},${top + h}H${x + k}A${k},${k} 0 0 1 ${x},${top + h - k}V${top + k}A${k},${k} 0 0 1 ${x + k},${top}Z`;
};


export function TrendViewChart(p: TrendViewChartProps) {
  const { label, bars, chart, range, format, unit, series, domain, typical, average, segments, compact } = p;
  // Once per data set: neither the width nor the theme changes any of this.
  const m = useMemo(
    () => buildModel({ label, bars, chart, range, format, unit, series, domain, typical, average, segments, compact, colorBy: p.colorBy, direction: p.direction }, (v) => formatValue(format, v)),
    [label, bars, chart, range, format, unit, series, domain, typical, average, segments, compact, p.colorBy, p.direction],
  );
  return (
    <ChartFigure summary={m.summary} height={m.height}>
      {({ width, height }) => <Plot p={p} m={m} width={width} height={height} />}
    </ChartFigure>
  );
}

function Plot({ p, m, width, height }: { p: TrendViewChartProps; m: Model; width: number; height: number }) {
  const { css, c } = useTheme();
  const fmt = (v: number) => formatValue(p.format, v);
  const { rows, keys, weekly, pair } = m;
  const single = css(DATA_COLORS["chart-5"].css);
  const tints = { strain: css(DATA_COLORS.strain.css), sleep: css(DATA_COLORS.sleep.css), single };
  const fillOf = (v: number) => colorOf(p.colorBy, v, (x) => css(DATA_COLORS[recoveryColor(x)].css), tints);
  /** A bar's colour as text: red text uses the lifted red token for contrast (spec §2.3). */
  const textOf = (fill: string | undefined) => (fill === css(DATA_COLORS["recovery-red"].css) ? c["recovery-red-text"] : (fill ?? c.foreground));

  const g = useMemo(() => geometry(m, p.chart, p.segments, p.direction, width, height), [m, p.chart, p.segments, p.direction, width, height]);
  const { x0, x1, y0, y1, y, xs, step, bw, floor, draws, segs } = g;
  const range = p.chart === "range";
  const strokeSingle = m.faint ? c["chart-faint"] : single;

  const asLine = p.chart === "line" || (m.faint && !weekly);
  const asStack = p.chart === "stack" && !!p.series;
  const lastX = m.last >= 0 ? xs[m.last] : 0;
  const tick = (d: string) => {
    const on = d === p.selected;
    const [top, bottom] =
      p.range === "6m" ? [formatDay(d, { month: "short" }), ""] : p.range === "w" && !weekly ? [formatDay(d, { weekday: "short" }), formatDay(d, { day: "numeric" })] : [formatDay(d, { month: "short" }), formatDay(d, { day: "numeric" })];
    return { on, text: bottom ? `${top}\n${bottom}` : top };
  };
  const yText = (v: number) => (range ? clockOf(v) : p.format === "duration" ? hmm(v) : `${wholeTick(fmt)(v)}${p.unit === "%" ? "%" : ""}`);
  const halo = c.card;

  return (
    <>
      <PlotCanvas width={width} height={height}>
        <GridLines ys={m.yTicks.map(y)} x0={x0} x1={x1} />
        {/* The selected day's column: a soft rounded band the full height of the plot and its tick. */}
        {p.selected && keys.includes(p.selected) && (() => {
          const i = keys.indexOf(p.selected);
          const w = Math.min(step * 0.86, 44);
          return <RoundedRect x={xs[i] - w / 2} y={y0 - 4} width={w} height={y1 - y0 + 46} r={6} color={c["chart-highlight"]} />;
        })()}
        {p.typical && <RoundedRect x={x0} y={y(p.typical[1])} width={x1 - x0} height={Math.max(0, y(p.typical[0]) - y(p.typical[1]))} r={0} color={c["chart-band"]} />}
        {m.showAvg && (
          <Path path={`M${x0},${y(p.average!)}L${x1},${y(p.average!)}`} style="stroke" strokeWidth={1} color={c.foreground} opacity={0.7}>
            <DashPathEffect intervals={[4, 3]} />
          </Path>
        )}

        {pair ? (
          pair.map((s, k) => {
            const color = css(partColor(s.key));
            return (
              <Group key={s.key}>
                <Path path={draws.pair![k]} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" color={color} />
                {rows.map((r, i) => (r.parts?.[s.key] == null || (p.range === "m" && i !== m.last) ? null : <HollowDot key={r.key} x={xs[i]} y={y(r.parts[s.key])} r={4.5} stroke={color} strokeWidth={2} />))}
              </Group>
            );
          })
        ) : range ? (
          rows.map((r, i) => {
            if (!r.span) return null;
            const top = y(r.span[0]);
            const h = y(r.span[1]) - top;
            const w = Math.min(bw, 18);
            return <Path key={r.key} path={roundedPath(xs[i] - w / 2, top, w, h, 3)} color={single} />;
          })
        ) : asLine ? (
          <>
            {!m.faint && <FadeFill path={draws.area} color={single} y0={draws.top} y1={y1} from={0.22} to={0} />}
            <Path path={draws.line} style="stroke" strokeWidth={m.faint ? 1.5 : 2} strokeCap="round" strokeJoin="round" color={strokeSingle} />
            {!m.faint && rows.map((r, i) => (r.value === null || (p.range === "m" && i !== m.last) ? null : <HollowDot key={r.key} x={xs[i]} y={y(r.value)} r={4.5} stroke={single} strokeWidth={2} />))}
          </>
        ) : asStack ? (
          rows.map((r, i) => {
            let base = 0;
            return (
              <Group key={r.key} opacity={m.faint ? 0.35 : r.opacity}>
                {p.series!.map((s, k) => {
                  const v = r.parts?.[s.key] ?? 0;
                  const lo = base;
                  base += v;
                  if (v <= 0) return null;
                  const path = barPath(xs[i] - bw / 2, y(base), bw, y(lo), k === p.series!.length - 1 ? 3 : 0);
                  return (
                    <Group key={s.key}>
                      <Path path={path} color={css(partColor(s.key))} />
                      <Path path={path} style="stroke" strokeWidth={1} color={c.card} />
                    </Group>
                  );
                })}
              </Group>
            );
          })
        ) : (
          rows.map((r, i) => (r.value === null ? null : <Path key={r.key} path={barPath(xs[i] - bw / 2, y(r.value), bw, floor, 3)} color={fillOf(r.value)} opacity={m.faint ? 0.35 : r.opacity} />))
        )}

        {/* 6M: a level segment per month. */}
        {segs.map((s) => <Path key={s.month} path={`M${s.x1 + 2},${s.cy}L${s.x2 - 2},${s.cy}`} style="stroke" strokeWidth={3} strokeCap="round" color={SEG_COLOR[s.tone](c)} />)}
      </PlotCanvas>

      {/* Y ticks, right-aligned in the axis gutter. */}
      {!p.compact && m.yTicks.map((t) => (
        <ChartLabel key={t} x={x0 - TICK_GAP} y={y(t)} anchor="end" w={m.yAxisWidth}>
          {yText(t)}
        </ChartLabel>
      ))}
      {/* X ticks: weekday over date ("Thu" / "9"), the highlighted day in full white. */}
      {m.xTicks.map((k) => {
        const t = tick(k);
        return (
          <ChartLabel key={k} x={xs[keys.indexOf(k)]} y={y1 + TICK_GAP} top lines={2} w={56} className={t.on ? "font-bold leading-[15px] text-foreground" : "leading-[15px]"}>
            {t.text}
          </ChartLabel>
        );
      })}

      {m.showAvg && <Pill x={2} y={y(p.average!)} text="AVG." fill={c.foreground} color={c.background} />}

      {/* Each column's value over it (bars: the bar's colour; a stack's total: the text colour). */}
      {(p.chart === "stack" || p.chart === "bars") && m.labelled && !m.faint &&
        rows.map((r, i) => (r.value === null ? null : (
          <ChartLabel key={r.key} x={xs[i]} y={y(r.value) - 13} className="font-bold" color={p.chart === "bars" ? textOf(fillOf(r.value)) : c.foreground}>
            {r.text}
          </ChartLabel>
        )))}
      {/* A line's labels: W over every point, M on the last one only. */}
      {p.chart === "line" && !m.faint && p.range === "w" && rows.map((r, i) => (r.value === null ? null : <ChartLabel key={r.key} x={xs[i]} y={y(r.value) - 18} className="font-bold" color={single} halo={halo}>{r.text}</ChartLabel>))}
      {p.chart === "line" && !m.faint && p.range === "m" && m.last >= 0 && (
        <ChartLabel x={lastX + 9} y={y(rows[m.last].value!) - 14} anchor="start" className="font-bold" color={single} halo={halo}>{rows[m.last].text}</ChartLabel>
      )}
      {/* Each day the lower line labels under its point and the upper over it, so the two never collide. */}
      {pair && p.range === "w" &&
        pair.map((s, k) =>
          rows.map((r, i) => {
            const v = r.parts?.[s.key];
            if (v == null) return null;
            const other = r.parts?.[pair[1 - k].key];
            const below = other != null && (v < other || (v === other && k === 0));
            return <ChartLabel key={`${s.key}-${r.key}`} x={xs[i]} y={y(v) + (below ? 16 : -14)} className="font-bold" color={css(partColor(s.key))} halo={halo}>{fmt(v)}</ChartLabel>;
          }),
        )}
      {/* Time in bed: bed time over the bar, wake time under it. */}
      {range && rows.map((r, i) => (r.span ? (
        <ChartLabel key={r.key} x={xs[i]} y={y(r.span[0]) - 11} w={48} className="text-[11px] font-bold" color={single}>{clockOf(r.parts!.bed)}</ChartLabel>
      ) : null))}
      {range && rows.map((r, i) => (r.span ? (
        <ChartLabel key={`w${r.key}`} x={xs[i]} y={y(r.span[1]) + 11} w={48} className="text-[11px] font-bold" color={single}>{clockOf(r.parts!.wake)}</ChartLabel>
      ) : null))}
      {/* 6M segments: the month's value above its level, the change under it, when the segment is wide enough. */}
      {segs.map((s) =>
        s.x2 - s.x1 < 34 ? null : (
          <Group key={s.month}>
            <ChartLabel x={s.mid} y={s.cy - 14} w={s.x2 - s.x1} className="text-[13px] font-bold text-foreground">{fmt(s.value)}</ChartLabel>
            {s.change !== null && s.change !== 0 && (
              <ChartLabel x={s.mid} y={s.cy + 14} w={s.x2 - s.x1} className="font-bold" color={SEG_COLOR[s.tone](c)} halo={halo}>
                {`${s.change > 0 ? "+" : ""}${s.change}%`}
              </ChartLabel>
            )}
          </Group>
        ),
      )}
    </>
  );
}

const SEG_COLOR = { good: (c: Palette) => c.optimal, bad: (c: Palette) => c.warning, neutral: (c: Palette) => c.foreground };

/** Everything the plot needs in pixels: the box, the scales, the column centres, the line paths and the month segments. */
function geometry(m: Model, chart: TrendViewChartProps["chart"], segments: TrendViewChartProps["segments"], direction: GoodDirection, width: number, height: number) {
  const { rows, keys, pair } = m;
  // The plot box (Recharts: the margins, then the axes' own room).
  const x0 = m.margin.left + m.yAxisWidth;
  const x1 = width - m.margin.right;
  const y0 = m.margin.top;
  const y1 = height - m.margin.bottom - m.xAxisHeight;
  // The clock axis runs backwards: bed time at the top.
  const y = chart === "range" ? linearScale(m.domain, [y0, y1]) : linearScale(m.domain, [y1, y0]);
  const { step, centers: xs } = bandCenters(rows.length, x0, x1, 0.1);
  const pointsOf = (pick: (i: number) => number | null | undefined) => rows.map((_, i) => ({ x: xs[i], y: pick(i) == null ? null : y(pick(i)!) }));
  const daily = pointsOf((i) => rows[i].value);
  const draws = {
    line: linePath(daily, "linear"),
    area: areaPath(daily, y1, "linear"),
    top: Math.min(y1, ...rows.flatMap((r) => (r.value === null ? [] : [y(r.value)]))),
    pair: pair?.map((s) => linePath(pointsOf((i) => rows[i].parts?.[s.key]), "linear")),
  };
  // A month spans the columns inside it; categories are the bars' `from` days.
  const segs = (m.six ? (segments ?? []) : []).flatMap((s) => {
    const idx = keys.flatMap((k, i) => (k >= s.from && k <= s.to ? [i] : []));
    if (s.value === null || !idx.length) return [];
    const [a, b] = [x0 + step * idx[0], x0 + step * (idx.at(-1)! + 1)];
    return [{ month: s.month, value: s.value, change: s.change, x1: a, x2: b, mid: (a + b) / 2, cy: y(s.value), tone: s.change === null || s.change === 0 ? ("neutral" as const) : deltaTone(direction, s.change, 0).tone }];
  });
  return { x0, x1, y0, y1, y, xs, step, bw: Math.min(MAX_BAR, step * 0.9), floor: y(Math.max(0, m.domain[0])), draws, segs };
}
