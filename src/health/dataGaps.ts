// The data-gap checks behind telemetry's import.* and state.* codes (docs/telemetry.md): the failures that are not
// crashes, where Pulse runs fine but shows less than Health Connect holds. At most once a day after a successful sync:
// - mismatches: the data check (dataCheck.ts) over the last days, per metric, the days Health Connect has records and
//   Pulse stored nothing or a different value;
// - empty types: a granted core type with no record at all in the last 30 days;
// - stuck states: Recovery, Sleep Performance or Strain held on one reason for 3 or more days running while the band
//   was worn (heart rate or a sleep).
// Only the metric, type, score and reason names and day counts are sent; never a value.
import type { ScoreRow, Store } from "@/data/store";
import type { ReasonCode } from "@/lib/reasons";
import { once, report } from "@/lib/telemetry";
import { addDays, localDay } from "@/lib/time";
import { slice } from "@/lib/yield";
import { dayStrainOf, hrReason } from "@/queries/common";
import { hasRecords, permissionState, type ReadType } from "./connect";
import { runDataCheck } from "./dataCheck";
import { CHECK_METRICS, type DayCheck } from "./dataCheckSummary";

/** Days the data check reads, today included; today is left out of the count (its records are still arriving). */
const CHECK_DAYS = 7;
/** A metric is reported once it is off on this many of those days, so one odd day stays quiet. */
const MIN_DAYS = 2;
/** How far a value may stray from a source's and still agree: sums are near-exact, a day's readings vary more. */
const TOLERANCE = { sum: 0.1, mean: 0.25, latest: 0.25, list: 0.25 } as const;
/** The types the scores stand on; the optional extras (glucose, the cycle, food) are often empty by choice. */
export const CORE_TYPES: readonly ReadType[] = ["SleepSession", "HeartRate", "RestingHeartRate", "HeartRateVariabilityRmssd", "OxygenSaturation", "RespiratoryRate", "Steps", "Distance", "TotalCaloriesBurned", "ActiveCaloriesBurned"];
export const STUCK_DAYS = 3;
/** Days looked back for a stuck run. */
const STUCK_WINDOW = 14;

/** Per metric, the days (today aside) Health Connect has records for and Pulse has nothing or a value no source has. */
export async function importMismatches(days: DayCheck[], today: string): Promise<{ metric: string; days: number }[]> {
  const off = new Map<string, number>();
  for (const d of days) {
    if (d.day >= today) continue;
    for (const m of d.metrics) {
      if (!m.sources.length) continue;
      const tol = TOLERANCE[CHECK_METRICS.find((c) => c.key === m.key)?.combine ?? "list"];
      const agrees = m.pulse != null && m.sources.some((s) => s.value != null && Math.abs(m.pulse! - s.value) <= tol * Math.max(Math.abs(s.value), 1));
      if (!agrees) off.set(m.key, (off.get(m.key) ?? 0) + 1);
    }
    await slice();
  }
  return [...off].filter(([, n]) => n >= MIN_DAYS).map(([metric, n]) => ({ metric, days: n }));
}

const SCORES: { score: string; reason: (r: ScoreRow) => ReasonCode | null }[] = [
  { score: "recovery", reason: (r) => r.recovery?.reason ?? null },
  { score: "sleep_performance", reason: (r) => r.sleep?.reason ?? null },
  { score: "strain", reason: (r) => (dayStrainOf(r.strain) != null ? null : hrReason(r.strain)) },
];

/**
 * Headline scores held on one reason for STUCK_DAYS or more days running up to `lastDay`, each day with heart rate or
 * a sleep. Calibrating is left out: it is expected for a new install's first week.
 */
export async function stuckScores(rows: ScoreRow[], lastDay: string): Promise<{ score: string; reason: ReasonCode; days: number }[]> {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const worn = (r: ScoreRow) => (r.strain?.hrCount ?? 0) > 0 || !!r.sleep?.main;
  const out: { score: string; reason: ReasonCode; days: number }[] = [];
  for (const { score, reason } of SCORES) {
    let run = 0;
    let held: ReasonCode | null = null;
    for (let day = lastDay, i = 0; i < STUCK_WINDOW; day = addDays(day, -1), i++) {
      const r = byDay.get(day);
      const why = r && worn(r) ? reason(r) : null;
      if (!why || why === "calibrating" || (held && why !== held)) break;
      held = why;
      run++;
    }
    if (held && run >= STUCK_DAYS) out.push({ score, reason: held, days: run });
    await slice();
  }
  return out;
}

/** Runs the three checks and reports what they find, at most once a day and only while telemetry is on. Never throws. */
export async function runDataGapChecks(store: Store, timeZone: string, now = new Date()): Promise<void> {
  try {
    if (!(await once("checks"))) return;
    const today = localDay(now.getTime() / 1000, timeZone);
    const { days } = await runDataCheck(store, { timeZone, days: CHECK_DAYS, now });
    for (const m of await importMismatches(days, today)) void report(`import.mismatch.${m.metric}`, { days: m.days });

    const granted = new Set((await permissionState()).granted);
    const range = { start: new Date(now.getTime() - 30 * 86_400_000), end: now };
    for (const type of CORE_TYPES) {
      if (!granted.has(type)) continue;
      if (!(await hasRecords(type, range).catch(() => true))) void report(`import.empty.${type}`);
    }

    const yesterday = addDays(today, -1);
    const rows = await store.scoresIn({ from: addDays(yesterday, 1 - STUCK_WINDOW), to: yesterday });
    for (const s of await stuckScores(rows, yesterday)) void report(`state.stuck.${s.score}`, { reason: s.reason, days: s.days });
  } catch {
    // A check that cannot read is no finding; tomorrow's run tries again.
  }
}
