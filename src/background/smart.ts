// The smart alerts beside decide.ts's two: "Strain target reached", the Health Monitor's rise, "Weekly report ready" and
// the bedtime reminder's schedule. Pure like decide.ts (smart.test.ts); alerts.ts reads the store, sends and schedules.
// The gates are ported from noop's notif/StrainTargetNotifier.kt, notif/IllnessAlertNotifier.kt,
// notif/ScheduledReportNotifier.kt and alarm/WindDownScheduler.kt (© 2026 NoopApp, PolyForm Noncommercial 1.0.0); the
// copy and the inputs (strain_target, health_monitor, the reports, sleep_planner) are Pulse's own.
import { isoWeek, type Report } from "@/core/algorithms/reports";
import type { ScoreRow } from "@/data/store";
import { clock, rangeLabel } from "@/lib/format";
import { addDays, localDay, localMidnight, localMinutes } from "@/lib/time";
import type { SleepPlannerRow } from "@/pipeline/types";
import { illnessRaised, VITAL_LABEL } from "@/queries/home";
import { DEEP_LINK, isOwnData, sentFor, type Alert, type AlertSource, type MarkedMonitorLevel, type Markers } from "./decide";

// ── Inputs from the stored rows ──────────────────────────────────────────────

export type MonitorLevel = "clear" | MarkedMonitorLevel;
const RANK: Record<MonitorLevel, number> = { clear: 0, flagged: 1, illness: 2 };

export type MonitorState = { level: MonitorLevel; names: string[] };

/** A night's Health Monitor as Home's card reads it: the illness flag, else vitals out of range, else clear; null with no result. */
export function monitorState(hm: ScoreRow["health_monitor"] | undefined): MonitorState | null {
  if (!hm || hm.reason !== null) return null;
  const out = hm.vitals.filter((v) => v.status === "high" || v.status === "low");
  return { level: illnessRaised(hm) ? "illness" : out.length ? "flagged" : "clear", names: out.map((v) => VITAL_LABEL[v.key]) };
}

/** Nights back the Health Monitor looks for the level it rose from: a night or two off the band is no new episode. */
export const MONITOR_LOOKBACK_DAYS = 7;

/** The level before `today`: the newest earlier row with a result inside the lookback, or null (unknown). */
export function monitorBefore(rows: readonly ScoreRow[], today: string): MonitorLevel | null {
  const from = addDays(today, -MONITOR_LOOKBACK_DAYS);
  const earlier = rows.filter((r) => r.day < today && r.day >= from).sort((a, b) => (a.day < b.day ? 1 : -1));
  for (const r of earlier) {
    const s = monitorState(r.health_monitor);
    if (s) return s.level;
  }
  return null;
}

/** Today's Day Strain (a percent) and target range from its row; null on a day without enough HR, or without a target. */
export function strainOf(row: ScoreRow | null | undefined): { strain: number | null; target: { low: number; high: number } | null } {
  const t = row?.strain_target;
  return {
    strain: row?.strain?.engine?.strain?.value ?? null,
    target: t && t.reason === null ? { low: t.low, high: t.high } : null,
  };
}

// ── The alerts ───────────────────────────────────────────────────────────────

export type WeekReport = Pick<Report, "period" | "start" | "end" | "partial" | "days" | "averages">;

export type SmartInput = {
  /** Unix seconds. */
  now: number;
  timeZone: string;
  source: AlertSource;
  settings: { strainTarget: boolean; healthMonitor: boolean; weeklyReport: boolean };
  /** Today's Day Strain, a percent; null on a day without enough HR. */
  strain: number | null;
  /** Today's target, a percent; null without one (Recovery not scored yet). */
  target: { low: number; high: number } | null;
  /** Today's Health Monitor; null until last night's vitals are in. */
  monitor: MonitorState | null;
  /** The level it would rise from (monitorBefore). */
  monitorBefore: MonitorLevel | null;
  /** The stored reports; only last week's is read. */
  reports: readonly WeekReport[];
  markers: Markers;
};

/** "Weekly report ready" from this local minute on Monday (ScheduledReportPolicy's morning floor)... */
export const WEEKLY_REPORT_FROM_MIN = 7 * 60;
/** ...through this many days of the new week, so a Monday without a run still hears on Tuesday. */
export const WEEKLY_REPORT_DAYS = 2;

export const reportLink = (period: string) => `pulse://reports/${period}`;

/** Strain as a whole percent: "42%". */
const pct = (x: number) => `${Math.round(x)}%`;
/** Monday = 0. */
const isoDow = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Where the day's strain sits in its target, in the Strain Coach's range wording. */
export function strainBody(strain: number, target: { low: number; high: number }): string {
  const range = `${Math.round(target.low)} - ${pct(target.high)}`;
  return strain <= target.high
    ? `Day Strain ${pct(strain)} is inside today’s target of ${range}.`
    : `Day Strain ${pct(strain)} is past today’s target of ${range}. Prioritise sleep tonight to recover.`;
}

/** Home's monitor card as a notification: the illness signal, or the vitals out of range by name. */
export function monitorCopy(s: MonitorState): { title: string; body: string } {
  if (s.level === "illness")
    return {
      title: "Your body may be fighting something",
      body: "Several vitals moved away from your normal range together, a pattern that often comes before feeling unwell. Consider an easier day.",
    };
  const n = s.names.length;
  const names = n > 1 ? `${s.names.slice(0, -1).join(", ")} and ${s.names[n - 1]}` : (s.names[0] ?? "A vital");
  return {
    title: `${n || 1} ${n > 1 ? "vitals" : "vital"} outside your normal range`,
    body: `${names} ${n > 1 ? "are" : "is"} outside your usual range. This can be an early sign of illness or heavy strain.`,
  };
}

/** "Sep 28 - Oct 4: Recovery averaged 64%, Day Strain 42%." with what the week has. */
export function reportBody(r: WeekReport): string {
  const range = rangeLabel(r.start, r.end);
  const parts = [
    r.averages.recovery != null ? `Recovery averaged ${Math.round(r.averages.recovery)}%` : null,
    r.averages.strain != null ? `Day Strain ${pct(r.averages.strain)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${range}: ${parts.join(", ")}.` : `Your week of ${range} is in.`;
}

/** StrainTargetPolicy: once a day, when the day's strain reaches the low end of today's target; never without a target. */
function strainTargetAlert(i: SmartInput, day: string): Alert | null {
  const { strain, target } = i;
  if (!i.settings.strainTarget || strain == null || !target || strain < target.low || sentFor(i.markers.strainTargetDay, day)) return null;
  return { kind: "strain_target", title: "Strain target reached", body: strainBody(strain, target), url: DEEP_LINK.strain, day, mark: { strainTargetDay: day } };
}

/**
 * IllnessAlertPolicy: only on a rise (clear → vitals out of range → illness), never again while the level holds. The
 * level it rises from is the stored night before rather than a remembered state, so one raised night does not notify
 * again the next day; an unknown night before (a first night, a week off the band) is never a rise (noop's #2586).
 * At most once a day, unless that day's alert was for vitals and the illness signal then joins them.
 */
function monitorAlert(i: SmartInput, day: string): Alert | null {
  const cur = i.monitor;
  const before = i.monitorBefore;
  if (!i.settings.healthMonitor || !cur || cur.level === "clear" || before == null || RANK[cur.level] <= RANK[before]) return null;
  const m = i.markers;
  if (sentFor(m.monitorDay, day) && m.monitorLevel != null && RANK[m.monitorLevel] >= RANK[cur.level]) return null;
  return { kind: "health_monitor", ...monitorCopy(cur), url: DEEP_LINK.monitor, day, mark: { monitorDay: day, monitorLevel: cur.level } };
}

/**
 * ScheduledReportPolicy keyed by period instead of night: once per ISO week, for the week that just ended, from Monday
 * 07:00 once its report is complete (not partial) and holds some data.
 */
function weeklyReportAlert(i: SmartInput, day: string): Alert | null {
  if (!i.settings.weeklyReport) return null;
  const dow = isoDow(day);
  if (dow >= WEEKLY_REPORT_DAYS || (dow === 0 && localMinutes(i.now, i.timeZone) < WEEKLY_REPORT_FROM_MIN)) return null;
  const period = isoWeek(addDays(day, -7));
  if (sentFor(i.markers.reportPeriod, period)) return null;
  const r = i.reports.find((x) => x.period === period);
  if (!r || r.partial || r.days === 0 || !Object.values(r.averages).some((v) => v != null)) return null;
  return { kind: "weekly_report", title: "Weekly report ready", body: reportBody(r), url: reportLink(period), day, mark: { reportPeriod: period } };
}

/** The smart alerts due now. The person's own data only, like decide (demo data never notifies). */
export function decideSmart(input: SmartInput): Alert[] {
  if (!isOwnData(input.source)) return [];
  const day = localDay(input.now, input.timeZone);
  return [strainTargetAlert(input, day), monitorAlert(input, day), weeklyReportAlert(input, day)].filter((a): a is Alert => a !== null);
}

// ── Bedtime reminder ─────────────────────────────────────────────────────────

export type BedtimeInput = {
  /** Unix seconds. */
  now: number;
  timeZone: string;
  source: AlertSource;
  enabled: boolean;
  leadMin: number;
  /** Yesterday's and today's sleep_planner by row day (yesterday's still counts for a bedtime after midnight). */
  plans: readonly { day: string; planner: SleepPlannerRow | null | undefined }[];
  markers: Pick<Markers, "bedtimeDay" | "bedtimeAt">;
};

export type BedtimeReminder = {
  title: string;
  body: string;
  url: string;
  /** The planner row's day. */
  day: string;
  /** When it fires, unix seconds. */
  at: number;
  /** The 100 % bedtime, unix seconds. */
  bedtime: number;
};

/** What to do with the one scheduled reminder, and the markers to set once done (a schedule's only if it worked). */
export type BedtimeAction =
  | { action: "schedule"; reminder: BedtimeReminder; mark: Partial<Markers> }
  | { action: "keep"; mark: Partial<Markers> }
  | { action: "cancel"; mark: Partial<Markers> };

/** Lead minutes as saved, within WindDownStore's 0–120; 30 when unreadable. */
export const leadOf = (min: number) => (Number.isFinite(min) ? Math.min(120, Math.max(0, Math.round(min))) : 30);


/**
 * WindDownScheduler's nudge, fed by the sleep planner instead of a fixed wake time: one local notification `leadMin`
 * before the bedtime that meets tonight's whole need (the 100 % plan), re-planned on one identifier after every run.
 * The earliest reminder still ahead wins. A plan day whose reminder already fired (its marked time has passed) is not
 * planned again however its bedtime moves. With nothing ahead, a reminder whose time just passed is kept (Android may
 * deliver an inexact alarm late) and one still pending is cancelled, its marker cleared so the day can be planned again.
 */
export function planBedtime(i: BedtimeInput): BedtimeAction {
  const m = i.markers;
  const pending = m.bedtimeAt != null && m.bedtimeAt > i.now;
  const cancel: BedtimeAction = { action: "cancel", mark: pending ? { bedtimeDay: null, bedtimeAt: null } : {} };
  if (!i.enabled || !isOwnData(i.source)) return cancel;
  const lead = leadOf(i.leadMin) * 60;
  const ahead = i.plans
    .flatMap(({ day, planner }): BedtimeReminder[] => {
      if (!planner || planner.reason !== null || planner.wakeMin == null) return [];
      const full = planner.plans.find((p) => p.share === 1);
      if (!full || (m.bedtimeDay === day && m.bedtimeAt != null && m.bedtimeAt <= i.now)) return [];
      const bedtime = Math.round((localMidnight(planner.wakeDay, i.timeZone) + full.bedtimeMin * 60) / 60) * 60;
      const at = bedtime - lead;
      if (at <= i.now) return [];
      return [{ title: "Wind down", body: `Bed by ${clock(bedtime * 1000, i.timeZone)} to meet tonight’s sleep need.`, url: DEEP_LINK.planner, day, at, bedtime }];
    })
    .sort((a, b) => a.at - b.at);
  const next = ahead[0];
  if (next) return { action: "schedule", reminder: next, mark: { bedtimeDay: next.day, bedtimeAt: next.at } };
  return m.bedtimeAt != null && !pending ? { action: "keep", mark: {} } : cancel;
}
