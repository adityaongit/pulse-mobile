import { metricHref, trendHref } from "@/lib/url";
import { addDays, localMinutes } from "../time";
import {
  type DayRow,
  finite,
  fromReason,
  loadDays,
  maybe,
  ms,
  none,
  ok,
  planVM,
  priorStats,
  type QueryCtx,
  sleepMetric,
  todayOf,
  vitalReason,
} from "./common";
import type { KeyStat, Metric, SleepStatus, SleepVM, TimePoint } from "./types";

type Stage = "awake" | "rem" | "light" | "deep";
const STAGE_ROWS: { stage: Stage; label: string; typical: [number, number] }[] = [
  { stage: "awake", label: "Awake", typical: [5, 10] },
  { stage: "rem", label: "REM", typical: [20, 25] },
  { stage: "light", label: "Light", typical: [45, 55] },
  { stage: "deep", label: "Deep", typical: [13, 23] },
];

const status = (v: number | null | undefined, optimal: number, sufficient: number): SleepStatus | undefined =>
  !finite(v) ? undefined : v >= optimal ? "optimal" : v >= sufficient ? "sufficient" : "poor";

const hoursPct = (r: DayRow) => {
  const m = r.sleep?.main;
  return m && r.sleep ? (m.asleepMin / (r.sleep.needHours * 60)) * 100 : null;
};
const efficiencyPct = (r: DayRow) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null);

export async function getSleep(ctx: QueryCtx, day: string): Promise<SleepVM> {
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
  // The reference app's four rows, each opening its Trend View; restorative sleep sits under the stages instead.
  const summary = [
    { ...stat("hours", "Hours vs. needed", hoursPct, "%", (v) => status(v, 85, 70)), href: trendHref("hours_need") },
    { ...stat("consistency", "Sleep consistency", (r) => r.sleep?.consistency, "%", (v) => status(v, 80, 70), main ? "calibrating" : reason), href: trendHref("consistency") },
    { ...stat("efficiency", "Sleep efficiency", efficiencyPct, "%", (v) => status(v, 85, 75)), href: trendHref("efficiency") },
    // The web's fourth row, "High sleep stress", is built behind FEATURES.sleepStress, which is off until Pulse scores stress during sleep: it is left out here.
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
    { ...stat("timeInBed", "Time in bed", (r) => r.sleep?.main?.inBedMin, "min"), direction: "neutral" as const },
    { ...stat("wakeEvents", "Wake events", (r) => r.sleep?.main?.wakeEvents, undefined), direction: "down" as const },
    { ...stat("resp", "Respiratory rate", (r) => r.metrics?.respBpm, "rpm", undefined, vitalReason(row, isToday)), direction: "down" as const, href: metricHref("resp") },
    { ...stat("debt", "Sleep debt", (r) => (r.sleep?.main ? r.sleep.debtMin : null), "min"), direction: "down" as const },
  ];

  const restorativeMin = (r: DayRow) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null);
  const restPrior = priorStats(rows, day, restorativeMin);
  const restNow = row ? restorativeMin(row) : null;
  const restorative: SleepVM["restorative"] = finite(restNow)
    ? ok({ minutes: restNow, average: restPrior.mean, ...(restPrior.sd !== undefined && { sd: restPrior.sd }) })
    : fromReason(noNight, isToday);

  const plan = planVM(ctx, row, isToday);
  const [stages, nightHr] = await Promise.all([stagesOf(ctx, row, noNight), main ? nightHrOf(ctx, main.start, main.end) : fromReason<never>(noNight, isToday)]);
  const effPrior = priorStats(rows, day, efficiencyPct);
  const span = main ? Math.max(1, main.end - main.start) * 1000 : 1;
  const efficiency: SleepVM["efficiency"] = main
    ? ok({
        pct: main.efficiency * 100,
        average: effPrior.mean,
        ...(effPrior.sd !== undefined && { sd: effPrior.sd }),
        asleepMin: main.asleepMin,
        awakeMin: main.awakeMin,
        wakeEvents: main.wakeEvents,
        // Spells awake after falling asleep and before the final wake; the first and last stretches are not wake-ups.
        wakes: (stages?.value?.segments ?? [])
          .filter((g, i, all) => g.stage === "awake" && i > 0 && i < all.length - 1)
          .map((g) => ({ at: (g.start - main.start * 1000) / span, width: (g.end - g.start) / span })),
      })
    : fromReason(noNight, isToday);
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
    details,
    restorative,
    efficiency,
    sleepStress: none("no_data"),
    planner: plan.value ? ok({ ...plan.value, weekdayWake: !plan.value.weekend }) : (plan as Metric<never>),
  };
}

type StagedSession = { id: string; start: number; end: number; staged: boolean; awakeMin: number; remMin: number | null; lightMin: number | null; deepMin: number | null };

async function stagesOf(ctx: QueryCtx, row: DayRow | undefined, noNight: SleepVM["performance"]["reason"]): Promise<SleepVM["stages"]> {
  const main = row?.sleep?.main;
  return main ? sessionStages(ctx, main) : none(noNight ?? "no_data");
}

/** One session's hypnogram and stage rows; null when Fitbit did not stage it. */
async function sessionStages(ctx: QueryCtx, x: StagedSession): Promise<SleepVM["stages"]> {
  if (!x.staged) return null;
  const segments = (await ctx.store.sessions.segmentsOf(x.id)).map((g) => ({ stage: g.stage, start: ms(g.startTs), end: ms(g.endTs) }));
  if (!segments.length) return null;
  const minutes: Record<Stage, number> = { awake: x.awakeMin, rem: x.remMin ?? 0, light: x.lightMin ?? 0, deep: x.deepMin ?? 0 };
  const total = minutes.awake + minutes.rem + minutes.light + minutes.deep;
  return ok({
    bed: ms(x.start),
    wake: ms(x.end),
    segments,
    rows: STAGE_ROWS.map((r) => ({ ...r, minutes: minutes[r.stage], pct: total > 0 ? (minutes[r.stage] / total) * 100 : 0 })),
  });
}

export type NapVM = { id: string; day: string; start: number; end: number; hours: SleepVM["hours"]; stages: SleepVM["stages"]; hr: SleepVM["nightHr"] };

/** A nap's own detail: time asleep, stages when Fitbit staged it, and heart rate across it. Null for an unknown id or a main sleep. */
export async function getNap(ctx: QueryCtx, id: string): Promise<NapVM | null> {
  const n = await ctx.store.sessions.sessionById(id);
  if (!n || n.isMain) return null;
  const session = { id: n.id, start: n.startTs, end: n.endTs, staged: n.stagesStatus === "SUCCEEDED", awakeMin: n.awakeMin ?? 0, remMin: n.remMin, lightMin: n.lightMin, deepMin: n.deepMin };
  const [stages, hr] = await Promise.all([sessionStages(ctx, session), nightHrOf(ctx, n.startTs, n.endTs)]);
  const asleepMin = n.asleepMin ?? Math.round((n.endTs - n.startTs) / 60);
  return { id: n.id, day: n.day, start: ms(n.startTs), end: ms(n.endTs), hours: ok({ asleepMin, average: null }), stages, hr };
}

const HR_PAD_S = 15 * 60;

/** Per-minute mean HR over the sleep [start, end) (unix seconds) plus 15 minutes each side; empty minutes are null. */
export async function nightHrOf(ctx: QueryCtx, start: number, end: number): Promise<SleepVM["nightHr"]> {
  const from = Math.floor((start - HR_PAD_S) / 60) * 60;
  const to = end + HR_PAD_S;
  const sums = new Map<number, { sum: number; n: number }>();
  for (const { ts, bpm } of await ctx.store.samples.readHr(from, to)) {
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
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** Five nights ending on `day`: bed and wake as minutes from local midnight, each with the median of the 14 nights before it. */
export function consistencyOf(rows: Map<string, DayRow>, day: string, tz: string, noScore: SleepVM["performance"]["reason"], average: number | null): SleepVM["consistency"] {
  const pct = rows.get(day)?.sleep?.consistency;
  if (!finite(pct)) return none(noScore ?? "calibrating");
  const night = (d: string) => {
    const m = rows.get(d)?.sleep?.main;
    return m ? { day: d, label: `${WEEKDAY.format(new Date(`${d}T12:00:00Z`))}.`, bed: bedMin(m.start, tz), wake: localMinutes(m.end, tz) } : null;
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
  const word = perf >= 85 ? "optimal" : perf >= 70 ? "sufficient" : "poor";
  const prior: number[] = [];
  for (let k = 1; k <= 14; k++) {
    const m = rows.get(addDays(day, -k))?.sleep?.main;
    if (m) prior.push(bedMin(m.start, tz));
  }
  prior.sort((a, b) => a - b);
  const usual = prior.length ? prior[Math.floor(prior.length / 2)] : null;
  const shift = usual == null ? 0 : bedMin(main.start, tz) - usual;
  const consistency = row?.sleep?.consistency;
  if (Math.abs(shift) >= 45) {
    return `Your sleep was ${word}. Consistency is the easiest win: you went to bed ${Math.abs(Math.round(shift))} minutes ${shift > 0 ? "later" : "earlier"} than usual.`;
  }
  if (finite(consistency) && consistency < 70) return `Your sleep was ${word}. Keeping a steadier bedtime and wake time would lift your consistency.`;
  const need = row?.sleep ? row.sleep.needHours * 60 : null;
  if (need && main.asleepMin < need * 0.85) return `Your sleep was ${word}. You slept ${Math.round(need - main.asleepMin)} minutes less than you needed; an earlier night helps.`;
  return `Your sleep was ${word}. You kept to your usual schedule and slept close to your need.`;
}
