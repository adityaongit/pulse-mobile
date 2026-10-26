// The coach's tools, ported from Pulse's src/server/coach/tools.ts: read-only, bound to this person's QueryCtx by
// closure (the model never names a person or a store), each a compact digest of an existing screen query. A metric
// without a value carries its reason code instead, so the model can say "calibrating" rather than guess. No chart
// series, ids or raw payloads.
import { tool, type InferToolOutput } from "ai";
import { z } from "zod";
import { i18n } from "@/i18n/config";
import { trainingGuidance } from "@/core/algorithms/coaching";
import type { Metric } from "@/lib/reasons";
import { addDays, daysBetween } from "@/lib/time";
import { getActivities } from "@/queries/activities";
import { costDigest } from "@/queries/activityCost";
import { getActivity } from "@/queries/activity";
import { dayStartOf, firstDay, loadDays, maybe, meanSd, todayOf, type QueryCtx } from "@/queries/common";
import { acwrStatus, getFitness, getHealthHub, getMonitor, getStress } from "@/queries/health";
import { energyBankVM, latestReport } from "@/queries/home";
import { getJournalInsights } from "@/queries/journal";
import { getRecovery } from "@/queries/recovery";
import { getReport } from "@/queries/reports";
import { getSleep } from "@/queries/sleep";
import { getStrain } from "@/queries/strain";
import { TREND_METRICS, trendMetric, type TrendMetricKey } from "@/queries/trends";
import { defaultTexts, type Texts } from "./texts";

const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

/** A number metric as `{ value }` or `{ value: null, reason }`; provisional only when it is. */
export function num(m: Metric<number>, dp = 0) {
  return { value: m.value === null ? null : round(m.value, dp), reason: m.value === null ? (m.reason ?? "no_data") : null, provisional: m.provisional, ...(m.nightsLeft !== undefined && { nightsLeft: m.nightsLeft }) };
}

const Day = (description: string) => z.iso.date().optional().describe(description);

async function dayOf(ctx: QueryCtx, day: string | undefined) {
  const today = todayOf(ctx);
  if (!day || day > today) return today;
  const first = await firstDay(ctx);
  return first && day < first ? first : day;
}

export async function sleepDigest(ctx: QueryCtx, day: string) {
  const s = await getSleep(day, ctx);
  return {
    day,
    timeZone: ctx.timeZone,
    performance: { ...num(s.performance), unit: "%" },
    asleepMinutes: num(s.hours.value ? { ...s.hours, value: s.hours.value.asleepMin } : { ...s.hours, value: null }),
    need: s.hoursVsNeed,
    summary: s.summary.map((v) => ({ key: v.key, label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average, status: v.status ?? null })),
    details: s.details.map((v) => ({ key: v.key, label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average })),
    stages: s.stages?.value
      ? { value: { bedAt: s.stages.value.bed, wakeAt: s.stages.value.wake, rows: s.stages.value.rows.map((r) => ({ stage: r.label, minutes: round(r.minutes), pct: round(r.pct) })) }, reason: null, provisional: s.stages.provisional }
      : { value: null, reason: s.stages?.reason ?? "no_data", provisional: false },
    planner: s.planner,
    insight: s.insight,
  };
}

export async function trendDigest(ctx: QueryCtx, metric: TrendMetricKey, start?: string, end?: string) {
  const to = end && end < todayOf(ctx) ? end : todayOf(ctx);
  const requested = start ?? addDays(to, -13);
  const from = requested > to ? to : requested < addDays(to, -89) ? addDays(to, -89) : requested;
  const count = daysBetween(from, to) + 1;
  const priorEnd = addDays(from, -1);
  const priorStart = addDays(from, -count);
  const rows = await loadDays(ctx, priorStart, to);
  // In the person's units, as the screens show it.
  const m = trendMetric(metric);
  const points = (a: string, b: string) => {
    const out = [];
    for (let day = a; day <= b; day = addDays(day, 1)) {
      const row = rows.get(day)!;
      const partial = !!m.partialToday && day === todayOf(ctx);
      const v = partial ? null : m.pick(row);
      const rec = row.recovery;
      const reason = metric === "recovery" && rec?.reason ? rec.reason : "no_data";
      out.push({ day, ...num(maybe(v, reason, !!m.provisional?.(row)), 1), ...(partial && { excludedPartialDay: true }) });
    }
    return out;
  };
  const current = points(from, to);
  const previous = points(priorStart, priorEnd);
  const stats = (p: typeof current) => ({ average: num(maybe(meanSd(p.map((d) => d.value)).mean, "no_data", p.some((d) => d.provisional)), 1), observedDays: p.filter((d) => d.value !== null).length });
  return { metric: m.label, key: metric, unit: m.unit ?? (m.format === "duration" ? "min" : null), start: from, end: to, requestedStart: start ?? null, requestedEnd: end ?? null, calendarDays: count, ...stats(current), previous: { start: priorStart, end: priorEnd, ...stats(previous) }, points: current };
}

export async function dayDigest(ctx: QueryCtx, day: string) {
  const [rec, sleep, strain, stress, rows] = await Promise.all([getRecovery(day, ctx), getSleep(day, ctx), getStrain(day, ctx), getStress(day, ctx), loadDays(ctx, day, day)]);
  const bank = energyBankVM(ctx, rows.get(day), day, rec.isToday, null);
  return {
    day,
    isToday: rec.isToday,
    guidance: trainingGuidance({
      recovery: rec.recovery.value,
      provisional: rec.recovery.provisional,
      sleepPerformance: sleep.performance.value,
      strain: strain.strain.value,
      targetHigh: strain.target.value?.high ?? null,
      loadStatus: rows.get(day)?.trainingLoad?.acwr == null ? null : acwrStatus(rows.get(day)!.trainingLoad!.acwr!).status,
    }),
    recovery: {
      ...num(rec.recovery),
      unit: "%",
      band: rec.band,
      contributors: rec.contributors.map((c) => ({
        label: c.label,
        unit: c.unit,
        ...num(c.metric, 1),
        baseline: c.baseline && round(c.baseline.mean, 1),
        points: c.points === null ? null : round(c.points, 1),
      })),
    },
    sleep: {
      performance: { ...num(sleep.performance), unit: "%" },
      hoursAsleep: sleep.hours.value ? round(sleep.hours.value.asleepMin / 60, 1) : null,
      hoursNeeded: sleep.hoursVsNeed.value ? round(sleep.hoursVsNeed.value.needMin / 60, 1) : null,
      stages: sleep.stages?.value?.rows.map((r) => ({ stage: r.label, minutes: Math.round(r.minutes), pct: Math.round(r.pct) })) ?? null,
    },
    strain: {
      ...num(strain.strain),
      scale: i18n.t("coachTools:strainScale"),
      soFar: strain.soFar,
      target: strain.target.value ? [round(strain.target.value.low), round(strain.target.value.high)] : null,
      coachLine: strain.coach,
    },
    energyBank: { value: bank.value ? { current: round(bank.value.current), charged: round(bank.value.charged), drained: round(bank.value.drained), asOf: bank.value.until } : null, reason: bank.reason, provisional: bank.provisional },
    stress: stress.gauge.value ? { ...num({ ...stress.gauge, value: stress.gauge.value.value }), level: stress.gauge.value.level } : num({ ...stress.gauge, value: null }),
  };
}

/**
 * The tool set for this person. `t` gives each description (texts.ts). Parameter types and what each tool reads are
 * fixed here.
 */
export function coachTools(ctx: QueryCtx, t: Texts = defaultTexts) {
  return {
    get_day: tool({
      description: t("tool.get_day"),
      inputSchema: z.object({ day: Day(t("tool.get_day.day")) }),
      execute: async ({ day }) => dayDigest(ctx, await dayOf(ctx, day)),
    }),
    get_sleep: tool({
      description: t("tool.get_sleep"),
      inputSchema: z.object({ day: Day(t("tool.get_sleep.day")) }),
      execute: async ({ day }) => sleepDigest(ctx, await dayOf(ctx, day)),
    }),
    get_trend: tool({
      description: t("tool.get_trend"),
      inputSchema: z.object({ metric: z.enum(TREND_METRICS.map((m) => m.key) as [TrendMetricKey, ...TrendMetricKey[]]).describe(t("tool.get_trend.metric")), start: Day(t("tool.get_trend.start")), end: Day(t("tool.get_trend.end")) }),
      execute: async ({ metric, start, end }) => trendDigest(ctx, metric, start, end),
    }),
    get_activities: tool({
      description: t("tool.get_activities"),
      inputSchema: z.object({ days: z.number().int().min(1).max(90).default(14).describe(t("tool.get_activities.days")) }),
      execute: async ({ days }) => {
        const a = await getActivities(days, ctx);
        const all = a.groups.flatMap((g) =>
          g.items.filter((i) => i.kind === "activity").map((i) => ({
            id: i.id,
            day: g.day,
            name: i.name,
            minutes: Math.round((i.end - i.start) / 60_000),
            strain: num(i.strain, 1),
            distanceKm: i.distanceKm === null ? null : round(i.distanceKm, 1),
          })),
        );
        // Mobile: stretches of raised HR with no workout recorded (estimates, never scored), and each kind's recovery cost.
        const detected = a.groups.flatMap((g) =>
          g.detected.map((d) => ({ day: g.day, likely: d.label, minutes: Math.round((d.end - d.start) / 60_000), avgHr: d.avgHr, strain: d.strain === null ? null : round(d.strain, 1) })),
        );
        return {
          start: addDays(a.today, -(days - 1)),
          end: a.today,
          total: all.length,
          truncated: all.length > 30,
          workouts: all.slice(0, 30),
          detected: detected.slice(0, 30),
          recoveryCost: a.cost && costDigest(a.cost),
        };
      },
    }),
    get_activity: tool({
      description: t("tool.get_activity"),
      inputSchema: z.object({ id: z.string().min(1).max(100).describe(t("tool.get_activity.id")) }),
      execute: async ({ id }) => {
        const a = await getActivity(id, ctx);
        if (!a || a.day > todayOf(ctx)) return { workout: null, reason: "no_data" as const };
        return {
          workout: {
            id: a.id,
            day: a.day,
            name: a.name,
            minutes: Math.round((a.end - a.start) / 60_000),
            strain: num(a.strain, 1),
            stats: a.stats.map((v) => ({ label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average })),
            zones: a.zones,
            zoneNote: a.zoneNote,
            hrRecovery: a.hrr,
            insight: a.insight,
          },
          reason: null,
        };
      },
    }),
    get_journal_impacts: tool({
      description: t("tool.get_journal_impacts"),
      inputSchema: z.object({ outcome: z.enum(["recovery", "hrv", "sleep"]).default("recovery").describe(t("tool.get_journal_impacts.outcome")) }),
      execute: async ({ outcome }) => {
        const j = await getJournalInsights(outcome, ctx);
        return {
          outcome,
          unit: j.unit,
          effects: j.items.map((i) => ({ key: i.key, behaviour: i.label, effect: i.effect, confidenceInterval: i.ci ?? null, delta: round(i.delta, 1), withAvg: i.avgWith, withoutAvg: i.avgWithout, yesDays: i.yes, noDays: i.no })),
          needsMoreData: j.needsMore.map((n) => ({ behaviour: n.label, yesDays: n.yes, noDays: n.no })),
        };
      },
    }),
    get_health: tool({
      description: t("tool.get_health"),
      inputSchema: z.object({ day: Day(t("tool.get_health.day")) }),
      execute: async ({ day }) => {
        const d = await dayOf(ctx, day);
        // The web's todayOf reads ctx.now; the phone's reads ctx.today, so the dated context moves both.
        const dated = { ...ctx, today: d, now: Math.min(ctx.now, dayStartOf(ctx, addDays(d, 1)) - 1) };
        const [mon, hub, fit] = await Promise.all([getMonitor(d, dated), getHealthHub(dated), getFitness(dated)]);
        return {
          day: d,
          asOf: hub.day,
          trainingLoad: fit.trainingLoad,
          vitals: mon.vitals.map((v) => ({ vital: v.label, unit: v.unit, ...num(v.metric, 1), status: v.status, range: v.range })),
          illness: mon.illness,
          pulseAge: { value: hub.healthspan.value ? { years: round(hub.healthspan.value.pulseAge, 1), vsActualAge: round(hub.healthspan.value.deltaYears, 1) } : null, reason: hub.healthspan.reason, provisional: hub.healthspan.provisional },
          vo2max: { value: hub.fitness.value ? { vo2max: round(hub.fitness.value.vo2max, 1), category: hub.fitness.value.category } : null, reason: hub.fitness.reason, provisional: hub.fitness.provisional },
          trainingLoadRatio: hub.fitness.value?.acwr ?? null,
        };
      },
    }),
    get_report: tool({
      description: t("tool.get_report"),
      inputSchema: z.object({ kind: z.enum(["week", "month"]).default("week").describe(t("tool.get_report.kind")) }),
      execute: async ({ kind }) => {
        // The web reads More's latestWeek / latestMonth, which are this same latestReport.
        const latest = await latestReport(ctx, kind);
        const r = latest && (await getReport(latest.period, ctx));
        if (!r) return { report: null, reason: "no_data" };
        return {
          period: r.period,
          start: r.start,
          end: r.end,
          partial: r.partial,
          scores: r.dials.map((d) => ({ score: d.label, ...num(d.metric, 1), changeVsPrevious: d.delta })),
          averages: r.averages.map((a) => ({ label: a.label, unit: a.unit ?? null, ...num(a.metric, 1) })),
          trainingBalance: r.trainingBalance.value?.line ?? null,
          bestWorst: r.bestWorst,
          summary: r.insight,
        };
      },
    }),
    get_profile: tool({
      description: t("tool.get_profile"),
      inputSchema: z.object({}),
      execute: async () => {
        const p = ctx.profile;
        const age = Math.floor((Date.parse(todayOf(ctx)) - Date.parse(p.birthDate)) / (365.2425 * 86_400_000));
        return { age, sex: p.sex, maxHr: p.maxHr, timeZone: ctx.timeZone, firstDayWithData: await firstDay(ctx), today: todayOf(ctx), weekAgo: addDays(todayOf(ctx), -7) };
      },
    }),
  };
}

export type CoachTools = ReturnType<typeof coachTools>;

export type CoachOutputs = { [K in keyof CoachTools]: InferToolOutput<CoachTools[K]> };
