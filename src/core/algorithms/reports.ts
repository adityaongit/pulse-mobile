// Own algorithm (docs/algorithms/reports.md): ISO-week (Monday–Sunday) and calendar-month summaries of the
// daily scores, with deltas against the previous period of the same kind.
import { mean } from "../scoring/forecast";
import type { LoadStatus } from "../engine/strain";
import { band, type RecoveryBand } from "../scoring/recovery";
import type { TagImpact } from "./journalImpact";
import { hasPlanData, PLAN_DEFAULTS, type PlanDay, type PlanTargets } from "./weeklyPlan";

/** One local day of scores; null where the score is not available. U10 maps daily_scores and daily_metrics into it. */
export interface ReportDay {
  day: string;
  /** 0–100 */
  recovery: number | null;
  /** Daily Strain, a percent. */
  strain: number | null;
  /** 0–100 */
  sleepPerf: number | null;
  /** Hours asleep, main sleep plus naps. */
  sleepHours: number | null;
  /** ms */
  hrv: number | null;
  /** bpm */
  rhr: number | null;
  /** Training Load on the Pulse engine this day: Fatigue ÷ Fitness (ATL ÷ CTL) and its status. */
  acwr: number | null;
  loadStatus?: LoadStatus | null;
  /** Sleep Regularity display value, 0–100. */
  sleepConsistency: number | null;
}

export const REPORT_METRICS = ["recovery", "strain", "sleepPerf", "sleepHours", "hrv", "rhr"] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export interface Report {
  /** `2026-W40` or `2026-10`. */
  period: string;
  kind: "week" | "month";
  start: string;
  end: string;
  /** The data does not cover the whole period (it is in progress, or history starts inside it). */
  partial: boolean;
  /** Days in the period with a row. */
  days: number;
  averages: Record<ReportMetric, number | null>;
  /** averages − the previous period's averages; null when either side is missing. */
  deltas: Record<ReportMetric, number | null>;
  /** Days in each band; sums to the days with a recovery score. */
  bands: Record<RecoveryBand, number>;
  /** From the period's last day with an ACWR. */
  trainingBalance: { acwr: number; status: LoadStatus } | null;
  sleepConsistency: number | null;
  /** Up to 3 tags with a clear recovery effect, largest |Δ| first. */
  topImpacts: TagImpact[];
  best: { day: string; recovery: number } | null;
  worst: { day: string; recovery: number } | null;
}

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isoDow = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

/** ISO 8601 week of a day, e.g. `2026-W40`: the week belongs to the year of its Thursday. */
export function isoWeek(day: string): string {
  const thursday = addDays(day, 3 - isoDow(day));
  const year = thursday.slice(0, 4);
  const week = Math.floor((Date.parse(thursday) - Date.parse(`${year}-01-01`)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** First and last day of `2026-W40` or `2026-10`. */
export function periodBounds(period: string): { start: string; end: string } {
  const w = /^(\d{4})-W(\d{2})$/.exec(period);
  if (w) {
    const jan4 = `${w[1]}-01-04`; // always in week 1
    const start = addDays(jan4, (Number(w[2]) - 1) * 7 - isoDow(jan4));
    return { start, end: addDays(start, 6) };
  }
  const [y, m] = period.split("-").map(Number);
  return { start: `${period}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

const periodOf = (day: string, kind: Report["kind"]) => (kind === "week" ? isoWeek(day) : day.slice(0, 7));

/** Every week and month that has at least one row, oldest first, weeks before months. */
export function reportPeriods(rows: ReportDay[]): string[] {
  const days = rows.map((r) => r.day).sort();
  return [...new Set(days.map((d) => isoWeek(d))), ...new Set(days.map((d) => d.slice(0, 7)))];
}

const averages = (rows: ReportDay[]) =>
  Object.fromEntries(
    REPORT_METRICS.map((m) => {
      const xs = rows.map((r) => r[m]).filter((v): v is number => v != null);
      return [m, xs.length ? mean(xs) : null];
    }),
  ) as Record<ReportMetric, number | null>;

/**
 * The report for `period`. `rows` may hold any days (all history is fine); `impacts` is journalImpact()
 * as of the period's end (or the latest), and only its clear recovery effects are used.
 */
export function buildReport(period: string, rows: ReportDay[], impacts: TagImpact[] = []): Report {
  const kind = period.includes("W") ? "week" : "month";
  const { start, end } = periodBounds(period);
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const cur = sorted.filter((r) => r.day >= start && r.day <= end);
  const prevPeriod = periodOf(addDays(start, -1), kind);
  const prev = sorted.filter((r) => periodOf(r.day, kind) === prevPeriod);

  const avg = averages(cur);
  const prevAvg = averages(prev);
  const deltas = Object.fromEntries(
    REPORT_METRICS.map((m) => [m, avg[m] != null && prevAvg[m] != null ? avg[m] - prevAvg[m] : null]),
  ) as Record<ReportMetric, number | null>;

  const scored = cur.filter((r): r is ReportDay & { recovery: number } => r.recovery != null);
  const bands: Record<RecoveryBand, number> = { red: 0, yellow: 0, green: 0 };
  for (const r of scored) bands[band(r.recovery)]++;
  // Ties go to the earliest day.
  const best = scored.reduce<(typeof scored)[number] | null>((b, r) => (!b || r.recovery > b.recovery ? r : b), null);
  const worst = scored.reduce<(typeof scored)[number] | null>((w, r) => (!w || r.recovery < w.recovery ? r : w), null);

  // The period's last day with a calibrated Training Load status.
  const lastLoad = cur.findLast((r) => r.acwr != null && r.loadStatus != null && r.loadStatus !== "calibrating") ?? null;
  const consistency = cur.map((r) => r.sleepConsistency).filter((v): v is number => v != null);

  return {
    period,
    kind,
    start,
    end,
    partial: sorted.length === 0 || start < sorted[0].day || end > sorted[sorted.length - 1].day,
    days: cur.length,
    averages: avg,
    deltas,
    bands,
    trainingBalance: lastLoad ? { acwr: lastLoad.acwr!, status: lastLoad.loadStatus! } : null,
    sleepConsistency: consistency.length ? mean(consistency) : null,
    topImpacts: impacts
      .filter((t) => t.effects.recovery.label === "positive" || t.effects.recovery.label === "negative")
      .sort((a, b) => Math.abs(b.effects.recovery.delta!) - Math.abs(a.effects.recovery.delta!))
      .slice(0, 3),
    best: best && { day: best.day, recovery: best.recovery },
    worst: worst && { day: worst.day, recovery: worst.recovery },
  };
}

// ── Performance assessment ───────────────────────────────────────────────────
// A phone addition after WHOOP's Weekly / Monthly Performance Assessment: each metric's average for the period against
// the period before, the biggest moves either way, and one or two plain-language focus points. The method follows
// noop's analytics/WeeklyDigest.kt and RangeReport.kt (© 2026 NoopApp, PolyForm Noncommercial 1.0.0): moves are
// scaled by a typical spread so metrics on different units rank together, and a move needs MIN_DAYS on both sides.
// Computed by the report query from the stored days; the stored Report (stage 2) is unchanged.

/** One day of the assessment: the plan's habits (src/core/algorithms/weeklyPlan.ts) and the day's scores. */
export interface AssessmentDay extends PlanDay {
  recovery: number | null;
  /** Daily Strain, a percent. */
  strain: number | null;
  sleepPerf: number | null;
  hrv: number | null;
  rhr: number | null;
}

export const ASSESS_KEYS = ["recovery", "strain", "sleepPerf", "hrv", "rhr", "slept", "consistency", "zone13", "zone45", "strength", "steps"] as const;
export type AssessKey = (typeof ASSESS_KEYS)[number];

/**
 * Per metric: the good direction and the typical spread a move is scaled by (*tunable*). Recovery, sleep, HRV and
 * resting HR are noop's (12, 12, 8 ms, 4 bpm); Strain is noop's 12 on its percent; the rest are ours,
 * about a band's width each: half an hour of sleep, 8 consistency points, 60 and 30 zone minutes a week, a session,
 * 1,500 steps.
 */
export const ASSESS: Record<AssessKey, { better: "up" | "down" | "neutral"; spread: number }> = {
  recovery: { better: "up", spread: 12 },
  strain: { better: "neutral", spread: 12 },
  sleepPerf: { better: "up", spread: 12 },
  hrv: { better: "up", spread: 8 },
  rhr: { better: "down", spread: 4 },
  slept: { better: "up", spread: 30 },
  consistency: { better: "up", spread: 8 },
  zone13: { better: "up", spread: 60 },
  zone45: { better: "up", spread: 30 },
  strength: { better: "up", spread: 1 },
  steps: { better: "up", spread: 1500 },
};

export const assessConfig = {
  /** Days each side needs before a move is real enough to rank (noop's MIN_DAYS_FOR_FOCUS). */
  minDays: 3,
  /** A move (in spreads) worth listing among the biggest changes. */
  changeThreshold: 0.25,
  /** A move or a gap to target (in spreads) worth a focus point (noop's FOCUS_THRESHOLD). */
  focusThreshold: 0.5,
  /** Sleep short of need by at least this many minutes a night is a gap. */
  sleepGapMin: 20,
};

export interface AssessmentStat {
  key: AssessKey;
  /** The period's value: the daily mean; zone minutes and strength sessions a week (daily mean × 7); `slept` in minutes. */
  value: number | null;
  previous: number | null;
  /** value − previous; null when either is missing. */
  delta: number | null;
  /** Days with a value, this period and the one before. */
  n: number;
  prevN: number;
  /** delta ÷ spread, signed so + is better; null for Strain (no good direction) or with fewer than minDays a side. */
  move: number | null;
}

/** A line of advice as a code and its parameters: counts of things are numbers (`points`, `sessions`, `walks`, `days`). */
export type FocusItem = { code: string; params: Record<string, number | string> };

export interface Assessment {
  stats: Record<AssessKey, AssessmentStat>;
  /** Nights with a main sleep and a need: the averages and how many met the need. */
  sleep: { sleptMin: number | null; needMin: number | null; nightsMet: number; nights: number };
  /** Up to 2 each, the largest first. */
  improved: AssessmentStat[];
  declined: AssessmentStat[];
  /** 1–2 focus points, most salient first, as codes the queries turn into words (`reports:focus.<code>`). */
  focus: FocusItem[];
  /** Days with any data, this period and the one before. */
  days: number;
  prevDays: number;
}

const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const isNum = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const hasAny = (d: AssessmentDay) => hasPlanData(d) || [d.recovery, d.strain, d.sleepPerf, d.hrv, d.rhr].some(isNum);

function valueOf(key: AssessKey, days: readonly AssessmentDay[]): { value: number | null; n: number } {
  const pick = (f: (d: AssessmentDay) => number | null) => {
    const xs = days.map(f).filter(isNum);
    return { xs, value: avgOf(xs), n: xs.length };
  };
  switch (key) {
    case "slept":
      return pick((d) => d.sleptMin);
    case "zone13":
    case "zone45": {
      const p = pick((d) => (key === "zone13" ? d.zone13Min : d.zone45Min));
      return { value: p.value === null ? null : p.value * 7, n: p.n };
    }
    case "strength": {
      const worn = days.filter(hasPlanData);
      return { value: worn.length ? (worn.reduce((a, d) => a + d.strengthSessions, 0) * 7) / worn.length : null, n: worn.length };
    }
    default:
      return pick((d) => d[key]);
  }
}

// Plain-language pieces (no Intl.PluralRules on Hermes). Prose lives in the `reports` namespace: the core returns codes.
const groupedInt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v));
/** 50 → "50 min", 70 → "1 h 10 min". */
export const minutesText = (m: number) => {
  const r = Math.max(0, Math.round(m));
  return r < 60 ? `${r} min` : r % 60 ? `${Math.floor(r / 60)} h ${r % 60} min` : `${r / 60} h`;
};
/** 412 → "6:52". */
const hm = (m: number) => {
  const r = Math.max(0, Math.round(m));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};
const item = (code: string, params: FocusItem["params"] = {}): FocusItem => ({ code, params });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A drop worth a focus point, with what to do about it. `d` is |delta| in the metric's units. */
function declineLine(key: AssessKey, d: number, target: number | null): FocusItem | null {
  switch (key) {
    case "recovery":
    case "sleepPerf":
    case "consistency":
      return item(`decline${cap(key)}`, { points: Math.round(d) });
    case "hrv":
      return item("declineHrv", { ms: Math.round(d) });
    case "rhr":
      return item("declineRhr", { bpm: Math.round(d) });
    case "slept":
      return item("declineSlept", { less: minutesText(d), earlier: minutesText(Math.ceil(d / 5) * 5) });
    case "zone13":
    case "zone45":
      return item(`decline${cap(key)}`, { min: Math.round(d) });
    case "strength":
      return item("declineStrength", { sessions: target ?? 2 });
    case "steps":
      return item("declineSteps", { steps: groupedInt(d) });
    case "strain":
      return null;
  }
}

/** A shortfall to the plan's target (or the night's need) worth a focus point, and its size in spreads. */
function gapOf(key: AssessKey, s: AssessmentStat, sleep: Assessment["sleep"], t: PlanTargets): { salience: number; item: FocusItem } | null {
  const v = s.value;
  if (v === null || s.n < assessConfig.minDays) return null;
  const gap = (target: number) => (target - v) / ASSESS[key].spread;
  switch (key) {
    case "slept": {
      if (sleep.sleptMin === null || sleep.needMin === null || sleep.nights < assessConfig.minDays) return null;
      const short = sleep.needMin - sleep.sleptMin;
      if (short < assessConfig.sleepGapMin) return null;
      return { salience: short / ASSESS.slept.spread, item: item("gapSlept", { slept: hm(sleep.sleptMin), need: hm(sleep.needMin), earlier: minutesText(Math.ceil(short / 5) * 5) }) };
    }
    case "consistency":
      return { salience: gap(t.consistency), item: item("gapConsistency", { value: Math.round(v) }) };
    case "zone13":
      return { salience: gap(t.zone13), item: item("gapZone13", { value: Math.round(v), target: t.zone13, walks: Math.max(1, Math.ceil((t.zone13 - v) / 30)) }) };
    case "zone45":
      return { salience: gap(t.zone45), item: item("gapZone45", { value: Math.round(v), target: t.zone45 }) };
    case "strength":
      return { salience: gap(t.strength), item: item("gapStrength", { strengthSessions: Math.round(v * 10) / 10, target: t.strength }) };
    case "steps":
      return { salience: gap(t.steps), item: item("gapSteps", { value: groupedInt(v), target: groupedInt(t.steps) }) };
    default:
      return null;
  }
}

/** A rise (or a small fall) from the period before, when nothing needs fixing: "rose 6 ms", "rose 3 points". */
function riseLine(s: AssessmentStat): FocusItem {
  const d = Math.abs(s.delta ?? 0);
  const by: Record<AssessKey, FocusItem["params"]> = {
    recovery: { points: Math.round(d) },
    strain: { points: Math.round(d) },
    sleepPerf: { points: Math.round(d) },
    hrv: { value: Math.round(d) },
    rhr: { value: Math.round(d) },
    slept: { value: minutesText(d) },
    consistency: { points: Math.round(d) },
    zone13: { value: Math.round(d) },
    zone45: { value: Math.round(d) },
    strength: { sessions: Math.round(d * 10) / 10 },
    steps: { value: groupedInt(d) },
  };
  return item(`rise${cap(s.key)}${(s.delta ?? 0) > 0 ? "Up" : "Down"}`, by[s.key]);
}

/**
 * The assessment of a period: `cur` its days (up to the last with data), `prev` the period before's, `targets` the
 * Weekly Plan's (the gaps a focus point can name).
 */
export function assessPeriod(cur: readonly AssessmentDay[], prev: readonly AssessmentDay[], kind: Report["kind"], targets: PlanTargets = PLAN_DEFAULTS.targets): Assessment {
  const word = kind;
  const { minDays, changeThreshold, focusThreshold } = assessConfig;
  const stats = Object.fromEntries(
    ASSESS_KEYS.map((key) => {
      const c = valueOf(key, cur);
      const p = valueOf(key, prev);
      const delta = c.value !== null && p.value !== null ? c.value - p.value : null;
      const { better, spread } = ASSESS[key];
      const move = delta === null || better === "neutral" || c.n < minDays || p.n < minDays ? null : ((better === "up" ? 1 : -1) * delta) / spread;
      return [key, { key, value: c.value, previous: p.value, delta, n: c.n, prevN: p.n, move } satisfies AssessmentStat];
    }),
  ) as Record<AssessKey, AssessmentStat>;

  const nights = cur.filter((d) => isNum(d.sleptMin) && isNum(d.needMin) && d.needMin > 0);
  const sleep: Assessment["sleep"] = {
    sleptMin: avgOf(nights.map((d) => d.sleptMin!)),
    needMin: avgOf(nights.map((d) => d.needMin!)),
    nightsMet: nights.filter((d) => d.sleptMin! >= d.needMin!).length,
    nights: nights.length,
  };

  const moved = ASSESS_KEYS.map((k) => stats[k]).filter((s) => s.move !== null && Math.abs(s.move) >= changeThreshold);
  const improved = moved.filter((s) => s.move! > 0).sort((a, b) => b.move! - a.move!);
  const declined = moved.filter((s) => s.move! < 0).sort((a, b) => a.move! - b.move!);

  // Focus: per metric the larger of its drop and its gap to target, then the two most salient.
  const candidates: { salience: number; item: FocusItem }[] = [];
  for (const key of ASSESS_KEYS) {
    const s = stats[key];
    const drop = s.move !== null && s.move <= -focusThreshold ? { salience: -s.move, item: declineLine(key, Math.abs(s.delta!), key === "strength" ? targets.strength : null) } : null;
    const gap = gapOf(key, s, sleep, targets);
    const best = [drop, gap && gap.salience >= focusThreshold ? gap : null].filter((x) => x !== null).sort((a, b) => b.salience - a.salience)[0];
    if (best?.item) candidates.push({ salience: best.salience, item: best.item });
  }
  candidates.sort((a, b) => b.salience - a.salience);

  const days = cur.filter(hasAny).length;
  const prevDays = prev.filter(hasAny).length;
  const focus: FocusItem[] = [];
  // Too few days to call a trend: say so first, as noop's digest does (its #463), then still name a clear gap.
  if (days > 0 && days < minDays) focus.push(item(`early${cap(word)}`, { days }));
  focus.push(...candidates.map((c) => c.item));
  if (!focus.length) {
    const top = improved.find((s) => s.move! >= focusThreshold);
    if (top) focus.push(riseLine(top));
    else if (days >= minDays && prevDays > 0 && prevDays < minDays) focus.push(item(`prevThin${cap(word)}`, { days: prevDays }));
    else if (days > 0) focus.push(item(`steady${cap(word)}`));
  }

  return { stats, sleep, improved: improved.slice(0, 2), declined: declined.slice(0, 2), focus: focus.slice(0, 2), days, prevDays };
}

/** The period before `period` of the same kind ("2026-W40" → "2026-W39", "2026-01" → "2025-12"). */
export function previousPeriod(period: string): string {
  const { start } = periodBounds(period);
  return periodOf(addDays(start, -1), period.includes("W") ? "week" : "month");
}
