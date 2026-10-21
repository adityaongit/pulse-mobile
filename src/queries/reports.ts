// Reports (spec §7.13): one ISO week or calendar month, and the archive of every period with data. Ported from Pulse's
// src/server/queries/reports.ts; the web's `reports` table reads are Store reads (`store.getReports()`, which the
// pipeline's stage 2 rewrites on every run), and the VM shapes are the web's, verbatim. A phone addition rides along:
// the Performance Assessment (`performance`, after WHOOP's), computed here from the stored days of the period and the
// one before it, so the stored reports are unchanged.
import { assessPeriod, periodBounds, previousPeriod, type AssessKey, type Assessment, type AssessmentDay, type Report } from "@/core/algorithms/reports";
import { PLAN_DEFAULTS, type PlanTargets } from "@/core/algorithms/weeklyPlan";
import type { ReportRow } from "@/data/store";
import { DEFAULT_JOURNAL_TAGS } from "@/data/seed";
import { i18n } from "@/i18n/config";
import { metricLabel } from "@/lib/metricLabels";
import { FORMATS, hmm } from "./_lib";
import { type DayRow, exercisesBetween, finite, loadDays, none, ok, type QueryCtx, dayStrainOf } from "./common";
import { latestReport } from "./home";
import type { DriverItem, KeyStat, Metric, ReportVM, StackedSegment } from "./types";
import { planDays } from "./weeklyPlan";

/** The web's `like('____-W__')` and `like('____-__')`. */
export const WEEK_PERIOD = /^\d{4}-W\d{2}$/;
export const MONTH_PERIOD = /^\d{4}-\d{2}$/;
const patternOf = (kind: "week" | "month") => (kind === "week" ? WEEK_PERIOD : MONTH_PERIOD);

/** Every stored report, ascending by period (the Store's order). */
const allReports = (ctx: QueryCtx): Promise<ReportRow[]> => ctx.store.getReports();

const readReport = (rows: ReportRow[], period: string) => rows.find((r) => r.period === period)?.data ?? null;

/** The nearest same-kind period before (`dir` -1) or after (+1) `period`, or null. */
function neighbour(rows: ReportRow[], pattern: RegExp, period: string, dir: -1 | 1): string | null {
  const same = rows.filter((r) => pattern.test(r.period)).map((r) => r.period);
  if (dir < 0) return same.filter((p) => p < period).sort().at(-1) ?? null;
  return same.filter((p) => p > period).sort()[0] ?? null;
}

/** Training Load's status (the Pulse engine's) as the report's training balance: the stored status picks the line. */
const BALANCE = {
  maintaining: "balanced",
  peaking: "balanced",
  productive: "balanced",
  fatigued: "overreaching",
  overtraining: "overreaching",
  detraining: "undertrained",
} as const;

/** Reports `/reports/[period]` (spec §7.13); null for a period with no data. `targets`: the Weekly Plan's. */
export async function getReport(period: string, ctx: QueryCtx, targets: PlanTargets = PLAN_DEFAULTS.targets): Promise<ReportPageVM | null> {
  const all = await allReports(ctx);
  const r = readReport(all, period);
  if (!r || r.days === 0) return null;
  const kind = r.kind;
  const pattern = patternOf(kind);
  const prev = neighbour(all, pattern, period, -1);
  const next = neighbour(all, pattern, period, 1);
  const before = periodBounds(previousPeriod(period));
  const [both, exs, latestWeek, latestMonth, labels] = await Promise.all([
    loadDays(ctx, before.start, r.end),
    exercisesBetween(ctx, before.start, r.end),
    latestReport(ctx, "week"),
    latestReport(ctx, "month"),
    tagLabels(ctx),
  ]);
  const rows = new Map([...both].filter(([day]) => day >= r.start));
  const prevReport = prev ? readReport(all, prev) : null;

  const avg = (v: number | null): Metric<number> => (finite(v) ? ok(v) : none("no_data"));
  const periodWord = i18n.t(kind === "week" ? "reports:lastWeek" : "reports:lastMonth");
  const stat = (key: string, label: string, v: number | null, prevV: number | null | undefined, unit: string | undefined, direction: KeyStat["direction"]): KeyStat => ({
    key,
    label,
    metric: avg(v),
    ...(unit && { unit }),
    average: finite(prevV) ? prevV : null,
    direction,
  });
  const a = r.averages;
  const pa = prevReport?.averages;

  const bands: StackedSegment[] = [
    { key: "green", label: i18n.t("reports:band.green"), count: r.bands.green, color: "recovery-green" },
    { key: "yellow", label: i18n.t("reports:band.yellow"), count: r.bands.yellow, color: "recovery-yellow" },
    { key: "red", label: i18n.t("reports:band.red"), count: r.bands.red, color: "recovery-red" },
  ];
  const scored = r.bands.green + r.bands.yellow + r.bands.red;

  let inTarget = 0;
  let withTarget = 0;
  for (const row of rows.values()) {
    const t = row.strainTarget;
    const s = dayStrainOf(row.s1);
    if (t?.reason === null && s != null) {
      withTarget++;
      if (s >= t.low && s <= t.high) inTarget++;
    }
  }
  const tbStatus = r.trainingBalance ? BALANCE[r.trainingBalance.status as keyof typeof BALANCE] : null;
  const strainOf = (day: string) => dayStrainOf(rows.get(day)?.s1);

  const impacts: DriverItem[] = r.topImpacts.map((t) => ({
    key: t.tag,
    label: labels.get(t.tag) ?? t.tag,
    delta: t.effects.recovery.delta!,
    effect: t.effects.recovery.label === "positive" ? "positive" : "negative",
    yes: t.effects.recovery.nYes,
    no: t.effects.recovery.nNo,
    ci: [t.effects.recovery.ciLow!, t.effects.recovery.ciHigh!],
  }));

  return {
    period,
    kind,
    start: r.start,
    end: r.end,
    partial: r.partial,
    prev,
    next,
    latestWeek: latestWeek?.period ?? null,
    latestMonth: latestMonth?.period ?? null,
    dials: [
      { key: "sleep", label: i18n.t("reports:dial.sleep"), metric: avg(a.sleepPerf), delta: r.deltas.sleepPerf },
      { key: "recovery", label: i18n.t("reports:dial.recovery"), metric: avg(a.recovery), delta: r.deltas.recovery },
      { key: "strain", label: i18n.t("reports:dial.strain"), metric: avg(a.strain), delta: r.deltas.strain },
    ],
    insight: insightOf(r, periodWord, inTarget, withTarget),
    bands: scored ? ok(bands) : none("no_data"),
    averages: [
      stat("recovery", metricLabel("recovery"), a.recovery, pa?.recovery, "%", "up"),
      stat("strain", metricLabel("strain"), a.strain, pa?.strain, "%", "neutral"),
      stat("sleepPerf", metricLabel("sleep"), a.sleepPerf, pa?.sleepPerf, "%", "up"),
      stat("sleepHours", metricLabel("hours"), a.sleepHours, pa?.sleepHours, "h", "up"),
      stat("consistency", metricLabel("consistency"), r.sleepConsistency, prevReport?.sleepConsistency, "%", "up"),
      stat("hrv", metricLabel("hrv"), a.hrv, pa?.hrv, "ms", "up"),
      stat("rhr", metricLabel("rhr"), a.rhr, pa?.rhr, "bpm", "down"),
    ],
    trainingBalance: r.trainingBalance && tbStatus ? ok({ status: tbStatus, word: i18n.t(`reports:balance.${tbStatus}`), acwr: r.trainingBalance.acwr, line: i18n.t(`reports:balance.${r.trainingBalance.status as keyof typeof BALANCE}`) }) : none("no_data"),
    topImpacts: impacts,
    performance: performanceOf(assessPeriod(...assessmentDays(both, exs, r.start, before.start), kind, targets), targets),
    bestWorst:
      r.best && r.worst && scored >= 2
        ? [
            { label: "Best day", day: r.best.day, recovery: r.best.recovery, strain: strainOf(r.best.day) },
            { label: "Worst day", day: r.worst.day, recovery: r.worst.recovery, strain: strainOf(r.worst.day) },
          ]
        : null,
  };
}

// ── Performance assessment (phone addition) ─────────────────────────────────

/** One of the biggest changes: "Sleep consistency", "−12%". */
export type ReportChange = { key: AssessKey; label: string; text: string; better: boolean };

export type PerformanceVM = {
  /** 1–2 plain-language focus points, most salient first. */
  focus: string[];
  /** Up to 2 each, the largest first. */
  improved: ReportChange[];
  declined: ReportChange[];
  /** Hours slept, sleep need, nights at need and consistency, against the period before. */
  sleep: KeyStat[];
  /** Moderate and vigorous minutes and strength sessions a week, daily steps, against the period before. */
  activity: KeyStat[];
};

export type ReportPageVM = ReportVM & { performance: PerformanceVM };

const NBSP = "\u00a0";

/** How each assessment metric is named and how its change prints. Getters-in-a-function: nothing translated at import. */
const CHANGE: Record<AssessKey, { label: () => string; text: (d: number) => string }> = {
  recovery: { label: () => metricLabel("recovery"), text: (d) => `${FORMATS.signedInt(d)}%` },
  strain: { label: () => metricLabel("strain"), text: (d) => `${FORMATS.signedInt(d)}%` },
  sleepPerf: { label: () => metricLabel("sleep"), text: (d) => `${FORMATS.signedInt(d)}%` },
  hrv: { label: () => metricLabel("hrv"), text: (d) => `${FORMATS.signedInt(d)}${NBSP}ms` },
  rhr: { label: () => metricLabel("rhr"), text: (d) => `${FORMATS.signedInt(d)}${NBSP}bpm` },
  slept: { label: () => i18n.t("reports:perf.hoursSlept"), text: (d) => `${d > 0 ? "+" : "−"}${hmm(Math.abs(d))}` },
  consistency: { label: () => metricLabel("consistency"), text: (d) => `${FORMATS.signedInt(d)}%` },
  zone13: { label: () => i18n.t("reports:perf.moderate"), text: (d) => i18n.t("reports:perf.minPerWeek", { value: FORMATS.signedInt(d) }) },
  zone45: { label: () => i18n.t("reports:perf.vigorous"), text: (d) => i18n.t("reports:perf.minPerWeek", { value: FORMATS.signedInt(d) }) },
  strength: { label: () => i18n.t("reports:perf.strength"), text: (d) => i18n.t("reports:perf.perWeek", { value: FORMATS.signed1(d) }) },
  steps: { label: () => i18n.t("reports:perf.steps"), text: (d) => `${d > 0 ? "+" : ""}${FORMATS.grouped(d)}` },
};

/** The stored days as assessment days: the period's (from `start`) and the period before's (`prevStart` up to `start`). */
function assessmentDays(rows: Map<string, DayRow>, exs: Parameters<typeof planDays>[1], start: string, prevStart: string): [AssessmentDay[], AssessmentDay[]] {
  const plan = new Map(planDays(rows, exs).map((d) => [d.day, d]));
  const cur: AssessmentDay[] = [];
  const prev: AssessmentDay[] = [];
  for (const row of rows.values()) {
    if (row.day < prevStart) continue;
    const day: AssessmentDay = {
      ...plan.get(row.day)!,
      recovery: finite(row.recovery?.value) ? row.recovery.value : null,
      strain: dayStrainOf(row.s1),
      sleepPerf: finite(row.sleep?.performance) ? row.sleep.performance : null,
      hrv: row.metrics?.hrvMs ?? null,
      // As the stored report's days take it (src/pipeline/scores.ts recordOutcomes).
      rhr: row.rhr,
    };
    (row.day >= start ? cur : prev).push(day);
  }
  return [cur, prev];
}

const valueMetric = (v: number | null): Metric<number> => (finite(v) ? ok(v) : none("no_data"));

function performanceOf(a: Assessment, t: PlanTargets): PerformanceVM {
  const s = a.stats;
  const change = (st: Assessment["improved"][number], better: boolean): ReportChange => ({ key: st.key, label: CHANGE[st.key].label(), text: CHANGE[st.key].text(st.delta!), better });
  const vs = (key: AssessKey, label: string, unit: string | undefined, format: KeyStat["format"], caption?: string): KeyStat => ({
    key,
    label,
    metric: valueMetric(s[key].value),
    ...(unit && { unit }),
    average: s[key].previous,
    direction: "up",
    ...(format && { format }),
    ...(caption && { caption }),
  });
  const whole = (k: AssessKey) => [s[k].value, s[k].previous].every((v) => v === null || Math.abs(v - Math.round(v)) < 0.05);
  const { sleptMin, needMin, nightsMet, nights } = a.sleep;
  return {
    focus: a.focus,
    improved: a.improved.map((x) => change(x, true)),
    declined: a.declined.map((x) => change(x, false)),
    sleep: [
      vs("slept", i18n.t("reports:perf.hoursSlept"), undefined, "duration", needMin === null ? undefined : i18n.t("reports:perf.needPerNight", { value: hmm(needMin) })),
      {
        key: "nightsMet",
        label: i18n.t("reports:perf.nightsAtNeed"),
        metric: nights ? ok(nightsMet) : none("no_data"),
        ...(nights > 0 && { unit: i18n.t("reports:perf.nightsOf", { count: nights }) }),
        average: null,
        direction: "none",
        format: "int",
        ...(sleptMin !== null && needMin !== null && { caption: sleptMin >= needMin ? i18n.t("reports:perf.covered") : i18n.t("reports:perf.shortPerNight", { value: hmm(needMin - sleptMin) }) }),
      },
      vs("consistency", metricLabel("consistency"), "%", "int", i18n.t("reports:perf.targetPct", { value: t.consistency })),
    ],
    activity: [
      vs("zone13", i18n.t("reports:perf.moderate"), "min", "grouped", i18n.t("reports:perf.zones13", { value: t.zone13 })),
      vs("zone45", i18n.t("reports:perf.vigorous"), "min", "grouped", i18n.t("reports:perf.zones45", { value: t.zone45 })),
      vs("strength", i18n.t("reports:perf.strength"), undefined, whole("strength") ? "int" : "decimal1", i18n.t("reports:perf.strengthWeek", { value: t.strength })),
      vs("steps", i18n.t("reports:perf.steps"), undefined, "grouped", i18n.t("reports:perf.stepsTarget", { value: FORMATS.grouped(t.steps) })),
    ],
  };
}

/**
 * Behaviour labels by tag (the web's `journal_tags` read). The Journal inserts the default rows the first time it reads
 * them, so until then the defaults' own labels stand in; a tag with no row shows by its key, as on the web.
 */
async function tagLabels(ctx: QueryCtx): Promise<Map<string, string>> {
  const rows = await ctx.store.journalTags();
  return new Map<string, string>([...DEFAULT_JOURNAL_TAGS.map((t) => [t.tag, t.label] as const), ...rows.map((r) => [r.tag, r.label] as const)]);
}

function insightOf(r: Report, period: string, inTarget: number, withTarget: number): string | null {
  if (r.averages.recovery == null) return null;
  const scored = r.bands.green + r.bands.yellow + r.bands.red;
  const week = r.kind === "week";
  const mood = i18n.t(
    r.bands.red > r.bands.green ? (week ? "reports:insight.demandingWeek" : "reports:insight.demandingMonth") : r.bands.green * 2 >= scored ? (week ? "reports:insight.strongWeek" : "reports:insight.strongMonth") : week ? "reports:insight.balancedWeek" : "reports:insight.balancedMonth",
  );
  const parts = [withTarget ? i18n.t("reports:insight.greenDaysTarget", { mood, count: r.bands.green, inTarget, withTarget }) : i18n.t("reports:insight.greenDays", { mood, count: r.bands.green })];
  if (r.deltas.sleepPerf != null && Math.abs(r.deltas.sleepPerf) >= 3) {
    parts.push(i18n.t(r.deltas.sleepPerf > 0 ? "reports:insight.sleepRose" : "reports:insight.sleepDipped", { count: Math.abs(Math.round(r.deltas.sleepPerf)), period }));
  }
  return parts.join(" ");
}

/** One period in the archive: its dates and the three headline averages (null where none). */
export type ReportListItem = {
  period: string;
  start: string;
  end: string;
  partial: boolean;
  recovery: number | null;
  strain: number | null;
  sleepPerf: number | null;
};
export type ReportArchiveVM = { weeks: ReportListItem[]; months: ReportListItem[] };

/** Reports archive `/reports` (More): every week and month that has data, newest first. */
export async function getReportArchive(ctx: QueryCtx): Promise<ReportArchiveVM> {
  const rows = [...(await allReports(ctx))].sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
  const out: ReportArchiveVM = { weeks: [], months: [] };
  for (const row of rows) {
    const r = row.data;
    if (!r.days) continue;
    const a = r.averages;
    (r.kind === "week" ? out.weeks : out.months).push({
      period: row.period,
      start: r.start,
      end: r.end,
      partial: r.partial,
      recovery: finite(a.recovery) ? a.recovery : null,
      strain: finite(a.strain) ? a.strain : null,
      sleepPerf: finite(a.sleepPerf) ? a.sleepPerf : null,
    });
  }
  return out;
}
