// Stage 2: folds the days, oldest first, over the daily rows and stage 1's cached results, then writes only
// the rows, series and reports whose JSON changed.
//
// Incremental: the fold state after one day is kept (fold_checkpoints, one row), about a month behind the newest
// day. A run replays from the day after it when nothing before it changed (the usual case: last night and today),
// else from the first day. The replayed rows are byte-identical to a full fold's: the fold is plain JSON and every
// scorer reads only the fold and the day's own inputs (incremental.test.ts checks this).
import type { Repos, Store } from "../data/repos";
import type { Stage2Write } from "../data/repos/scores";
import { addDays, daysBetween } from "../time";
import { hrvCfg, respCfg, restingHRCfg, skinTempCfg, update } from "@/core/scoring/baselines";
import { journalImpact, type JournalDay, type TagImpact } from "@/core/algorithms/journalImpact";
import { buildReport, periodBounds, reportPeriods } from "@/core/algorithms/reports";
import { BATCH_DAYS, breathe, type Data, groupBy, sha } from "./data";
import {
  type Cached,
  dayOf,
  type Fold,
  forecastOf,
  type Inputs,
  newFold,
  recordOutcomes,
  scoreEnergyBank,
  scoreFitness,
  scoreHealthMonitor,
  scoreHealthspan,
  scorePlanner,
  scoreRecovery,
  scoreSleep,
  scoreStrainTarget,
  scoreStress,
  scoreTrainingLoad,
} from "./scores";
import {
  type JournalImpactRow,
  type PipelineOptions,
  type RecoveryRow,
  SCORING_VERSION,
  STAGE2_COLUMNS,
  type Stage1Activity,
  type Stage1Day,
  type Stage2Row,
} from "./types";

/** The checkpoint sits this many days before the newest day: sync re-lists sessions 30 days back, so older changes are rare. */
export const CHECKPOINT_LAG = 31;
/** The checkpoint moves forward in steps of this many days; between steps a run replays 31 to 61 days. */
export const CHECKPOINT_STEP = 30;

const inputsKey = (data: Data, opts: PipelineOptions) =>
  JSON.stringify([data.first, opts.timeZone, opts.profile.birthDate, opts.profile.sex, opts.profile.heightCm ?? null, opts.profile.maxHr]);

/** The stored checkpoint, when it was taken under the same version and inputs inside this history. */
async function readCheckpoint(store: Repos, data: Data, opts: PipelineOptions): Promise<{ day: string; fold: Fold } | null> {
  const r = await store.scores.readCheckpoint();
  if (!r || r.scoringVersion !== SCORING_VERSION || r.inputsKey !== inputsKey(data, opts) || r.day < data.first || r.day >= data.last) return null;
  return { day: r.day, fold: JSON.parse(r.fold) as Fold };
}

/**
 * `redone`: the days stage 1 redid this run (its key or a dirty mark: samples, sessions, workouts, daily rows,
 * journal). Null means unknown, so everything is replayed.
 */
export async function stage2(store: Store, data: Data, opts: PipelineOptions, redone: string[] | null = null): Promise<{ from: string; days: number }> {
  const { timeZone: tz } = opts;
  const { inputs, journal, storedImpact } = await readInputs(store);
  const stillHr = new Map<string, (number | null)[]>();
  const loadSeries = new Map<string, (number | null)[]>();
  Object.assign(inputs, { stillHr, loadSeries });

  // Where to start: the day before the first change (Energy Bank and Stress on day D read the night that follows
  // it), from the checkpoint when that lies after it, else from the first day.
  const checkpoint = await readCheckpoint(store, data, opts);
  const firstChanged = redone === null ? data.first : redone.length ? redone.reduce((a, b) => (b < a ? b : a)) : null;
  const needFrom = firstChanged === null ? null : addDays(firstChanged, -1);
  let f: Fold = newFold();
  let from = data.first;
  const resume = !!checkpoint && (needFrom === null || needFrom > checkpoint.day);
  if (resume) {
    f = checkpoint!.fold;
    from = addDays(checkpoint!.day, 1);
  }
  // A full fold always rewrites the checkpoint (a change before it made the stored state wrong); a resumed one moves
  // it forward about monthly. The replay reaches the candidate in both cases (from <= candidate).
  const candidate = addDays(data.last, -CHECKPOINT_LAG);
  const checkpointAt = candidate >= from && (!resume || daysBetween(checkpoint!.day, candidate) >= CHECKPOINT_STEP) ? candidate : null;
  let snapshot: string | null = null;
  const days = data.days.slice(data.days.indexOf(from));

  const out = new Map<string, Omit<Stage2Row, "journal_impact">>();
  // Stress and Energy Bank series go out in batches during the fold rather than all at the end, so memory
  // doesn't grow with history. They are idempotent upserts; a crash before the final commit leaves
  // intraday_dirty set, so the next run redoes everything.
  let pending: { day: string; stress: (number | null)[]; energy: (number | null)[] | null }[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    const series = batch.flatMap((p) => [
      { day: p.day, kind: "stress", data: p.stress },
      ...(p.energy ? [{ day: p.day, kind: "energy_bank", data: p.energy }] : []),
    ]);
    const noEnergy = batch.filter((p) => !p.energy).map((p) => p.day);
    await store.transaction(async (tx) => {
      await tx.series.upsertSeries(series);
      if (noEnergy.length) await tx.series.deleteSeries("energy_bank", noEnergy);
    });
  };

  // Order matters: each scorer reads the fold as earlier scorers left it for today.
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    await breathe();
    if (i % BATCH_DAYS === 0) {
      // The per-minute series the scorers read, a batch of days at a time: the scorers stay synchronous and memory
      // stays flat in history length.
      await flush();
      const batch = days.slice(i, i + BATCH_DAYS);
      stillHr.clear();
      loadSeries.clear();
      const rows = await store.series.readSeries(["still_hr", "load"], batch[0], batch.at(-1)!);
      for (const r of rows) (r.kind === "still_hr" ? stillHr : loadSeries).set(r.day, r.data);
    }
    const d = dayOf(data, inputs, day, opts);
    const sleep = scoreSleep(data, inputs, f, d, tz);
    const recovery = scoreRecovery(f, d, sleep);
    const trainingLoad = scoreTrainingLoad(f, d, recovery);
    const strainTarget = scoreStrainTarget(f, recovery);
    const planner = scorePlanner(f, d, sleep, tz);
    recovery.forecast = forecastOf(f, d, recovery, planner.plan, planner.tonightNeed);
    const stress = scoreStress(f, d, inputs);
    const energy = scoreEnergyBank(data, inputs, d, recovery, sleep, stress.minutes);
    pending.push({ day, stress: stress.series, energy: energy.curve });
    const healthMonitor = scoreHealthMonitor(f, d, inputs, recovery);
    const healthspan = scoreHealthspan(data, f, d, sleep, opts);
    const fitness = scoreFitness(f, d, opts);
    recordOutcomes(f, d, recovery, sleep, trainingLoad);
    out.set(day, {
      recovery,
      sleep,
      training_load: trainingLoad,
      strain_target: strainTarget,
      sleep_planner: planner.row,
      energy_bank: energy.row,
      stress: stress.row,
      health_monitor: healthMonitor,
      healthspan,
      fitness,
    });

    // Fold today's nightly values into the baselines (after scoring today).
    f.hrvB = update(f.hrvB, recovery.inputs.hrv, hrvCfg);
    f.rhrB = update(f.rhrB, recovery.inputs.rhr, restingHRCfg);
    f.respB = update(f.respB, recovery.inputs.resp, respCfg);
    f.skinB = update(f.skinB, d.dm?.nightlyTempC ?? null, skinTempCfg);
    f.efforts.push(d.s1.effort);
    f.prevAcwr = trainingLoad.acwr;
    // The state after this day, as the next run will read it back from jsonb.
    if (day === checkpointAt) snapshot = JSON.stringify(f);
  }
  await flush();

  // ── Journal impact: as of each day, memoised on its inputs ────────────────
  const entries: JournalDay[] = [...journal].map(([day, es]) => ({ day, tags: Object.fromEntries(es.map((e) => [e.tag, e.value])) }));
  const rows = new Map<string, Stage2Row>();
  const impactsAsOf = new Map<string, TagImpact[]>();
  for (const day of days) {
    await breathe();
    const from = addDays(day, -90);
    const inWindow = entries.filter((e) => e.day >= from && e.day < day);
    const outWindow = f.outcomes.filter((o) => o.day > from && o.day <= day);
    const key = sha(JSON.stringify([inWindow, outWindow]));
    const prior = storedImpact.get(day);
    const impacts = prior?.key === key ? prior.impacts : journalImpact(inWindow, outWindow, day);
    impactsAsOf.set(day, impacts);
    rows.set(day, { ...out.get(day)!, journal_impact: { key, impacts } });
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  // Only rows whose version or JSON changed are updated (writeStage2 is diff-only), so an unchanged run writes nothing.
  const scoreRows = days.map((day): Stage2Write => {
    const row = rows.get(day)!;
    return { day, scoringVersion: SCORING_VERSION, ...(Object.fromEntries(STAGE2_COLUMNS.map((k) => [camel(k), row[k]])) as Omit<Stage2Write, "day" | "scoringVersion">) };
  });
  const periods = reportPeriods(f.reportRows);
  const reportRows = periods.map((period) => {
    const { end } = periodBounds(period);
    const asOf = end < data.last ? end : data.last;
    // A period that ended before the replay keeps the impact stored for its last day (unchanged, or it would be replayed).
    return { period, data: buildReport(period, f.reportRows, impactsAsOf.get(asOf) ?? storedImpact.get(asOf)?.impacts ?? []) };
  });
  await store.transaction(async (tx) => {
    for (let i = 0; i < scoreRows.length; i += 200) await tx.scores.writeStage2(scoreRows.slice(i, i + 200));
    if (reportRows.length) await tx.scores.writeReports(reportRows);
    await tx.scores.deleteReportsExcept(periods);
    await tx.scores.deleteOutside(data.first, data.last);
    await tx.series.deleteOutside(data.first, data.last);
    if (snapshot !== null) {
      await tx.scores.writeCheckpoint({ day: checkpointAt!, scoringVersion: SCORING_VERSION, inputsKey: inputsKey(data, opts), fold: snapshot });
    } else if (!resume) {
      await tx.scores.deleteCheckpoint(); // too short a history for one; a stale row must not survive
    }
    // Stage 1 has redone these days, and now stage 2 has too.
    await tx.scores.clearDirty();
  });
  return { from, days: days.length };
}

/** daily_scores column name to its schema key. */
const camel = (k: string) => k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** Stage 1's cached rows, hypnograms, the journal and the stored journal impact. */
async function readInputs(store: Repos) {
  const [scored, segments, entries] = await Promise.all([
    store.scores.readStage2Inputs(),
    store.sessions.readSegments(),
    // Tags in byte order, as SQLite sorted them: their order is part of journal impact's memo key.
    store.journal.entriesForScoring(),
  ]);
  const cached = new Map(
    scored.map((r): [string, Cached] => [
      r.day,
      {
        s1: r.strain as Stage1Day,
        activities: (r.activities ?? []) as Stage1Activity[],
        sessionRhr: r.sessionRhr,
        recovery: (r.recovery ?? null) as RecoveryRow | null,
      },
    ]),
  );
  const storedImpact = new Map(scored.map((r) => [r.day, (r.impact ?? null) as JournalImpactRow | null]));
  const journal = groupBy(entries, (e) => e.day);
  const inputs: Inputs = {
    cached,
    // Filled a batch of days at a time by stage2.
    stillHr: new Map(),
    loadSeries: new Map(),
    segments: groupBy(segments, (s) => s.sessionId),
    tagOn: (day, tag) => (journal.get(day) ?? []).some((e) => e.tag === tag && e.value > 0),
  };
  return { inputs, journal, storedImpact };
}
