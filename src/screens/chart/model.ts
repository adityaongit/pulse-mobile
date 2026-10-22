// The chart explorer's pure model: series in explorer form (x = day index or minutes from local midnight), the range
// windows, the y axes for a visible window (fixed, from zero, fitted, or aligned to the primary grid for a compare
// series), the summary row and the scrub readout's text per point. No React Native imports, so vitest runs it.
import {
  alignedScale,
  barsWeight,
  clampStart,
  dayTickLevels,
  fullDayText,
  minuteText,
  minuteTickLevels,
  monthDayText,
  nearestValued,
  niceScale,
  rangeWindow,
  shortDayText,
  windowStats,
  type ExplorerRange,
  type TickLevel,
  type WindowStats,
} from "@/lib/chartmath";
import { i18n } from "@/i18n/config";
import { formatValue, isSymbolUnit, type FormatKey, unitLabel } from "@/lib/format";
import type { ChartColorBy, ChartDayVM, ChartDef, ChartSeriesVM, DayView } from "@/queries/chart";

export type Range = ExplorerRange | "day";
export const DAILY_RANGES: readonly ExplorerRange[] = ["w", "m", "6m", "1y", "all"];
const RANGE_WORD = { w: "W", m: "M", "6m": "SixM", "1y": "OneY" } as const;
/** The toggle's short label and its spoken form; the four shared ranges come from the ui namespace's trend keys. */
export const rangeLabel = (r: Range) => (r === "day" || r === "all" ? i18n.t(`trends:explorerRange.${r}`) : i18n.t(`ui:trend.label${RANGE_WORD[r]}`));
export const rangeAria = (r: Range) => (r === "day" || r === "all" ? i18n.t(`trends:explorerAria.${r}`) : i18n.t(`ui:trend.aria${RANGE_WORD[r]}`));

/** The `r` param: a known range, `day` only for a metric with a day view; else `m` (or `day` for a day-only view). */
export function parseRange(raw: string | undefined, hasDay: boolean): Range {
  if (raw === "day") return hasDay ? "day" : "m";
  return raw && (DAILY_RANGES as readonly string[]).includes(raw) ? (raw as ExplorerRange) : "m";
}

export type Mark = "bar" | "line";
export type SeriesColor = ChartColorBy | "zones";

/** One series as the explorer draws it. `xs` ascending; a null y is a gap (or skipped, for a sparse series). */
export type Series = {
  key: string;
  label: string;
  unit?: string;
  format: FormatKey;
  colorBy: SeriesColor;
  mark: Mark;
  sparse: boolean;
  /** A fixed y domain (band and stress metrics). */
  fixed?: [number, number];
  /** A line whose axis starts at zero, like bars (Day Strain builds up from nothing). */
  zero?: boolean;
  /** A running total (Day Strain so far): the window's numbers are where it stood and what it gained, not a mean. */
  cumulative?: boolean;
  xs: number[];
  ys: (number | null)[];
  /** Per point: today's running total of a metric that accrues through the day (drawn faded, kept out of stats). */
  partial?: boolean[];
};

/** A daily metric: x is the index into `vm.days`. */
export function dailySeries(def: ChartDef, vm: ChartSeriesVM): Series {
  return {
    key: def.key,
    label: def.label,
    ...(def.unit && { unit: def.unit }),
    format: def.format,
    colorBy: def.colorBy,
    mark: def.mark,
    sparse: !!def.sparse,
    ...(def.domain && { fixed: def.domain }),
    xs: vm.days.map((_, i) => i),
    ys: vm.values,
    partial: vm.partial,
  };
}

/** `other`'s values on `primary`'s days (each by date; a day `other` lacks is a gap). */
export function alignDaily(primary: ChartSeriesVM, other: ChartSeriesVM): (number | null)[] {
  const at = new Map<string, number | null>();
  other.days.forEach((d, i) => at.set(d, other.values[i]));
  return primary.days.map((d) => at.get(d) ?? null);
}

export const DAY_COLOR: Record<DayView, SeriesColor> = { hr: "zones", strain: "strain", stress: "stress", energy: "band", sleep: "single" };
const DAY_FIXED: Partial<Record<DayView, [number, number]>> = { stress: [0, 100], energy: [0, 100] };

/** A day view: x is minutes from local midnight. */
export function daySeries(vm: ChartDayVM, label: string, unit: string | undefined, format: FormatKey): Series {
  return {
    key: vm.view,
    label,
    ...(unit && { unit }),
    format,
    colorBy: DAY_COLOR[vm.view],
    mark: "line",
    sparse: vm.view === "energy",
    ...(DAY_FIXED[vm.view] && { fixed: DAY_FIXED[vm.view] }),
    ...(vm.view === "strain" && { zero: true, cumulative: true }),
    xs: vm.xs,
    ys: vm.ys,
  };
}

// --- Day views: what sits beside each, and what the header says it draws ---

/** The day views that share a clock and can sit on one chart, with the metric that opens each. */
export const DAY_COMPARE: readonly { view: DayView; key: string }[] = [
  { view: "hr", key: "avg_hr" },
  { view: "strain", key: "strain" },
  { view: "stress", key: "stress" },
  { view: "energy", key: "energy" },
];

/** What a day view draws beside it unless told otherwise: the day's heart rate under Strain, stress and the Energy Bank. */
export const DAY_DEFAULT_COMPARE: Partial<Record<DayView, DayView>> = { strain: "hr", stress: "hr", energy: "hr" };

/** The `compare` param that turns a day view's default compare off. */
export const NO_COMPARE = "none";

/**
 * The day view drawn beside `view`: the one picked (the compare param's metric's day view) when it is another
 * clock-sharing view, nothing when the compare was turned off, else the view's default. The night stands alone.
 */
export function dayCompareView(view: DayView, picked: DayView | "none" | null): DayView | null {
  if (view === "sleep" || picked === NO_COMPARE) return null;
  if (picked && picked !== view && DAY_COMPARE.some((x) => x.view === picked)) return picked;
  return DAY_DEFAULT_COMPARE[view] ?? null;
}

/** The header's line under the metric's name: what its day view draws, and what sits beside it. Short enough for two lines. */
export function dayWhy(view: DayView, metric: string, compare: DayView | null): string {
  if (view === "sleep") return i18n.t("trends:dayWhy.sleep");
  const name = view !== "hr" ? view : metric === "rhr" ? "hrResting" : metric === "avg_hr" ? "hrAverage" : metric === "workouts" ? "hrWorkouts" : "hr";
  return compare ? i18n.t(`trends:dayWhy.${name}With`, { what: i18n.t(`trends:dayNoun.${compare}`) }) : i18n.t(`trends:dayWhy.${name}`);
}

/** The labelled line a heart-rate day draws for its metric: the day's average for Average heart rate, else its resting heart rate. */
export function dayReference(metric: string, refs: ChartDayVM["refs"]): { y: number; label: string; name: string } | null {
  if (metric === "avg_hr") return refs.average !== null ? { y: refs.average, label: i18n.t("trends:dayRef.dayAverage"), name: i18n.t("trends:dayRef.nameDayAverage") } : null;
  return refs.resting !== null ? { y: refs.resting, label: i18n.t("trends:dayRef.restingHr"), name: i18n.t("trends:dayRef.nameRestingHr") } : null;
}

/** The stage names (getters, so they follow the language in use). */
export const STAGE_NAME = {
  get awake() { return i18n.t("ui:hypnogram.awake"); },
  get rem() { return i18n.t("ui:hypnogram.rem"); },
  get light() { return i18n.t("ui:hypnogram.light"); },
  get deep() { return i18n.t("ui:hypnogram.deep"); },
};

/** Per point of a night: the stage it falls in and that stretch's times ("REM · 02:14–02:37"); before bed or after waking, that. */
export function stageNotes(xs: readonly number[], stages: ChartDayVM["stages"], bed: number | null, wake: number | null): string[] {
  const sorted = [...stages].sort((a, b) => a.from - b.from);
  const froms = sorted.map((s) => s.from);
  return xs.map((x) => {
    if (bed !== null && x < bed) return i18n.t("trends:note.beforeSleep");
    if (wake !== null && x >= wake) return i18n.t("trends:note.afterWaking");
    const g = sorted[lastAtOrBefore(froms, x)];
    return g && x < g.to ? i18n.t("trends:note.stageSpan", { stage: STAGE_NAME[g.stage], from: minuteText(g.from), to: minuteText(g.to) }) : "";
  });
}

/** Per point of a running total: what it gained over the `window` minutes before ("+1.2 in the last hour"). */
export function gainNotes(series: Series, window = 60): string[] {
  return series.xs.map((x, i) => {
    const y = series.ys[i];
    if (y === null) return "";
    const before = runningAt(series, x - window) ?? 0;
    const gain = y - before;
    return gain >= 0.05 ? i18n.t("trends:note.gainedHour", { gain: formatValue(series.format, gain) }) : i18n.t("trends:note.noChangeHour");
  });
}

/** A stretch's length, short: "42 min", "1 h 5 min", "2 h". */
export function lengthText(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return !h ? `${r} min` : r ? `${h} h ${r} min` : `${h} h`;
}

/** Per point: the workout it falls in, with its length ("Run · 42 min"); null outside every workout. */
export function workoutNotes(xs: readonly number[], spans: ChartDayVM["spans"]): (string | null)[] {
  const workouts = spans.filter((s) => s.kind === "workout");
  return xs.map((x) => {
    const w = workouts.find((s) => x >= s.from && x <= s.to);
    return w ? i18n.t("trends:note.workoutLength", { label: w.label, length: lengthText(w.to - w.from) }) : null;
  });
}

/** Per point: whether it falls inside a workout (the workouts day view draws those minutes in full and the rest quiet). */
export const inWorkouts = (xs: readonly number[], spans: ChartDayVM["spans"]): boolean[] => {
  const workouts = spans.filter((s) => s.kind === "workout");
  return xs.map((x) => workouts.some((s) => x >= s.from && x <= s.to));
};

/** The window that frames a day's workouts with an hour either side, inside the extent; null without any. */
export function workoutWindow(spans: ChartDayVM["spans"], extent: { min: number; max: number }): { start: number; span: number } | null {
  const workouts = spans.filter((s) => s.kind === "workout" && s.to > extent.min && s.from < extent.max);
  if (!workouts.length) return null;
  const a = Math.min(...workouts.map((s) => s.from)) - 60;
  const b = Math.max(...workouts.map((s) => s.to)) + 60;
  const span = Math.min(extent.max - extent.min, b - a);
  return { start: clampStart(a, span, extent.min, extent.max), span };
}

/** Index of the last entry of ascending `xs` at or before `x`; -1 when there is none. */
function lastAtOrBefore(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** A running total's value at x: its last valued point at or before x; null before its first point. */
function runningAt(series: Series, x: number): number | null {
  for (let i = lastAtOrBefore(series.xs, x); i >= 0; i--) if (series.ys[i] !== null) return series.ys[i];
  return null;
}

/**
 * A running total over [from, to]: where it stood at the window's start (0 before its first point: nothing had
 * accrued) and end, and what it gained in between. Null throughout when the window ends before the total starts.
 */
export function runningStats(series: Series, from: number, to: number): { start: number | null; end: number | null; gained: number | null } {
  const end = runningAt(series, to);
  if (end === null) return { start: null, end: null, gained: null };
  const start = runningAt(series, from) ?? 0;
  return { start, end, gained: end - start };
}

// --- Text ---

/** The unit after a value: "%" tight, words after a space. */
export const unitText = (unit?: string) => (!unit ? "" : isSymbolUnit(unit) ? unit : ` ${unitLabel(unit)}`);

/** "72 bpm", "64%", "--". */
export const valueText = (v: number | null | undefined, format: FormatKey, unit?: string) => {
  const s = formatValue(format, v);
  return s === "--" ? s : `${s}${unitText(unit)}`;
};

/** A signed difference in the metric's own format: "+4 bpm", "−1.2 kg". */
export function deltaText(d: number, format: FormatKey, unit?: string) {
  const s = formatValue(format, Math.abs(d));
  const zero = Number(s.replace(/[^\d.]/g, "")) === 0;
  return `${zero ? "±" : d > 0 ? "+" : "−"}${s}${unitText(unit)}`;
}

export type NoteBasis = {
  baseline?: { mean: number; sd: number } | null;
  goal?: number | null;
  average?: number | null;
  /** A named line the value is read against ("resting HR"): the difference from it. */
  reference?: { y: number; name: string } | null;
};

/** The readout's last line: against a named reference, the normal range, the goal, or the visible average (in that order of preference). */
export function noteFor(v: number | null, format: FormatKey, unit: string | undefined, basis: NoteBasis): string {
  if (v === null) return "";
  const { baseline, goal, average, reference } = basis;
  if (reference) return i18n.t("trends:note.vsReference", { delta: deltaText(v - reference.y, format, unit), name: reference.name });
  if (baseline) {
    if (v > baseline.mean + baseline.sd) return i18n.t("trends:note.aboveRange");
    if (v < baseline.mean - baseline.sd) return i18n.t("trends:note.belowRange");
    return i18n.t("trends:note.withinRange");
  }
  if (goal != null) return v >= goal ? i18n.t("trends:note.goalMet") : i18n.t("trends:note.toGoal", { amount: `${formatValue(format, goal - v)}${unitText(unit)}` });
  if (average != null) {
    const d = v - average;
    return formatValue(format, Math.abs(d)) === formatValue(format, 0) ? i18n.t("trends:note.atAverage") : i18n.t("trends:note.vsAverage", { delta: deltaText(d, format, unit) });
  }
  return "";
}

/** A day view's clock time: "14:05", and the day's end (its last minute's close) "24:00", never the next "00:00". */
export const dayClock = (x: number) => (Math.round(x) === 1440 ? "24:00" : minuteText(x));

/** The date or time of each point: "Mon, Sep 28" (with the year when it isn't this year's), or "14:05". */
export function pointLabels(mode: "daily" | "day", xs: readonly number[], days: readonly string[] | null, today: string): string[] {
  if (mode === "day" || !days) return xs.map(dayClock);
  const year = today.slice(0, 4);
  return days.map((d) => (d.slice(0, 4) === year ? shortDayText(d) : `${shortDayText(d)}, ${d.slice(0, 4)}`));
}

/** The visible window in words: "Sep 3 – Oct 7" (years when they differ from today's), or "06:00 – 14:30" (a day's end "24:00"). */
export function windowText(mode: "daily" | "day", from: number, to: number, days: readonly string[] | null, today: string): string {
  if (mode === "day" || !days) return `${minuteText(from)} – ${dayClock(to)}`;
  const a = days[Math.max(0, Math.min(days.length - 1, Math.ceil(from)))];
  const b = days[Math.max(0, Math.min(days.length - 1, Math.floor(to)))];
  if (!a || !b) return "";
  const year = today.slice(0, 4);
  const fmt = (d: string) => (d.slice(0, 4) === year && a.slice(0, 4) === b.slice(0, 4) ? monthDayText(d) : fullDayText(d));
  return a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
}

// --- Windows and axes ---

/** The x window a range shows: daily ranges end on day index `end`; the day view and All show everything. */
export function windowFor(range: Range, series: Series, end: number): { start: number; span: number } {
  if (range === "day") {
    const lo = series.xs[0] ?? 0;
    const hi = series.xs[series.xs.length - 1] ?? lo + 60;
    return { start: lo, span: Math.max(60, hi - lo) };
  }
  return rangeWindow(range, end, series.xs.length);
}

/** The full x extent the viewport may pan across, and the closest zoom. */
export function extentOf(mode: "daily" | "day", series: Series, from?: number, to?: number): { min: number; max: number; minSpan: number } {
  if (mode === "daily") return { min: -0.5, max: Math.max(0, series.xs.length - 1) + 0.5, minSpan: 4 };
  const lo = from ?? series.xs[0] ?? 0;
  const hi = to ?? series.xs[series.xs.length - 1] ?? lo + 60;
  return { min: lo, max: Math.max(hi, lo + 60), minSpan: 20 };
}

export type Domain = { lo: number; hi: number; ticks: number[] };

/** Evenly spaced ticks across a fixed domain (bands read best on their own cut points: 0 / 33 / 67 / 100). */
export function fixedDomain(lo: number, hi: number, n: number): Domain {
  const k = Math.max(1, n - 1);
  return { lo, hi, ticks: Array.from({ length: k + 1 }, (_, i) => Math.round((lo + ((hi - lo) * i) / k) * 1e6) / 1e6) };
}

/**
 * The primary y axis for the visible window [from, to]: a fixed domain as is; bars from zero; a line fitted to the
 * visible values. `extra` values (the goal, the normal range) are kept in view.
 */
export function yDomain(series: Series, from: number, to: number, opts: { bars: boolean; extra?: (number | null | undefined)[]; count?: number }): Domain {
  const count = opts.count ?? 5;
  if (series.fixed) return fixedDomain(series.fixed[0], series.fixed[1], series.fixed[1] === 3 ? 4 : count);
  const s = windowStats(series.xs, series.ys, from, to);
  const extra = (opts.extra ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const all = windowStats(series.xs, series.ys, -Infinity, Infinity);
  const lo = Math.min(...(s.min !== null ? [s.min] : all.min !== null ? [all.min] : [0]), ...extra);
  const hi = Math.max(...(s.max !== null ? [s.max] : all.max !== null ? [all.max] : [1]), ...extra);
  return niceScale(lo, hi, count, (opts.bars || !!series.zero) && lo >= 0);
}

/** The compare series' axis for the visible window, its ticks on the primary's grid rows (`n` of them). */
export function compareDomain(series: Series, from: number, to: number, n: number): Domain {
  if (series.fixed) return fixedDomain(series.fixed[0], series.fixed[1], n);
  const s = windowStats(series.xs, series.ys, from, to);
  const all = windowStats(series.xs, series.ys, -Infinity, Infinity);
  const lo = s.min ?? all.min ?? 0;
  const hi = s.max ?? all.max ?? 1;
  return alignedScale(lo, hi, n);
}

/** Whether a series draws bars over a window `span` wide (the crossfade's midpoint). */
export const drawsBars = (series: Series, span: number) => series.mark === "bar" && barsWeight(span) >= 0.5;

/** Min, max and mean over the visible window. */
/** The window's stats; today's running total ("so far") isn't a day's value yet, so it stays out of them. */
export const summaryOf = (series: Series, from: number, to: number): WindowStats =>
  windowStats(series.xs, series.partial ? series.ys.map((y, i) => (series.partial![i] ? null : y)) : series.ys, from, to);

/** Tick levels for the x axis. */
export function levelsFor(mode: "daily" | "day", days: readonly string[] | null, from: number, to: number): TickLevel[] {
  if (mode === "daily" && days) return dayTickLevels(days);
  // A day's last tick is its end, 24:00.
  return minuteTickLevels(from, to).map((l) => ({ ...l, ticks: l.ticks.map((t) => (Math.round(t.x) === 1440 ? { ...t, text: "24:00" } : t)) }));
}

/**
 * For each primary point, the index of the compare point shown beside it in the readout: the same day (daily), or
 * the nearest valued minute within `maxGap` minutes (day views sample at different rates); -1 for none.
 */
export function compareIndex(mode: "daily" | "day", primary: Series, compare: Series, maxGap = 10): number[] {
  if (mode === "daily") return primary.xs.map((_, i) => (i < compare.ys.length && compare.ys[i] !== null ? i : -1));
  return primary.xs.map((x) => nearestValued(compare.xs, compare.ys, x, maxGap));
}
