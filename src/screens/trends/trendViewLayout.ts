// The Trend View chart's numbers, apart from any drawing: its y domain and ticks, the x ticks and the bar rows. Ported
// from pulse src/components/charts/TrendViewChart.tsx (the code that sat above the JSX) so they run once per data set,
// not per frame, and so Node can test them. Nothing here reads the theme or the width.
import type { GoodDirection } from "@/lib/bands";
import type { FormatKey } from "@/lib/format";
import type { MonthSegment, TrendViewBar, TrendViewRange } from "@/lib/trend";

export type ChartKind = "bars" | "line" | "stack" | "range" | "pair";
export type ColorBy = "band" | "strain" | "sleep" | "single" | "stress";

export type TrendViewChartProps = {
  label: string;
  bars: TrendViewBar[];
  /** `range`: bars from bed to wake on an inverted clock axis (`parts.bed`, `parts.wake` in minutes from midnight);
   * `pair`: two labelled lines, `series[0]` under `series[1]` (hours of sleep against sleep needed). */
  chart: ChartKind;
  range: TrendViewRange;
  colorBy: ColorBy;
  format: FormatKey;
  unit?: string;
  direction: GoodDirection;
  /** Stack parts, bottom first. */
  series?: readonly { key: string; label: string }[];
  domain?: [number, number];
  typical?: [number, number] | null;
  /** M bars: the dashed AVG line. */
  average?: number | null;
  /** 6M: one segment per month over the faint daily (or weekly) trace. */
  segments?: MonthSegment[] | null;
  /** The day whose column is highlighted (the selected day in Weekly Trends, the window's last day here). */
  selected?: string;
  /** Weekly Trends cards: shorter, no y axis. */
  compact?: boolean;
};

/** "21:00" from minutes after midnight (negative before it). */
export const clockOf = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

/** About four evenly spaced ticks on round steps (1, 2, 2.5 or 5 × 10ⁿ; clock steps for minutes) that cover `domain`. */
export function niceTicks([lo, hi]: [number, number], duration = false) {
  const raw = (hi - lo) / 3 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Minutes step on the clock: 15 and 30 minutes, then whole hours.
  const steps = duration ? [5, 10, 15, 30, 60, 120, 180, 240, 360] : [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = steps.find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  return Array.from({ length: Math.ceil((hi - start) / step) + 1 }, (_, i) => start + i * step);
}

/** The keys that carry an x label: 6M one per month (the first day from the 14th on), M every 7th from the end, else all. */
export function xTickKeys(keys: string[], range: TrendViewRange, weekly: boolean) {
  if (range === "6m") return keys.filter((k, i) => i === 0 || k.slice(0, 7) !== keys[i - 1].slice(0, 7)).map((k) => keys.find((x) => x.slice(0, 7) === k.slice(0, 7) && x.slice(8) >= "14") ?? k);
  if (range === "m" && !weekly) return keys.filter((_, i) => (keys.length - 1 - i) % 7 === 0);
  return keys;
}

export const colorOf = (colorBy: ColorBy, v: number, recoveryColor: (v: number) => string, css: Record<"strain" | "sleep" | "single", string>) =>
  colorBy === "band" ? recoveryColor(v) : colorBy === "strain" ? css.strain : colorBy === "sleep" ? css.sleep : css.single;

export type Row = TrendViewBar & { key: string; value: number | null; span: [number, number] | null; text: string; opacity: number };

export type Model = {
  rows: Row[];
  keys: string[];
  values: number[];
  six: boolean;
  weekly: boolean;
  labelled: boolean;
  pair: readonly { key: string; label: string }[] | null;
  /** The axis' own domain (the first and last tick, or the clock span for `range`). */
  domain: [number, number];
  yTicks: number[];
  xTicks: string[];
  showAvg: boolean;
  /** A faint daily trace under the month segments. */
  faint: boolean;
  last: number;
  summary: string;
  margin: { top: number; right: number; bottom: number; left: number };
  xAxisHeight: number;
  yAxisWidth: number;
  height: number;
};

export function buildModel(p: TrendViewChartProps, fmt: (v: number) => string): Model {
  const six = p.range === "6m";
  const weekly = p.bars.length > 0 && p.bars[0].from !== p.bars[0].to;
  const labelled = p.range === "w" || weekly;
  const rows: Row[] = p.bars.map((b) => ({
    ...b,
    key: b.from,
    opacity: b.provisional ? 0.45 : 1,
    text: b.value === null ? "" : `${fmt(b.value)}${p.unit === "%" ? "%" : ""}`,
    span: b.parts && p.chart === "range" ? [b.parts.bed, b.parts.wake] : null,
  }));
  const keys = rows.map((r) => r.key);
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  const pair = p.chart === "pair" && !six && p.series?.length === 2 ? p.series : null;
  const partVals = pair ? rows.flatMap((r) => pair.flatMap((s) => (r.parts?.[s.key] != null ? [r.parts[s.key]] : []))) : [];
  const segVals = (p.segments ?? []).flatMap((s) => (s.value === null ? [] : [s.value]));

  // Lines get a tight axis around the data and the typical range; bars stand on zero.
  const lineDomain = (): [number, number] => {
    const xs = [...values, ...partVals, ...segVals, ...(p.typical ?? [])];
    if (!xs.length) return [0, 1];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const pad = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.02, 1);
    // A pair labels its lower line under the points, so it keeps twice the room at the bottom.
    return [Math.max(0, Math.floor(lo - (p.chart === "pair" ? 2 : 1) * pad)), Math.ceil(hi + pad)];
  };
  const spans = rows.flatMap((r) => (r.span ? [r.span] : []));
  const rangeDomain: [number, number] = [
    Math.min(-180, ...spans.map((s) => Math.floor((s[0] - 60) / 240) * 240 + 60)),
    Math.max(780, ...spans.map((s) => Math.ceil((s[1] - 60) / 240) * 240 + 60)),
  ];
  const domain: [number, number] =
    p.chart === "range" ? rangeDomain : (p.domain ?? (p.chart === "line" || p.chart === "pair" || (six && !weekly) ? lineDomain() : [0, Math.max(1, ...values, ...segVals) * 1.15]));
  const niced = p.domain && p.domain[1] === 100 ? [0, 25, 50, 75, 100] : p.domain && p.domain[1] === 21 ? [0, 5, 10, 15, 21] : niceTicks(domain, p.format === "duration");
  const yTicks = p.chart === "range" ? Array.from({ length: Math.round((domain[1] - domain[0]) / 240) + 1 }, (_, i) => domain[0] + i * 240) : niced;

  const summary = values.length
    ? `${p.label}: ${values.length} ${weekly ? "weeks" : "days"} with data, from ${fmt(Math.min(...values))} to ${fmt(Math.max(...values))}.`
    : `No ${p.label} data in this period.`;

  return {
    rows,
    keys,
    values,
    six,
    weekly,
    labelled,
    pair,
    domain: p.chart === "range" ? domain : [niced[0], niced.at(-1)!],
    yTicks,
    xTicks: xTickKeys(keys, p.range, weekly),
    showAvg: p.range === "m" && !weekly && p.chart === "bars" && p.average != null,
    faint: six && p.chart !== "range",
    last: rows.findLastIndex((r) => r.value !== null),
    summary,
    margin: { top: labelled || p.chart === "range" ? 22 : 10, right: p.chart === "line" && p.range === "m" ? 24 : 6, bottom: p.chart === "range" || p.chart === "pair" ? 12 : 0, left: 0 },
    xAxisHeight: six ? 24 : 42,
    yAxisWidth: p.compact ? 0 : p.format === "duration" || p.chart === "range" || p.unit === "%" ? 46 : 38,
    height: p.compact ? 150 : 240,
  };
}
