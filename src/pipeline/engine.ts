// Stage 2's Pulse engine scorers (docs/engine-plan.md), next to halo's in scores.ts: the sleep family and Recovery,
// Cardio Load and Target Strain, Stress and Energy Bank, and Pulse Age, from the per-day aggregates stage 1 keeps
// (Stage1Day.engine) and the pooled baselines over the days before. They fill the same daily_scores rows the screens read, so the screens keep
// their look. Every value for day D reads only D and earlier days.
import type { ReasonCode } from "@/lib/reasons";
import { addDays, daysBetween, fractionalYears, localMinutes } from "@/lib/time";
import { IMPACT_METRICS, type JournalDay, type OutcomeDay, type TagImpact } from "@/core/algorithms/journalImpact";
import { arms, effect, MIN_DAYS } from "@/core/engine/journal";
import { type SleepPlan, sleepPlan } from "@/core/algorithms/sleepPlanner";
import type { ChargeDriver, ChargeDriverVerdict } from "@/core/scoring/drivers";
import { band } from "@/core/scoring/recovery";
import { type Agg, baseline, calibrated, chanMerge, mergeHist, RECOVERY_CALIBRATION_DAYS, STRESS_CALIBRATION_DAYS } from "@/core/engine/baselines";
import { timeline } from "@/core/engine/context";
import { DEFAULT_SLEEP_GOAL_HOURS, POOLING } from "@/core/engine/days";
import { awakeSeconds, type Drain, energyBand, energyStep, WARMUP_DAYS } from "@/core/engine/energyBank";
import { mean, popStats, roundHalfAway } from "@/core/engine/math";
import { paceOf, pulseAge, type PulseAgeDay, references } from "@/core/engine/pulseAge";
import { recovery, type RecoveryResult } from "@/core/engine/recovery";
import {
  hasStages,
  hrDip,
  type SleepComponent,
  sleepBank,
  sleepConsistency,
  type SleepNeed,
  sleepNeeded,
  sleepScore,
  type SleepSeg,
  stageSums,
  tonightNeeded,
} from "@/core/engine/sleep";
import { loadConfidence, loadStatus, loadStep, STRENGTH_TYPES, targetBase, targetRange } from "@/core/engine/strain";
import { cdfOf, displayStress, gapFill, HRV_LOOKBACK_S, SLOT_S, type SlotContext, slotContext, slotHr, slotsOf, slotStress, stressLevel } from "@/core/engine/stress";
import { type Data, touching } from "./data";
import type { Day, Fold, Inputs, scorePlanner } from "./scores";
import type { BaselineSummary, CardioLoadRow, EnergyBankRow, HealthMonitorRow, HealthspanRow, PipelineOptions, RecoveryRow, SleepPlannerRow, SleepRow, StrainTargetRow, StressRow } from "./types";

/** Aggregates kept per day for the baselines (oldest first, at most BASELINE_DAYS). */
type DayAggRow = { restingHRV: Agg | null; averageHRV: Agg | null; restingHR: Agg | null; inactiveHR: Agg | null; resp: Agg | null; temp: Agg | null };

/** The engine's part of the stage-2 fold: plain arrays (the checkpoint clones it), bounded in length. */
export const newEngineFold = () => ({
  aggs: [] as DayAggRow[],
  /** Seconds asleep (main sleep and naps) per day, the last 7, for the bank. */
  asleepS: [] as number[],
  /** Strain per day, the last 30, for the need's strain term. */
  strains: [] as number[],
  prevStrain: null as number | null,
  /** The last 8 days' primary sleep: its day bounds and asleep spans, for Consistency. */
  nights: [] as { dayStart: number; dayEnd: number; spans: [number, number][] | null }[],
  /** The last 30 nights' efficiency (%) and minutes to fall asleep, for tonight's need. */
  effs: [] as number[],
  lats: [] as number[],
  /** Sleep Scores of the last 60 days, the Sleep row's "typical night" in the drivers. */
  sleepScores: [] as number[],
  /** Day numbers with a Recovery (the calibration span), first and count. */
  recoveryFirst: null as number | null,
  recoveryDays: 0,
  /** Cardio Load: ATL and CTL, the last 28 daily loads, whether each of the last 42 was active, the last 10 CTLs. */
  atl: 0,
  ctl: 0,
  loads28: [] as number[],
  active42: [] as boolean[],
  ctls: [] as number[],
  /** Daily Strain of the last 15 days (null without one), Target Strain's history. */
  strainHist: [] as (number | null)[],
  /** Stress: day numbers with a daily stress (the 30-day calibration), first and count. */
  stressFirst: null as number | null,
  stressDays: 0,
  /** The day before's HRV samples [ts, ms], for slots early in the day (an HRV reading counts for 36 minutes). */
  hrvPrev: [] as [number, number][],
  /** Energy Bank: the level at the end of the last full day, how many days it has run, and the last 7 days' sleep. */
  ebLevel: null as number | null,
  ebDays: 0,
  sleepS: [] as number[],
  /** Pulse Age: the last 28 days' inputs (with their VO2 max and lean %), and the week's result as of its Monday. */
  ageDays: [] as { day: PulseAgeDay; vo2: number | null; vo2Run: boolean; lean: number | null }[],
  ageWeek: null as { day: string; row: HealthspanRow } | null,
});

const push = <T>(xs: T[], x: T, max: number) => {
  xs.push(x);
  if (xs.length > max) xs.splice(0, xs.length - max);
};

/** The profile's sleep goal, hours; 7.5 h when it sets none (shared-machinery.md § Sleep goal). */
const goalHours = (opts: PipelineOptions) => opts.profile.sleepGoalHours ?? DEFAULT_SLEEP_GOAL_HOURS;

/** The primary sleep's stage segments; a night without stages is unstaged sleep over its asleep minutes. */
function mainSegments(d: Day, inputs: Inputs): { segs: SleepSeg[]; staged: boolean } {
  const s = d.mainSession;
  if (!s) return { segs: [], staged: false };
  const staged = (inputs.segments.get(s.id) ?? []).slice().sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs);
  if (s.stagesStatus === "SUCCEEDED" && staged.length && hasStages(staged)) return { segs: staged, staged: true };
  const asleepS = s.asleepMin != null ? s.asleepMin * 60 : s.endTs - s.startTs;
  return { segs: [{ startTs: s.startTs, endTs: s.startTs + asleepS, stage: "unspecified" }], staged: false };
}

export type EngineSleep = {
  score: number | null;
  components: Record<SleepComponent, number | null>;
  need: SleepNeed;
  bankMin: number;
  consistency: number | null;
  sleepingHr: number | null;
  /** Seconds asleep today (main sleep and naps), and the main sleep's asleep spans, for the fold. */
  asleepS: number;
  spans: [number, number][] | null;
};

/** The Sleep family for day D: score, need, bank and consistency. */
export function scoreEngineSleep(f: Fold, d: Day, inputs: Inputs, opts: PipelineOptions, tz: string): EngineSleep {
  const e = f.engine;
  const goal = goalHours(opts);
  const previousBank = sleepBank(e.asleepS, goal);
  const need = sleepNeeded(goal, e.prevStrain, e.strains, previousBank);
  const { segs, staged } = mainSegments(d, inputs);
  const sums = stageSums(segs);
  const sleepingHr = d.s1.engine?.restingHR?.avg ?? null;
  const inactiveBase = baseline(e.aggs.map((a) => a.inactiveHR), POOLING.inactiveHR);
  const r = d.mainSession
    ? sleepScore({ sums, staged, needS: need.needS, hrDip: hrDip(sleepingHr, inactiveBase?.avg ?? null), age: d.age.whole, sex: opts.profile.sex })
    : null;
  const asleepToday = sums.asleep + d.naps.reduce((a, n) => a + n.asleepMin * 60, 0);
  const bankMin = sleepBank([...e.asleepS, asleepToday], goal);

  // Consistency: the up-to-7 most recent days (D included) with a primary sleep, each painted with its own night and
  // the night of the included day before it, as local clock minutes.
  const spans: [number, number][] | null = d.mainSession ? segs.filter((g) => g.stage !== "awake").map((g) => [g.startTs, g.endTs]) : null;
  const nights = [...e.nights, { dayStart: d.start, dayEnd: d.end, spans }].slice(-8);
  const withSleep = nights.slice(1).filter((n) => n.spans);
  const anchor = nights[0].spans ? nights[0] : null;
  const paint = (n: (typeof nights)[number], from: (typeof nights)[number] | null): [number, number][] =>
    [...(from?.spans ?? []), ...n.spans!].flatMap(([s, t]): [number, number][] => {
      const a = Math.max(s, n.dayStart);
      const b = Math.min(t, n.dayEnd);
      if (!(a < b)) return [];
      const m0 = localMinutes(a - (a % 60), tz);
      const m1 = b === n.dayEnd ? 1440 : localMinutes(b - (b % 60), tz);
      return m1 > m0 ? [[m0, m1]] : [];
    });
  const consistency = sleepConsistency(withSleep.map((n, i) => paint(n, i === 0 ? anchor : withSleep[i - 1])));

  const comp = (k: SleepComponent) => r?.components[k]?.input ?? null;
  return {
    score: r?.score ?? null,
    components: { asleep: comp("asleep"), deep: comp("deep"), rem: comp("rem"), hrDip: comp("hrDip"), efficiency: comp("efficiency"), continuity: comp("continuity") },
    need,
    bankMin,
    consistency,
    sleepingHr,
    asleepS: asleepToday,
    spans,
  };
}

/** The Sleep row with the engine's values in place of halo's: score, need, bank (as debt) and consistency. */
export function engineSleepRow(row: SleepRow, s: EngineSleep): SleepRow {
  const r2 = (x: number | null) => (x == null ? null : roundHalfAway(x, 2));
  return {
    ...row,
    performance: s.score == null ? null : roundHalfAway(s.score, 1),
    reason: row.reason ?? (s.score == null && row.main ? "no_data" : null),
    parts: null,
    components: Object.fromEntries(Object.entries(s.components).map(([k, v]) => [k, r2(v)])) as EngineSleep["components"],
    needHours: s.need.goalS / 3600,
    needMin: roundHalfAway(s.need.needS / 60, 1),
    debtMin: roundHalfAway(Math.max(0, -s.bankMin), 1),
    bankMin: roundHalfAway(s.bankMin, 1),
    consistency: s.consistency == null ? null : roundHalfAway(s.consistency, 1),
  };
}

const summary = (b: Agg | null, ok: boolean): BaselineSummary =>
  b && { mean: roundHalfAway(b.avg, 2), sd: roundHalfAway(b.sd, 3), status: ok ? "trusted" : "provisional", nValid: b.count };

/** Recovery for day D, on the shape halo's RecoveryRow has. */
export function scoreEngineRecovery(f: Fold, d: Day, sleep: EngineSleep): RecoveryRow {
  const e = f.engine;
  const a = d.s1.engine;
  const pool = (k: keyof DayAggRow) => baseline(e.aggs.map((x) => x[k]), POOLING[k]);
  const base = { hrv: pool("restingHRV"), rhr: pool("restingHR"), resp: pool("resp"), temp: pool("temp") };
  const hrv = a?.restingHRV?.avg ?? null;
  const rhr = a?.restingHR?.avg ?? null;
  const resp = d.dm?.respBpm ?? null;
  const temp = tempDelta(d);
  const r = recovery({ hrv, hrvBase: base.hrv, rhr, rhrBase: base.rhr, sleepScore: sleep.score, resp, respBase: base.resp, temp, tempBase: base.temp });
  const today = daysBetween("1970-01-01", d.day);
  const first = e.recoveryFirst ?? today;
  const ok = r.value != null && calibrated(first, today, e.recoveryDays + 1, RECOVERY_CALIBRATION_DAYS);
  let reason: ReasonCode | null = null;
  let nightsLeft: number | undefined;
  if (r.value == null) {
    if (!d.mainSession) reason = "band_not_worn";
    else if (!d.mainSession.processed) reason = "awaiting_sleep_sync";
    else if (r.missing.includes("hrv")) reason = "no_hrv_last_night";
    else if (r.missing.includes("hrvBaseline") || r.missing.includes("rhrBaseline")) {
      reason = "calibrating";
      nightsLeft = 1;
    } else reason = "no_data";
  } else {
    if (e.recoveryFirst == null) e.recoveryFirst = today;
    e.recoveryDays++;
    f.recoveries.push(r.value);
  }
  const value = r.value == null ? null : roundHalfAway(r.value, 1);
  const terms = r.value == null ? [] : ["hrv", "rhr", "sleep", ...(resp != null && base.resp ? ["resp"] : []), ...(temp != null && base.temp ? ["skinTemp"] : [])];
  const prev = d.cache.recovery;
  return {
    value,
    reason,
    ...(nightsLeft !== undefined && { nightsLeft }),
    provisional: value != null && !ok,
    stale: [],
    terms,
    updated: value != null && prev?.value != null && (prev.updated || terms.some((t) => !prev.terms.includes(t))),
    inputs: {
      hrv: hrv == null ? null : roundHalfAway(hrv, 1),
      rhr: rhr == null ? null : roundHalfAway(rhr, 1),
      resp,
      sleepPerf: sleep.score == null ? null : roundHalfAway(sleep.score / 100, 3),
      skinTempDev: temp == null ? null : roundHalfAway(temp, 2),
    },
    baselines: { hrv: summary(base.hrv, ok), rhr: summary(base.rhr, ok), resp: summary(base.resp, ok), skinTemp: summary(base.temp, ok) },
    hrvZ: hrv != null && base.hrv && base.hrv.sd > 0 ? roundHalfAway((hrv - base.hrv.avg) / base.hrv.sd, 2) : null,
    drivers: r.value == null ? [] : drivers(r, { hrv, rhr, resp, temp, sleep: sleep.score }, base, mean(e.sleepScores)),
    forecast: null,
    forecastNightsLeft: Math.max(0, 14 - f.recoveries.length),
  };
}

/** Last night's skin-temperature delta, °C: Health Connect's nightly reading against its own baseline (fix 10). */
const tempDelta = (d: Day) => (d.dm?.nightlyTempC == null ? null : d.dm.nightlyTempC - (d.dm.tempBaselineC ?? 0));

/**
 * "What shaped it": each term's points against that term at its baseline (HRV, resting HR and respiratory rate at z = 0,
 * temperature at or below baseline, the Sleep Score at the person's typical night), biggest mover first.
 */
function drivers(
  r: Extract<RecoveryResult, { value: number }>,
  cur: { hrv: number | null; rhr: number | null; resp: number | null; temp: number | null; sleep: number | null },
  base: { hrv: Agg | null; rhr: Agg | null; resp: Agg | null; temp: Agg | null },
  typicalSleep: number | null,
): ChargeDriver[] {
  const verdict = (pts: number, above: boolean): ChargeDriverVerdict => {
    const dir = above ? "ABOVE" : "BELOW";
    if (Math.abs(pts) < 1) return "AT_BASELINE";
    const kind = pts > 0 ? "SUPPORTING" : "LIMITING";
    return (Math.abs(pts) < 3 ? `SLIGHTLY_${dir}_BASELINE_${kind}` : `${dir}_BASELINE_${kind}`) as ChargeDriverVerdict;
  };
  const pts = (x: number) => roundHalfAway(x);
  const out: ChargeDriver[] = [];
  if (cur.hrv != null && base.hrv) {
    const p = pts((r.parts.hrv - 50) * 0.4);
    out.push({ label: "HEART_RATE_VARIABILITY", deltaPoints: p, value: roundHalfAway(cur.hrv, 1), baseline: roundHalfAway(base.hrv.avg, 1), unit: "MILLISECONDS", verdict: verdict(p, cur.hrv > base.hrv.avg) });
  }
  if (cur.rhr != null && base.rhr) {
    const p = pts((r.parts.rhr - 50) * 0.3);
    out.push({ label: "RESTING_HEART_RATE", deltaPoints: p, value: roundHalfAway(cur.rhr, 1), baseline: roundHalfAway(base.rhr.avg, 1), unit: "BEATS_PER_MINUTE", verdict: verdict(p, cur.rhr > base.rhr.avg) });
  }
  if (cur.sleep != null) {
    const p = pts((cur.sleep - (typicalSleep ?? cur.sleep)) * 0.3);
    const v: ChargeDriverVerdict = p >= 3 ? "STRONG_NIGHT_SUPPORTING" : p <= -3 ? "BELOW_GOOD_NIGHT_LIMITING" : "TYPICAL_NIGHT";
    out.push({ label: "SLEEP_QUALITY", deltaPoints: p, value: roundHalfAway(cur.sleep), baseline: null, unit: "PERCENT", verdict: v });
  }
  if (cur.resp != null && base.resp && r.parts.resp !== 0) {
    const p = pts(r.parts.resp);
    out.push({ label: "RESPIRATORY_RATE", deltaPoints: p, value: cur.resp, baseline: roundHalfAway(base.resp.avg, 1), unit: "BREATHS_PER_MINUTE", verdict: verdict(p, cur.resp > base.resp.avg) });
  }
  if (cur.temp != null && base.temp && r.parts.temp < 0) {
    const p = pts(r.parts.temp);
    out.push({ label: "SKIN_TEMPERATURE", deltaPoints: p, value: roundHalfAway(cur.temp, 2), baseline: roundHalfAway(base.temp.avg, 2), unit: "CELSIUS_DEVIATION", verdict: p === 0 ? "NEAR_BASELINE" : "WARMER_THAN_BASELINE_LIMITING" });
  }
  return out.sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints));
}

/** Tonight's need from the engine (sleep.md § Tonight planner), in the planner's parts. */
export function engineTonight(f: Fold, s: EngineSleep, strainToday: number | null) {
  const e = f.engine;
  const strains = strainToday == null ? e.strains : [...e.strains, strainToday].slice(-30);
  const need = sleepNeeded(s.need.goalS / 3600, strainToday, strains, s.bankMin);
  return tonightNeeded(need, e.effs, e.lats);
}

/** Folds day D into the engine's state, after every scorer has read it. */
export function foldEngineDay(f: Fold, d: Day, s: EngineSleep, strain: number | null) {
  const e = f.engine;
  const a = d.s1.engine;
  const temp = tempDelta(d);
  push(e.aggs, {
    restingHRV: a?.restingHRV ?? null,
    averageHRV: a?.averageHRV ?? null,
    restingHR: a?.restingHR ?? null,
    inactiveHR: a?.inactiveHR ?? null,
    resp: d.dm?.respBpm == null ? null : { avg: d.dm.respBpm, sd: 0, count: 1 },
    temp: temp == null ? null : { avg: temp, sd: 0, count: 1 },
  }, 60);
  push(e.asleepS, s.asleepS, 7);
  if (strain != null) push(e.strains, strain, 30);
  e.prevStrain = strain;
  push(e.nights, { dayStart: d.start, dayEnd: d.end, spans: s.spans }, 8);
  if (d.main) {
    push(e.effs, d.main.efficiency * 100, 30);
    if (d.main.latencyMin != null) push(e.lats, d.main.latencyMin, 30);
  }
  if (s.score != null) push(e.sleepScores, s.score, 60);
  push(e.strainHist, strain, 15);
}

/**
 * Tonight's plan on the engine's need (goal, strain and a quarter of the debt; naps count through the bank): halo's
 * planner turns it into bedtimes through the usual efficiency and time to fall asleep, and its parts become the engine's.
 */
export function enginePlan(f: Fold, d: Day, s: EngineSleep, planner: ReturnType<typeof scorePlanner>, strainToday: number | null) {
  const t = engineTonight(f, s, strainToday);
  const wakeDay = addDays(d.day, 1);
  const plan: SleepPlan = {
    ...sleepPlan({ baselineNeedHours: t.needS / 3600, strain: null, debtMin: 0, napMin: 0, nights: f.wakeNights, wakeDay }),
    parts: { baselineMin: t.goalS / 60, strainMin: t.strainS / 60, debtMin: t.debtS / 60, napMin: 0 },
  };
  f.prevPlan = { wakeDay, needMin: plan.needMin };
  const row: SleepPlannerRow = planner.row.reason === null ? { ...planner.row, ...plan } : { ...planner.row, needMin: plan.needMin };
  return { ...planner, row, plan };
}

/** Day D's Daily Strain on the engine (a percent), or null without one. */
export const engineStrain = (d: Day): number | null => d.s1.engine?.strain?.value ?? null;

/**
 * Cardio Load for day D (strain-load.md § Cardio Load): the day's load is its workouts' TRIMP, ATL and CTL step from a
 * zero seed, and the status reads the same day's Recovery.
 */
export function scoreCardioLoad(f: Fold, d: Day, recoveryValue: number | null): CardioLoadRow {
  const e = f.engine;
  const load = d.cache.activities.reduce((a, x) => a + (x.engine?.trimp ?? 0), 0);
  push(e.loads28, load, 28);
  push(e.active42, load > 5, 42);
  const { atl, ctl } = loadStep(e, load);
  e.atl = atl;
  e.ctl = ctl;
  push(e.ctls, ctl, 10);
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const a = meanOf(e.ctls.slice(-5));
  const b = e.ctls.length > 5 ? meanOf(e.ctls.slice(0, -5)) : null;
  const ctlTrendPct = a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null;
  const confidence = loadConfidence(e.loads28, e.active42.filter(Boolean).length);
  const r4 = (x: number) => roundHalfAway(x, 4);
  return {
    load: r4(load),
    atl: r4(atl),
    ctl: r4(ctl),
    ratio: ctl > 0 ? r4(atl / ctl) : null,
    confidence: r4(confidence),
    status: loadStatus({ atl, ctl, confidence, ctlTrendPct, recovery: recoveryValue }),
  };
}

/**
 * Target Strain for day D (strain-load.md § Target Strain): the 14 days before, folded, scaled by today's Recovery. On
 * the percent scale; always present (a short history folds what there is).
 */
export function scoreEngineStrainTarget(f: Fold, recoveryValue: number | null): StrainTargetRow {
  const hist = f.engine.strainHist;
  const base = targetBase(hist);
  const { low, high } = targetRange(base, recoveryValue);
  return {
    reason: null,
    low: roundHalfAway(low, 1),
    high: roundHalfAway(high, 1),
    base: hist.length ? roundHalfAway(base, 1) : null,
    band: band(recoveryValue ?? 50),
    coldStart: hist.length < 14,
    acwrRule: null,
  };
}

// ── Stress and Energy Bank (Phase 5) ────────────────────────────────────────

/** One 6-minute slot: its start, context, display stress and raw stress for Energy Bank. */
type Slot = { ts: number; context: SlotContext; display: number | null; raw: number | null };

/**
 * Day D's slots on its local-midnight grid (stress.ts): heart rate per slot from the minute series (median or trimmed
 * mean for Stress, the mean for Energy Bank, gaps filled from neighbours), the latest HRV within 36 minutes (a workout's
 * mean HRV in a workout slot), against the 30 days' HRV and awake heart rate up to and including D.
 */
function slotsOfDay(f: Fold, d: Day, data: Data, inputs: Inputs): { slots: Slot[]; referenceHr: number | null } {
  const e = f.engine;
  const a = d.s1.engine;
  const sessions = touching(data.sessions, d.start - HRV_LOOKBACK_S, d.end);
  const tl = timeline({
    sessions,
    segments: sessions.flatMap((s) => (inputs.segments.get(s.id) ?? []).map((g) => ({ ...g }))),
    workouts: touching(data.exercises, d.start, d.end),
  });
  const recent = [...e.aggs.slice(-29), { averageHRV: a?.averageHRV ?? null, inactiveHR: a?.inactiveHR ?? null }];
  const hrvBase = chanMerge(recent.flatMap((x) => (x.averageHRV ? [x.averageHRV] : [])));
  const inactive = recent.flatMap((x) => (x.inactiveHR ? [x.inactiveHR] : []));
  const hist = mergeHist(inactive.flatMap((x) => (x.hist ? [x.hist] : [])));
  const cdf = hist.length ? cdfOf(hist) : null;
  const referenceHr = chanMerge(inactive)?.avg ?? null;
  const hrv: [number, number][] = [...e.hrvPrev, ...(a?.hrv ?? []).map(([o, ms]): [number, number] => [d.start + o, ms])];
  const minutes = inputs.hrSeries?.get(d.day) ?? [];
  const starts = slotsOf(d.start, d.end);
  const perSlot = starts.map((s) => {
    const lo = Math.round((s - d.start) / 60);
    return minutes.slice(lo, lo + SLOT_S / 60).filter((v): v is number => v != null);
  });
  const medianHr = gapFill(perSlot.map(slotHr));
  const meanHr = gapFill(perSlot.map((xs) => mean(xs)));
  const slots = starts.map((s, i): Slot => {
    const end = s + SLOT_S;
    const context = slotContext(tl, s, end);
    const inSlot = hrv.filter(([t]) => t >= s && t < end).map(([, ms]) => ms);
    const latest = hrv.findLast(([t]) => t > s - HRV_LOOKBACK_S && t < end)?.[1] ?? null;
    const reading = context === "workout" ? mean(inSlot) : latest;
    const ebReading = context === "workout" ? mean(hrv.filter(([t]) => t >= s - HRV_LOOKBACK_S && t < end).map(([, ms]) => ms)) : latest;
    const raw = slotStress({ hr: medianHr[i], cdf, hrv: reading, hrvBase });
    return {
      ts: s,
      context,
      display: displayStress(raw, context),
      raw: slotStress({ hr: meanHr[i], cdf, hrv: ebReading, hrvBase }),
    };
  });
  return { slots, referenceHr };
}

/** Per-minute values from per-slot ones (each minute takes its slot's), for the stored series. */
function perMinute(d: Day, slots: Slot[], pick: (s: Slot, i: number) => number | null): (number | null)[] {
  const n = Math.round((d.end - d.start) / 60);
  const out = new Array<number | null>(n).fill(null);
  slots.forEach((s, i) => {
    const v = pick(s, i);
    const m0 = Math.round((s.ts - d.start) / 60);
    for (let m = m0; m < Math.min(n, m0 + SLOT_S / 60); m++) out[m] = v == null ? null : roundHalfAway(v, 1);
  });
  return out;
}

/** The engine's Stress row and series for day D (0–100), and the slots Energy Bank runs on. */
export function scoreEngineStress(f: Fold, d: Day, data: Data, inputs: Inputs) {
  const e = f.engine;
  const { slots, referenceHr } = slotsOfDay(f, d, data, inputs);
  const shown = slots.filter((s) => s.display != null);
  const today = daysBetween("1970-01-01", d.day);
  const average = shown.length ? mean(shown.map((s) => s.display!)) : null;
  if (average != null) {
    if (e.stressFirst == null) e.stressFirst = today;
    e.stressDays++;
  }
  const mins = (lvl: "low" | "medium" | "high") => shown.filter((s) => stressLevel(s.display!) === lvl).length * (SLOT_S / 60);
  let longestHigh: StressRow["longestHigh"] = null;
  let run: number | null = null;
  slots.forEach((s, i) => {
    const high = s.display != null && s.display >= 60;
    if (high && run == null) run = i;
    if ((!high || i === slots.length - 1) && run != null) {
      const endI = high ? i + 1 : i;
      const minutes = (endI - run) * (SLOT_S / 60);
      if (!longestHigh || minutes > longestHigh.minutes) longestHigh = { start: slots[run].ts, minutes };
      run = null;
    }
  });
  const last = shown.at(-1);
  const row: StressRow = {
    provisional: average != null && !calibrated(e.stressFirst ?? today, today, e.stressDays, STRESS_CALIBRATION_DAYS),
    average: average == null ? null : roundHalfAway(average, 1),
    lowMin: mins("low"),
    mediumMin: mins("medium"),
    highMin: mins("high"),
    latest: last ? { ts: last.ts, value: roundHalfAway(last.display!, 1) } : null,
    longestHigh,
    referenceHr: referenceHr == null ? null : roundHalfAway(referenceHr, 1),
  };
  e.hrvPrev = (d.s1.engine?.hrv ?? []).map(([o, ms]): [number, number] => [d.start + o, ms]);
  return { row, series: perMinute(d, slots, (s) => s.display), slots };
}

/** Seconds of sleep (any session) inside [lo, hi): sessions split at local midnight. */
const sleepWithin = (data: Data, lo: number, hi: number) =>
  touching(data.sessions, lo, hi).reduce((a, s) => a + Math.min(hi, s.endTs) - Math.max(lo, s.startTs), 0);

/**
 * The engine's Energy Bank for day D: the state machine over the day's slots from where yesterday ended (from 0 on the
 * first day of history), shown from the eighth day it has run (fix 3). The last day runs to its last heart rate and
 * hands nothing on; every earlier day runs to midnight.
 */
export function scoreEngineEnergyBank(f: Fold, d: Day, data: Data, slots: Slot[], sleepGoalS: number): { row: EnergyBankRow; curve: (number | null)[] | null } {
  const e = f.engine;
  const full = d.day < data.last;
  const until = full ? d.end : d.s1.lastHrTs != null ? Math.min(d.end, d.s1.lastHrTs + 60) : d.start;
  const awakeS = awakeSeconds(e.sleepS);
  const fromLevel = e.ebLevel ?? 0;
  let level = fromLevel;
  const before: (number | null)[] = [];
  let charged = 0;
  let drained = 0;
  const drains: Drain[] = [];
  const names = new Map(touching(data.exercises, d.start, d.end).map((x) => [x, x.name ?? "Workout"]));
  for (const s of slots) {
    if (s.ts >= until) {
      before.push(null);
      continue;
    }
    before.push(level);
    const next = energyStep(level, { context: s.context, rawStress: s.raw, sleepGoalS, awakeS });
    const delta = next - level;
    if (delta > 0) charged += delta;
    else if (delta < 0) {
      drained -= delta;
      const w = s.context === "workout" ? [...names].find(([x]) => x.endTs > s.ts && x.startTs < s.ts + SLOT_S) : undefined;
      const kind: Drain["kind"] = w ? "workout" : s.raw != null && s.raw >= 60 ? "stress" : "activity";
      const label = w ? w[1] : kind === "stress" ? "Stress" : "Activity";
      const lastDrain = drains.at(-1);
      if (lastDrain && lastDrain.label === label && lastDrain.end === s.ts) {
        lastDrain.end = s.ts + SLOT_S;
        lastDrain.amount -= delta;
      } else drains.push({ label, kind, start: s.ts, end: s.ts + SLOT_S, amount: -delta });
    }
    level = next;
  }
  e.ebDays++;
  if (full) e.ebLevel = level;
  push(e.sleepS, sleepWithin(data, d.start, d.end), 7);
  if (d.s1.hrCount === 0 && !d.main) return { row: { value: null, reason: "band_not_worn", provisional: false }, curve: null };
  if (e.ebDays <= WARMUP_DAYS) return { row: { value: null, reason: "calibrating", provisional: false }, curve: null };
  const wake = d.main ? Math.max(d.start, d.main.end) : d.start;
  const wakeI = Math.min(slots.length - 1, Math.max(0, Math.floor((wake - d.start) / SLOT_S)));
  const r1 = (x: number) => roundHalfAway(x, 1);
  return {
    row: {
      value: r1(level),
      reason: null,
      provisional: false,
      startLevel: r1(before[wakeI] ?? fromLevel),
      wake,
      until,
      charged: r1(charged),
      drained: r1(drained),
      topDrains: drains
        .sort((x, y) => y.amount - x.amount)
        .slice(0, 3)
        .map((x) => ({ ...x, amount: r1(x.amount) })),
      naps: d.naps.filter((x) => d.main == null || x.start >= d.main.end).map((x) => ({ start: x.start, end: x.end })),
      from: d.start,
      fromLevel: r1(Math.max(1, fromLevel)),
      band: energyBand(level),
    },
    curve: perMinute(d, slots, (_, i) => before[i]),
  };
}

// ── Pulse Age (Phase 6) ─────────────────────────────────────────────────────

const isSunday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

/**
 * Pulse Age for day D. The study computes the week starting Monday W from the 28 days before W; the screens show a
 * week on its Sunday, so the value is stored on that Sunday, from the 28 days ending with it (the same days), with the
 * age at W, and every day after carries it until the next Sunday. Before the first Sunday, each day shows what its own
 * 28 days give. Fitbit's VO2 max and body-fat readings feed VO2 max and lean %. `halo`: halo's row, for the Fitness Age
 * estimate and body composition it also carries.
 */
export function scoreEnginePulseAge(f: Fold, d: Day, s: EngineSleep, halo: HealthspanRow, opts: PipelineOptions, data: Data): HealthspanRow {
  const e = f.engine;
  foldPulseAgeDay(f, d, s, data);
  const fitnessEstimate = halo.fitnessEstimate;
  if (isSunday(d.day) || !e.ageWeek) {
    const age = fractionalYears(opts.profile.birthDate, addDays(d.day, 1));
    const r = pulseAge({
      age,
      sex: opts.profile.sex,
      days: e.ageDays.map((x) => x.day),
      vo2: e.ageDays.flatMap((x) => (x.vo2 == null ? [] : [x.vo2])),
      leanPct: e.ageDays.flatMap((x) => (x.lean == null ? [] : [x.lean])),
    });
    const refs = references(age, opts.profile.sex);
    const dataDays = e.ageDays.filter((x) => Object.values(x.day).some((v) => v != null)).length;
    const r2 = (v: number) => roundHalfAway(v, 2);
    const row: HealthspanRow = r
      ? {
          reason: null,
          age: r2(age),
          pulseAge: r2(r.pulseAge),
          deltaYears: r2(r.deltaYears),
          paceOfAging: r2(paceOf(r.pulseAge, age)),
          paceDaily: r2(paceOf(r.pulseAge, age)),
          paceAsOf: d.day,
          paceDays: dataDays,
          contributions: r.factors.flatMap((x) =>
            x.value == null || x.years == null ? [] : [{ key: x.key, value: r2(x.value), reference: r2(refs[x.key]), years: r2(x.years) }],
          ),
          vo2maxSource: e.ageDays.some((x) => x.vo2Run) ? "run" : e.ageDays.some((x) => x.vo2 != null) ? "daily" : null,
          bodyComposition: halo.reason === null ? halo.bodyComposition : null,
          dataDays,
          termsUsed: r.present,
          provisional: r.confidence < 0.5,
          paceProvisional: r.confidence < 0.5,
          fitnessEstimate,
        }
      : { reason: "calibrating", dataDays, fitnessEstimate };
    if (isSunday(d.day)) e.ageWeek = { day: d.day, row };
    else return row;
  }
  return { ...e.ageWeek!.row, fitnessEstimate };
}

/** Adds day D's Pulse Age inputs to the 28-day window. */
function foldPulseAgeDay(f: Fold, d: Day, s: EngineSleep, data: Data) {
  // Steps, zone and strength minutes on every day with data (heart rate or steps), as the study's daily metrics. Steps
  // are the day's count (reference study, `biological-age-muscular.md` § factors: HealthMetric `steps`), the total the
  // Steps screen shows, not Strain's awake steps, which leave out workouts and sleep.
  const covered = d.s1.engine?.strain != null;
  const z = d.s1.engine?.strain?.zoneS;
  const bodyFat = d.dm?.bodyFatPct;
  push(
    f.engine.ageDays,
    {
      day: {
        sleepHours: d.mainSession ? s.asleepS / 3600 : null,
        sri: s.consistency,
        steps: covered ? (d.dm?.steps ?? null) : null,
        zone13Min: covered && z ? (z[2] + z[3]) / 60 : null,
        zone45Min: covered && z ? (z[4] + z[5]) / 60 : null,
        strengthMin: covered ? strengthMinutes(data, d) : null,
        restingHr: d.s1.engine?.restingHR?.avg ?? null,
      },
      vo2: d.dm?.vo2maxRun ?? d.dm?.vo2maxDaily ?? null,
      vo2Run: d.dm?.vo2maxRun != null,
      lean: bodyFat == null ? null : 100 - bodyFat,
    },
    28,
  );
}

/** Minutes of strength-type workouts that started on day D. */
const strengthMinutes = (data: Data, d: Day) =>
  (data.exercisesByDay.get(d.day) ?? []).filter((x) => STRENGTH_TYPES.test(x.type)).reduce((a, x) => a + (x.endTs - x.startTs) / 60, 0);

// ── Journal insights (Phase 7) ──────────────────────────────────────────────

/**
 * Each behaviour's effect on the next day's Recovery, HRV z and Sleep Score over the 90 days before `asOf`
 * (journal.ts), on halo's TagImpact shape; clear effects first, then by the size of the Recovery effect.
 */
export function engineJournalImpact(entries: JournalDay[], outcomes: OutcomeDay[], asOf: string): TagImpact[] {
  const byDay = new Map(outcomes.map((o) => [o.day, o]));
  const result: TagImpact[] = [];
  for (const [tag, { yes, no }] of arms(entries, (d) => byDay.get(d) ?? null, asOf)) {
    const values = (xs: (OutcomeDay | null)[], m: (typeof IMPACT_METRICS)[number]) => xs.map((o) => o?.[m]).filter((v): v is number => v != null);
    const effects = Object.fromEntries(IMPACT_METRICS.map((m) => [m, effect(values(yes, m), values(no, m), m === "hrvZ" ? 2 : 0)])) as TagImpact["effects"];
    const enough = yes.length >= MIN_DAYS && no.length >= MIN_DAYS;
    result.push({ tag, status: enough ? "ok" : "not_enough_data", nYes: yes.length, nNo: no.length, effects });
  }
  const rank = (t: TagImpact) => (t.status !== "ok" ? -2 : t.effects.recovery.delta == null ? -1 : Math.abs(t.effects.recovery.delta));
  return result.sort((a, b) => rank(b) - rank(a) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

// ── Health Monitor (Phase 7) ────────────────────────────────────────────────

/** Nights the Health Monitor's normal band is drawn from, the night shown included. */
export const MONITOR_WINDOW = 30;

const MONITOR_FIELD = { restingHr: "rhr", hrv: "hrv", resp: "resp", spo2: "spo2", skinTempDev: "skinTempDev" } as const;

/**
 * Health Monitor's vitals on the engine's rule (reference study, other-calculators.md § Vitals): normal within ±1 SD
 * (population) of the mean over the window, the night shown included; low below, high above. halo's illness signal stays.
 */
export function engineMonitor(f: Fold, row: HealthMonitorRow): HealthMonitorRow {
  if (row.reason !== null) return row;
  const nights = f.monitorRows.slice(-MONITOR_WINDOW);
  // No SpO2: Fitbit does not write it to Health Connect, so it is left out rather than shown empty.
  const vitals = row.vitals.filter((v) => v.key !== "spo2").map((v) => {
    const xs = nights.map((n) => n[MONITOR_FIELD[v.key]]).filter((x): x is number => x != null && Number.isFinite(x));
    const s = popStats(xs);
    const range = s && { low: roundHalfAway(s.mean - s.sd, 2), high: roundHalfAway(s.mean + s.sd, 2) };
    const status: typeof v.status =
      v.value == null || !s ? "no_data" : s.sd === 0 ? "in_range" : v.value < s.mean - s.sd ? "low" : v.value > s.mean + s.sd ? "high" : "in_range";
    return { ...v, range, rangeSource: "pulse" as const, status };
  });
  return {
    ...row,
    vitals,
    inRange: vitals.filter((v) => v.status === "in_range").length,
    flagged: vitals.filter((v) => v.status === "high" || v.status === "low").length,
  };
}
