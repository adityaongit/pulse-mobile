import type { BodyKey } from "@/lib/dashboard";
import { EXTRA_KEYS, type ExtraKey } from "@/lib/extraMetrics";
import { clock, DAY, formatDay, type FormatKey } from "@/lib/format";
import { RANGE_DAYS, RANGES, type TrendRange, weekOf } from "@/lib/url";
import { addDays } from "../time";
import {
  ACTIVITY_NAME,
  activityKind,
  dayStartOf,
  type DayRow,
  type ExerciseRow,
  exercisesBetween,
  finite,
  loadDays,
  meanSd,
  ms,
  none,
  ok,
  priorStats,
  type QueryCtx,
  todayOf,
  vitalReason,
} from "./common";
import { type LoggedEntry, toEntry } from "./log";
import { TREND_METRICS } from "./trends";
import type { GoodDirection, KeyStat, Metric } from "./types";

export type VitalDetailKey = "hrv" | "rhr" | "resp" | "spo2" | "skin";
export type DetailKey = "steps" | "calories" | VitalDetailKey | BodyKey | ExtraKey;
export const DETAIL_KEYS: readonly DetailKey[] = ["steps", "calories", "hrv", "rhr", "resp", "spo2", "skin", "weight", "body_fat", ...EXTRA_KEYS];
export const isDetailKey = (k: string): k is DetailKey => (DETAIL_KEYS as readonly string[]).includes(k);

type Group = "activity" | "body" | "nutrition" | "vitals";
type SectionKind = Section["kind"];

type Config = {
  about: string;
  group: Group;
  sections: SectionKind[];
  /** Sums make sense over a range (steps, distance), so the stats show a total. */
  total?: boolean;
  /** A spot reading (weight, glucose): the hero is the latest reading on or before the day. */
  reading?: boolean;
  stack?: "calories" | "distance";
  reference?: { y: number; label: string };
  smooth?: number;
  baseline?: boolean;
};

/** The 7,000-a-day step reference (Lancet Public Health 2025), and the 150 weekly active minutes (WHO 2020). */
export const STEP_TARGET = 7000;
export const WEEKLY_TARGET = 150;
const PROTEIN_G_PER_KG = 0.8;

const LEVELS = ["intensity"] as const;
const CONFIG: Record<DetailKey, Config> = {
  hrv: { group: "vitals", baseline: true, sections: ["outliers"], about: "Variation in time between heartbeats during sleep, measured in milliseconds. Compare it with your own usual range." },
  rhr: { group: "vitals", baseline: true, sections: ["outliers"], about: "Your resting heart rate from Google Health, or the sleeping heart rate from your main sleep session when the daily value is missing." },
  resp: { group: "vitals", baseline: true, sections: ["outliers"], about: "Breaths per minute during sleep, measured by your Fitbit." },
  spo2: { group: "vitals", baseline: true, sections: ["outliers"], about: "Estimated blood oxygen saturation during sleep, measured by your Fitbit." },
  skin: { group: "vitals", baseline: true, sections: ["outliers"], reference: { y: 0, label: "Baseline" }, about: "Nightly skin temperature above or below your personal baseline, in degrees Celsius. This is a temperature difference, not your body temperature." },
  steps: { group: "activity", total: true, sections: ["hourly", "goal", "weekday"], reference: { y: STEP_TARGET, label: "7,000" }, about: "Steps counted through the day." },
  calories: {
    group: "activity",
    total: true,
    stack: "calories",
    sections: ["workouts"],
    about: "Everything you burned: your resting burn plus movement. Resting is the total minus active calories, since Google sends no separate resting roll-up.",
  },
  weight: { group: "body", reading: true, smooth: 7, sections: ["readings"], about: "Your weight, from a connected scale, a log in Fitbit or Google Health, or Pulse's Journal." },
  body_fat: { group: "body", reading: true, smooth: 7, sections: ["readings"], about: "Body fat percentage, from a smart scale or a manual log." },
  distance: { group: "activity", total: true, stack: "distance", sections: ["weekday"], about: "Distance covered on foot and in workouts, from your steps and GPS." },
  floors: { group: "activity", total: true, sections: ["weekday"], about: "Floors climbed, counted from changes in altitude as you walk." },
  elevation: { group: "activity", total: true, sections: ["weekday"], about: "Height gained over the day." },
  active_minutes: { group: "activity", total: true, sections: ["weekly", ...LEVELS], about: "Minutes of moderate or harder movement, the time that counts toward the 150 minutes a week the WHO recommends." },
  light_minutes: { group: "activity", total: true, sections: [...LEVELS], about: "Minutes of light movement, such as an easy walk or chores." },
  azm: {
    group: "activity",
    total: true,
    sections: ["weekly", ...LEVELS],
    about: "Active Zone Minutes: a minute in the moderate zone counts once and a minute in the vigorous or peak zones counts twice, toward 150 a week.",
  },
  active_calories: { group: "activity", total: true, sections: ["workouts"], about: "Calories burned by movement above your resting burn." },
  sedentary_minutes: {
    group: "activity",
    sections: ["hourly", ...LEVELS],
    about: "Time awake and still. Google sends one daily total, so the hourly view shows your steps instead: the gaps are when you sat.",
  },
  avg_hr: { group: "vitals", baseline: true, sections: ["outliers"], about: "Your average heart rate over the whole day, from your Fitbit." },
  water: { group: "nutrition", total: true, sections: ["entries"], about: "Water you logged in Fitbit, Google Health or Pulse's Journal." },
  calories_in: { group: "nutrition", sections: ["balance", "macros", "entries"], about: "Calories from the food you logged." },
  protein: { group: "nutrition", sections: ["macros", "entries"], about: "Protein from the food you logged." },
  carbs: { group: "nutrition", sections: ["macros", "entries"], about: "Carbohydrates from the food you logged." },
  fat: { group: "nutrition", sections: ["macros", "entries"], about: "Fat from the food you logged." },
  glucose: { group: "vitals", reading: true, baseline: true, sections: ["outliers"], about: "Blood glucose readings from a connected meter or a manual log." },
  core_temp: { group: "vitals", reading: true, baseline: true, sections: ["outliers"], about: "Core body temperature readings from a connected sensor." },
  swim_strokes: { group: "activity", total: true, sections: [], about: "Strokes counted during pool swims." },
};

const SOURCE: Record<Group, string> = {
  activity: "Google Health's daily roll-up, counted by your Fitbit or your phone and synced through the Google Health API. Pulse shows it as it comes and does not score it.",
  body: "Readings synced from Google Health, plus any you log in Pulse. A day without a reading shows the latest one before it.",
  nutrition: "Google Health's daily total of your logs, synced through the Google Health API, plus entries made in Pulse since the last sync.",
  vitals: "Google Health's daily value, from your Fitbit or a connected device. Pulse shades your usual range from the last 90 days.",
};

const CALORIES = {
  key: "calories",
  label: "Calories",
  unit: "kcal",
  format: "grouped" as FormatKey,
  direction: "neutral" as GoodDirection,
  pick: (r: DayRow) => r.metrics?.calories,
  partialToday: true,
};

function defOf(key: DetailKey) {
  const t = key === "calories" ? CALORIES : TREND_METRICS.find((m) => m.key === key)!;
  return { key, label: t.label, unit: t.unit, format: t.format, direction: t.direction, pick: t.pick, partialToday: !!t.partialToday, ...CONFIG[key] };
}

export type Point = { day: string; value: number | null; provisional?: boolean; parts?: Record<string, number> | null };
export type Extreme = { day: string; value: number } | null;
export type RangeStats = { average: number | null; prior: number | null; high: Extreme; low: Extreme; total: number | null; withData: number; days: number };
export type Hour = { t: number; label: string; value: number | null };

export type Section =
  | { kind: "hourly"; hours: Metric<Hour[]>; still: { from: number; to: number; minutes: number } | null }
  | { kind: "goal"; target: number; streak: number; longest: number; met: number; days: number }
  | { kind: "weekday"; weeks: number; days: { label: string; value: number | null }[] }
  | { kind: "weekly"; target: number; week: { from: string; to: string; total: number }; weeks: { from: string; value: number | null }[]; met: number }
  | { kind: "intensity"; rows: KeyStat[] }
  | { kind: "workouts"; active: number | null; items: { id: string; name: string; start: number; end: number; calories: number | null }[] }
  | { kind: "entries"; items: LoggedEntry[] }
  | { kind: "balance"; rows: KeyStat[] }
  | { kind: "macros"; rows: KeyStat[] }
  | { kind: "readings"; changes: KeyStat[]; items: { day: string; value: number }[] }
  | { kind: "outliers"; mean: number; sd: number; items: { day: string; value: number; dir: "high" | "low" }[] };

export type MetricDetailVM = {
  key: DetailKey;
  label: string;
  unit?: string;
  format: FormatKey;
  direction: GoodDirection;
  group: Group;
  about: string;
  source: string;
  day: string;
  today: string;
  /** The selected day's value, or for a reading metric the latest reading on or before it (`valueDay`). */
  value: Metric<number>;
  valueDay: string | null;
  soFar: boolean;
  /** Mean over the 30 days before `valueDay`. */
  average: number | null;
  sd?: number;
  /** 365 days ending on the selected day, oldest first; today's running total is a gap, as on Trends. */
  history: Metric<Point[]>;
  ranges: Record<TrendRange, RangeStats>;
  total: boolean;
  chart: { stack?: "calories" | "distance"; reference?: { y: number; label: string }; smooth?: number; baseline?: { mean: number; sd: number } | null };
  sections: Section[];
};

const SPAN = RANGE_DAYS["1y"];
const DAY_FROM = 7 * 60;
const DAY_TO = 22 * 60;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function getMetricDetail(key: DetailKey, day: string, ctx: QueryCtx): Promise<MetricDetailVM> {
  const m = defOf(key);
  const today = todayOf(ctx);
  const isToday = day === today;
  // Two years: the 1Y stats compare with the year before.
  const from = addDays(day, -(2 * SPAN - 1));
  const needExs = m.stack === "distance" || m.sections.includes("workouts");
  const [rows, exs] = await Promise.all([loadDays(ctx, from, day), needExs ? exercisesBetween(ctx, addDays(day, -(SPAN - 1)), day) : []]);
  const raw = (d: string) => {
    const r = rows.get(d);
    const v = r ? m.pick(r) : null;
    return finite(v) ? v : null;
  };
  // Exclude unfinished daily totals from history and range comparisons.
  const val = (d: string) => (m.partialToday && d === today ? null : raw(d));
  const days = Array.from({ length: 2 * SPAN }, (_, k) => addDays(from, k));

  let valueDay: string | null = day;
  if (m.reading) valueDay = [...days].reverse().find((d) => raw(d) !== null) ?? null;
  const value = valueDay ? raw(valueDay) : null;
  const prior = valueDay ? priorStats(rows, valueDay, (r) => m.pick(r)) : { mean: null, sd: undefined };

  const shown: Point[] = days.slice(-SPAN).map((d) => ({ day: d, value: val(d), ...(m.stack && { parts: partsOf(m.stack, rows.get(d), val(d), exs) }) }));

  const ranges = Object.fromEntries(RANGES.map((r) => [r, rangeStats(days.map(val), days, RANGE_DAYS[r], !!m.total)])) as Record<TrendRange, RangeStats>;
  const out = m.baseline ? outliers(days.slice(-90), val) : null;

  const s: SectionCtx = { ctx, rows, day, today, isToday, val, raw, exs };
  const built = await Promise.all(m.sections.map((k) => (k === "outliers" ? out : BUILD[k](s, key))));
  return {
    key,
    label: m.label,
    ...(m.unit && { unit: m.unit }),
    format: m.format,
    direction: m.direction,
    group: m.group,
    about: m.about,
    source: SOURCE[m.group],
    day,
    today,
    value: value === null ? none(detailReason(key, rows.get(day), isToday)) : ok(value),
    valueDay: value === null ? null : valueDay,
    soFar: m.partialToday && isToday && valueDay === today && value !== null,
    average: prior.mean,
    ...(prior.sd !== undefined && { sd: prior.sd }),
    history: shown.some((p) => p.value !== null) ? ok(shown) : none("no_data"),
    ranges,
    total: !!m.total,
    chart: { stack: m.stack, reference: m.reference, smooth: m.smooth, baseline: out && { mean: out.mean, sd: out.sd } },
    sections: built.filter((sec): sec is Section => !!sec),
  };
}

function detailReason(key: DetailKey, row: DayRow | undefined, isToday: boolean) {
  if (key === "skin" && row?.metrics?.nightlyTempC != null) return "calibrating" as const;
  if (["hrv", "rhr", "resp", "spo2", "skin"].includes(key)) return vitalReason(row, isToday, key === "hrv");
  return "no_data" as const;
}

type SectionCtx = {
  ctx: QueryCtx;
  rows: Map<string, DayRow>;
  day: string;
  today: string;
  isToday: boolean;
  /** The metric's value on a day (today's running total excluded) and its raw value (included). */
  val: (d: string) => number | null;
  raw: (d: string) => number | null;
  exs: ExerciseRow[];
};

/**
 * A day's split. Calories: active over resting (resting = total − active, active capped at the total, as on Strain).
 * Distance: recorded workouts' distance over everyday movement. Null when a day has a total but no breakdown.
 */
function partsOf(stack: "calories" | "distance", r: DayRow | undefined, total: number | null, exs: SectionCtx["exs"]): Record<string, number> | null {
  if (total === null || !r) return null;
  if (stack === "calories") {
    const a = r.extra.active_calories;
    if (!finite(a)) return null;
    const active = Math.min(Math.max(0, a), total);
    return { active, resting: total - active };
  }
  const workouts = Math.min(exs.filter((e) => e.day === r.day).reduce((a, e) => a + (e.distanceM ?? 0), 0) / 1000, total);
  return { workouts, everyday: total - workouts };
}

export function rangeStats(values: (number | null)[], days: string[], n: number, total: boolean): RangeStats {
  const v = values.slice(-n);
  const d = days.slice(-n);
  const have = v.flatMap((x, i) => (x === null ? [] : [{ day: d[i], value: x }]));
  const sum = have.reduce((a, x) => a + x.value, 0);
  const priorV = values.slice(-2 * n, -n).filter(finite);
  const pick = (better: (a: number, b: number) => boolean) => have.reduce<Extreme>((best, x) => (!best || better(x.value, best.value) ? x : best), null);
  return {
    average: have.length ? sum / have.length : null,
    prior: priorV.length ? priorV.reduce((a, b) => a + b, 0) / priorV.length : null,
    high: pick((a, b) => a > b),
    low: pick((a, b) => a < b),
    total: total && have.length ? sum : null,
    withData: have.length,
    days: v.length,
  };
}

/** Days in `days` outside mean ± 2 σ of those days; needs a week of values to call a range. */
function outliers(days: string[], val: (d: string) => number | null): Extract<Section, { kind: "outliers" }> | null {
  const xs = days.map((d) => ({ day: d, value: val(d) })).filter((x): x is { day: string; value: number } => x.value !== null);
  const { mean, sd } = meanSd(xs.map((x) => x.value));
  if (mean === null || sd === undefined || xs.length < 7) return null;
  const items = xs
    .filter((x) => Math.abs(x.value - mean) > 2 * sd)
    .reverse()
    .slice(0, 6)
    .map((x) => ({ ...x, dir: x.value > mean ? ("high" as const) : ("low" as const) }));
  return { kind: "outliers", mean, sd, items };
}

const stat = (s: SectionCtx, key: string, label: string, pick: (r: DayRow) => number | null | undefined, direction: KeyStat["direction"], extra: Partial<KeyStat> = {}): KeyStat => {
  const v = s.rows.get(s.day) ? pick(s.rows.get(s.day)!) : null;
  const { mean, sd } = priorStats(s.rows, s.day, pick);
  return { key, label, metric: finite(v) ? ok(v) : none("no_data"), average: mean, ...(sd !== undefined && { sd }), direction, format: "duration", ...extra };
};

const BUILD: Record<Exclude<SectionKind, "outliers">, (s: SectionCtx, key: DetailKey) => Section | null | Promise<Section | null>> = {
  hourly: (s, key) => hourly(s, key === "sedentary_minutes"),

  goal: (s) => {
    const met = (d: string) => (s.raw(d) ?? 0) >= STEP_TARGET;
    // Today counts once it is met; until then the streak runs to yesterday.
    let d = s.isToday && !met(s.day) ? addDays(s.day, -1) : s.day;
    let streak = 0;
    while (met(d) && streak < 2 * SPAN) {
      streak++;
      d = addDays(d, -1);
    }
    let longest = 0;
    let run = 0;
    for (let k = SPAN - 1; k >= 0; k--) {
      run = met(addDays(s.day, -k)) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const month = Array.from({ length: 30 }, (_, k) => addDays(s.day, -k));
    return { kind: "goal", target: STEP_TARGET, streak, longest, met: month.filter(met).length, days: 30 };
  },

  weekday: (s) => {
    const sums = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (let k = 0; k < 84; k++) {
      const d = addDays(s.day, -k);
      const v = s.val(d);
      if (v === null) continue;
      const w = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
      sums[w].sum += v;
      sums[w].n++;
    }
    if (sums.every((x) => !x.n)) return null;
    return { kind: "weekday", weeks: 12, days: sums.map((x, i) => ({ label: WEEKDAYS[i], value: x.n ? x.sum / x.n : null })) };
  },

  weekly: (s) => {
    const [mon] = weekOf(s.day);
    const total = (from: string, to: string) => {
      const vs: number[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) vs.push(...(s.raw(d) === null ? [] : [s.raw(d)!]));
      return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    };
    const weeks = Array.from({ length: 12 }, (_, k) => {
      const from = addDays(mon, -7 * (11 - k));
      const to = addDays(from, 6) < s.day ? addDays(from, 6) : s.day;
      return { from, value: total(from, to) };
    });
    return {
      kind: "weekly",
      target: WEEKLY_TARGET,
      week: { from: mon, to: s.day, total: weeks[11].value ?? 0 },
      weeks,
      met: weeks.filter((w) => (w.value ?? 0) >= WEEKLY_TARGET).length,
    };
  },

  intensity: (s, key) => ({
    kind: "intensity",
    rows:
      key === "azm"
        ? [
            stat(s, "zones13", "Light and moderate zones", (r) => r.metrics?.lightModerateMin, "up"),
            stat(s, "zones45", "Vigorous and peak zones", (r) => r.metrics?.vigorousPeakMin, "up"),
          ]
        : [
            stat(s, "active_minutes", "Active minutes", (r) => r.extra.active_minutes, "up"),
            stat(s, "light_minutes", "Light activity", (r) => r.extra.light_minutes, "up"),
            stat(s, "sedentary_minutes", "Sedentary time", (r) => r.extra.sedentary_minutes, "down"),
          ],
  }),

  workouts: (s) => {
    const items = s.exs
      .filter((e) => e.day === s.day)
      .map((e) => ({ id: e.id, name: e.name ?? ACTIVITY_NAME[activityKind(e.type)], start: ms(e.startTs), end: ms(e.endTs), calories: e.calories }));
    const a = s.rows.get(s.day)?.extra.active_calories;
    return { kind: "workouts", active: finite(a) ? a : null, items };
  },

  entries: async (s, key) => {
    const type = key === "water" ? "hydration-log" : "nutrition-log";
    return { kind: "entries", items: (await s.ctx.store.log.entriesOn(type, s.day)).map(toEntry) };
  },

  balance: (s) => {
    const r = s.rows.get(s.day);
    const eaten = r?.extra.calories_in;
    const burned = r?.metrics?.calories;
    const opts = { unit: "kcal", format: "grouped" as const };
    return {
      kind: "balance",
      rows: [
        stat(s, "calories_in", "Eaten", (x) => x.extra.calories_in, "none", opts),
        stat(s, "calories", "Burned", (x) => x.metrics?.calories, "none", opts),
        {
          key: "balance",
          label: "Difference",
          caption: "Eaten minus burned",
          metric: finite(eaten) && finite(burned) ? ok(eaten - burned) : none("no_data"),
          average: null,
          direction: "none",
          unit: "kcal",
          format: "signedInt",
        },
      ],
    };
  },

  macros: (s) => {
    const r = s.rows.get(s.day);
    const g = { protein: r?.extra.protein, carbs: r?.extra.carbs, fat: r?.extra.fat };
    const kcal = (finite(g.protein) ? g.protein * 4 : 0) + (finite(g.carbs) ? g.carbs * 4 : 0) + (finite(g.fat) ? g.fat * 9 : 0);
    const share = (v: number | undefined, per: number) => (finite(v) && kcal > 0 ? `${Math.round(((v * per) / kcal) * 100)}% of macro calories` : undefined);
    const row = (key: "protein" | "carbs" | "fat", label: string, per: number): KeyStat => ({
      ...stat(s, key, label, (x) => x.extra[key], "none", { unit: "g", format: "int" }),
      ...(share(g[key], per) && { caption: share(g[key], per) }),
    });
    const rows = [row("protein", "Protein", 4), row("carbs", "Carbohydrates", 4), row("fat", "Fat", 9)];
    // Protein's reference: 0.8 g per kg of the latest weight on or before the day.
    let weight: number | null = null;
    for (let k = 0; k < 2 * SPAN && weight === null; k++) weight = s.rows.get(addDays(s.day, -k))?.metrics?.weightKg ?? null;
    if (weight)
      rows.push({
        key: "protein_target",
        label: "Protein reference",
        caption: `${PROTEIN_G_PER_KG} g per kg at ${weight.toFixed(1)} kg`,
        metric: ok(weight * PROTEIN_G_PER_KG),
        average: null,
        direction: "none",
        unit: "g",
        format: "int",
      });
    return { kind: "macros", rows };
  },

  readings: (s, key) => {
    const items: { day: string; value: number }[] = [];
    for (let k = 0; k < 2 * SPAN; k++) {
      const d = addDays(s.day, -k);
      const v = s.raw(d);
      if (v !== null) items.push({ day: d, value: v });
    }
    const unit = key === "weight" ? "kg" : "%";
    const change = (n: 30 | 90): KeyStat => {
      const latest = items[0];
      const before = latest && items.find((x) => x.day <= addDays(latest.day, -n));
      return {
        key: `change${n}`,
        label: `Change over ${n} days`,
        ...(before && { caption: `Since ${formatDay(before.day, DAY.monthDay)}` }),
        metric: before ? ok(latest.value - before.value) : none("no_data"),
        average: null,
        direction: "none",
        unit,
        format: "signed1",
      };
    };
    return { kind: "readings", changes: [change(30), change(90)], items: items.slice(0, 8) };
  },
};

/**
 * Steps per hour of the day from the stored steps per minute; hours still to come today are gaps. `still` adds the longest
 * stretch without a step between 07:00 and 22:00 (or now, today), for Sedentary time.
 */
async function hourly(s: SectionCtx, still: boolean): Promise<Extract<Section, { kind: "hourly" }>> {
  const start = dayStartOf(s.ctx, s.day);
  const end = dayStartOf(s.ctx, addDays(s.day, 1));
  const mins = (await s.ctx.store.samples.readSamples("steps", start, end)).filter((x) => x.v > 0).map((x) => ({ ts: x.ts, steps: x.v }));
  if (!mins.length) return { kind: "hourly", hours: none("no_data"), still: null };
  const n = Math.round((end - start) / 3600);
  const now = s.isToday ? Math.floor((s.ctx.now - start) / 3600) : n;
  const sums = new Array<number>(n).fill(0);
  for (const m of mins) sums[Math.min(n - 1, Math.floor((m.ts - start) / 3600))] += m.steps;
  const hours = sums.map((v, h) => ({ t: ms(start + h * 3600), label: clock(ms(start + h * 3600), s.ctx.timeZone), value: h > now ? null : v }));
  let gap: { from: number; to: number; minutes: number } | null = null;
  if (still) {
    // Exclude overnight hours so sleep is not counted as sedentary time.
    const [lo, hi] = [start + DAY_FROM * 60, start + DAY_TO * 60];
    const ts = [lo - 60, ...mins.map((m) => m.ts).filter((t) => t >= lo && t < hi), Math.min(hi, s.isToday ? s.ctx.now - (s.ctx.now % 60) : hi)];
    for (let i = 1; i < ts.length; i++) {
      const minutes = Math.round((ts[i] - ts[i - 1]) / 60) - 1;
      if (minutes > 0 && (!gap || minutes > gap.minutes)) gap = { from: ms(ts[i - 1] + 60), to: ms(ts[i]), minutes };
    }
  }
  return { kind: "hourly", hours: ok(hours), still: gap };
}
