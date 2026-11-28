// Stage 1: per-sample work for the days whose inputs changed. Reads heart rate and steps (the Store's hr_days /
// steps_days buckets) and caches each day's strain, activities, session resting HR and per-minute series, and (mobile)
// the workouts it detects from sustained elevated HR.
// Ported from Pulse's src/server/pipeline/stage1.ts; only the reads and writes changed.
import type { ScoreRow, Store } from "@/data/store";
import { addDays } from "@/lib/time";
import { slice } from "@/lib/yield";
import { hrRecovery } from "@/core/scoring/hrRecovery";
import { sessionRestingHR } from "@/core/scoring/restingHr";
import { cardioTrimp, defaultRestingHR, effortOfTrimp, muscularTrimp, strain, wakingFloorCap, wakingFloorDefault } from "@/core/scoring/strain";
import { isWakingHourOfDay, quantile } from "@/core/scoring/stressBase";
import type { BaselineState, HrSample } from "@/core/scoring/types";
import { timeInZone, zones as hrZones } from "@/core/scoring/zones";
import { AUTO_WORKOUT_VERSION, detectWorkouts } from "@/core/algorithms/autoWorkout";
import { zoneBoutSeconds } from "@/core/algorithms/healthspan";
import { sleepStress } from "@/core/algorithms/sleepStress";
import { maxHrSplit, peakEpoc } from "@/core/algorithms/trainingEffect";
import { minuteMeanHr, stress } from "@/core/algorithms/stress";
import { BATCH_DAYS, type Data, type Exercise, type Progress, r1, round, type Segment, type Session, sha, touching } from "./data";
import { MODERATE_FROM_HRR } from "./intensity";
import { carriedRestingHr, estimateRestingHr, resolveRestingHr } from "./restingHr";
import { type EngineDayAggs, type EngineWorkout, type PipelineOptions, SCORING_VERSION, type Stage1Activity, type Stage1Day } from "./types";
import type { Agg } from "@/core/engine/baselines";
import { contextAt, minuteHr, timeline, within } from "@/core/engine/context";
import { baseline, BASELINE_DAYS } from "@/core/engine/baselines";
import { dayStrain, epoc, hrRecovery as engineHrr, PASSIVE_GAP_S, segmentsOf, trimp, units, workoutStrain, zoneSeconds, zonesOf } from "@/core/engine/strain";
import { dayAggregates } from "@/core/engine/days";
import type { HrvSample } from "@/data/types";

/** A baseline whose centre is set, so stress() scores every still minute; only the still mask is kept. */
const MASK_BASELINE: BaselineState = { baseline: 0, spread: 1, nValid: 1, nightsSinceUpdate: 0, status: "calibrating" };

/**
 * Days behind a day's waking floor (Day Strain's floor, strain.ts): the median of their own still waking heart rate on
 * the reserve. 14 days, as WHOOP's resting HR and Stress Monitor baselines (The Locker, 2024-11-21 and 2023-03-29).
 */
export const WAKING_FLOOR_DAYS = 14;
/** Still waking minutes a day needs before its own median counts toward later days' floors (calibrated). */
export const WAKING_FLOOR_MIN_MINUTES = 30;

/** Days a measured or Fitbit VO2max is used for after its reading (Training Effect's intensity scale). */
export const VO2MAX_DAYS = 90;

/** The newest measured VO2max, else Fitbit's, within VO2MAX_DAYS up to `day`, 0.1 precision; null without one. */
export function vo2maxFor(data: Data, day: string): number | null {
  for (let k = 0; k < VO2MAX_DAYS; k++) {
    const m = data.metrics.get(addDays(day, -k));
    const v = m?.vo2maxRun ?? m?.vo2maxDaily;
    if (v != null && v > 0) return round(v, 1);
  }
  return null;
}

/** The median of the values, or null with none. */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * A day's waking floor from the days before it (their own `wakingHrr`, oldest first, missing ones skipped): their median,
 * capped at wakingFloorCap, at 3 dp; null without any (the day then uses its own, else wakingFloorDefault).
 */
export function wakingFloorFrom(prior: (number | null | undefined)[]): number | null {
  const m = median(prior.filter((v): v is number => v != null));
  return m === null ? null : round(Math.min(m, wakingFloorCap), 3);
}

/**
 * `carried`: the resting HR carried from earlier days, on a day without a daily one (restingHr.ts). `floor`: the waking
 * floor from the days before (wakingFloorFrom).
 */
function stage1Key(data: Data, day: string, opts: PipelineOptions, carried: number | null, floor: number | null, rhrBase: number | null) {
  const lo = data.dayStart(day);
  const hi = data.dayStart(addDays(day, 1));
  const main = data.mainOf.get(day);
  return sha(
    JSON.stringify([
      SCORING_VERSION,
      opts.timeZone, // the day's bounds come from it
      opts.profile.maxHr,
      opts.profile.sex, // Banister's weighting differs by sex (strain.ts)
      data.metrics.get(day)?.rhrBpm ?? null,
      carried,
      floor,
      // The stages and asleep minutes too: Sleep Stress reads the night's stages (version 16).
      main ? [main.id, main.startTs, main.endTs, main.stagesStatus, main.asleepMin] : null,
      touching(data.sessions, lo, hi).map((s) => [s.id, s.startTs, s.endTs, s.isMain]),
      touching(data.exercises, lo, hi + 330).map((e) => [e.id, e.startTs, e.endTs, e.type, e.day]),
      AUTO_WORKOUT_VERSION, // mobile: a change to detection redoes every day
      vo2maxFor(data, day), // Training Effect's intensity scale (version 19)
      rhrBase, // the engine's TRIMP and EPOC rest on the 60-day resting-HR baseline (version 21)
      opts.profile.engineMaxHr, // the engine's zones (version 25)
      // The person's own zones: setting, changing or clearing them redoes every day, as a new max HR does. Left out
      // without them, so the keys of a profile that never set any stay as they were.
      ...(opts.profile.hrZones ? [opts.profile.hrZones] : []),
    ]),
  );
}

/** A score row with nothing scored yet: stage 1 fills its first three columns, stage 2 the rest. */
export const emptyScoreRow = (day: string): ScoreRow => ({
  day,
  scoringVersion: 0,
  strain: null,
  activities: null,
  sessionRhrBpm: null,
  recovery: null,
  sleep: null,
  training_load: null,
  strain_target: null,
  sleep_planner: null,
  energy_bank: null,
  stress: null,
  health_monitor: null,
  healthspan: null,
  fitness: null,
  journal_impact: null,
  hrv_status: null,
  training: null,
});

/**
 * Reruns the days whose memo key changed or that are in `dirtyDays` (what the Store's intraday_dirty held when the
 * run started). Returns the days it redid.
 */
export async function stage1(store: Store, data: Data, dirtyDays: string[], opts: PipelineOptions, onProgress?: Progress): Promise<string[]> {
  const storedRows = await store.scoresIn({ from: data.first, to: data.last });
  const storedBy = new Map(storedRows.map((r) => [r.day, r]));
  // A row written under another scoring version is stale whatever its key says.
  const stored = new Map(storedRows.map((r) => [r.day, r.strain?.key && r.scoringVersion === SCORING_VERSION ? r.strain.key : null]));
  const dirty = new Set(dirtyDays);
  // A night that starts before midnight reads the previous day's HR for its resting HR.
  for (const d of [...dirty]) {
    const main = data.mainOf.get(addDays(d, 1));
    if (main && main.startTs < data.dayStart(addDays(d, 1))) dirty.add(addDays(d, 1));
  }
  // Resting HR a day without its own can carry forward (mobile addition, restingHr.ts): each day's daily record, else its
  // sleep-session estimate (as stored, then as recomputed in this run). A day's key holds the value it carries.
  const known = new Map<string, number>();
  for (const d of data.days) {
    const v = data.metrics.get(d)?.rhrBpm ?? storedBy.get(d)?.sessionRhrBpm ?? null;
    if (v != null) known.set(d, v);
  }
  const carriedFor = (d: string) => (data.metrics.get(d)?.rhrBpm != null ? null : carriedRestingHr(d, known));
  // Each day's own still waking heart rate on the reserve, as stored and then as recomputed in this run: a day's waking
  // floor is the median of the 14 days before it, and its key holds that floor, so a change there reruns it.
  const waking = new Map<string, number>();
  for (const r of storedRows) if (r.strain?.wakingHrr != null && r.scoringVersion === SCORING_VERSION) waking.set(r.day, r.strain.wakingHrr);
  const floorFor = (d: string) => wakingFloorFrom(Array.from({ length: WAKING_FLOOR_DAYS }, (_, k) => waking.get(addDays(d, k - WAKING_FLOOR_DAYS))));
  // The engine's 60-day resting-HR baseline (sleep heart rate, pooled over the days before), as stored and then as
  // recomputed in this run: workouts' TRIMP and EPOC rest on it, and a day's key holds it. Rows of any version seed it:
  // a stale one only moves a first guess, which the next pass corrects once its day is redone (oldest first).
  const rhrAggs = new Map<string, Agg>();
  for (const r of storedRows) if (r.strain?.engine?.restingHR) rhrAggs.set(r.day, r.strain.engine.restingHR);
  const rhrBaseFor = (d: string) => {
    const b = baseline(Array.from({ length: BASELINE_DAYS }, (_, k) => rhrAggs.get(addDays(d, k - BASELINE_DAYS))), "combined");
    return b && round(b.avg, 2);
  };
  const keyOf = (d: string) => stage1Key(data, d, opts, carriedFor(d), floorFor(d), rhrBaseFor(d));
  /** The days whose key changed (and the dirty ones), oldest first; sliced (src/lib/yield.ts), as a key reads every session. */
  const stale = async (withDirty: boolean) => {
    const out: string[] = [];
    for (const d of data.days) {
      if ((withDirty && dirty.has(d)) || stored.get(d) !== keyOf(d)) out.push(d);
      await slice();
    }
    return out;
  };
  let todo = await stale(true);
  const redone: string[] = [];
  let total = todo.length;
  onProgress?.("stage1", 0, total);

  // Oldest first, so a day carries what the days before it just produced. A day whose own session estimate changed can
  // change what later days carry, so their keys are checked again after each pass; the next pass is short (only the
  // estimates of redone days move, and a day redone for its carried value keeps its own).
  for (let pass = 0; todo.length && pass < 5; pass++) {
    // Written in batches as it goes, so memory stays flat in history length. Each day's key is its own, so a crash
    // between batches just recomputes the days not yet written. Each batch reads its HR and steps once.
    for (let i = 0; i < todo.length; i += BATCH_DAYS) {
      const batch = todo.slice(i, i + BATCH_DAYS).map((day) => {
        const start = data.dayStart(day);
        const end = data.dayStart(addDays(day, 1));
        const main = data.mainOf.get(day);
        const exs = data.exercisesByDay.get(day) ?? [];
        return { day, start, end, main, exs, lo: Math.min(start, main?.startTs ?? start), hi: Math.max(end, ...exs.map((e) => e.endTs + 330)) };
      });
      // ponytail: one range per batch, so scattered dirty days read the HR between them too; split on gaps if that bites.
      const lo = Math.min(...batch.map((b) => b.lo));
      const hi = Math.max(...batch.map((b) => b.hi));
      // Every session the batch touches, with its stages: the engine labels samples by them (naps too).
      const near = touching(data.sessions, lo, hi);
      const [hrAll, stepsAll, segmentRows, hrvAll] = await Promise.all([
        store.readHr(lo, hi),
        store.readSteps(Math.min(...batch.map((b) => b.start)), Math.max(...batch.map((b) => b.end))),
        store.segmentsFor(near.map((s) => s.id)),
        store.readHrv(lo, hi),
      ]);
      for (const b of batch) {
        // A day's work is synchronous; between days the JS thread goes back to the screen (src/lib/yield.ts).
        await slice();
        const steps = between(stepsAll, b.start, b.end).map((s) => ({ ts: s.ts, steps: s.v }));
        const carried = carriedFor(b.day);
        const floor = floorFor(b.day);
        const rhrBase = rhrBaseFor(b.day);
        const key = stage1Key(data, b.day, opts, carried, floor, rhrBase);
        const segs = b.main ? segmentRows.filter((g) => g.sessionId === b.main!.id) : [];
        const r = stage1Day(data, b.day, b.start, b.end, b.main, segs, b.exs, between(hrAll, b.lo, b.hi), steps, key, carried, floor, opts);
        const eng = engineDay(data, b, between(hrAll, b.lo, b.hi), between(hrvAll, b.lo, b.hi), segmentRows, between(stepsAll, b.start, b.end), rhrBase, r.s1.restingHr, opts);
        r.s1.engine = eng.day;
        for (const a of r.activities) a.engine = eng.workouts.get(a.id);
        if (eng.day.restingHR) rhrAggs.set(b.day, eng.day.restingHR);
        else rhrAggs.delete(b.day);
        if (data.metrics.get(b.day)?.rhrBpm == null) {
          if (r.sessionRhr != null) known.set(b.day, r.sessionRhr);
          else known.delete(b.day);
        }
        if (r.s1.wakingHrr != null) waking.set(b.day, r.s1.wakingHrr);
        else waking.delete(b.day);
        stored.set(b.day, key);
        redone.push(b.day);
        // Stage 1 never stamps scoring_version (a new row gets 0): stage 2 does when it commits, so a crash between
        // the stages leaves the row visibly unscored.
        const prev = storedBy.get(b.day) ?? emptyScoreRow(b.day);
        await store.putScores({ ...prev, strain: r.s1, activities: r.activities, sessionRhrBpm: r.sessionRhr, detected: r.detected });
        await store.putSeries(b.day, "hr", r.hrSeries);
        await store.putSeries(b.day, "still_hr", r.still);
      }
      onProgress?.("stage1", redone.length, total);
    }
    todo = await stale(false);
    total += todo.length;
  }
  return [...new Set(redone)];
}

/** Aggregates to 4 decimals, so the stored JSON stays small and stable. */
const r4 = (a: Agg | null): Agg | null =>
  a && { avg: round(a.avg, 4), sd: round(a.sd, 4), count: a.count, ...(a.hist && { hist: a.hist }) };

/**
 * The Pulse engine's per-day work (src/core/engine): the sample-based aggregates (days.ts), Daily Strain from the waking
 * heart rate and steps and the day's workouts (strain.ts), and each workout's units, strain, TRIMP, EPOC and heart-rate
 * recovery. `rhrBase`: the 60-day resting-HR baseline TRIMP rests on (null without one: no TRIMP); EPOC falls back to
 * the day's resting HR.
 */
function engineDay(
  data: Data,
  b: { start: number; end: number; main: Session | undefined; lo: number; hi: number; exs: Exercise[] },
  hr: HrSample[],
  hrv: HrvSample[],
  segmentRows: Segment[],
  steps: { ts: number; v: number }[],
  rhrBase: number | null,
  dayRestingHr: number,
  opts: PipelineOptions,
): { day: EngineDayAggs; workouts: Map<string, EngineWorkout> } {
  const sessions = touching(data.sessions, b.lo, b.hi);
  const ids = new Set(sessions.map((s) => s.id));
  const tl = timeline({
    sessions,
    segments: segmentRows.filter((g) => ids.has(g.sessionId)),
    workouts: touching(data.exercises, b.lo, b.hi),
  });
  const minutes = minuteHr(hr);
  const a = dayAggregates({ dayStart: b.start, dayEnd: b.end, primary: b.main ?? null, tl, hr: minutes, hrv, respBpm: null, tempDeltaC: null });

  const { sex } = opts.profile;
  const maxHr = opts.profile.engineMaxHr ?? opts.profile.maxHr;
  const own = opts.profile.hrZones ?? null;
  const zones = zonesOf(maxHr, own);
  const workouts = new Map<string, EngineWorkout>();
  let workoutUnits = 0;
  const zoneS = [0, 0, 0, 0, 0, 0];
  const addZones = (segs: ReturnType<typeof segmentsOf>) => zoneSeconds(segs, zones).forEach((v, k) => (zoneS[k] += v));
  for (const e of b.exs) {
    const xs = hr.filter((s) => s.ts >= e.startTs && s.ts < e.endTs);
    const segs = segmentsOf(xs);
    addZones(segs);
    const u = units(segs, zones);
    workoutUnits += u;
    const t = trimp(segs, rhrBase, maxHr, sex);
    const ep = segs.length ? epoc(segs, rhrBase ?? dayRestingHr, maxHr) : null;
    const rec = engineHrr(hr.filter((s) => s.ts >= e.startTs && s.ts < e.endTs + 120), e.endTs, zones);
    workouts.set(e.id, {
      units: round(u, 1),
      zoneS: zoneSeconds(segs, zones).map((v) => Math.round(v)),
      strain: round(workoutStrain(u), 2),
      trimp: t == null ? null : round(t, 2),
      epocPeak: ep && round(ep.peak, 2),
      focus: ep && { lowAerobic: round(ep.focus.lowAerobic, 2), highAerobic: round(ep.focus.highAerobic, 2), anaerobic: round(ep.focus.anaerobic, 2) },
      hrr: rec && { drop: round(rec.drop, 1), startHr: rec.startHr, endHr: rec.endHr, startTs: rec.startTs, endTs: rec.endTs },
    });
  }
  // The waking (passive) pool: minute heart rate labelled awake, gaps capped at 30 minutes, zone 0 left out; steps taken
  // awake (not asleep, not in a workout).
  const awake = within(minutes, b.start, b.end).filter((m) => contextAt(tl, m.ts) === "awake");
  const awakeSegs = segmentsOf(awake, PASSIVE_GAP_S);
  addZones(awakeSegs);
  const passive = units(awakeSegs, zones, true);
  const awakeSteps = steps.reduce((n, s) => n + (contextAt(tl, s.ts, false) === "awake" ? s.v : 0), 0);
  const day: EngineDayAggs = {
    restingHRV: r4(a.restingHRV),
    averageHRV: r4(a.averageHRV),
    restingHR: r4(a.restingHR),
    inactiveHR: r4(a.inactiveHR),
    hrv: within(hrv, b.start, b.end).map((s): [number, number] => [s.ts - b.start, s.ms]),
    strain: hr.length || awakeSteps
      ? {
          value: round(dayStrain(awakeSteps, passive + workoutUnits), 2),
          steps: awakeSteps,
          passiveUnits: round(passive, 1),
          workoutUnits: round(workoutUnits, 1),
          zoneS: zoneS.map((v) => Math.round(v)),
          maxHr,
          ...(own ? { zones: [...zones.lowest] } : {}),
        }
      : null,
  };
  return { day, workouts };
}

/** The samples with lo <= ts < hi of a time-ordered list. */
function between<T extends { ts: number }>(xs: T[], lo: number, hi: number): T[] {
  const first = (t: number) => {
    let a = 0;
    let z = xs.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (xs[m].ts < t) a = m + 1;
      else z = m;
    }
    return a;
  };
  return xs.slice(first(lo), first(hi));
}

function stage1Day(
  data: Data,
  day: string,
  start: number,
  end: number,
  main: Session | undefined,
  segments: Segment[],
  exs: Exercise[],
  hr: HrSample[],
  stepRows: { ts: number; steps: number }[],
  key: string,
  carried: number | null,
  floor: number | null,
  opts: PipelineOptions,
) {
  const maxHr = opts.profile.maxHr;
  const sex = opts.profile.sex;
  const dayHr = hr.filter((s) => s.ts >= start && s.ts < end);
  const sessionRhr = main ? sessionRestingHR(main.startTs, main.endTs, hr) : null;
  const means = minuteMeanHr(dayHr, start, end);
  const n = means.length;
  const steps = new Array<number>(n).fill(0);
  for (const s of stepRows) steps[Math.floor((s.ts - start) / 60)] = s.steps;
  // Google's daily resting HR first; Pulse's sleep-session estimate only on days Google has none; then (mobile) the last
  // known one carried up to 30 days, then the day's own still heart rate, then 60 bpm (restingHr.ts).
  const dailyRhr = data.metrics.get(day)?.rhrBpm ?? null;
  const workouts = touching(data.exercises, start, end).map((x) => ({ start: x.startTs, end: x.endTs }));
  const { restingHr, source: restingHrSource } = resolveRestingHr(dailyRhr, sessionRhr, carried, () => estimateRestingHr(means, steps, start, workouts), defaultRestingHR);
  // Five zones on heart-rate reserve from the day's resting HR (WHOOP's 2024 edges, zones.ts), the reserve Strain's
  // continuous load is on.
  const zoneSet = hrZones(restingHr, maxHr);
  const tiz = (xs: HrSample[]) => timeInZone(xs, zoneSet);

  const dayTiz = tiz(dayHr);
  // Pulse Age's moderate-activity floor, 40 % of the reserve: Zone 1's lower edge since version 15 (WHOOP's 2024 zones),
  // so the separate 40–50 % tally stage 1 kept before (`moderateSeconds`) is gone.
  const moderateFrom = restingHr + MODERATE_FROM_HRR * Math.max(1, maxHr - restingHr); // the reserve as zones.ts takes it
  const excluded = [...touching(data.sessions, start, end), ...touching(data.exercises, start, end)].map((x) => ({
    start: x.startTs,
    end: x.endTs,
  }));
  const probe = stress({ start, end, hr: dayHr, steps, excluded, baseline: MASK_BASELINE });
  const still = probe.minutes.map((v, m) => (v == null ? null : means[m]));
  const noon = Math.min(n, 720);
  // Day Strain's waking floor (strain.ts): the share of the reserve of this day's median still waking minute (06–22,
  // no steps, outside sleep and workouts), which later days' floors read; this day's own floor comes from the 14 days
  // before it, else from this median, else the default.
  const reserve = Math.max(1, maxHr - restingHr);
  const stillWaking = still.filter((v, m): v is number => v != null && isWakingHourOfDay(Math.floor(m / 60)));
  const wakingHrr =
    stillWaking.length >= WAKING_FLOOR_MIN_MINUTES
      ? round(Math.min(1, Math.max(0, (quantile(stillWaking.sort((a, b) => a - b), 0.5) - restingHr) / reserve)), 4)
      : null;
  const floorX = floor ?? (wakingHrr == null ? wakingFloorDefault : round(Math.min(wakingHrr, wakingFloorCap), 3));
  const inWorkout = (ts: number) => workouts.some((w) => ts >= w.start && ts <= w.end);
  const dayCardio = cardioTrimp(dayHr, maxHr, restingHr, { sex, floor: { x: floorX, exempt: inWorkout } });
  const dayMuscular = exs.reduce((a, e) => a + muscularTrimp(e.type, (e.endTs - e.startTs) / 60), 0);
  const dayTrimp = dayCardio == null ? null : dayCardio + dayMuscular;
  // Sleep Stress over last night's main sleep (sleepStress.ts): its asleep minutes from the stages, its heart rate per
  // minute. Only a staged night has asleep minutes to read.
  let nightStress: Stage1Day["sleepStress"] = null;
  if (main && main.stagesStatus === "SUCCEEDED" && segments.length) {
    const nightHr = minuteMeanHr(hr, main.startTs, main.endTs);
    const asleepAt = new Array<boolean>(nightHr.length).fill(false);
    for (const g of segments) {
      if (g.stage !== "light" && g.stage !== "deep" && g.stage !== "rem") continue;
      for (let m = Math.max(0, Math.ceil((g.startTs - main.startTs) / 60)); m < nightHr.length && main.startTs + m * 60 < g.endTs; m++) asleepAt[m] = true;
    }
    const st = sleepStress(nightHr, asleepAt, restingHr, maxHr);
    nightStress = st && { pct: st.pct, minutes: st.minutes };
  }
  const withHr = (from: number, to: number) => means.slice(from, to).filter((v) => v != null).length;

  const s1: Stage1Day = {
    key,
    hrCount: dayHr.length,
    hrMinutesAm: withHr(0, noon),
    hrMinutesPm: withHr(noon, n),
    lastHrTs: dayHr.at(-1)?.ts ?? null,
    restingHr,
    restingHrSource,
    maxHr,
    effort: dayTrimp == null ? null : effortOfTrimp(dayTrimp),
    trimp: dayTrimp == null ? null : round(dayTrimp, 2),
    wakingHrr,
    floorHrr: floorX,
    zoneLower: zoneSet.zones.map((z) => round(z.lower, 1)),
    zoneSeconds: dayTiz.seconds,
    zoneBelowSeconds: dayTiz.belowZone1,
    // Mobile: Pulse Age counts zone time only inside workouts or in bouts of 10+ minutes (WHOOP counts it in activities).
    boutZoneSeconds: zoneBoutSeconds(means, start, { moderate: moderateFrom, brisk: zoneSet.zones[1].lower, vigorous: zoneSet.zones[3].lower }, workouts),
    sleepStress: nightStress,
    dayAggregate: probe.dayAggregate,
    stillMinutes: still.filter((v) => v != null).length,
  };
  const vo2 = vo2maxFor(data, day) ?? round((15.3 * maxHr) / Math.max(30, restingHr), 1);
  const activities: Stage1Activity[] = exs.map((e) => {
    const xs = hr.filter((s) => s.ts >= e.startTs && s.ts <= e.endTs);
    const actTiz = tiz(xs);
    // Activity Strain: the session's own TRIMP with no waking floor, plus its muscular load (strength types, strain.ts).
    const cardio = cardioTrimp(xs, maxHr, restingHr, { sex });
    const muscular = muscularTrimp(e.type, (e.endTs - e.startTs) / 60);
    // Version 19: the session's peak EPOC (Training Effect, trainingEffect.ts) on its VO2max, Fitbit's or a measured one,
    // else Uth's estimate from max and resting HR (Uth et al. 2004: 15.3 × max ÷ resting); and its time by % of max HR.
    const epoc = xs.length >= 2 ? round(peakEpoc(xs, restingHr, maxHr, vo2), 1) : null;
    return {
      id: e.id,
      effort: cardio == null ? null : effortOfTrimp(cardio + muscular),
      cardioTrimp: cardio == null ? null : round(cardio, 2),
      muscularTrimp: round(muscular, 2),
      epocPeak: cardio == null ? null : epoc,
      vo2max: vo2,
      maxHrSeconds: cardio == null ? null : maxHrSplit(xs, maxHr),
      hrCount: xs.length,
      avgHr: xs.length ? round(xs.reduce((a, s) => a + s.bpm, 0) / xs.length, 1) : null,
      // reduce, not Math.max(...): a long workout's readings overflow the stack as call arguments (#70).
      maxHr: xs.length ? xs.reduce((m, s) => Math.max(m, s.bpm), -Infinity) : null,
      zoneSeconds: actTiz.seconds,
      zoneBelowSeconds: actTiz.belowZone1,
      hrr: hrRecovery(hr, e.startTs, e.endTs, maxHr),
    };
  });
  // Mobile: sustained elevated HR with no workout or sleep recorded (autoWorkout.ts), shown as "Detected activity". Its
  // Effort is for display (its own TRIMP, no waking floor): the day's Effort already counts this HR (above the floor), and
  // nothing else reads it.
  const detected = detectWorkouts(dayHr, { restingHr, maxHr, steps: stepRows, excluded }).map((w) => ({
    ...w,
    effort: strain(dayHr.filter((s) => s.ts >= w.start && s.ts <= w.end), maxHr, restingHr, { sex }),
  }));
  return {
    s1,
    activities,
    detected,
    sessionRhr,
    hrSeries: means.map(r1),
    still,
  };
}
