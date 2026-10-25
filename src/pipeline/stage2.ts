// Stage 2: folds every day, oldest first, over the daily rows and stage 1's cached results, then
// writes only the rows and series whose JSON changed. Ported from Pulse's src/server/pipeline/stage2.ts;
// the fold, the scorer order and the journal-impact memo are the web's, the reads and writes are Store calls.
import type { ReportRow, ScoreRow, SeriesKind, Store } from "@/data/store";
import { addDays } from "@/lib/time";
import { slice } from "@/lib/yield";
import { hrvCfg, recoveryHRVLnCfg, respCfg, restingHRCfg, skinTempCfg, update } from "@/core/scoring/baselines";
import { lnHrv } from "@/core/scoring/recovery";
import { activityCost } from "@/core/algorithms/activityCost";
import type { JournalDay, TagImpact } from "@/core/algorithms/journalImpact";
import { buildReport, periodBounds, reportPeriods } from "@/core/algorithms/reports";
import { activityKind } from "@/queries/common";
import { BATCH_DAYS, byteOrder, type Data, groupBy, type Progress, type Segment, sha } from "./data";
import {
  type Cached,
  dayOf,
  type Fold,
  forecastOf,
  type Inputs,
  newFold,
  recordOutcomes,
  scoreFitness,
  scoreHealthMonitor,
  scoreHealthspan,
  scoreHrvStatus,
  scoreTraining,
  scorePlanner,
  scoreSleep,
  scoreStress,
  scoreTrainingLoad,
} from "./scores";
import { type JournalImpactRow, type PipelineOptions, SCORING_VERSION, STAGE2_COLUMNS, type Stage2Row } from "./types";
import { emptyScoreRow } from "./stage1";
import {
  enginePlan,
  engineJournalImpact,
  engineMonitor,
  engineSleepRow,
  engineStrain,
  foldEngineDay,
  scoreCardioLoad,
  scoreEngineRecovery,
  scoreEngineEnergyBank,
  scoreEnginePulseAge,
  scoreEngineSleep,
  scoreEngineStress,
  scoreEngineStrainTarget,
} from "./engine";
import { computeVascularCorridorSeries, type VascularDailyFeatureInput } from "@/core/engine/vascular";
import { resume, snapshot } from "./checkpoint";

export async function stage2(store: Store, data: Data, opts: PipelineOptions, onProgress?: Progress, rerun: string[] = []) {
  const { timeZone: tz } = opts;
  const { days } = data;
  const { inputs, journal, storedImpact, storedRows } = await readInputs(store, data);
  const stillHr = new Map<string, (number | null)[]>();
  const hrSeries = new Map<string, (number | null)[]>();
  Object.assign(inputs, { stillHr, hrSeries });

  // Pulse: start from the fold kept by the last run when no earlier day's inputs changed (checkpoint.ts).
  const cp = await resume(store, data, inputs, journal, opts, rerun);
  const start = cp.start;
  const f = cp.fold ?? newFold();
  let kept: Fold | null = null;
  const out = new Map<string, Omit<Stage2Row, "journal_impact">>();
  // Stress and Energy Bank series go out in batches during the fold rather than all at the end, so memory
  // doesn't grow with history. They are idempotent upserts.
  let pending: { day: string; stress: (number | null)[]; energy: (number | null)[] | null }[] = [];
  const cuffRows = await store.getBloodPressureReadings(data.last);
  const flush = async () => {
    const batch = pending;
    pending = [];
    for (const p of batch) {
      await putSeriesIfChanged(store, p.day, "stress", p.stress);
      // An empty series removes a stale Energy Bank curve (the web deleted the row).
      await putSeriesIfChanged(store, p.day, "energy_bank", p.energy ?? []);
    }
  };

  onProgress?.("stage2", 0, days.length);
  // Order matters: each scorer reads the fold as earlier scorers left it for today. The scorers are synchronous; the
  // loops here await slice() between days and between a day's scorers, so a run gives the JS thread back to the screen
  // every few milliseconds (src/lib/yield.ts). Nothing else touches the fold meanwhile, so the results don't change.
  for (let i = start; i < days.length; i++) {
    await slice();
    const day = days[i];
    if (i === cp.keepAt) kept = snapshot(f);
    if ((i - start) % BATCH_DAYS === 0) {
      // The per-minute series the scorers read, a batch of days at a time: the scorers stay synchronous and memory
      // stays flat in history length.
      await flush();
      onProgress?.("stage2", i, days.length);
      const batch = days.slice(i, i + BATCH_DAYS);
      stillHr.clear();
      hrSeries.clear();
      for (const d of batch) {
        const [still, hr] = await Promise.all([store.getSeries(d, "still_hr"), store.getSeries(d, "hr")]);
        if (still) stillHr.set(d, still);
        if (hr) hrSeries.set(d, hr);
      }
    }
    const d = dayOf(data, inputs, day, opts);
    // The Pulse engine's Sleep and Recovery (engine.ts) on the rows halo's scorers shape.
    const engineSleep = scoreEngineSleep(f, d, inputs, opts, tz);
    const sleep = engineSleepRow(scoreSleep(data, inputs, f, d, tz), engineSleep);
    const recovery = scoreEngineRecovery(f, d, engineSleep);
    const trainingLoad = { ...scoreTrainingLoad(f, d, recovery), cardio: scoreCardioLoad(f, d, recovery.value) };
    const strainTarget = scoreEngineStrainTarget(f, recovery.value);
    const planner = enginePlan(f, d, engineSleep, scorePlanner(f, d, sleep, tz), engineStrain(d));
    recovery.forecast = forecastOf(f, d, recovery, planner.plan, planner.tonightNeed);
    await slice();
    // Halo's stress still feeds halo's training scorer; the stored Stress and Energy Bank are the engine's (engine.ts).
    const stress = scoreStress(f, d, inputs);
    const engineStress = scoreEngineStress(f, d, data, inputs);
    const energy = scoreEngineEnergyBank(f, d, data, engineStress.slots, engineSleep.need.goalS);
    pending.push({ day, stress: engineStress.series, energy: energy.curve });
    await slice();
    const hrvStatusRow = scoreHrvStatus(f, recovery);
    const training = scoreTraining(data, f, d, recovery, sleep, trainingLoad, stress.row, stress.minutes, hrvStatusRow, opts);
    const healthMonitor = engineMonitor(f, scoreHealthMonitor(f, d, inputs, recovery));
    const healthspan = scoreEnginePulseAge(f, d, engineSleep, scoreHealthspan(data, f, d, sleep, opts, recovery), opts, data);
    const fitness = scoreFitness(f, d, opts);
    recordOutcomes(f, d, recovery, sleep, trainingLoad);
    out.set(day, {
      recovery,
      sleep,
      training_load: trainingLoad,
      strain_target: strainTarget,
      sleep_planner: planner.row,
      energy_bank: energy.row,
      stress: engineStress.row,
      health_monitor: healthMonitor,
      healthspan,
      fitness,
      hrv_status: hrvStatusRow,
      training,
      vascular_corridor: {
        mode: "uncalibrated",
        systolic: { value: null, lower: null, upper: null, reason: "baseline_warming_up", provisional: true },
        diastolic: { value: null, lower: null, upper: null, reason: "baseline_warming_up", provisional: true },
        pulsePressure: { value: null, reason: "baseline_warming_up", provisional: true },
        meanArterialPressure: { value: null, reason: "baseline_warming_up", provisional: true },
        autonomicDelta: { sbpDeltaMmHg: null, dbpDeltaMmHg: null, reason: "baseline_warming_up", provisional: true },
        calibration: { status: "uncalibrated", lastCalibratedAtMs: null, daysSinceCalibration: null, halfWidthMmHg: null, anchorSystolicMmHg: null, anchorDiastolicMmHg: null },
        drivers: { rhrDeltaBpm: null, lnRmssdDelta: null, sleepDebtHours: null, acwr: null, bmi: null },
        ahaCategory: null,
      },
    });

    // Fold today's nightly values into the baselines (after scoring today).
    f.hrvB = update(f.hrvB, recovery.inputs.hrv, hrvCfg);
    f.hrvLnB = update(f.hrvLnB, lnHrv(recovery.inputs.hrv), recoveryHRVLnCfg);
    f.rhrB = update(f.rhrB, recovery.inputs.rhr, restingHRCfg);
    f.respB = update(f.respB, recovery.inputs.resp, respCfg);
    f.skinB = update(f.skinB, d.dm?.nightlyTempC ?? null, skinTempCfg);
    f.efforts.push(d.s1.effort);
    foldEngineDay(f, d, engineSleep, engineStrain(d));
    f.prevAcwr = trainingLoad.acwr;
  }
  await flush();
  let lastKnownWeightKg: number | null = null;
  const vascularFeatures: VascularDailyFeatureInput[] = days.map((day) => {
    const dm = data.metrics.get(day);
    if (dm?.weightKg != null) lastKnownWeightKg = dm.weightKg;
    const cur = out.get(day);
    const prev = storedRows.get(day);
    const rec = cur?.recovery ?? prev?.recovery ?? null;
    const slp = cur?.sleep ?? prev?.sleep ?? null;
    const st1 = inputs.cached.get(day)?.s1 ?? prev?.strain ?? null;
    const h = opts.profile.heightCm;
    const bmi =
      lastKnownWeightKg != null && h != null && h > 0
        ? lastKnownWeightKg / Math.pow(h / 100, 2)
        : null;
    const sleepEfficiencyPct =
      slp?.main != null ? slp.main.efficiency * 100 : null;
    return {
      date: day,
      rhrBpm: rec?.inputs.rhr ?? dm?.rhrBpm ?? null,
      hrvRmssdMs: rec?.inputs.hrv ?? dm?.hrvMs ?? null,
      sleepDurationHours: slp?.creditedMin != null ? slp.creditedMin / 60 : slp?.main != null ? slp.main.asleepMin / 60 : null,
      sleepEfficiencyPct,
      sleepDebtHours: slp?.debtMin != null ? slp.debtMin / 60 : null,
      strainPct: st1?.engine?.strain?.value ?? null,
      respiratoryRateBrpm: rec?.inputs.resp ?? dm?.respBpm ?? null,
      skinTempDeltaC: dm?.nightlyTempC ?? null,
      bmi,
    };
  });
  const vascularByDay = computeVascularCorridorSeries(vascularFeatures, cuffRows);
  for (const [day, row] of out) {
    const vc = vascularByDay.get(day);
    if (vc) row.vascular_corridor = vc;
  }
  onProgress?.("stage2", days.length, days.length);
  const recovery = new Map<string, number>();
  for (const day of days.slice(0, start)) {
    const v = storedRows.get(day)?.recovery?.value;
    if (v != null) recovery.set(day, v);
  }
  for (const [day, row] of out) if (row.recovery.value != null) recovery.set(day, row.recovery.value);
  await putActivityCost(store, data, recovery);

  // ── Journal impact: as of each day, memoised on its inputs ────────────────
  onProgress?.("journal", 0, days.length);
  const entries: JournalDay[] = [...journal].map(([day, es]) => ({ day, tags: Object.fromEntries(es.map((e) => [e.tag, e.value])) }));
  const rows = new Map<string, Stage2Row>();
  const impactsAsOf = new Map<string, TagImpact[]>();
  for (let i = start; i < days.length; i++) {
    await slice();
    const day = days[i];
    const from = addDays(day, -90);
    const inWindow = entries.filter((e) => e.day >= from && e.day < day);
    const outWindow = f.outcomes.filter((o) => o.day > from && o.day <= day);
    // "engine": the Pulse engine's t-test (version 24), so a row memoised under halo's bootstrap is redone.
    const key = sha(JSON.stringify(["engine", inWindow, outWindow]));
    const prior = storedImpact.get(day);
    const impacts = prior?.key === key ? prior.impacts : engineJournalImpact(inWindow, outWindow, day);
    impactsAsOf.set(day, impacts);
    rows.set(day, { ...out.get(day)!, journal_impact: { key, impacts } });
    if (i % BATCH_DAYS === BATCH_DAYS - 1) onProgress?.("journal", i + 1, days.length);
  }
  onProgress?.("journal", days.length, days.length);

  // ── Writes ────────────────────────────────────────────────────────────────
  // Only rows whose version or JSON changed are written, so an unchanged run writes nothing.
  for (const day of days.slice(start)) {
    await slice();
    const row = rows.get(day)!;
    const prev = storedRows.get(day) ?? emptyScoreRow(day);
    const next: ScoreRow = { ...prev, day, scoringVersion: SCORING_VERSION };
    for (const k of STAGE2_COLUMNS) (next as Record<string, unknown>)[k] = row[k];
    if (prev.scoringVersion !== SCORING_VERSION || STAGE2_COLUMNS.some((k) => !sameJson(prev[k], next[k]))) await store.putScores(next);
  }
  const periods = reportPeriods(f.reportRows);
  const reportRows: ReportRow[] = [];
  for (const period of periods) {
    await slice();
    const { end } = periodBounds(period);
    const asOf = end < data.last ? end : data.last;
    reportRows.push({ period, data: buildReport(period, f.reportRows, impactsAsOf.get(asOf) ?? storedImpact.get(asOf)?.impacts ?? []) });
  }
  await store.putReports(reportRows);
  if (kept) await cp.keep(kept);
  return days[start];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mobile: Activity Cost over all history (activityCost.ts), each kind of workout (the screens' run, ride, walk, strength,
 * workout) against the day's Recovery; written only when it changed.
 */
async function putActivityCost(store: Store, data: Data, recovery: Map<string, number>) {
  const daysByKind = new Map<string, Set<string>>();
  for (const e of data.exercises) {
    const kind = activityKind(e.type);
    daysByKind.set(kind, (daysByKind.get(kind) ?? new Set()).add(e.day));
  }
  const next = activityCost(daysByKind, recovery);
  if (!sameJson(await store.getActivityCost(), next)) await store.putActivityCost(next);
}

/** Writes a per-minute series only when it differs from what is stored (an empty one when nothing should be). */
async function putSeriesIfChanged(store: Store, day: string, kind: SeriesKind, data: (number | null)[]) {
  const prev = await store.getSeries(day, kind);
  if (data.length ? prev && sameJson(prev, data) : !prev) return;
  await store.putSeries(day, kind, data);
}

/** Stage 1's cached rows, hypnograms, the journal and the stored journal impact. */
async function readInputs(store: Store, data: Data) {
  const [scored, segmentRows, entryRows] = await Promise.all([
    store.scoresIn({ from: data.first, to: data.last }),
    store.segmentsFor(data.sessions.map((s) => s.id)),
    store.allJournal(),
  ]);
  const segments = segmentRows.slice().sort((a, b) => a.startTs - b.startTs);
  // Tags in byte order, as SQLite sorted them: their order is part of journal impact's memo key.
  const entries = entryRows.slice().sort((a, b) => byteOrder(a.day, b.day) || byteOrder(a.tag, b.tag));
  const storedRows = new Map(scored.map((r) => [r.day, r]));
  const cached = new Map(
    scored.flatMap((r): [string, Cached][] =>
      r.strain
        ? [[r.day, { s1: r.strain, activities: r.activities ?? [], sessionRhr: r.sessionRhrBpm, recovery: r.recovery ?? null }]]
        : [],
    ),
  );
  const storedImpact = new Map(scored.map((r): [string, JournalImpactRow | null] => [r.day, r.journal_impact ?? null]));
  const journal = groupBy(entries, (e) => e.day);
  const inputs: Inputs = {
    cached,
    // Filled a batch of days at a time by stage2.
    stillHr: new Map(),
    segments: groupBy(segments as Segment[], (s) => s.sessionId),
    tagOn: (day, tag) => (journal.get(day) ?? []).some((e) => e.tag === tag && e.value > 0),
  };
  return { inputs, journal, storedImpact, storedRows };
}
