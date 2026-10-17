// The chart explorer `/chart?metric=&r=&d=&compare=` (mobile only): any daily metric the Trends and metric screens
// know, plus the trend cards that live outside that catalogue (sleep efficiency and debt, restorative sleep, workout
// duration, SpO2, skin temperature, VO2 max, Pulse Age, Energy Bank), over the whole stored history; and the intraday
// views behind the day charts (heart rate, Day Strain as it builds, stress, Energy Bank, the night's stages and heart
// rate). Built from the same day rows and series as the screens' own queries, so every number matches the card it was
// opened from.
import { inUnits } from "@/lib/units";
import { timeline } from "@/core/engine/context";
import { addDays, fractionalYears } from "@/lib/time";
import { type FormatKey, type GoodDirection } from "./_lib";
import { type DayRow, dayStartOf, daySpans, exercisesBetween, finite, firstDay, loadDays, loadSeries, meanSd, ms, type QueryCtx, todayOf } from "./common";
import { strainCurve } from "./dayStrain";
import { getHeartRate, getStress } from "./health";
import { energyBankVM } from "./home";
import { STEP_TARGET } from "./metric";
import { getSleep } from "./sleep";
import { TREND_GROUPS, TREND_METRICS, type TrendGroup } from "./trends";

export type ChartColorBy = "band" | "strain" | "sleep" | "single" | "stress";
/**
 * The intraday view a metric opens on a single day: its own picture of the day, which the explorer overlays with the
 * day's heart rate (`hr`: the heart-rate metrics and workouts; `strain`: Day Strain building minute by minute).
 */
export type DayView = "hr" | "strain" | "stress" | "sleep" | "energy";

export type ChartDef = {
  key: string;
  label: string;
  group: TrendGroup;
  unit?: string;
  format: FormatKey;
  colorBy: ChartColorBy;
  direction: GoodDirection;
  /** The day's value from its row (absent for workouts, which come from the exercise table). */
  pick?: (r: DayRow) => number | null | undefined;
  provisional?: (r: DayRow) => boolean;
  /** Accrues through the day: today is drawn as a running total ("so far") and kept out of every average. */
  partialToday?: boolean;
  /** Bars (daily totals, scores) or a line (readings) when zoomed in to weeks. */
  mark: "bar" | "line";
  /** Readings on some days only (weight, VO2 max): the line joins them across the empty days. */
  sparse?: boolean;
  /** Shade the normal range (mean ± 1 σ of the last 90 days). */
  baseline?: boolean;
  /** A difference from a baseline (skin temperature): converts without a unit's offset (src/lib/units.ts). */
  deviation?: boolean;
  reference?: { y: number; label: string };
  /** A fixed y domain (band and stress metrics). */
  domain?: [number, number];
  /** The intraday view a single day of this metric opens. */
  day?: DayView;
  source?: "workouts";
};

const LINE = new Set(["hrv", "rhr", "resp", "weight", "body_fat", "avg_hr", "glucose", "core_temp"]);
const SPARSE = new Set(["weight", "body_fat", "glucose", "core_temp"]);
const BASELINE = new Set(["hrv", "rhr", "resp", "avg_hr", "glucose", "core_temp"]);
const DAY_OF: Record<string, DayView> = { rhr: "hr", avg_hr: "hr", strain: "strain", stress: "stress", sleep: "sleep", hours: "sleep", consistency: "sleep" };
const fixed = (colorBy: ChartColorBy): [number, number] | undefined => (colorBy === "band" ? [0, 100] : colorBy === "stress" ? [0, 100] : undefined);

const isSunday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

// Blood oxygen and skin temperature have their own entries below (one decimal, the signed skin key the chart cards open).
const OWN = new Set(["spo2", "skin"]);

/** Every metric the explorer charts, Trends' first (in its order), then the cards' own. */
export const CHART_METRICS: readonly ChartDef[] = [
  ...TREND_METRICS.filter((m) => !OWN.has(m.key)).map(
    (m): ChartDef => ({
      key: m.key,
      label: m.label,
      group: m.group,
      ...(m.unit && { unit: m.unit }),
      format: m.format,
      colorBy: m.colorBy,
      direction: m.direction,
      pick: m.pick,
      ...(m.deviation && { deviation: true }),
      ...(m.provisional && { provisional: m.provisional }),
      ...(m.partialToday && { partialToday: true }),
      mark: LINE.has(m.key) ? "line" : "bar",
      ...(SPARSE.has(m.key) && { sparse: true }),
      ...(BASELINE.has(m.key) && { baseline: true }),
      ...(m.key === "steps" && { reference: { y: STEP_TARGET, label: "7,000" } }),
      ...(fixed(m.colorBy) && { domain: fixed(m.colorBy) }),
      ...(DAY_OF[m.key] && { day: DAY_OF[m.key] }),
    }),
  ),
  { key: "calories", label: "Calories", group: "Activity", unit: "kcal", format: "grouped", colorBy: "single", direction: "neutral", pick: (r) => r.metrics?.calories, partialToday: true, mark: "bar" },
  { key: "workouts", label: "Workout duration", group: "Activity", format: "duration", colorBy: "strain", direction: "up", source: "workouts", partialToday: true, mark: "bar", day: "hr" },
  {
    key: "efficiency",
    label: "Sleep efficiency",
    group: "Recovery & sleep",
    unit: "%",
    format: "int",
    colorBy: "sleep",
    direction: "up",
    pick: (r) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null),
    mark: "line",
    day: "sleep",
  },
  {
    key: "restorative",
    label: "Restorative sleep",
    group: "Recovery & sleep",
    format: "duration",
    colorBy: "sleep",
    direction: "up",
    pick: (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null),
    mark: "bar",
    day: "sleep",
  },
  { key: "debt", label: "Sleep debt", group: "Recovery & sleep", unit: "h", format: "decimal1", colorBy: "sleep", direction: "down", pick: (r) => (r.sleep?.main ? r.sleep.debtMin / 60 : null), mark: "bar", day: "sleep" },
  { key: "energy", label: "Energy Bank", group: "Recovery & sleep", unit: "%", format: "int", colorBy: "band", direction: "up", pick: (r) => r.energyBank?.value, mark: "bar", domain: [0, 100], day: "energy" },
  { key: "spo2", label: "Blood oxygen", group: "Vitals", unit: "%", format: "decimal1", colorBy: "single", direction: "up", pick: (r) => r.metrics?.spo2Pct, mark: "line", baseline: true },
  { key: "skin_temp", label: "Skin temp (from baseline)", group: "Vitals", unit: "°C", format: "signed1", colorBy: "single", direction: "neutral", pick: (r) => r.recovery?.inputs.skinTempDev, mark: "line", baseline: true, deviation: true },
  { key: "vo2max", label: "VO2 max", group: "Vitals", unit: "ml/kg/min", format: "decimal1", colorBy: "single", direction: "up", pick: (r) => r.metrics?.vo2maxRun ?? r.metrics?.vo2maxDaily, mark: "line", sparse: true },
  {
    key: "pulse_age",
    label: "Pulse Age",
    group: "Body",
    format: "decimal1",
    colorBy: "single",
    direction: "down",
    // One result a week, at the ISO week's end (Pulse Age history's points).
    pick: (r) => (isSunday(r.day) && r.healthspan && r.healthspan.reason === null ? r.healthspan.pulseAge : null),
    mark: "line",
    sparse: true,
  },
];

/** The picker's sections, Trends' order, each with its metrics. */
export const CHART_GROUPS = TREND_GROUPS.map((group) => ({ group, metrics: CHART_METRICS.filter((m) => m.group === group) })).filter((g) => g.metrics.length > 0);

/** A metric as the explorer shows it: in the person's units (src/lib/units.ts), its unit and its values alike. */
export const chartDef = (key: string | undefined): ChartDef | null => {
  const def = CHART_METRICS.find((m) => m.key === key);
  return def ? inUnits(def) : null;
};

/** The day views' series names (the legend's and the readout's), units and formats. */
export const DAY_VIEW: Record<DayView, { label: string; unit?: string; format: FormatKey }> = {
  hr: { label: "Heart rate", unit: "bpm", format: "int" },
  strain: { label: "Day strain", unit: "%", format: "int" },
  stress: { label: "Stress", format: "int" },
  sleep: { label: "Night heart rate", unit: "bpm", format: "int" },
  energy: { label: "Energy Bank", unit: "%", format: "int" },
};

// ── Daily series ────────────────────────────────────────────────────────────

/** Up to five years back (the store keeps what the sync imported; most accounts hold months). */
const MAX_DAYS = 5 * 365 + 1;

export type ChartSeriesVM = {
  key: string;
  today: string;
  /** Every day from the first stored day to today, oldest first. */
  days: string[];
  values: (number | null)[];
  provisional: boolean[];
  /** Today's running total of a metric that accrues through the day: drawn, but not a day's value yet. */
  partial: boolean[];
  /** Mean ± 1 σ of the last 90 days, for metrics that shade a normal range. */
  baseline: { mean: number; sd: number } | null;
  reference: { y: number; label: string } | null;
};

export async function getChartSeries(key: string, ctx: QueryCtx): Promise<ChartSeriesVM> {
  const def = chartDef(key) ?? inUnits(CHART_METRICS[0]);
  const today = todayOf(ctx);
  const earliest = addDays(today, -(MAX_DAYS - 1));
  const first = (await firstDay(ctx)) ?? today;
  // At least a week, so W always has a full window.
  let from = first < earliest ? earliest : first;
  if (from > addDays(today, -6)) from = addDays(today, -6);
  const [rows, exs] = await Promise.all([loadDays(ctx, from, today), def.source === "workouts" ? exercisesBetween(ctx, from, today) : Promise.resolve([])]);
  const workoutMin = new Map<string, number>();
  for (const e of exs) workoutMin.set(e.day, (workoutMin.get(e.day) ?? 0) + (e.endTs - e.startTs) / 60);

  const days: string[] = [];
  const values: (number | null)[] = [];
  const provisional: boolean[] = [];
  const partial: boolean[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const r = rows.get(d);
    let v: number | null | undefined = null;
    if (def.source === "workouts") v = r?.s1 ? (workoutMin.get(d) ?? 0) : (workoutMin.get(d) ?? null);
    else if (r && def.pick) v = def.pick(r);
    days.push(d);
    values.push(finite(v) ? v : null);
    provisional.push(!!(r && def.provisional?.(r)));
    partial.push(!!def.partialToday && d === today && finite(v));
  }

  let baseline: ChartSeriesVM["baseline"] = null;
  if (def.baseline) {
    const recent = values.map((v, i) => (partial[i] ? null : v)).slice(-90).filter(finite);
    const { mean, sd } = meanSd(recent);
    if (mean !== null && sd !== undefined && recent.length >= 7) baseline = { mean, sd };
  }
  const reference = def.reference ?? (def.key === "pulse_age" ? { y: fractionalYears(ctx.profile.birthDate, today), label: "Your age" } : null);
  return { key: def.key, today, days, values, provisional, partial, baseline, reference };
}

// ── Intraday views ──────────────────────────────────────────────────────────

export type Stage = "awake" | "rem" | "light" | "deep";

export type ChartDayVM = {
  view: DayView;
  day: string;
  today: string;
  /** Local midnight of `day`, epoch ms: every x below is minutes from it (negative before midnight). */
  origin: number;
  /** The x extent shown, minutes. */
  from: number;
  to: number;
  xs: number[];
  ys: (number | null)[];
  /** The marked stretches: workouts, sleep and naps (minutes), in time order. */
  spans: { kind: "workout" | "sleep"; label: string; from: number; to: number }[];
  /** Heart-rate zones, ascending (hr view). */
  zones: { zone: number; label: string; min: number; max: number }[];
  /** The night's stages (sleep view), minutes. */
  stages: { stage: Stage; from: number; to: number }[];
  /** Bed and wake (sleep view), minutes. */
  bed: number | null;
  wake: number | null;
  /** Today: now, minutes. */
  now: number | null;
  /**
   * The day's values a heart-rate line is read against (hr view): its resting heart rate (Resting heart rate's own
   * value) and its average (Average heart rate's own value), each null when the day has none.
   */
  refs: { resting: number | null; average: number | null };
  /** A shaded range on the primary axis: the day's Strain Target (strain view). */
  band: { lo: number; hi: number } | null;
};

const toMin = (origin: number, t: number) => (t - origin) / 60_000;

export async function getChartDay(view: DayView, day: string, ctx: QueryCtx): Promise<ChartDayVM> {
  const today = todayOf(ctx);
  const origin = ms(dayStartOf(ctx, day));
  const m = (t: number) => toMin(origin, t);
  const base: ChartDayVM = { view, day, today, origin, from: 0, to: 1440, xs: [], ys: [], spans: [], zones: [], stages: [], bed: null, wake: null, now: null, refs: { resting: null, average: null }, band: null };
  const spansOf = (spans: { kind: "workout" | "sleep" | "nap"; label: string; start: number; end: number }[]) =>
    spans.map((s) => ({ kind: s.kind === "workout" ? ("workout" as const) : ("sleep" as const), label: s.label, from: m(s.start), to: m(s.end) })).sort((a, b) => a.from - b.from);

  if (view === "hr") {
    const [vm, rows] = await Promise.all([getHeartRate(day, ctx), loadDays(ctx, day, day)]);
    const row = rows.get(day);
    const spans = await daySpans(ctx, row, day, dayStartOf(ctx, day));
    const average = row?.extra.avg_hr;
    return {
      ...base,
      // A day the clocks went back has 25 hours: its last hour stays in view.
      to: Math.max(1440, m(vm.points.at(-1)?.t ?? 0)),
      xs: vm.points.map((p) => m(p.t)),
      ys: vm.points.map((p) => p.v),
      spans: spansOf(spans),
      zones: vm.zoneBands.map((z) => ({ zone: z.zone, label: z.label, min: z.min, max: z.max ?? vm.maxHr })),
      now: vm.isToday && vm.latest ? m(vm.latest.t) : null,
      refs: { resting: vm.restingHr, average: finite(average) ? average : null },
    };
  }
  if (view === "strain") {
    // Day Strain minute by minute, from the same samples and math as the day's Strain (dayStrain.ts).
    const start = dayStartOf(ctx, day);
    const end = dayStartOf(ctx, addDays(day, 1));
    const [rows, exercises, sessions] = await Promise.all([loadDays(ctx, day, day), ctx.store.allExercises(), ctx.store.allSessions()]);
    const row = rows.get(day);
    const s1 = row?.s1 ?? null;
    // Stage 1's labelling: the sleeps and workouts touching the day; the day's own workouts count their heart rate in full.
    const touching = <T extends { startTs: number; endTs: number }>(xs: T[]) => xs.filter((x) => x.endTs > start && x.startTs < end);
    const near = touching(sessions);
    const own = exercises.filter((e) => e.day === day).sort((a, b) => a.startTs - b.startTs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [hr, steps, segments] = await Promise.all([
      ctx.store.readHr(start, Math.max(end, ...own.map((e) => e.endTs))),
      ctx.store.readSteps(start, end),
      ctx.store.segmentsFor(near.map((s) => s.id)),
    ]);
    const tl = timeline({ sessions: near, segments, workouts: touching(exercises) });
    const inputs = s1 && { value: s1.engine?.strain?.value ?? null, maxHr: s1.engine?.strain?.maxHr ?? s1.maxHr, lastHrTs: s1.lastHrTs };
    const curve = strainCurve(hr, steps, tl, inputs, start, end, day === today, own);
    const spans = await daySpans(ctx, row, day, start);
    const target = row?.strainTarget;
    return {
      ...base,
      // A day the clocks went back has 25 hours: its Strain's last point (the day's Strain) stays in view.
      to: Math.max(1440, curve.xs.at(-1) ?? 0),
      xs: curve.xs,
      ys: curve.ys,
      spans: spansOf(spans),
      now: day === today && s1?.lastHrTs != null ? m(ms(s1.lastHrTs)) : null,
      band: target && target.reason === null ? { lo: target.low, hi: target.high } : null,
    };
  }
  if (view === "stress") {
    const vm = await getStress(day, ctx);
    const chart = vm.chart.value;
    const xs = chart?.points.map((p) => m(p.t)) ?? [];
    const now = chart?.now ? m(chart.now) : null;
    const from = xs[0] ?? 0;
    return {
      ...base,
      from,
      to: Math.max(from + 60, now ?? xs[xs.length - 1] ?? 1440),
      xs,
      ys: chart?.points.map((p) => p.v) ?? [],
      spans: spansOf(chart?.spans ?? []),
      now,
    };
  }
  if (view === "energy") {
    const [rows, series] = await Promise.all([loadDays(ctx, day, day), loadSeries(ctx, day, "energy_bank")]);
    const eb = energyBankVM(ctx, rows.get(day), day, day === today, series).value;
    if (!eb) return base;
    const xs = eb.curve.map((p) => m(p.t));
    const from = xs[0] ?? 0;
    return {
      ...base,
      from,
      to: Math.max(from + 60, xs[xs.length - 1] ?? 1440),
      xs,
      ys: eb.curve.map((p) => p.v),
      spans: eb.naps.map((n) => ({ kind: "sleep" as const, label: "Nap", from: m(n.start), to: m(n.end) })),
      now: day === today ? m(eb.until) : null,
    };
  }
  // The night: heart rate across the main sleep with its stages under it.
  const vm = await getSleep(day, ctx);
  const hr = vm.nightHr.value;
  const st = vm.stages?.value;
  const bed = hr?.bed ?? st?.bed ?? null;
  const wake = hr?.wake ?? st?.wake ?? null;
  const xs = hr?.points.map((p) => m(p.t)) ?? [];
  const lo = xs.length ? xs[0] : bed !== null ? m(bed) - 15 : 0;
  const hi = xs.length ? xs[xs.length - 1] : wake !== null ? m(wake) + 15 : 1440;
  return {
    ...base,
    from: lo,
    to: Math.max(hi, lo + 60),
    xs,
    ys: hr?.points.map((p) => p.v) ?? [],
    stages: st?.segments.map((s) => ({ stage: s.stage, from: m(s.start), to: m(s.end) })) ?? [],
    bed: bed !== null ? m(bed) : null,
    wake: wake !== null ? m(wake) : null,
  };
}
