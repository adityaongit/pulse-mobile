import { formatDay } from "./format";
import { addDays } from "./url";

// The Trend View's arithmetic (spec §11 R29): period windows, the relative change, 6M month segments, weekly
// totals, the breakdown counts and the verdict sentence. Pure, so the query and the tests share it.

export const TREND_VIEW_RANGES = ["w", "m", "6m"] as const;
export type TrendViewRange = (typeof TREND_VIEW_RANGES)[number];

/** Daily metrics average their days; activity-time metrics (zones, strength) total each week. */
export type TrendAgg = "daily" | "weekly";

/** Days in a window. Weekly totals use whole weeks (4 and 26), as the reference app's "MAR 19 - APR 15" does. */
export function windowDays(range: TrendViewRange, agg: TrendAgg = "daily") {
  if (range === "w") return 7;
  if (range === "m") return agg === "weekly" ? 28 : 30;
  return 182;
}

export const parseTrendRange = (raw: string | string[] | undefined): TrendViewRange => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (TREND_VIEW_RANGES as readonly string[]).includes(v ?? "") ? (v as TrendViewRange) : "m";
};

/** `?p=`: whole periods back from the latest one (0 = the period ending on `end`). */
export const parseOffset = (raw: string | string[] | undefined) => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : 0;
};

/** The window `offset` periods before the one ending on `end`, inclusive. */
export function periodWindow(end: string, range: TrendViewRange, offset = 0, agg: TrendAgg = "daily") {
  const n = windowDays(range, agg);
  const to = addDays(end, -offset * n);
  return { from: addDays(to, -(n - 1)), to };
}

/** "Mar 17 - Apr 15, 26"; the first date carries its own year when the window crosses one ("Oct 18, 25 - …"). */
export function periodLabel(from: string, to: string) {
  const md = (d: string) => formatDay(d, { month: "short", day: "numeric" });
  const yy = (d: string) => d.slice(2, 4);
  return `${md(from)}${yy(from) === yy(to) ? "" : `, ${yy(from)}`} - ${md(to)}, ${yy(to)}`;
}

/** Whole-percent change of `now` against `prior`; null when there is no prior or it is zero with a non-zero now. */
export function relativeChange(now: number | null, prior: number | null) {
  if (now === null || prior === null) return null;
  if (prior === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prior) / Math.abs(prior)) * 100);
}

export type DayValue = { day: string; value: number | null };

/** One Trend View column: a day, or a week (`from` < `to`) for weekly totals. */
export type TrendViewBar = { from: string; to: string; value: number | null; provisional?: boolean; parts?: Record<string, number> | null };

export const mean = (xs: readonly (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Sums per 7-day week, oldest first, the last week ending on the last day. A week with no values is null. */
export function weeklyTotals(points: readonly DayValue[]) {
  const out: { from: string; to: string; value: number | null }[] = [];
  for (let end = points.length; end > 0; end -= 7) {
    const week = points.slice(Math.max(0, end - 7), end);
    const vs = week.flatMap((p) => (p.value === null ? [] : [p.value]));
    out.unshift({ from: week[0].day, to: week.at(-1)!.day, value: vs.length ? vs.reduce((a, b) => a + b, 0) : null });
  }
  return out;
}

export type MonthSegment = { month: string; from: string; to: string; value: number | null; change: number | null };

/** 6M: one segment per calendar month, its average (or mean weekly total) and the change from the month before. */
export function monthSegments(points: readonly DayValue[], agg: TrendAgg = "daily"): MonthSegment[] {
  const months = new Map<string, DayValue[]>();
  for (const p of points) months.set(p.day.slice(0, 7), [...(months.get(p.day.slice(0, 7)) ?? []), p]);
  const segs: MonthSegment[] = [];
  for (const [month, ps] of months) {
    const vs = ps.flatMap((p) => (p.value === null ? [] : [p.value]));
    // A month's weekly total is its daily mean times seven, so a part-month compares fairly with a whole one.
    const value = vs.length ? (agg === "weekly" ? (vs.reduce((a, b) => a + b, 0) / ps.length) * 7 : vs.reduce((a, b) => a + b, 0) / vs.length) : null;
    segs.push({ month, from: ps[0].day, to: ps.at(-1)!.day, value, change: relativeChange(value, segs.at(-1)?.value ?? null) });
  }
  return segs;
}

/** A breakdown band: values at or above `min` (and below the next band's) count here. Listed best/highest first. */
export type BreakdownBand = { key: string; label: string; min: number };

/** How many days fall in each band. */
export function bandCounts<B extends BreakdownBand>(values: readonly (number | null)[], bands: readonly B[]) {
  const counts = bands.map((b) => ({ ...b, count: 0 }));
  for (const v of values) {
    if (v === null) continue;
    const hit = counts.find((b) => v >= b.min);
    if (hit) hit.count++;
  }
  return counts;
}

const WORD: Record<TrendViewRange, { this: string; prior: string }> = {
  w: { this: "this week", prior: "previous 7-day" },
  m: { this: "this month", prior: "previous 30-day" },
  "6m": { this: "over this period", prior: "previous 6-month" },
};

const WEEKS: Record<TrendViewRange, string> = { w: "this week", m: "over these four weeks", "6m": "over this period" };
const WEEKS_PRIOR: Record<TrendViewRange, string> = { w: "previous 7-day total", m: "previous four-week average", "6m": "previous 6-month average" };

/**
 * The one-sentence verdict. `typical` (the normal range) wins for vitals on W, as the reference app words RHR;
 * otherwise the change against the prior period decides: under 1% reads "consistent with".
 */
export function verdict(o: {
  label: string;
  range: TrendViewRange;
  agg: TrendAgg;
  now: number | null;
  prior: number | null;
  fmt: (v: number) => string;
  typical?: [number, number] | null;
}) {
  const { label, range, now, prior, fmt } = o;
  if (now === null) return `No ${label} data ${WORD[range].this}.`;
  if (o.typical && range === "w") {
    const [lo, hi] = o.typical;
    const where = now < lo ? "below" : now > hi ? "above" : "within";
    return `Your average ${label} during this 7-day period was ${where} its typical range (${fmt(lo)} - ${fmt(hi)}).`;
  }
  const change = prior === null ? null : relativeChange(now, prior);
  const cmp = change === 0 || change === null ? "consistent with" : change > 0 ? "above" : "below";
  if (o.agg === "weekly") {
    const lead = range === "w" ? `During this 7-day period, your total ${label} (${fmt(now)})` : `Your average weekly ${label} ${WEEKS[range]} (${fmt(now)})`;
    if (prior === null) return `${lead}.`;
    return `${lead} was ${cmp} your ${range === "w" ? "previous 7-day total" : WEEKS_PRIOR[range]} of ${fmt(prior)}.`;
  }
  const lead = `Your average ${label} ${WORD[range].this} (${fmt(now)})`;
  if (prior === null) return `${lead}.`;
  return `${lead} was ${cmp} your ${WORD[range].prior} average of ${fmt(prior)}.`;
}
