// Pure geometry for the Skia charts: scales, line and area paths (with gaps, as Recharts draws them), arcs. Everything
// returns plain numbers or SVG path strings, which Skia's <Path path="..."> takes, so it is all testable in Node.

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] };

/** Linear map from a domain to a pixel range (the range may run backwards: a y scale goes from the bottom up). */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + (v - d0) * k)) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** Evenly spaced centres for `n` category columns across [x0, x1] (Recharts' band scale): column width, centres. */
/**
 * A bar's width in its band, as Recharts sizes a single bar series: the band less `gap` (barCategoryGap, 10 % by
 * default) on each side, rounded to whole pixels above 1, capped at `max` (maxBarSize).
 */
export function barWidth(band: number, gap = 0.1, max = Infinity) {
  const size = band - 2 * band * gap;
  return Math.min(size > 1 ? Math.round(size) : size, max);
}

export function bandCenters(n: number, x0: number, x1: number, gapRatio = 0.1) {
  const step = (x1 - x0) / Math.max(1, n);
  return { step, centers: Array.from({ length: n }, (_, i) => x0 + step * (i + 0.5)), gap: step * gapRatio };
}

export type Point = { x: number; y: number | null };
export type Curve = "linear" | "monotone" | "stepAfter";

const f = (n: number) => +n.toFixed(2);

/** Contiguous runs of points with a y; a null y ends a run (Recharts' connectNulls={false}). */
export function segments(points: readonly Point[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null || !Number.isFinite(p.y)) {
      if (run.length) out.push(run);
      run = [];
    } else run.push({ x: p.x, y: p.y });
  }
  if (run.length) out.push(run);
  return out;
}

const sign = (x: number) => (x < 0 ? -1 : 1);
// d3-shape's curveMonotoneX (Steffen's method), which is what Recharts' type="monotone" draws.
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}
const slope2 = (x0: number, y0: number, x1: number, y1: number, t: number) => {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
};

/** One run as path commands, starting with M. */
function runPath(run: { x: number; y: number }[], curve: Curve): string {
  const [first, ...rest] = run;
  let d = `M${f(first.x)},${f(first.y)}`;
  if (curve === "stepAfter") {
    let prev = first;
    for (const p of rest) {
      d += `L${f(p.x)},${f(prev.y)}L${f(p.x)},${f(p.y)}`;
      prev = p;
    }
    return d;
  }
  if (curve === "linear" || run.length < 3) {
    for (const p of rest) d += `L${f(p.x)},${f(p.y)}`;
    return d;
  }
  const n = run.length;
  const t = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) t[i] = slope3(run[i - 1].x, run[i - 1].y, run[i].x, run[i].y, run[i + 1].x, run[i + 1].y);
  t[0] = slope2(run[0].x, run[0].y, run[1].x, run[1].y, t[1]);
  t[n - 1] = slope2(run[n - 2].x, run[n - 2].y, run[n - 1].x, run[n - 1].y, t[n - 2]);
  for (let i = 1; i < n; i++) {
    const a = run[i - 1];
    const b = run[i];
    const dx = (b.x - a.x) / 3;
    d += `C${f(a.x + dx)},${f(a.y + dx * t[i - 1])},${f(b.x - dx)},${f(b.y - dx * t[i])},${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** A line through the points; each gap (null y) starts a new subpath. "" with nothing to draw. */
export function linePath(points: readonly Point[], curve: Curve = "linear"): string {
  return segments(points).map((r) => runPath(r, curve)).join("");
}

/** The filled area under the same line, down to `baseY`, one closed shape per run. */
export function areaPath(points: readonly Point[], baseY: number, curve: Curve = "linear"): string {
  return segments(points)
    .map((r) => `${runPath(r, curve)}L${f(r[r.length - 1].x)},${f(baseY)}L${f(r[0].x)},${f(baseY)}Z`)
    .join("");
}

/** A point on a circle; `deg` runs clockwise from 12 o'clock. */
export const polar = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.sin((deg * Math.PI) / 180), y: cy - r * Math.cos((deg * Math.PI) / 180) });

/** An arc on the circle of radius `r` from `fromDeg` to `toDeg`, clockwise (degrees clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const sweep = toDeg - fromDeg;
  if (sweep <= 0) return "";
  const a = polar(cx, cy, r, fromDeg);
  // A full turn cannot be one arc command (start = end): split it in two halves.
  const mid = polar(cx, cy, r, fromDeg + sweep / 2);
  const b = polar(cx, cy, r, toDeg);
  const large = sweep / 2 > 180 ? 1 : 0;
  return `M${f(a.x)},${f(a.y)}A${f(r)},${f(r)} 0 ${large} 1 ${f(mid.x)},${f(mid.y)}A${f(r)},${f(r)} 0 ${large} 1 ${f(b.x)},${f(b.y)}`;
}

/** Nearest index in ascending `xs` to `x` (the scrub cursor's snap). -1 for an empty list. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x) ? lo - 1 : lo;
}

/**
 * "Nice" ticks covering [lo, hi]: Recharts' getNiceTickValues (its default "auto" step, decimals allowed), which the
 * web's axes run with `tickCount`. The step is the rough step rounded up to 0.05 of its power of ten (0.1 for steps
 * from 1 to 10), the ticks pass through 0 when the range spans it, else through a multiple of the step near the middle,
 * and the step grows until `count` ticks cover the range. VO2 max 42.3 to 47.6 gives 42, 45, 48.
 */
export function evenTicks(lo: number, hi: number, count: number): number[] {
  if (lo > hi) [lo, hi] = [hi, lo];
  const n = Math.max(count, 2);
  // Ends that only differ past the step arithmetic's precision (float noise in a mean) are one value: a zero step draws no ticks.
  return exact(lo) === exact(hi) ? singleTicks(lo, n) : niceTicks(lo, hi, n, 0);
}

const exact = (v: number) => +v.toFixed(10);
const digitCount = (v: number) => (v === 0 ? 1 : Math.floor(Math.log10(Math.abs(v))) + 1);

/** Recharts' getAdaptiveStep: the rough step rounded up to 0.05 of its power of ten (0.1 from 1 to 10), plus `correction` of those. */
function adaptiveStep(rough: number, correction: number): number {
  const digits = digitCount(rough);
  const unit = 10 ** digits;
  const scale = digits !== 1 ? 0.05 : 0.1;
  return exact((Math.ceil(exact(rough / unit / scale)) + correction) * scale * unit);
}

function niceTicks(lo: number, hi: number, count: number, correction: number): number[] {
  const step = adaptiveStep((hi - lo) / (count - 1), correction);
  const mid = (lo + hi) / 2;
  const middle = lo <= 0 && hi >= 0 ? 0 : exact(mid - exact(mid % step));
  let below = Math.ceil(exact((middle - lo) / step));
  let up = Math.ceil(exact((hi - middle) / step));
  const have = below + up + 1;
  if (have > count) return niceTicks(lo, hi, count, correction + 1);
  if (have < count) {
    if (hi > 0) up += count - have;
    else below += count - have;
  }
  return Array.from({ length: below + up + 1 }, (_, i) => exact(middle + (i - below) * step));
}

/** Recharts' getTickOfSingleValue: one value, ticks a round step apart around it. */
function singleTicks(v: number, count: number): number[] {
  let step = 1;
  let middle = v;
  if (!Number.isInteger(v)) {
    if (Math.abs(v) < 1) {
      step = 10 ** (digitCount(v) - 1);
      middle = exact(Math.floor(v / step) * step);
    } else middle = Math.floor(v);
  } else if (v === 0) middle = Math.floor((count - 1) / 2);
  const half = Math.floor((count - 1) / 2);
  return Array.from({ length: count }, (_, i) => exact(middle + (i - half) * step));
}

/**
 * Ticks on a fixed numeric domain: Recharts' getTickValuesFixedDomain, which the web's axes use when the domain is
 * given as numbers. From `lo` by the adaptive step, then `hi` itself (Recharts' tickCount 4 on [40, 180]: 40, 90, 140, 180).
 */
export function ticksIn(lo: number, hi: number, count: number): number[] {
  if (lo > hi) [lo, hi] = [hi, lo];
  if (exact(lo) === exact(hi)) return [lo];
  const step = adaptiveStep((hi - lo) / (Math.max(count, 2) - 1), 0);
  const out: number[] = [];
  for (let v = lo; v < hi; v = exact(v + step)) out.push(v);
  return [...out, hi];
}

/** An axis tick as Recharts thins it: its x and the width of its text. */
export type AxisTick = { x: number; size: number };

// ponytail: an average Figtree advance (0.55 em) stands in for Recharts' DOM measurement of the tick text; it is
// within 3 % on dates and clock times. Measure real glyph advances if a label set ever thins differently.
/** A tick's text width as Recharts measures it (the axis's 12 px text). Recharts measures the raw value when the axis
 * has no tickFormatter (TrendChart's ISO dates), the formatted text when it has one. */
export const tickTextWidth = (text: string, fontSize = 12) => text.length * 0.55 * fontSize;

const fits = (x: number, size: number, lo: number, hi: number) => x - size / 2 >= lo && x + size / 2 <= hi;

/**
 * Recharts' interval="preserveStartEnd" (getTicksStart): the last tick is kept, pulled inside `end` if its text runs
 * past it; then from the first (pulled inside `start` likewise) each tick is kept when its text clears the one kept
 * before it by `gap` and the last one too. Returns the kept indices with the x to draw them at. `start` and `end` are
 * the chart's own edges (0 and its width), not the plot's: the web's axis labels may overhang the plot (00:00 centred
 * on the plot's left edge).
 */
export function preserveStartEnd(ticks: AxisTick[], start: number, end: number, gap: number): { index: number; x: number }[] {
  const n = ticks.length;
  if (!n) return [];
  const tail = ticks[n - 1];
  const tailX = Math.min(tail.x, end - tail.size / 2);
  const tailShown = fits(tailX, tail.size, start, end);
  const hi = tailShown ? tailX - (tail.size / 2 + gap) : end;
  const kept: { index: number; x: number }[] = [];
  let lo = start;
  for (let i = 0; i < n - 1; i++) {
    const t = ticks[i];
    const x = i === 0 ? Math.max(t.x, start + t.size / 2) : t.x;
    if (fits(x, t.size, lo, hi)) {
      kept.push({ index: i, x });
      lo = x + t.size / 2 + gap;
    }
  }
  return tailShown ? [...kept, { index: n - 1, x: tailX }] : kept;
}

/**
 * Recharts' interval="equidistantPreserveStart" (getEquidistantTicks): every k-th tick from the first, with the
 * smallest k at which no text runs into the one before it (by `gap`) or past the plot's right edge.
 */
export function equidistantPreserveStart(ticks: AxisTick[], start: number, end: number, gap: number): number[] {
  for (let step = 1; step <= ticks.length; step++) {
    let lo = start;
    let ok = true;
    for (let i = 0; i < ticks.length; i += step) {
      const t = ticks[i];
      if (i > 0 && !fits(t.x, t.size, lo, end)) {
        ok = false;
        break;
      }
      lo = t.x + t.size / 2 + gap;
    }
    if (ok) return ticks.flatMap((_, i) => (i % step === 0 ? [i] : []));
  }
  return [];
}
