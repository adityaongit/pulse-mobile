// Sleep `/sleep` (spec §7.5). Ported from Pulse's src/server/queries/sleep.ts: the hypnogram's segments come
// from store.segmentsFor and the night's heart rate from store.readHr over the sleep window only.
import { i18n } from "@/i18n/config";
import { getLocale } from "@/lib/locale";
import { addDays, localMinutes } from "@/lib/time";
import {
  type DayRow,
  finite,
  fromReason,
  loadDays,
  maybe,
  ms,
  nightNeedMin,
  none,
  ok,
  planVM,
  priorStats,
  type QueryCtx,
  sleepMetric,
  todayOf,
  vitalReason,
  trendPoints,
} from "./common";
import type { KeyStat, Metric, SleepStatus, SleepVM, TimePoint } from "./types";

type Stage = "awake" | "rem" | "light" | "deep";
const STAGE_ROWS: { stage: Stage; typical: [number, number] }[] = [
  { stage: "awake", typical: [5, 10] },
  { stage: "rem", typical: [20, 25] },
  { stage: "light", typical: [45, 55] },
  { stage: "deep", typical: [13, 23] },
];

const status = (v: number | null | undefined, optimal: number, sufficient: number): SleepStatus | undefined =>
  !finite(v) ? undefined : v >= optimal ? "optimal" : v >= sufficient ? "sufficient" : "poor";

/** Hours vs. needed: asleep against the night's full need (version 16), else the baseline need on older rows. */
const hoursPct = (r: DayRow) => {
  const m = r.sleep?.main;
  return m && r.sleep ? (m.asleepMin / (r.sleep.needMin ?? r.sleep.needHours * 60)) * 100 : null;
};
/** Sleep Stress as Sleep Performance's fourth part reads it (sleepStress.ts). */
const stressPct = (r: DayRow) => (r.sleep?.main ? (r.sleep.stressPct ?? null) : null);
/** Lower is better: a guess at WHOOP's bands (it publishes none), under 10 % optimal, under 20 % sufficient. */
const stressStatus = (v: number | null | undefined): SleepStatus | undefined => (!finite(v) ? undefined : v < 10 ? "optimal" : v < 20 ? "sufficient" : "poor");
const efficiencyPct = (r: DayRow) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null);
const restorativePct = (r: DayRow) => {
  const m = r.sleep?.main;
  return m && m.asleepMin > 0 && m.deepMin != null && m.remMin != null ? ((m.deepMin + m.remMin) / m.asleepMin) * 100 : null;
};

/** Sleep `/sleep` for `day` (spec §7.5). */
export async function getSleep(day: string, ctx: QueryCtx): Promise<SleepVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const rows = await loadDays(ctx, addDays(day, -181), day);
  const row = rows.get(day);
  const s = row?.sleep ?? null;
  const main = s?.main ?? null;
  const performance = sleepMetric(row, isToday);
  const noNight = performance.value == null ? performance.reason ?? "no_data" : null;
  const reason = noNight ?? "no_data";

  const stat = (key: string, label: string, pick: (r: DayRow) => number | null | undefined, unit: string | undefined, st?: (v: number | null | undefined) => SleepStatus | undefined, r = reason): KeyStat => {
    const v = row ? pick(row) : null;
    const { mean, sd } = priorStats(rows, day, pick);
    const sv = st?.(v);
    return { key, label, metric: maybe(v, r), ...(unit && { unit }), average: mean, ...(sd !== undefined && { sd }), direction: "up", ...(sv && { status: sv }) };
  };
  // Each row leads to its own section further down the page (`#need`, `#consistency`, …).
  const summary = [
    { ...stat("hours", i18n.t("sleep:stat.hours"), hoursPct, "%", (v) => status(v, 85, 70)), href: "#need" },
    { ...stat("consistency", i18n.t("sleep:stat.consistency"), (r) => r.sleep?.consistency, "%", (v) => status(v, 80, 70), main ? "calibrating" : reason), href: "#consistency" },
    { ...stat("efficiency", i18n.t("sleep:stat.efficiency"), efficiencyPct, "%", (v) => status(v, 85, 75)), href: "#efficiency" },
    { ...stat("restorative", i18n.t("sleep:stat.restorative"), restorativePct, "%", (v) => status(v, 40, 30)), href: "#restorative" },
    // Sleep Performance's fourth part since version 16 (WHOOP 2025): heart rate well above the night's calm level.
    { ...stat("sleepStress", i18n.t("sleep:stat.sleepStress"), stressPct, "%", stressStatus, main ? "insufficient_hr_data" : reason), direction: "down" as const },
  ];

  // Last night's need is the plan made the evening before.
  const prevPlan = rows.get(addDays(day, -1))?.sleepPlanner;
  const hoursVsNeed: SleepVM["hoursVsNeed"] =
    !main || !s
      ? fromReason(noNight, isToday)
      : prevPlan && prevPlan.reason === null
        ? ok({ asleepMin: main.asleepMin, needMin: prevPlan.needMin, parts: prevPlan.parts, calibrating: false })
        : ok({ asleepMin: main.asleepMin, needMin: s.needHours * 60, parts: { baselineMin: s.needHours * 60, strainMin: 0, debtMin: 0, napMin: 0 }, calibrating: true });

  const prior = priorStats(rows, day, (r) => r.sleep?.main?.asleepMin);
  const hours: SleepVM["hours"] = main
    ? ok({ asleepMin: main.asleepMin, average: prior.mean, ...(prior.sd !== undefined && { sd: prior.sd }) })
    : fromReason(noNight, isToday);

  const consistency: SleepVM["consistency"] = main ? consistencyOf(rows, day, ctx.timeZone, "calibrating", priorStats(rows, day, (r) => r.sleep?.consistency).mean) : fromReason(noNight, isToday);

  const details = [
    { ...stat("timeInBed", i18n.t("sleep:stat.timeInBed"), (r) => r.sleep?.main?.inBedMin, "min"), direction: "neutral" as const },
    { ...stat("wakeEvents", i18n.t("sleep:stat.wakeEvents"), (r) => r.sleep?.main?.wakeEvents, undefined), direction: "down" as const },
    { ...stat("resp", i18n.t("sleep:stat.resp"), (r) => r.metrics?.respBpm, "rpm", undefined, vitalReason(row, isToday)), direction: "neutral" as const, href: "/chart?metric=resp&r=m" },
    { ...stat("debt", i18n.t("sleep:stat.debt"), (r) => (r.sleep?.main ? r.sleep.debtMin : null), "min"), direction: "down" as const, href: "#debt" },
  ];

  const plan = planVM(ctx, row, isToday);
  const [stages, nightHr] = await Promise.all([stagesOf(ctx, row, noNight), main ? nightHrOf(ctx, main.start, main.end) : fromReason<never>(noNight, isToday)]);
  return {
    day,
    isToday,
    performance,
    summary,
    insight: insightOf(rows, day, ctx.timeZone),
    stages,
    hours,
    nightHr,
    hoursVsNeed,
    consistency,
    restorative: trendPoints(rows, day, (r) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null), 30).map((p) => {
      const m = rows.get(p.day)?.sleep?.main;
      return { ...p, parts: p.value !== null && m ? { deep: m.deepMin!, rem: m.remMin! } : null };
    }),
    efficiencyTrend: { points: trendPoints(rows, day, efficiencyPct) },
    details,
    debtTrend: {
      points: trendPoints(rows, day, (r) => (r.sleep?.main ? r.sleep.debtMin / 60 : null)),
    },
    planner: plan.value ? ok({ ...plan.value, weekdayWake: !plan.value.weekend }) : (plan as Metric<never>),
  };
}

async function stagesOf(ctx: QueryCtx, row: DayRow | undefined, noNight: SleepVM["performance"]["reason"]): Promise<SleepVM["stages"]> {
  const main = row?.sleep?.main;
  if (!main) return none(noNight ?? "no_data");
  if (!main.staged) return null;
  const segments = (await ctx.store.segmentsFor([main.id]))
    .sort((a, b) => a.startTs - b.startTs)
    .map((g) => ({ stage: g.stage, start: ms(g.startTs), end: ms(g.endTs) }));
  const minutes: Record<Stage, number> = { awake: main.awakeMin, rem: main.remMin ?? 0, light: main.lightMin ?? 0, deep: main.deepMin ?? 0 };
  const total = minutes.awake + minutes.rem + minutes.light + minutes.deep;
  return ok({
    bed: ms(main.start),
    wake: ms(main.end),
    segments,
    rows: STAGE_ROWS.map((r) => ({ ...r, label: i18n.t(`sleep:stage.${r.stage}`), minutes: minutes[r.stage], pct: total > 0 ? (minutes[r.stage] / total) * 100 : 0 })),
  });
}

const HR_PAD_S = 15 * 60;

/** Per-minute mean HR over the sleep [start, end) (unix seconds) plus 15 minutes each side; empty minutes are null. */
export async function nightHrOf(ctx: QueryCtx, start: number, end: number): Promise<SleepVM["nightHr"]> {
  const from = Math.floor((start - HR_PAD_S) / 60) * 60;
  const to = end + HR_PAD_S;
  const sums = new Map<number, { sum: number; n: number }>();
  for (const { ts, bpm } of await ctx.store.readHr(from, to)) {
    const m = Math.floor(ts / 60) * 60;
    const a = sums.get(m) ?? { sum: 0, n: 0 };
    a.sum += bpm;
    a.n++;
    sums.set(m, a);
  }
  const rows = [...sums].map(([m, a]) => ({ m, bpm: Math.round(a.sum / a.n) }));
  const byMin = new Map(rows.map((r) => [r.m, r.bpm]));
  const points: TimePoint[] = [];
  for (let m = from; m < to; m += 60) points.push({ t: ms(m), v: byMin.get(m) ?? null });
  // Under a third of the night's minutes is too thin to draw honestly.
  const inNight = rows.filter((r) => r.m + 60 > start && r.m < end).length;
  if (inNight < (end - start) / 180) return none("insufficient_hr_data");
  return ok({ bed: ms(start), wake: ms(end), points });
}

/** Bedtime as minutes from midnight, evening negative. */
const bedMin = (start: number, tz: string) => {
  const m = localMinutes(start, tz);
  return m > 720 ? m - 1440 : m;
};

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

/** Five nights ending on `day`: bed and wake as minutes from local midnight, each with the median of the 14 nights before it. */
export function consistencyOf(rows: Map<string, DayRow>, day: string, tz: string, noScore: SleepVM["performance"]["reason"], average: number | null): SleepVM["consistency"] {
  const pct = rows.get(day)?.sleep?.consistency;
  if (!finite(pct)) return none(noScore ?? "calibrating");
  const night = (d: string) => {
    const m = rows.get(d)?.sleep?.main;
    return m ? { day: d, label: new Intl.DateTimeFormat(getLocale(), { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)), bed: bedMin(m.start, tz), wake: localMinutes(m.end, tz) } : null;
  };
  const withTypical = (d: string) => {
    const n = night(d);
    if (!n) return null;
    const prior = Array.from({ length: 14 }, (_, k) => night(addDays(d, -(k + 1)))).filter((x) => x !== null);
    return { ...n, typicalBed: median(prior.map((x) => x.bed)), typicalWake: median(prior.map((x) => x.wake)) };
  };
  return ok({ pct, average, nights: Array.from({ length: 5 }, (_, k) => withTypical(addDays(day, k - 4))) });
}

export function insightOf(rows: Map<string, DayRow>, day: string, tz: string): string | null {
  const row = rows.get(day);
  const perf = row?.sleep?.performance;
  const main = row?.sleep?.main;
  if (!finite(perf) || !main) return null;
  const band = i18n.t(`sleep:band.${perf >= 85 ? "optimal" : perf >= 70 ? "sufficient" : "poor"}`);
  const prior: number[] = [];
  for (let k = 1; k <= 14; k++) {
    const m = rows.get(addDays(day, -k))?.sleep?.main;
    if (m) prior.push(bedMin(m.start, tz));
  }
  prior.sort((a, b) => a - b);
  const usual = prior.length ? prior[Math.floor(prior.length / 2)] : null;
  const shift = usual == null ? 0 : bedMin(main.start, tz) - usual;
  const consistency = row?.sleep?.consistency;
  if (Math.abs(shift) >= 45) return i18n.t(`sleep:insight.${shift > 0 ? "laterBedtime" : "earlierBedtime"}`, { band, count: Math.abs(Math.round(shift)) });
  if (finite(consistency) && consistency < 70) return i18n.t("sleep:insight.steadier", { band });
  const need = nightNeedMin(row?.sleep);
  if (need && main.asleepMin < need * 0.85) return i18n.t("sleep:insight.lessSleep", { band, count: Math.round(need - main.asleepMin) });
  return i18n.t("sleep:insight.onTrack", { band });
}
