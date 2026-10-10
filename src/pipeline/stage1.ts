// Stage 1: per-sample work for the days whose inputs changed. Reads heart rate and steps (hr_days, steps_days) and
// caches each day's strain, activities, session resting HR and per-minute series.
import type { Store } from "../data/repos";
import type { Stage1Write } from "../data/repos/scores";
import type { SeriesRow } from "../data/repos/series";
import { addDays } from "../time";
import { hrRecovery } from "@/core/scoring/hrRecovery";
import { sessionRestingHR } from "@/core/scoring/restingHr";
import { defaultRestingHR, strain } from "@/core/scoring/strain";
import type { BaselineState, HrSample } from "@/core/scoring/types";
import { timeInZone, zones as hrZones } from "@/core/scoring/zones";
import { minuteLoad } from "@/core/algorithms/energyBank";
import { minuteMeanHr, stress } from "@/core/algorithms/stress";
import { BATCH_DAYS, breathe, type Data, type Exercise, r1, round, type Session, sha, touching } from "./data";
import { type PipelineOptions, SCORING_VERSION, type Stage1Activity, type Stage1Day } from "./types";

/** A baseline whose centre is set, so stress() scores every still minute; only the still mask is kept. */
const MASK_BASELINE: BaselineState = { baseline: 0, spread: 1, nValid: 1, nightsSinceUpdate: 0, status: "calibrating" };

function stage1Key(data: Data, day: string, opts: PipelineOptions) {
  const lo = data.dayStart(day);
  const hi = data.dayStart(addDays(day, 1));
  const main = data.mainOf.get(day);
  return sha(
    JSON.stringify([
      SCORING_VERSION,
      opts.timeZone, // the day's bounds come from it
      opts.profile.maxHr,
      data.metrics.get(day)?.rhrBpm ?? null,
      main ? [main.id, main.startTs, main.endTs] : null,
      touching(data.sessions, lo, hi).map((s) => [s.id, s.startTs, s.endTs, s.isMain]),
      touching(data.exercises, lo, hi + 330).map((e) => [e.id, e.startTs, e.endTs, e.type, e.day]),
    ]),
  );
}

export async function stage1(store: Store, data: Data, opts: PipelineOptions): Promise<string[]> {
  const [storedRows, dirtyRows] = await Promise.all([store.scores.stage1Stored(), store.scores.dirtyDays()]);
  // A row written under another scoring version is stale whatever its key says.
  const stored = new Map(storedRows.map((r) => [r.day, r.key && r.scoringVersion === SCORING_VERSION ? r.key : null]));
  const dirty = new Set(dirtyRows);
  // A night that starts before midnight reads the previous day's HR for its resting HR.
  for (const d of [...dirty]) {
    const main = data.mainOf.get(addDays(d, 1));
    if (main && main.startTs < data.dayStart(addDays(d, 1))) dirty.add(addDays(d, 1));
  }
  const keys = new Map(data.days.map((d) => [d, stage1Key(data, d, opts)]));
  const todo = data.days.filter((d) => dirty.has(d) || stored.get(d) !== keys.get(d));

  // Written in batches as it goes: holding every day's three per-minute series until one final write made
  // memory grow with history (3 years of a full recompute overflowed a 96 MB heap). Each day's key is its own,
  // so a crash between batches just recomputes the days not yet written. Each batch reads its HR and steps in one
  // query each and writes in one statement per table.
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
    const [hrAll, stepsAll] = await Promise.all([
      store.samples.readHr(lo, hi),
      store.samples.readSamples("steps", Math.min(...batch.map((b) => b.start)), Math.max(...batch.map((b) => b.end))),
    ]);
    const scores: Stage1Write[] = [];
    const series: SeriesRow[] = [];
    for (const b of batch) {
      await breathe();
      const steps = between(stepsAll, b.start, b.end).map((s) => ({ ts: s.ts, steps: s.v }));
      const r = stage1Day(data, b.day, b.start, b.end, b.main, b.exs, between(hrAll, b.lo, b.hi), steps, keys.get(b.day)!, opts);
      // Stage 1 never stamps scoring_version (a new row gets 0) and leaves intraday_dirty alone: stage 2 does
      // both when it commits, so a crash between the stages still shows up in needsRecompute.
      scores.push({ day: b.day, strain: r.s1, activities: r.activities, sessionRhrBpm: r.sessionRhr });
      series.push({ day: b.day, kind: "hr", data: r.hrSeries }, { day: b.day, kind: "still_hr", data: r.still }, { day: b.day, kind: "load", data: r.load });
    }
    await store.transaction(async (tx) => {
      await tx.scores.writeStage1(scores); // a new row gets scoring_version 0
      await tx.series.upsertSeries(series);
    });
  }
  return todo;
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
  exs: Exercise[],
  hr: HrSample[],
  stepRows: { ts: number; steps: number }[],
  key: string,
  opts: PipelineOptions,
) {
  const maxHr = opts.profile.maxHr;
  const dayHr = hr.filter((s) => s.ts >= start && s.ts < end);
  const sessionRhr = main ? sessionRestingHR(main.startTs, main.endTs, hr) : null;
  // Google's daily resting HR first; Pulse's sleep-session estimate only on days Google has none.
  const dailyRhr = data.metrics.get(day)?.rhrBpm ?? null;
  const restingHr = dailyRhr ?? sessionRhr ?? defaultRestingHR;
  // Five zones on heart-rate reserve from the day's resting HR, the same zones Strain counts.
  const zoneSet = hrZones(restingHr, maxHr);
  const tiz = (xs: HrSample[]) => timeInZone(xs, zoneSet);

  const dayTiz = tiz(dayHr);
  const means = minuteMeanHr(dayHr, start, end);
  const n = means.length;
  const steps = new Array<number>(n).fill(0);
  for (const s of stepRows) steps[Math.floor((s.ts - start) / 60)] = s.steps;
  const excluded = [...touching(data.sessions, start, end), ...touching(data.exercises, start, end)].map((x) => ({
    start: x.startTs,
    end: x.endTs,
  }));
  const probe = stress({ start, end, hr: dayHr, steps, excluded, baseline: MASK_BASELINE });
  const still = probe.minutes.map((v, m) => (v == null ? null : means[m]));
  const noon = Math.min(n, 720);
  const withHr = (from: number, to: number) => means.slice(from, to).filter((v) => v != null).length;

  const s1: Stage1Day = {
    key,
    hrCount: dayHr.length,
    hrMinutesAm: withHr(0, noon),
    hrMinutesPm: withHr(noon, n),
    lastHrTs: dayHr.at(-1)?.ts ?? null,
    restingHr,
    restingHrSource: dailyRhr != null ? "daily" : sessionRhr != null ? "session" : "default",
    maxHr,
    effort: strain(dayHr, maxHr, restingHr),
    zoneLower: zoneSet.zones.map((z) => round(z.lower, 1)),
    zoneSeconds: dayTiz.seconds,
    zoneBelowSeconds: dayTiz.belowZone1,
    dayAggregate: probe.dayAggregate,
    stillMinutes: still.filter((v) => v != null).length,
  };
  const activities: Stage1Activity[] = exs.map((e) => {
    const xs = hr.filter((s) => s.ts >= e.startTs && s.ts <= e.endTs);
    const actTiz = tiz(xs);
    return {
      id: e.id,
      effort: strain(xs, maxHr, restingHr),
      hrCount: xs.length,
      avgHr: xs.length ? round(xs.reduce((a, s) => a + s.bpm, 0) / xs.length, 1) : null,
      maxHr: xs.length ? Math.max(...xs.map((s) => s.bpm)) : null,
      zoneSeconds: actTiz.seconds,
      zoneBelowSeconds: actTiz.belowZone1,
      hrr: hrRecovery(hr, e.startTs, e.endTs, maxHr),
    };
  });
  return {
    s1,
    activities,
    sessionRhr,
    hrSeries: means.map(r1),
    still,
    load: minuteLoad(means, restingHr, maxHr),
  };
}
