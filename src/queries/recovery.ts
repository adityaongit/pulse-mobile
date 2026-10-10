import type { ChargeDriver } from "@/core/scoring/drivers";
import { sleepPerfCenter, sleepPerfScale } from "@/core/scoring/recovery";
import { behaviorChips, type BehaviorChip, type BehaviorDay } from "@/core/algorithms/behaviorChips";
import { journalImpactConfig } from "@/core/algorithms/journalImpact";
import { trendHref } from "@/lib/url";
import { addDays, localMinutes } from "../time";
import {
  type DayRow,
  exercisesBetween,
  type ExerciseRow,
  finite,
  loadDays,
  none,
  ok,
  priorStats,
  type QueryCtx,
  recoveryBand,
  recoveryMetric,
  todayOf,
  toStrain,
  vitalReason,
} from "./common";
import type { Contributor, KeyStat, Metric, RecoveryVM } from "./types";

const KEY_OF: Record<ChargeDriver["label"], Contributor["key"]> = {
  HEART_RATE_VARIABILITY: "hrv",
  RESTING_HEART_RATE: "rhr",
  RESPIRATORY_RATE: "resp",
  SLEEP_QUALITY: "sleep",
  SKIN_TEMPERATURE: "skinTemp",
};

/** Recovery `/recovery` for `day` (spec §7.2). */
export async function getRecovery(ctx: QueryCtx, day: string): Promise<RecoveryVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const window = journalImpactConfig.windowDays;
  const [rows, exs] = await Promise.all([loadDays(ctx, addDays(day, -(window + 30)), day), exercisesBetween(ctx, addDays(day, -window), day)]);
  const row = rows.get(day);
  const recovery = recoveryMetric(row, isToday);
  const cs = contributors(row, isToday);

  // Today against the prior 30 days, the reference app's rows: no unit but %, each opening its Trend View.
  const summary: KeyStat[] = (["hrv", "rhr", "resp", "sleep"] as const).map((key) => {
    const c = cs.find((x) => x.key === key)!;
    const prior = priorStats(rows, day, PICK[key]);
    return {
      key,
      label: c.label,
      metric: c.metric,
      ...(key === "sleep" && { unit: "%" }),
      format: key === "resp" ? "decimal1" : "int",
      average: prior.mean,
      ...(prior.sd !== undefined && { sd: prior.sd }),
      direction: c.direction,
      href: trendHref(key),
    } satisfies KeyStat;
  });

  return {
    day,
    isToday,
    recovery,
    band: recovery.value != null ? recoveryBand(recovery.value) : null,
    contributors: cs,
    summary,
    insight: recovery.value != null ? screenInsight(cs, recovery.value) : null,
    behaviors: recovery.value == null ? [] : behaviors(rows, exs, day, ctx.timeZone),
  };
}

/** Each row's value on a day, for its prior 30-day mean (the same inputs the score uses, else the raw nightly value). */
const PICK: Record<"hrv" | "rhr" | "resp" | "sleep", (r: DayRow) => number | null | undefined> = {
  hrv: (r) => r.recovery?.inputs.hrv ?? r.metrics?.hrvMs,
  rhr: (r) => r.recovery?.inputs.rhr ?? r.sessionRhr,
  resp: (r) => r.recovery?.inputs.resp ?? r.metrics?.respBpm,
  sleep: (r) => (r.recovery?.inputs.sleepPerf != null ? r.recovery.inputs.sleepPerf * 100 : r.sleep?.performance),
};

/** The behaviour days of journal impact's window before `day`, and the chips for `day` (docs/algorithms/behavior-chips.md). */
function behaviors(rows: Map<string, DayRow>, exs: ExerciseRow[], day: string, tz: string): BehaviorChip[] {
  const wake = (d: string) => {
    const m = rows.get(d)?.sleep?.main;
    return m ? localMinutes(m.end, tz) : null;
  };
  const days: BehaviorDay[] = [];
  for (let d = addDays(day, -journalImpactConfig.windowDays); d < day; d = addDays(d, 1)) {
    const r = rows.get(d);
    const next = rows.get(addDays(d, 1));
    const perf = next?.sleep?.performance;
    const effort = r?.s1?.effort;
    const worn = (r?.s1?.hrCount ?? 0) > 0;
    const workouts = exs.filter((e) => e.day === d);
    const w = wake(addDays(d, 1));
    const usual = Array.from({ length: 14 }, (_, k) => wake(addDays(d, -k))).filter((x): x is number => x !== null).sort((a, b) => a - b);
    days.push({
      day: d,
      holds: {
        ...(finite(perf) && { sleep86: perf >= 86 }),
        ...(finite(effort) && { strain7: toStrain(effort) >= 7 }),
        ...((workouts.length || worn) && { earlyWorkout: workouts.some((e) => localMinutes(e.startTs, tz) < 8 * 60) }),
        ...(w !== null && usual.length >= 7 && { consistentWake: Math.abs(w - usual[Math.floor(usual.length / 2)]) <= 30 }),
      },
    });
  }
  const outcomes = Array.from({ length: journalImpactConfig.windowDays + 1 }, (_, k) => {
    const d = addDays(day, -k);
    return { day: d, recovery: rows.get(d)?.recovery?.value ?? null };
  });
  return behaviorChips(days, outcomes, day);
}

export function contributors(row: DayRow | undefined, isToday: boolean): Contributor[] {
  const r = row?.recovery;
  const pts = (key: Contributor["key"]) => r?.drivers.find((d) => KEY_OF[d.label] === key)?.deltaPoints ?? null;
  const base = (b: { mean: number; sd: number } | null | undefined, ok = true) => (b && ok ? { mean: b.mean, sd: b.sd } : null);
  const usable = (b: { status: string } | null | undefined) => !!b && (b.status === "provisional" || b.status === "trusted");
  const metric = (key: Contributor["key"], v: number | null | undefined, missing: Metric<number>["reason"]): Metric<number> => {
    if (!finite(v)) return none(missing ?? "no_data");
    return ok(v, false, r?.stale.includes(key) ? ["stale_baseline"] : []);
  };
  // An input the score could not use reads "Not measured: left out of today's score" (no_data).
  const missing = r?.value != null ? "no_data" : vitalReason(row, isToday);
  const inputs = r?.inputs;
  const b = r?.baselines;
  return [
    {
      key: "hrv",
      label: "Heart rate variability",
      unit: "ms",
      metric: metric("hrv", inputs?.hrv ?? row?.metrics?.hrvMs, r?.value != null ? "no_data" : vitalReason(row, isToday, true)),
      baseline: base(b?.hrv, usable(b?.hrv)),
      points: pts("hrv"),
      direction: "up",
    },
    {
      key: "rhr",
      label: "Resting heart rate",
      unit: "bpm",
      metric: metric("rhr", inputs?.rhr ?? row?.sessionRhr, missing),
      baseline: base(b?.rhr, usable(b?.rhr)),
      points: pts("rhr"),
      direction: "down",
    },
    {
      key: "resp",
      label: "Respiratory rate",
      unit: "rpm",
      metric: metric("resp", inputs?.resp ?? row?.metrics?.respBpm, missing),
      baseline: base(b?.resp, usable(b?.resp)),
      points: pts("resp"),
      // A rise in breathing rate reads orange, as the reference app marks it (spec §11 R34).
      direction: "down",
    },
    {
      key: "sleep",
      label: "Sleep performance",
      unit: "%",
      metric: metric("sleep", inputs?.sleepPerf != null ? inputs.sleepPerf * 100 : null, missing),
      // The score centres sleep at 85% with a 12-point scale (noop's sleepPerfCenter / sleepPerfScale).
      baseline: { mean: sleepPerfCenter * 100, sd: sleepPerfScale * 100 },
      points: pts("sleep"),
      direction: "up",
    },
    {
      key: "skinTemp",
      label: "Skin temperature",
      unit: "°C",
      metric: metric("skinTemp", inputs?.skinTempDev, row?.metrics?.nightlyTempC != null ? "calibrating" : missing),
      // Google's 30-night SD when it gives one, else Pulse's own baseline spread.
      baseline: row?.metrics?.tempSdC ? { mean: 0, sd: row.metrics.tempSdC } : b?.skinTemp && usable(b.skinTemp) ? { mean: 0, sd: b.skinTemp.sd } : null,
      points: pts("skinTemp"),
      direction: "toward_zero",
    },
  ];
}

const SHORT: Record<Contributor["key"], string> = { hrv: "HRV", rhr: "RHR", resp: "respiratory rate", sleep: "Sleep Performance", skinTemp: "skin temperature" };
const UNIT_TEXT: Record<Contributor["key"], string> = { hrv: " ms", rhr: " bpm", resp: " rpm", sleep: "%", skinTemp: " °C" };
const ADVICE: Record<ReturnType<typeof recoveryBand>, string> = {
  green: "Your body is primed to take on strain today.",
  yellow: "Today is a good day to stay active at a steady load.",
  red: "Today is a day to take it easy and let your body recover.",
};

/**
 * The Recovery screen's insight, in the reference app's shape (recovery-05, spec §11 R34): the input that moved the score
 * most, its value against its typical range (baseline ± 1 SD), the band it led to, then the day's advice.
 */
export function screenInsight(cs: Contributor[], score: number): string {
  const band = recoveryBand(score);
  const lead = cs
    .filter((c) => c.key !== "skinTemp" && c.metric.value !== null && c.baseline && c.points !== null)
    .sort((a, b) => Math.abs(b.points!) - Math.abs(a.points!))[0];
  if (!lead) return `Your Recovery is ${band}. ${ADVICE[band]}`;
  const v = lead.metric.value!;
  const { mean, sd } = lead.baseline!;
  const fmt = (x: number) => `${lead.key === "resp" ? x.toFixed(1) : Math.round(x)}${UNIT_TEXT[lead.key]}`;
  const where = v < mean - sd ? "below" : v > mean + sd ? "above" : "within";
  return `Your ${SHORT[lead.key]} (${fmt(v)}) is ${where} its typical range of ${fmt(mean - sd)} to ${fmt(mean + sd)}, which contributed to a ${band} Recovery. ${ADVICE[band]}`;
}

/** One templated coach line from the biggest movers (spec §5.15 copy rules). */
export function insightOf(drivers: ChargeDriver[]): string {
  const up = drivers.filter((d) => d.deltaPoints > 0).map((d) => d.label);
  const down = drivers.filter((d) => d.deltaPoints < 0).map((d) => d.label);
  const phrase = (l: ChargeDriver["label"], good: boolean) =>
    ({
      HEART_RATE_VARIABILITY: good ? "your HRV is above your baseline" : "your HRV is below your baseline",
      RESTING_HEART_RATE: good ? "your resting heart rate is lower than usual" : "your resting heart rate is higher than usual",
      RESPIRATORY_RATE: good ? "your breathing rate is steady" : "your breathing rate is up",
      SLEEP_QUALITY: good ? "you slept well" : "your sleep fell short",
      SKIN_TEMPERATURE: good ? "your skin temperature is normal" : "your skin temperature moved from your normal",
    })[l];
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (up.length && !down.length) return `${cap(phrase(up[0], true))}, which lifted Recovery today.`;
  if (down.length && !up.length) return `${cap(phrase(down[0], false))}, which held Recovery back today.`;
  if (up.length && down.length) return `${cap(phrase(up[0], true))}, but ${phrase(down[0], false)}. Together they shaped today’s Recovery.`;
  return "Your signals sit close to your baseline, so Recovery is near your usual level.";
}
