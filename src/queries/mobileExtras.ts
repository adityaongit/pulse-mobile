// What Pulse Mobile's screens show that halo's view models dropped, ported from Pulse Mobile's earlier queries
// (pulse's src/server/queries) onto halo's common.ts and Store: Recovery's "today vs. the last 30 days" rows and its
// Behavior Insights chips, the Sleep page's Restorative Sleep row and Sleep Efficiency card, and a nap's own page.
import { i18n } from "@/i18n/config";
import { journalImpact, journalImpactConfig, type ImpactLabel } from "@/core/algorithms/journalImpact";
import { addDays, localMinutes } from "@/lib/time";
import { trendHref } from "@/lib/url";
import { activityKind, type DayRow, exercisesBetween, type ExerciseRow, finite, fromReason, loadDays, meanSd, ms, ok, priorStats, type QueryCtx, sleepMetric, todayOf, activityStrainOf, dayStrainOf } from "./common";
import { contributors } from "./recovery";
import { nightHrOf } from "./sleep";
import type { KeyStat, Metric, SleepVM } from "./types";

// ── Recovery ────────────────────────────────────────────────────────────────

export type BehaviorKey = "sleep86" | "strain7" | "earlyWorkout" | "consistentWake";
/** A behaviour of the day before, toned by its next-day Recovery effect over journal impact's window. */
export type BehaviorChip = { key: BehaviorKey; label: string; effect: "up" | "down" | "neutral" };
const EFFECT: Record<ImpactLabel, BehaviorChip["effect"]> = { positive: "up", negative: "down", no_clear_effect: "neutral", not_enough_data: "neutral" };

/** Each row's value on a day, for its prior 30-day mean (the same inputs the score uses, else the raw nightly value). */
const PICK: Record<"hrv" | "rhr" | "resp" | "sleep", (r: DayRow) => number | null | undefined> = {
  hrv: (r) => r.metrics?.hrvMs,
  rhr: (r) => r.rhr,
  resp: (r) => r.metrics?.respBpm,
  sleep: (r) => (r.recovery?.inputs.sleepPerf != null ? r.recovery.inputs.sleepPerf * 100 : r.sleep?.performance),
};

/** Recovery's rows (today against the prior 30 days, each opening its Trend View) and Behavior Insights for `day`. */
export async function getRecoveryExtras(day: string, ctx: QueryCtx): Promise<{ summary: KeyStat[]; behaviors: BehaviorChip[] }> {
  const isToday = day === todayOf(ctx);
  const windowDays = journalImpactConfig.windowDays;
  const [rows, exs] = await Promise.all([loadDays(ctx, addDays(day, -(windowDays + 30)), day), exercisesBetween(ctx, addDays(day, -windowDays), day)]);
  const row = rows.get(day);
  const cs = contributors(row, isToday, rows);
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
  return { summary, behaviors: row?.recovery?.value == null ? [] : behaviors(rows, exs, day, ctx.timeZone) };
}

/** The behaviour days of journal impact's window before `day`, and the chips for `day`. */
function behaviors(rows: Map<string, DayRow>, exs: ExerciseRow[], day: string, tz: string): BehaviorChip[] {
  const wake = (d: string) => {
    const m = rows.get(d)?.sleep?.main;
    return m ? localMinutes(m.end, tz) : null;
  };
  const days: { day: string; holds: Partial<Record<BehaviorKey, boolean>> }[] = [];
  for (let d = addDays(day, -journalImpactConfig.windowDays); d < day; d = addDays(d, 1)) {
    const r = rows.get(d);
    const perf = rows.get(addDays(d, 1))?.sleep?.performance;
    const strain = dayStrainOf(r?.s1);
    const worn = (r?.s1?.hrCount ?? 0) > 0;
    const workouts = exs.filter((e) => e.day === d);
    const w = wake(addDays(d, 1));
    const usual = Array.from({ length: 14 }, (_, k) => wake(addDays(d, -k))).filter((x): x is number => x !== null).sort((a, b) => a - b);
    days.push({
      day: d,
      holds: {
        ...(finite(perf) && { sleep86: perf >= 86 }),
        ...(strain != null && { strain7: strain >= 33 }),
        ...((workouts.length || worn) && { earlyWorkout: workouts.some((e) => localMinutes(e.startTs, tz) < 8 * 60) }),
        ...(w !== null && usual.length >= 7 && { consistentWake: Math.abs(w - usual[Math.floor(usual.length / 2)]) <= 30 }),
      },
    });
  }
  const yesterday = days.find((x) => x.day === addDays(day, -1));
  if (!yesterday) return [];
  const impact = journalImpact(
    days.map((x) => ({ day: x.day, tags: Object.fromEntries(Object.entries(x.holds).filter(([, v]) => v !== undefined)) as Record<string, boolean> })),
    Array.from({ length: journalImpactConfig.windowDays + 1 }, (_, k) => {
      const d = addDays(day, -k);
      return { day: d, recovery: rows.get(d)?.recovery?.value ?? null, hrvZ: null, sleepPerf: null };
    }),
    day,
  );
  return (["sleep86", "strain7", "earlyWorkout", "consistentWake"] as const satisfies readonly BehaviorKey[])
    .filter((k) => yesterday.holds[k])
    .map((key) => ({ key, label: i18n.t(`health:behavior.${key}`), effect: EFFECT[impact.find((t) => t.tag === key)?.effects.recovery.label ?? "not_enough_data"] }));
}

// ── Sleep ───────────────────────────────────────────────────────────────────

export type SleepExtras = {
  /** Last night's deep + REM minutes against the prior 30 nights (the Restorative Sleep row under the stages). */
  restorative: Metric<{ minutes: number; average: number | null; sd?: number }>;
  /** The Sleep Efficiency card: the share against the prior 30 nights, asleep and awake time, wake events and where each spell awake fell (0-1 of bed to wake). */
  efficiency: Metric<{ pct: number; average: number | null; sd?: number; asleepMin: number; awakeMin: number; wakeEvents: number | null; wakes: { at: number; width: number }[] }>;
};

const restorativeMin = (r: DayRow) => (r.sleep?.main?.deepMin != null && r.sleep.main.remMin != null ? r.sleep.main.deepMin + r.sleep.main.remMin : null);
const efficiencyPct = (r: DayRow) => (r.sleep?.main ? r.sleep.main.efficiency * 100 : null);

/** `stages`: getSleep's, for where the spells awake fell. */
export async function getSleepExtras(day: string, ctx: QueryCtx, stages: SleepVM["stages"]): Promise<SleepExtras> {
  const isToday = day === todayOf(ctx);
  const rows = await loadDays(ctx, addDays(day, -30), day);
  const row = rows.get(day);
  const performance = sleepMetric(row, isToday);
  const noNight = performance.value == null ? (performance.reason ?? "no_data") : null;
  const main = row?.sleep?.main ?? null;

  const restPrior = priorStats(rows, day, restorativeMin);
  const restNow = row ? restorativeMin(row) : null;
  const restorative: SleepExtras["restorative"] = finite(restNow)
    ? ok({ minutes: restNow, average: restPrior.mean, ...(restPrior.sd !== undefined && { sd: restPrior.sd }) })
    : fromReason(noNight, isToday);

  const effPrior = priorStats(rows, day, efficiencyPct);
  const span = main ? Math.max(1, main.end - main.start) * 1000 : 1;
  const efficiency: SleepExtras["efficiency"] = main
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
  return { restorative, efficiency };
}

// ── Naps ────────────────────────────────────────────────────────────────────

type Stage = "awake" | "rem" | "light" | "deep";
const STAGE_ROWS: { stage: Stage; label: string; typical: [number, number] }[] = [
  { stage: "awake", typical: [5, 10], get label() { return i18n.t("health:stage.awake"); } },
  { stage: "rem", typical: [20, 25], get label() { return i18n.t("health:stage.rem"); } },
  { stage: "light", typical: [45, 55], get label() { return i18n.t("health:stage.light"); } },
  { stage: "deep", typical: [13, 23], get label() { return i18n.t("health:stage.deep"); } },
];

export type NapVM = { id: string; day: string; start: number; end: number; hours: SleepVM["hours"]; stages: SleepVM["stages"]; hr: SleepVM["nightHr"] };

/** A nap's own detail: time asleep, stages when Fitbit staged it, and heart rate across it. Null for an unknown id or a main sleep. */
export async function getNap(id: string, ctx: QueryCtx): Promise<NapVM | null> {
  // ponytail: reads every session to find one; a Store lookup by id if histories grow long.
  const n = (await ctx.store.allSessions()).find((s) => s.id === id);
  if (!n || n.isMain) return null;
  const [segs, hr] = await Promise.all([n.stagesStatus === "SUCCEEDED" ? ctx.store.segmentsFor([n.id]) : Promise.resolve([]), nightHrOf(ctx, n.startTs, n.endTs)]);
  const segments = segs.sort((a, b) => a.startTs - b.startTs).map((g) => ({ stage: g.stage, start: ms(g.startTs), end: ms(g.endTs) }));
  const minutes: Record<Stage, number> = { awake: n.awakeMin ?? 0, rem: n.remMin ?? 0, light: n.lightMin ?? 0, deep: n.deepMin ?? 0 };
  const total = minutes.awake + minutes.rem + minutes.light + minutes.deep;
  const stages: SleepVM["stages"] = segments.length
    ? ok({ bed: ms(n.startTs), wake: ms(n.endTs), segments, rows: STAGE_ROWS.map((r) => ({ ...r, minutes: minutes[r.stage], pct: total > 0 ? (minutes[r.stage] / total) * 100 : 0 })) })
    : null;
  const asleepMin = n.asleepMin ?? Math.round((n.endTs - n.startTs) / 60);
  return { id: n.id, day: n.day, start: ms(n.startTs), end: ms(n.endTs), hours: ok({ asleepMin, average: null }), stages, hr };
}


/**
 * The activity hero's numbers halo's ActivityVM dropped: the mean strain of earlier activities of the same kind in the
 * 30 days before, and, for runs and walks, the steps inside the workout with the same kind's 30-day mean.
 */
export async function getActivityExtras(id: string, ctx: QueryCtx): Promise<{ strainAverage: number | null; steps: { value: number; average: number | null } | null }> {
  const e = (await ctx.store.allExercises()).find((x) => x.id === id);
  if (!e) return { strainAverage: null, steps: null };
  const kind = activityKind(e.type);
  const [rows, recent] = await Promise.all([loadDays(ctx, addDays(e.day, -30), e.day), exercisesBetween(ctx, addDays(e.day, -30), e.day)]);
  const same = recent.filter((x) => x.id !== id && x.startTs < e.startTs && activityKind(x.type) === kind);
  const strainOf = (x: ExerciseRow) => {
    return activityStrainOf(rows.get(x.day)?.activities.find((y) => y.id === x.id));
  };
  const stepping = kind === "run" || kind === "walk";
  const steps = stepping ? await ctx.store.readSteps(Math.min(e.startTs, ...same.map((x) => x.startTs)), e.endTs) : [];
  const stepsIn = (x: { startTs: number; endTs: number }) => steps.reduce((s, m) => (m.ts >= x.startTs && m.ts < x.endTs ? s + m.v : s), 0);
  const own = stepping ? stepsIn(e) : 0;
  return {
    strainAverage: meanSd(same.map(strainOf)).mean,
    steps: own > 0 ? { value: own, average: meanSd(same.map(stepsIn).filter((n) => n > 0)).mean } : null,
  };
}
