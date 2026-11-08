// Home `/` (spec §7.1). Ported from Pulse's src/server/queries/home.ts.
import { i18n } from "@/i18n/config";
import { inUnits, shownValue } from "@/lib/units";
import { addDays, localMinutes } from "@/lib/time";
import { energyBand } from "@/core/engine/energyBank";
import {
  BODY_METRICS,
  DASHBOARD_DEFAULT,
  DASHBOARD_LABEL,
  DASHBOARD_METRICS,
  type DashboardKey,
  EXTRA_METRICS,
  type ExtraKey,
  type ExtraMetric,
  hmm,
  isDashboardKey,
  metricHref,
  PHONE_DEFAULT,
  PHONE_STATS,
} from "./_lib";
import { insightOf as recoveryInsight } from "./recovery";
import { insightOf as sleepInsight } from "./sleep";
import { detectedItem } from "./activityCost";
import { coach } from "./strain";
import {
  type DayRow,
  hrReason,
  loadDays,
  loadSeries,
  maybe,
  minutePoints,
  ms,
  none,
  nightNeedMin,
  nightReason,
  ok,
  planVM,
  priorStats,
  type QueryCtx,
  recoveryMetric,
  sleepMetric,
  strainMetric,
  stressNow,
  exercisesBetween,
  timelineOf,
  todayOf,
  vitalReason,
  dayStartOf,
  finite,
  recoveryBand,
  dayStrainOf,
} from "./common";
import type { CardStatKey, EnergyBankVM, HomeVM, KeyStat, Metric, VitalKey } from "./types";

/** Getters, so the text follows the language (a plain object would freeze the first one). */
export const VITAL_LABEL: Record<VitalKey, string> = {
  get resp() {
    return i18n.t("home:vital.resp");
  },
  get spo2() {
    return i18n.t("home:vital.spo2");
  },
  get restingHr() {
    return i18n.t("home:vital.restingHr");
  },
  get hrv() {
    return i18n.t("home:vital.hrv");
  },
  get skinTempDev() {
    return i18n.t("home:vital.skinTempDev");
  },
  get bp() {
    return i18n.t("home:vital.bp");
  },
};

/** A drain's name: the engine stores "Stress", "Activity" or the workout's name in English; those three map to keys, a named workout shows as stored. */
const DRAIN_CODE: Record<string, "stress" | "activity" | "workout"> = { Stress: "stress", Activity: "activity", Workout: "workout" };
const drainLabel = (stored: string) => (DRAIN_CODE[stored] ? i18n.t(`ui:drain.${DRAIN_CODE[stored]}`) : stored);

/** The stats Home's own cards read, whatever My Dashboard shows (HomeVM.cardStats). */
const CARD_STATS: CardStatKey[] = ["hrv", "rhr", "resp", "steps", "calories"];

export type HomeOptions = {
  /**
   * My Dashboard's chosen metrics in order (the web keeps them in `dashboard_metrics`; the mobile app keeps them in
   * its own settings and passes them here). Unknown keys are skipped; none means the default list.
   */
  dashboardKeys?: readonly string[];
};

/** Home `/` for `day` (spec §7.1). */
export async function getHome(day: string, ctx: QueryCtx, opts: HomeOptions = {}): Promise<HomeVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const stripStart = day < addDays(today, -29) ? day : addDays(today, -29);
  const [rows, exs, defaults, weeklyTeaser, journal, ebSeries] = await Promise.all([
    loadDays(ctx, addDays(stripStart, -30), today),
    exercisesBetween(ctx, day, day),
    dashboardDefault(ctx),
    latestReport(ctx, "week"),
    journalWeek(ctx, day),
    loadSeries(ctx, day, "energy_bank"),
  ]);
  const keys = dashboardKeys(opts.dashboardKeys, defaults);
  const row = rows.get(day);

  const recovery = recoveryMetric(row, isToday);
  const sleep = sleepMetric(row, isToday);
  const strain = strainMetric(row);
  const target = row?.strainTarget?.reason === null ? ([row.strainTarget.low, row.strainTarget.high] as [number, number]) : null;
  const firstReason = [recovery, sleep, strain].find((m) => m.value == null);

  const strip: HomeVM["strip"] = [];
  for (let d = stripStart; d <= today; d = addDays(d, 1)) strip.push({ day: d, recovery: rows.get(d)?.recovery?.value ?? null });

  return {
    day,
    today,
    isToday,
    strip,
    dials: {
      sleep,
      recovery,
      strain,
      strainTarget: target,
      soFar: isToday,
      reason: firstReason ? { reason: firstReason.reason!, ...(firstReason.nightsLeft !== undefined && { nightsLeft: firstReason.nightsLeft }) } : null,
    },
    monitorAlert: monitorAlert(row),
    monitor: monitorSummary(row, isToday),
    stress: stressNow(row, isToday),
    // types.ts still types the title as the two English literals; it is translated text now (types.ts is shared).
    activities: { title: i18n.t(isToday ? "home:activities.today" : "home:activities.other"), items: timelineOf(row, day, exs), detected: (row?.detected ?? []).map(detectedItem) },
    energyBank: energyBankVM(ctx, row, day, isToday, ebSeries),
    tonight: planVM(ctx, row, isToday),
    keyStats: keyStats(rows, day, isToday, keys),
    cardStats: Object.fromEntries(keyStats(rows, day, isToday, CARD_STATS).map((s) => [s.key, s])) as HomeVM["cardStats"],
    dashboard: { defaults, empty: emptyKeys(rows, day, isToday) },
    phone: phoneDay(rows, day, isToday),
    weeklyTeaser,
    outlook: outlookOf(ctx, row, { recovery, strain, target }, isToday),
    insights: isToday ? insightsOf(ctx, rows, row, day, { strain, target }) : [],
    journalWeek: journal,
    strainRecovery: Array.from({ length: 7 }, (_, k) => {
      const d = addDays(day, k - 6);
      const r = rows.get(d);
      const e = dayStrainOf(r?.s1);
      const rec = r?.recovery?.value;
      // Today has no Strain score until effort accrues: a 0.0 would plot as a dive to the floor, so it is a gap (SYM4).
      const scored = finite(e) && (d !== today || e > 0);
      return { day: d, strain: scored ? e : null, recovery: finite(rec) ? rec : null };
    }),
  };
}

/** The reference app's banners switch from outlook to review at 17:00 (inferred, spec §12 I15). */
export const REVIEW_FROM_MIN = 17 * 60;
/** Strain as a whole percent: "42%". */
const pct = (x: number) => `${Math.round(x)}%`;

type DayScores = { recovery: Metric<number>; strain: Metric<number>; target: [number, number] | null };

/** "Your daily outlook" / "Your day in review": a templated summary of the day's stored scores (spec §7.1 7a). */
export function outlookOf(ctx: QueryCtx, row: DayRow | undefined, s: DayScores, isToday: boolean): HomeVM["outlook"] {
  const review = !isToday || localMinutes(ctx.now, ctx.timeZone) >= REVIEW_FROM_MIN;
  const rec = s.recovery.value;
  const target = s.target ? `${Math.round(s.target[0])} - ${pct(s.target[1])}` : null;
  const parts: string[] = [];
  if (!review) {
    if (rec != null) parts.push(i18n.t("home:outlook.recovery", { value: Math.round(rec), band: i18n.t(`home:outlook.band.${recoveryBand(rec)}`) }));
    if (target) parts.push(i18n.t("home:outlook.strainTarget", { target }));
    const main = row?.sleep?.main;
    const need = nightNeedMin(row?.sleep);
    if (main && need) parts.push(i18n.t("home:outlook.slept", { asleep: hmm(main.asleepMin), need: hmm(need) }));
  } else {
    const n = row?.activities.length ?? 0;
    const tense = isToday ? "Is" : "Was";
    if (s.strain.value != null) {
      const key = `home:outlook.strain${tense}${target ? "Target" : ""}${n ? "Acts" : ""}` as const;
      parts.push(i18n.t(key, { value: pct(s.strain.value), target: target ?? "", count: n }));
    }
    if (rec != null) parts.push(i18n.t(`home:outlook.recovery${tense}`, { value: Math.round(rec) }));
    const st = row?.stress;
    if (st && st.average != null) parts.push(i18n.t("home:outlook.highStress", { duration: hmm(st.highMin) }));
  }
  if (!parts.length) return null;
  return { kind: review ? "review" : "outlook", title: i18n.t(review ? "home:outlook.titleReview" : "home:outlook.titleOutlook"), body: parts.join(" ") };
}

const RECOVERY_TITLE = { green: "home:insights.recoveryGreen", yellow: "home:insights.recoveryYellow", red: "home:insights.recoveryRed" } as const;

/** Today's coach cards from the same templates the detail screens use (Strain Coach, Recovery, Sleep). */
function insightsOf(ctx: QueryCtx, rows: Map<string, DayRow>, row: DayRow | undefined, day: string, s: Pick<DayScores, "strain" | "target">): HomeVM["insights"] {
  const out: HomeVM["insights"] = [];
  const target = s.target ? { low: s.target[0], high: s.target[1] } : null;
  const c = coach(s.strain, target, row);
  if (c && target && s.strain.value != null) {
    const v = s.strain.value;
    const red = row?.recovery?.value != null && row.recovery.value < 34;
    const title = i18n.t(red ? "home:insights.keepLight" : v < target.low ? "home:insights.roomForMore" : v <= target.high ? "home:insights.optimal" : "home:insights.pastTarget");
    out.push({ key: "strain", title, body: c, href: "/strain" });
  }
  const r = row?.recovery;
  if (r?.value != null) out.push({ key: "recovery", title: i18n.t(RECOVERY_TITLE[recoveryBand(r.value)]), body: recoveryInsight(r.drivers), href: "/recovery" });
  const sl = sleepInsight(rows, day, ctx.timeZone);
  if (sl) out.push({ key: "sleep", title: i18n.t("home:insights.lastNight"), body: sl, href: "/sleep" });
  return out;
}

async function journalWeek(ctx: QueryCtx, day: string): Promise<HomeVM["journalWeek"]> {
  const from = addDays(day, -6);
  const done = new Set((await ctx.store.allJournal()).filter((j) => j.day >= from && j.day <= day).map((j) => j.day));
  return Array.from({ length: 7 }, (_, k) => {
    const d = addDays(from, k);
    return { day: d, done: done.has(d) };
  });
}

/** Raised (or agreeing with a logged illness) counts as the illness flag. */
export const illnessRaised = (hm: DayRow["healthMonitor"]) =>
  !!hm && hm.reason === null && (hm.illness.level === "raised" || (hm.illness.level === "alreadyUnwell" && hm.illness.score >= 50 && hm.illness.signalCount >= 2));

function monitorAlert(row: DayRow | undefined): HomeVM["monitorAlert"] {
  const hm = row?.healthMonitor;
  if (!hm || hm.reason !== null) return null;
  const flagged = hm.vitals.filter((v) => v.status === "high" || v.status === "low");
  const illness = illnessRaised(hm);
  if (!illness && !flagged.length) return null;
  return { kind: illness ? "illness" : "flagged", count: flagged.length, names: flagged.map((v) => VITAL_LABEL[v.key]) };
}

function monitorSummary(row: DayRow | undefined, isToday: boolean): HomeVM["monitor"] {
  const hm = row?.healthMonitor;
  if (!hm) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (hm.reason !== null) return none(nightReason(hm.reason, isToday));
  return ok({ inRange: hm.inRange, total: hm.vitals.length, flagged: hm.flagged });
}

/** `series` is the day's stored energy_bank minute series (loadSeries), fetched by the caller alongside its other reads. */
export function energyBankVM(ctx: QueryCtx, row: DayRow | undefined, day: string, isToday: boolean, series: (number | null)[] | null): Metric<EnergyBankVM> {
  const eb = row?.energyBank;
  if (!eb) return none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  if (eb.value == null) return none(nightReason(eb.reason, isToday), row?.recovery?.nightsLeft);
  const start = dayStartOf(ctx, day);
  // From where the curve starts: midnight when it carries on from yesterday (the night's recharge shows), else wake.
  const fromM = Math.max(0, Math.floor(((eb.from ?? eb.wake) - start) / 60));
  const untilM = Math.ceil((eb.until - start) / 60);
  const curve = minutePoints(series, start, 5, fromM, untilM).filter((p) => p.v != null);
  return ok(
    {
      current: eb.value,
      band: energyBand(eb.value),
      startLevel: eb.startLevel,
      startAt: ms(eb.wake),
      until: ms(eb.until),
      charged: eb.charged,
      drained: eb.drained,
      curve,
      drains: eb.topDrains.map((d) => ({ label: drainLabel(d.label), kind: d.kind, start: ms(d.start), amount: d.amount })),
      naps: eb.naps.map((n) => ({ start: ms(n.start), end: ms(n.end) })),
    },
    eb.provisional,
  );
}

/** True once any heart rate has synced: a phone-only account (no band) has none. */
const hasBand = async (ctx: QueryCtx) => (await ctx.store.hrBounds()) !== null;

/** My Dashboard's default list: the v1 rows, or the phone metrics for an account that has never synced heart rate (§11 CD2). */
export const dashboardDefault = async (ctx: QueryCtx): Promise<DashboardKey[]> => ((await hasBand(ctx)) ? DASHBOARD_DEFAULT : PHONE_DEFAULT);

/** My Dashboard's chosen metrics in order. Keys no longer in the catalogue are skipped; none chosen means the default list. */
export function dashboardKeys(chosen: readonly string[] | undefined, defaults: DashboardKey[]): DashboardKey[] {
  const keys = (chosen ?? []).filter(isDashboardKey);
  return keys.length ? keys : defaults;
}

type StatSpec = Omit<KeyStat, "key" | "label" | "average" | "sd"> & { pick: (r: DayRow) => number | null | undefined };

const spec = (
  pick: StatSpec["pick"],
  metric: Metric<number>,
  unit: string | undefined,
  direction: KeyStat["direction"],
  href?: string,
  format?: KeyStat["format"],
  deviation = false,
): StatSpec => {
  // In the person's units (src/lib/units.ts): the day's value, and the pick its average reads.
  const s = inUnits({ unit, pick, deviation });
  const value = metric.value === null ? metric : { ...metric, value: shownValue(unit, metric.value, deviation) };
  return { pick: s.pick, metric: value, ...(s.unit && { unit: s.unit }), direction, ...(href && { href }), ...(format && { format }) };
};

/** Each dashboard metric on `row`'s day: its value path (for averages), the metric with its reason, unit and link. */
function statSpecs(row: DayRow | undefined, isToday: boolean): Record<DashboardKey, StatSpec> {
  const m = row?.metrics;
  const rhr = (r: DayRow) => r.rhr;
  const skin = (r: DayRow) => r.recovery?.inputs.skinTempDev ?? null;
  const skinReason = m?.nightlyTempC != null ? "calibrating" : vitalReason(row, isToday);
  const dailyReason = !row?.s1 || row.s1.hrCount === 0 ? hrReason(row?.s1 ?? null) : "no_data";
  const out = {
    hrv: spec((r) => r.metrics?.hrvMs, maybe(m?.hrvMs, vitalReason(row, isToday, true)), "ms", "up", "/chart?metric=hrv&r=m"),
    rhr: spec(rhr, maybe(row && rhr(row), vitalReason(row, isToday)), "bpm", "down", "/chart?metric=rhr&r=m"),
    resp: spec((r) => r.metrics?.respBpm, maybe(m?.respBpm, vitalReason(row, isToday)), "rpm", "neutral", "/health/monitor"),
    sleep: spec((r) => r.sleep?.performance, sleepMetric(row, isToday), "%", "up", "/sleep"),
    calories: spec((r) => r.metrics?.calories, maybe(m?.calories, dailyReason), "kcal", "neutral", metricHref("calories")),
    steps: spec((r) => r.metrics?.steps, maybe(m?.steps, dailyReason), undefined, "up", metricHref("steps")),
    spo2: spec((r) => r.metrics?.spo2Pct, maybe(m?.spo2Pct, vitalReason(row, isToday)), "%", "up", "/health/monitor"),
    skin: spec(skin, maybe(row && skin(row), skinReason), "°C", "toward_zero", "/health/monitor", undefined, true),
  } as Record<DashboardKey, StatSpec>;
  // Shown-only readings: missing simply means the source had none for the day.
  for (const b of BODY_METRICS) {
    const pick = (r: DayRow) => (b.key === "weight" ? r.metrics?.weightKg : r.metrics?.bodyFatPct);
    out[b.key] = spec(pick, maybe(row && pick(row), "no_data"), b.unit, b.direction, b.href, b.format);
  }
  for (const e of EXTRA_METRICS as readonly ExtraMetric[])
    out[e.key as ExtraKey] = spec((r) => r.extra[e.key as ExtraKey], maybe(row?.extra[e.key as ExtraKey], "no_data"), e.unit, e.direction, metricHref(e.key), e.format);
  return out;
}

/** The dashboard rows for `keys`, in that order, each against its mean over the 30 days before `day`. */
export function keyStats(rows: Map<string, DayRow>, day: string, isToday: boolean, keys: DashboardKey[]): KeyStat[] {
  const specs = statSpecs(rows.get(day), isToday);
  return keys.map((key) => {
    const { pick, ...s } = specs[key];
    const { mean, sd } = priorStats(rows, day, pick);
    return { key, label: DASHBOARD_LABEL[key], ...s, average: mean, ...(sd !== undefined && { sd }) };
  });
}

/** Catalogue metrics with no value on `day` or in the 30 days before it: the editor marks them "No data yet". */
function emptyKeys(rows: Map<string, DayRow>, day: string, isToday: boolean): DashboardKey[] {
  const specs = statSpecs(rows.get(day), isToday);
  const days = Array.from({ length: 31 }, (_, k) => rows.get(addDays(day, -k))).filter((r): r is DayRow => !!r);
  return DASHBOARD_METRICS.map((m) => m.key).filter((key) => !days.some((r) => finite(specs[key].pick(r))));
}

/**
 * The band recorded no heart rate on `day` but the phone counted something: Home leads with those numbers (§11 CD2).
 * Null when the band was worn, or when the phone recorded nothing either.
 */
function phoneDay(rows: Map<string, DayRow>, day: string, isToday: boolean): KeyStat[] | null {
  const row = rows.get(day);
  if (!row || (row.s1 && row.s1.hrCount > 0)) return null;
  // Calories alone is the source's resting-burn estimate, there with or without a phone: it needs movement too.
  if (!row.metrics?.steps && !row.extra.distance && !row.activities.length) return null;
  const stats = keyStats(rows, day, isToday, PHONE_STATS).filter((s) => s.metric.value !== null);
  return stats.length ? stats : null;
}

/**
 * The latest complete week or month with a report: of the three newest periods of the kind, the first that is not
 * partial and has data. The web reads its `reports` table; here the pipeline's stage 2 writes them to the Store.
 */
export async function latestReport(ctx: QueryCtx, kind: "week" | "month"): Promise<HomeVM["weeklyTeaser"]> {
  const pattern = kind === "week" ? /^\d{4}-W\d{2}$/ : /^\d{4}-\d{2}$/;
  const rows = (await ctx.store.getReports())
    .filter((r) => pattern.test(r.period))
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
    .slice(0, 3);
  for (const r of rows) {
    const d = r.data;
    if (!d.partial && d.days > 0) return { period: r.period, start: d.start, end: d.end };
  }
  return null;
}
