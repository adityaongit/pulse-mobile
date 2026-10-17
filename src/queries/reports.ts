// Reports (spec §7.13): one ISO week or calendar month, and the archive of every period with data. Ported from Pulse's
// src/server/queries/reports.ts; the web's `reports` table reads are Store reads (`store.getReports()`, which the
// pipeline's stage 2 rewrites on every run), and the VM shapes are the web's, verbatim. A phone addition rides along:
// the Performance Assessment (`performance`, after WHOOP's), computed here from the stored days of the period and the
// one before it, so the stored reports are unchanged.
import { assessPeriod, periodBounds, previousPeriod, type AssessKey, type Assessment, type AssessmentDay, type Report } from "@/core/algorithms/reports";
import { PLAN_DEFAULTS, type PlanTargets } from "@/core/algorithms/weeklyPlan";
import type { ReportRow } from "@/data/store";
import { DEFAULT_JOURNAL_TAGS } from "@/data/seed";
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

/** Training Load's status (the Pulse engine's) as the report's training balance. */
const BALANCE = {
  maintaining: { status: "balanced", word: "Balanced", line: "Your training held steady with what your body is used to." },
  peaking: { status: "balanced", word: "Balanced", line: "Your fitness kept climbing at a pace your body is used to." },
  productive: { status: "balanced", word: "Balanced", line: "Your fatigue ran a little above your fitness: the kind of load that builds it." },
  fatigued: { status: "overreaching", word: "Overreaching", line: "Your fatigue ran above your fitness while Recovery was low. Watch your Recovery." },
  overtraining: { status: "overreaching", word: "Overreaching", line: "Your fatigue jumped well above your fitness. Injury and illness risk rise." },
  detraining: { status: "undertrained", word: "Undertrained", line: "Your fitness was falling. It slowly fades if this lasts." },
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
  const word = kind === "week" ? "week" : "month";
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
    { key: "green", label: "Green (67-100%)", count: r.bands.green, color: "recovery-green" },
    { key: "yellow", label: "Yellow (34-66%)", count: r.bands.yellow, color: "recovery-yellow" },
    { key: "red", label: "Red (0-33%)", count: r.bands.red, color: "recovery-red" },
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
  const tb = r.trainingBalance ? BALANCE[r.trainingBalance.status as keyof typeof BALANCE] : null;
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
      { key: "sleep", label: "Avg sleep", metric: avg(a.sleepPerf), delta: r.deltas.sleepPerf },
      { key: "recovery", label: "Avg recovery", metric: avg(a.recovery), delta: r.deltas.recovery },
      { key: "strain", label: "Avg strain", metric: avg(a.strain), delta: r.deltas.strain },
    ],
    insight: insightOf(r, word, inTarget, withTarget),
    bands: scored ? ok(bands) : none("no_data"),
    averages: [
      stat("recovery", "Recovery", a.recovery, pa?.recovery, "%", "up"),
      stat("strain", "Day strain", a.strain, pa?.strain, "%", "neutral"),
      stat("sleepPerf", "Sleep performance", a.sleepPerf, pa?.sleepPerf, "%", "up"),
      stat("sleepHours", "Hours of sleep", a.sleepHours, pa?.sleepHours, "h", "up"),
      stat("consistency", "Sleep consistency", r.sleepConsistency, prevReport?.sleepConsistency, "%", "up"),
      stat("hrv", "Heart rate variability", a.hrv, pa?.hrv, "ms", "up"),
      stat("rhr", "Resting heart rate", a.rhr, pa?.rhr, "bpm", "down"),
    ],
    trainingBalance: r.trainingBalance && tb ? ok({ status: tb.status, word: tb.word, acwr: r.trainingBalance.acwr, line: tb.line }) : none("no_data"),
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

/** How each assessment metric is named and how its change prints. */
const CHANGE: Record<AssessKey, { label: string; text: (d: number) => string }> = {
  recovery: { label: "Recovery", text: (d) => `${FORMATS.signedInt(d)}%` },
  strain: { label: "Day strain", text: (d) => `${FORMATS.signedInt(d)}%` },
  sleepPerf: { label: "Sleep performance", text: (d) => `${FORMATS.signedInt(d)}%` },
  hrv: { label: "Heart rate variability", text: (d) => `${FORMATS.signedInt(d)}${NBSP}ms` },
  rhr: { label: "Resting heart rate", text: (d) => `${FORMATS.signedInt(d)}${NBSP}bpm` },
  slept: { label: "Hours slept", text: (d) => `${d > 0 ? "+" : "−"}${hmm(Math.abs(d))}` },
  consistency: { label: "Sleep consistency", text: (d) => `${FORMATS.signedInt(d)}%` },
  zone13: { label: "Moderate activity", text: (d) => `${FORMATS.signedInt(d)}${NBSP}min a week` },
  zone45: { label: "Vigorous activity", text: (d) => `${FORMATS.signedInt(d)}${NBSP}min a week` },
  strength: { label: "Strength sessions", text: (d) => `${FORMATS.signed1(d)} a week` },
  steps: { label: "Daily steps", text: (d) => `${d > 0 ? "+" : ""}${FORMATS.grouped(d)}` },
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
  const change = (st: Assessment["improved"][number], better: boolean): ReportChange => ({ key: st.key, label: CHANGE[st.key].label, text: CHANGE[st.key].text(st.delta!), better });
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
      vs("slept", "Hours slept", undefined, "duration", needMin === null ? undefined : `Need ${hmm(needMin)} a night`),
      {
        key: "nightsMet",
        label: "Nights at sleep need",
        metric: nights ? ok(nightsMet) : none("no_data"),
        ...(nights > 0 && { unit: `of ${nights}` }),
        average: null,
        direction: "none",
        format: "int",
        ...(sleptMin !== null && needMin !== null && { caption: sleptMin >= needMin ? "You covered your need on average" : `${hmm(needMin - sleptMin)} short a night on average` }),
      },
      vs("consistency", "Sleep consistency", "%", "int", `Target ${t.consistency}%`),
    ],
    activity: [
      vs("zone13", "Moderate activity", "min", "grouped", `Zones 1–3 a week · target ${t.zone13}`),
      vs("zone45", "Vigorous activity", "min", "grouped", `Zones 4–5 a week · target ${t.zone45}`),
      vs("strength", "Strength sessions", undefined, whole("strength") ? "int" : "decimal1", `A week · target ${t.strength}`),
      vs("steps", "Daily steps", undefined, "grouped", `Target ${FORMATS.grouped(t.steps)} a day`),
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

function insightOf(r: Report, word: string, inTarget: number, withTarget: number): string | null {
  if (r.averages.recovery == null) return null;
  const scored = r.bands.green + r.bands.yellow + r.bands.red;
  const mood = r.bands.red > r.bands.green ? "A demanding" : r.bands.green * 2 >= scored ? "A strong" : "A balanced";
  const parts = [`${mood} ${word}: ${r.bands.green} green ${r.bands.green === 1 ? "day" : "days"}`];
  if (withTarget) parts[0] += ` and strain inside your target on ${inTarget} of ${withTarget} days`;
  parts[0] += ".";
  if (r.deltas.sleepPerf != null && Math.abs(r.deltas.sleepPerf) >= 3) {
    parts.push(`Sleep performance ${r.deltas.sleepPerf > 0 ? "rose" : "dipped"} ${Math.abs(Math.round(r.deltas.sleepPerf))} points from last ${word}.`);
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
