// Reads Health Connect for a window of days and writes Pulse rows through the Store.
// Sleep, workouts and the nightly/daily records are read for the whole window (small: a handful per day);
// heart rate and steps are read one local day at a time and written as they come, so a 180-day first sync
// never holds more than a day of samples.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getChanges, type RecordResult } from "react-native-health-connect";
import { readAhead } from "@/lib/ahead";
import { READ_TYPES, ensureInitialized, permissionState, readAll, skippedWarning, type ReadOptions, type ReadType } from "@/health/connect";
import { deriveDayExtras, restingHrOn, type Interval } from "@/health/derive";
import {
  createBloodPressureDiagnostics,
  mapBloodPressure,
  mapDailyValuesSteps,
  SOURCE_DAILY_KEYS,
  mapExercisesSteps,
  mapExternalEntries,
  mapHrSteps,
  mapHrv,
  mapMetricsSteps,
  mapSleep,
  largestSourceSteps,
  mapSteps,
  MAX_PERIOD_DAYS,
  stepsPerDaySteps,
  ts,
  type HealthInput,
  type HeartRateRecord,
  type StepsRecord,
} from "@/health/import";
import type { Store } from "@/data/store";
import type { DailyValue, HrSample, StepsMinute } from "@/data/types";
import { addDays, daysBetween, localDay, localMidnight } from "@/lib/time";
import { slice, sliced } from "@/lib/yield";
import { resolveMaxHr } from "@/pipeline/index";
import { forgetChanges, readImportState, TOKEN_KEY, TYPES_KEY, writeImportState } from "@/health/importState";
import { originBreakdown } from "@/health/origins";

export { forgetChanges };

/**
 * The importer's mapping version: bump when the importer's mapping changes (import.ts, derive.ts, or
 * what sync.ts writes), so installed apps re-import the whole history window once under the new mapping and replace
 * what the old one wrote. 1: the first port. 2: the formula audit (steps and other measured totals from the largest
 * source, derived minutes on heart-rate reserve from the largest source's steps, staged nights' stage minutes kept) and
 * the source policy (Fitbit only by default). 3: reads start READ_LEAD_S before the window (Health Connect returns a
 * record only to the read its start falls in), so the window's first day keeps the night that began the evening before:
 * every day became the first day of some incremental sync, which rewrote its row without that night (no skin
 * temperature, nightly vitals from the fallback windows, a nap promoted to the main sleep, the night's minutes counted
 * as sedentary); heart-rate and steps records running over midnight keep their samples after it. 4: every HRV sample is
 * kept (`hrv_days`), not only the nightly mean, for the Pulse engine. 5: under the Fitbit policies, other apps' workouts
 * that overlap none of the Fitbit's and smart scale readings are kept (the old source policy), and a malformed
 * record is left out instead of failing the sync. 6: a sync replaces the window's source-derived daily totals (calories
 * eaten, water, distance and the rest), so a record deleted in Health Connect no longer leaves its day's total behind,
 * and a sync that finds deletions replaces the window it re-reads (see replaceWindow). 7: the source policy is gone; every
 * app's records are kept, the largest source per day for measured totals. 8: blood pressure readings ingested.
 */
export const IMPORT_VERSION = 8;

/**
 * How far before the window's first local midnight the reads start. Health Connect returns a record only to a read whose
 * range holds its start (AOSP RecordHelper.getReadTableWhereClause: start time, or an instant's time, in [start, end)),
 * not to every read it overlaps. A day's night begins the evening before, and so can its nightly readings, its skin
 * temperature and a heart-rate or steps record running over midnight. Rows are written only for the window's days, so
 * the lead day is never rewritten from the part of its records the lead caught.
 */
export const READ_LEAD_S = 86_400;
/** A menstruation period runs for days: read back far enough that one begun before the window covers its flow days. */
const PERIOD_LEAD_S = MAX_PERIOD_DAYS * 86_400;

type HeartRateRecords = HeartRateRecord[];
type StepsRecords = StepsRecord[];
type RecordsOf<T extends "HeartRate" | "Steps"> = T extends "HeartRate" ? HeartRateRecords : StepsRecords;

/** Records once each (by Health Connect id; a record without one is kept), in their first order. */
function uniqueRecords<T extends { metadata?: { id?: string } }>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const id = r.metadata?.id;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export const DEFAULT_HISTORY_DAYS = 180;
/** Without ReadHealthDataHistory, Health Connect serves only the 30 days before the grant. */
export const HISTORY_DAYS_WITHOUT_PERMISSION = 30;
/** Later syncs re-read this many days before the last sync so late-arriving Fitbit writes are picked up. */
export const RESYNC_DAYS = 3;

export type SyncOptions = {
  timeZone: string;
  now?: Date;
  historyDays?: number;
  /** Re-read the whole history window, whatever changed. */
  full?: boolean;
  onProgress?: (step: string, done: number, total: number) => void;
};

export type SyncResult = {
  /** First and last local day of the window, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Rows written per kind, plus records read per type. */
  counts: Record<string, number>;
  /** Hints, never errors: "history_permission_missing", "permission_missing:<Type>". */
  warnings: string[];
  /** Health Connect had nothing new since the last sync, so nothing was read: the last sync's read-time warnings stand. */
  unchanged?: true;
};

// Health Connect's changes feed: a token per sync, so the next sync learns about every record written since — including
// history the health app backfills with old dates (it does so when a data type is first shared), which a "last few
// days" window would never see. Kept outside the Store (importState.ts).
/** Pages of changes to walk before giving up and re-reading everything. */
const MAX_CHANGE_PAGES = 400;

/**
 * Whether this sync reads the whole history window, and whether it re-imports it: clears what the earlier imports wrote
 * for those days first, because the importer's version changed (or nothing was recorded yet), so
 * a day the new mapping leaves empty doesn't keep old values. Pure, for the tests.
 */
export function windowPlan(a: {
  requested: boolean;
  lastSyncTs: number | null;
  hasNights: boolean;
  hasToken: boolean;
  newlyGranted: number;
  imported: { version: number } | null;
  importVersion?: number;
}): { full: boolean; reimport: boolean } {
  const reimport = !a.imported || a.imported.version < (a.importVersion ?? IMPORT_VERSION);
  const full = reimport || a.requested || a.lastSyncTs === null || !a.hasNights || !a.hasToken || a.newlyGranted > 0;
  return { full, reimport };
}

/** Why a sync reads the whole window, for the run log (null when it does not): the one thing to look at when "it synced from scratch". */
export function fullReason(a: Parameters<typeof windowPlan>[0]): string | null {
  if (!a.imported) return "no_import_state";
  if (a.imported.version < (a.importVersion ?? IMPORT_VERSION)) return "importer_version";
  if (a.requested) return "requested";
  if (a.lastSyncTs === null) return "first_sync";
  if (!a.hasNights) return "no_nights";
  if (!a.hasToken) return "no_changes_token";
  if (a.newlyGranted > 0) return "newly_granted_types";
  return null;
}

const recordStart = (r: { time?: string; startTime?: string }): number | null => {
  const iso = r.time ?? r.startTime;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/**
 * The earliest day of a stored workout, night or log made from one of the deleted Health Connect records (their ids are
 * Health Connect's own; a log's carries a `hc-<kind>-` prefix), or null when Pulse holds none of them.
 */
export async function dayOfStoredRecords(store: Store, deletedIds: readonly string[]): Promise<string | null> {
  if (!deletedIds.length) return null;
  const gone = new Set(deletedIds);
  let earliest: string | null = null;
  const take = (day: string) => {
    if (earliest === null || day < earliest) earliest = day;
  };
  for (const s of await store.allSessions()) if (gone.has(s.id)) take(s.day);
  for (const e of await store.allExercises()) if (gone.has(e.id)) take(e.day);
  for (const l of await store.loggedEntries(0, Number.MAX_SAFE_INTEGER)) if (l.source === "health_connect" && gone.has(l.id.replace(/^hc-[a-z]+-/, ""))) take(l.day);
  return earliest;
}

/**
 * What Health Connect changed since `token`: the earliest instant among records written (null when none), whether any
 * record was deleted, and the token after them; or "expired".
 */
async function changesSince(token: string): Promise<{ earliest: number | null; deleted: boolean; deletedIds: string[]; token: string } | "expired"> {
  let tok = token;
  let earliest: number | null = null;
  let deleted = false;
  const deletedIds: string[] = [];
  for (let page = 0; page < MAX_CHANGE_PAGES; page++) {
    const res = await getChanges({ changesToken: tok });
    if (res.changesTokenExpired) return "expired";
    for (const c of res.upsertionChanges) {
      const t = recordStart(c.record as { time?: string; startTime?: string });
      if (t !== null && (earliest === null || t < earliest)) earliest = t;
    }
    if (res.deletionChanges.length) deleted = true;
    for (const c of res.deletionChanges) deletedIds.push(c.recordId);
    tok = res.nextChangesToken;
    if (!res.hasMore) return { earliest, deleted, deletedIds, token: tok };
  }
  return "expired";
}

/** Types read once for the whole window; HeartRate and Steps are read per day. */
const WINDOW_TYPES = READ_TYPES.filter((t) => t !== "HeartRate" && t !== "Steps");

/**
 * Health Connect reads in flight at once, ahead of the mapping, which still takes their results one by one in order
 * (readAhead). 4 is a first guess: tune it by timing a first import and a pull to sync on the phone.
 */
export const READ_CONCURRENCY = 4;

export async function syncHealthConnect(store: Store, opts: SyncOptions): Promise<SyncResult> {
  const tz = opts.timeZone;
  const now = opts.now ?? new Date();
  const nowTs = Math.floor(now.getTime() / 1000);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const progress = opts.onProgress ?? (() => {});

  try {
    const perms = await permissionState();
    const granted = new Set<ReadType>(perms.granted);
    for (const t of perms.missing) warnings.push(`permission_missing:${t}`);

    // Window. A full window (the last `historyDays` days, 30 without the history permission) on the first sync, until a
    // night has arrived, when Pulse was granted a type it couldn't read before, when the changes token is missing or
    // expired, or on request. Otherwise from 3 days before the last sync, widened back to the oldest record Health
    // Connect received since then (a health app backfilling history writes old dates).
    const state = await store.getSyncState();
    const today = localDay(nowTs, tz);
    let days = opts.historyDays ?? DEFAULT_HISTORY_DAYS;
    if (!perms.history && days > HISTORY_DAYS_WITHOUT_PERMISSION) {
      days = HISTORY_DAYS_WITHOUT_PERMISSION;
      warnings.push("history_permission_missing");
    }
    const historyFrom = addDays(today, -(days - 1));
    const hasNights = (await store.allSessions()).length > 0;
    const [token, typesJson] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
      AsyncStorage.getItem(TYPES_KEY).catch(() => null),
    ]);
    const grantedTypes = [...granted].sort();
    const knownTypes = new Set<string>(typesJson ? (JSON.parse(typesJson) as string[]) : []);
    const newlyGranted = grantedTypes.filter((t) => !knownTypes.has(t));

    // Types with a record Health Connect could not read (malformed by the app that wrote it), left out and reported.
    const skipped = new Set<ReadType>();
    const readOptions = (type: ReadType): ReadOptions => ({ onSkipped: () => skipped.add(type) });
    const plan = windowPlan({
      requested: !!opts.full,
      lastSyncTs: state.lastSyncTs,
      hasNights,
      hasToken: !!token,
      newlyGranted: newlyGranted.length,
      imported: await readImportState(),
    });
    const why = fullReason({ requested: !!opts.full, lastSyncTs: state.lastSyncTs, hasNights, hasToken: !!token, newlyGranted: newlyGranted.length, imported: await readImportState() });
    if (why) counts[`why:${why}`] = 1;
    if (plan.reimport) {
      await forgetChanges();
      counts.reimport = 1;
    }

    let fromDay: string;
    // A sync that finds records deleted in Health Connect replaces the window it re-reads (below), not only upserts into it.
    let replaceWindow = false;
    // (plan.full already covers a missing token or first sync; repeated so the else branch can rely on both.)
    if (plan.full || !token || state.lastSyncTs === null) {
      fromDay = historyFrom;
      counts.full = 1;
    } else {
      // A read of the change feed that throws is tried once more before the window is read in full: a service that was
      // busy for a moment must not turn into a re-read of the whole history.
      const changed = await changesSince(token)
        .catch(() => changesSince(token))
        .catch(() => "expired" as const);
      // Nothing written to Health Connect or deleted from it since the last sync, on the same day: the re-read would
      // bring back exactly what is stored, so it is skipped (most background runs).
      if (changed !== "expired" && changed.earliest === null && !changed.deleted && localDay(state.lastSyncTs, tz) === today) {
        await store.setSyncState({ lastSyncTs: nowTs, lastError: null });
        await AsyncStorage.setItem(TOKEN_KEY, changed.token).catch(() => {});
        progress("done", 1, 1);
        return { from: today, to: today, counts: { unchanged: 1 }, warnings, unchanged: true };
      }
      fromDay = localDay(state.lastSyncTs - RESYNC_DAYS * 86_400, tz);
      if (changed === "expired") {
        fromDay = historyFrom;
        counts.full = 1;
        counts["why:change_feed_expired_or_failed"] = 1;
      } else if (changed.earliest !== null) {
        const backfill = localDay(changed.earliest, tz);
        if (backfill < fromDay) fromDay = backfill;
        counts.backfillFrom = 1;
      }
      // A deletion names no day, only a record id. The window the sync re-reads is replaced (what Health Connect no
      // longer has goes), reaching back to the day of any workout, night or log Pulse holds under a deleted id.
      if (changed !== "expired" && changed.deleted) {
        replaceWindow = true;
        counts.deleted = changed.deletedIds.length;
        const day = await dayOfStoredRecords(store, changed.deletedIds);
        if (day !== null && day < fromDay) fromDay = day;
      }
      if (fromDay < historyFrom) fromDay = historyFrom;
    }

    // The next sync's token, taken before reading so records written during the read are reported again next time.
    await ensureInitialized();
    const nextToken = grantedTypes.length
      ? (await getChanges({ recordTypes: grantedTypes as ReadType[] }).catch(() => null))?.nextChangesToken ?? null
      : null;
    const dayCount = daysBetween(fromDay, today) + 1;
    const windowStart = localMidnight(fromDay, tz);
    /** The window's whole-window read for `type`, from its lead before the first midnight (READ_LEAD_S). */
    const range = (type: ReadType) => ({ start: new Date((windowStart - (type === "MenstruationPeriod" ? PERIOD_LEAD_S : READ_LEAD_S)) * 1000), end: now });
    /** Only the window's days are written: a lead day's rows would be rebuilt from part of its records. */
    const inWindow = <T extends { day: string }>(xs: T[]) => xs.filter((x) => x.day >= fromDay);

    const total = WINDOW_TYPES.length + dayCount + 1;
    let done = 0;

    // The mapping below is sliced (src/lib/yield.ts): its record loops pause, and the steps between them await slice(),
    // so taps and scrolling get the JS thread every few milliseconds while a sync runs. It changes no result.

    // 1. Whole-window reads.
    const input: HealthInput = {};
    const windowTypes = WINDOW_TYPES.filter((t) => granted.has(t));
    const takeWindow = readAhead(windowTypes.length, READ_CONCURRENCY, (k) => readAll(windowTypes[k], range(windowTypes[k]), readOptions(windowTypes[k])));
    let windowRead = 0;
    for (const type of WINDOW_TYPES) {
      progress(`read:${type}`, done, total);
      if (granted.has(type)) {
        const records = (await takeWindow(windowRead++)) as unknown[];
        (input as Record<string, unknown[]>)[type] = records;
        counts[`read:${type}`] = records.length;
      }
      done++;
    }

    // Health Connect carries no activity minutes, Active Zone Minutes or daily average heart rate, so each day's are
    // derived from its heart rate and steps as they are read (derive.ts). Sleep and workouts bound the sedentary minutes;
    // max HR is the profile's, as the pipeline resolves it.
    const profile = await store.getProfile();
    const maxHr = profile ? resolveMaxHr(profile, today) : null;
    const spans = (xs: { startTime: string; endTime: string }[] | undefined): Interval[] => (xs ?? []).map((r) => ({ startTs: ts(r.startTime), endTs: ts(r.endTime) }));
    const sleepSpans = spans(input.SleepSession);
    const exerciseSpans = spans(input.ExerciseSession);
    const touching = (xs: Interval[], lo: number, hi: number) => xs.filter((x) => x.endTs > lo && x.startTs < hi);
    // Fitbit's zones sit on heart-rate reserve, so each day needs its resting HR: this window's readings, and the stored
    // ones from before it (restingHrOn carries the newest forward up to 30 days, else 60 bpm).
    const restingReadings: [string, number][] = [
      ...(await store.allMetrics()).flatMap((m): [string, number][] => (m.rhrBpm != null ? [[m.day, m.rhrBpm]] : [])),
      ...(input.RestingHeartRate ?? [])
        .map((r) => ({ t: ts(r.time), bpm: r.beatsPerMinute }))
        .sort((a, b) => a.t - b.t)
        .map((r): [string, number] => [localDay(r.t, tz), r.bpm]),
    ];
    const derived: DailyValue[] = [];

    // A re-import replaces: what earlier imports wrote for these days goes before the new rows are written, so a day the
    // new mapping leaves without steps, a workout or a derived minute doesn't keep the old one. The first day
    // goes too: the reads' lead (READ_LEAD_S) brings back its night, which began before the window.
    if (plan.reimport) await store.clearImported({ from: fromDay, to: today }, windowStart, nowTs + 1);
    // A deletion only replaces the window's imported rows: the scores stay, and stage 2 redoes the days whose inputs changed.
    else if (replaceWindow) await store.clearImported({ from: fromDay, to: today }, windowStart, nowTs + 1, { keepScores: true });

    // 2. Per-day heart rate and steps, written as they come. A record comes back with the day its start falls in, so one
    // running over midnight carries its later samples into the next day (`spill`); the first day reads the lead for
    // records begun before the window.
    const stepsByDay = new Map<string, number>();
    const dirty: string[] = [];
    let hrCount = 0;
    let stepCount = 0;
    const spill: { HeartRate: HeartRateRecords; Steps: StepsRecords } = { HeartRate: [], Steps: [] };
    // The reads, in the order the loop below takes them (a day's heart rate, then its steps), run READ_CONCURRENCY ahead.
    const dayReads: { type: "HeartRate" | "Steps"; range: { start: Date; end: Date }; lead: { start: Date; end: Date } | null }[] = [];
    for (let i = 0; i < dayCount; i++) {
      const dayStart = localMidnight(addDays(fromDay, i), tz);
      const dayEnd = Math.min(localMidnight(addDays(fromDay, i + 1), tz), nowTs);
      if (dayEnd <= dayStart) continue;
      const range = { start: new Date(dayStart * 1000), end: new Date(dayEnd * 1000) };
      const lead = i === 0 ? { start: new Date((dayStart - READ_LEAD_S) * 1000), end: range.start } : null;
      for (const type of ["HeartRate", "Steps"] as const) if (granted.has(type)) dayReads.push({ type, range, lead });
    }
    const takeDay = readAhead(dayReads.length, READ_CONCURRENCY, (k) => {
      const { type, range, lead } = dayReads[k];
      return Promise.all([readAll(type, range, readOptions(type)), lead ? readAll(type, lead, readOptions(type)) : null]);
    });
    let dayRead = 0;
    /** The day's records of `type`: those begun on it, and those begun before it that run past its midnight. */
    const dayRecords = async <T extends "HeartRate" | "Steps">(type: T, dayStart: number) => {
      const [raw, leadRaw] = await takeDay(dayRead++);
      const read = raw as RecordResult<T>[];
      const before = leadRaw ? (leadRaw as RecordResult<T>[]) : spill[type];
      return uniqueRecords([...before.filter((r) => ts(r.endTime) > dayStart), ...read]) as RecordsOf<T>;
    };
    for (let i = 0; i < dayCount; i++) {
      const day = addDays(fromDay, i);
      progress(`read:day:${day}`, done, total);
      const dayStart = localMidnight(day, tz);
      const nextMidnight = localMidnight(addDays(day, 1), tz);
      const dayEnd = Math.min(nextMidnight, nowTs);
      if (dayEnd <= dayStart) {
        done++;
        continue;
      }
      const clip = { startTs: dayStart, endTs: dayEnd };
      let touched = false;
      // Samples that were new or changed: only then does stage 1 redo the day (a sync re-reads the last days each time).
      let changed = false;
      let hr: HrSample[] = [];
      let minutes: StepsMinute[] = [];
      /** The day's largest source's steps per minute, for the derived activity minutes. */
      let deriveSteps: StepsMinute[] = [];
      if (granted.has("HeartRate")) {
        const hrRecords = await dayRecords("HeartRate", dayStart);
        spill.HeartRate = hrRecords.filter((r) => ts(r.endTime) > nextMidnight);
        hr = await sliced(mapHrSteps(hrRecords, clip));
        if (hr.length) {
          changed = (await store.putHr(hr)) || changed;
          hrCount += hr.length;
          touched = true;
        }
      }
      if (granted.has("Steps")) {
        const records = await dayRecords("Steps", dayStart);
        spill.Steps = records.filter((r) => ts(r.endTime) > nextMidnight);
        minutes = mapSteps(records, clip);
        if (minutes.length) {
          changed = (await store.putSteps(minutes)) || changed;
          stepCount += minutes.length;
          touched = true;
          for (const [d, v] of await sliced(stepsPerDaySteps(records, tz, clip))) stepsByDay.set(d, (stepsByDay.get(d) ?? 0) + v);
          deriveSteps = largestSourceSteps(records, clip);
        }
      }
      if (maxHr !== null && touched) {
        await slice();
        const extras = deriveDayExtras({
          start: dayStart,
          end: nextMidnight,
          hr,
          steps: deriveSteps,
          maxHr,
          restingHr: restingHrOn(day, restingReadings),
          sleep: touching(sleepSpans, dayStart, nextMidnight),
          exercises: touching(exerciseSpans, dayStart, nextMidnight),
        });
        for (const v of extras) derived.push({ day, ...v });
      }
      if (changed) dirty.push(day);
      done++;
      await slice();
    }
    counts.hr = hrCount;
    counts.steps = stepCount;

    // 3. Map and write the rest: the window's days only (the lead day's rows would be built from part of its records).
    progress("write", done, total);
    const sleep = mapSleep(input.SleepSession ?? [], tz);
    const sessions = inWindow(sleep.sessions);
    const sessionIds = new Set(sessions.map((s) => s.id));
    const segments = sleep.segments.filter((g) => sessionIds.has(g.sessionId));
    await slice();
    const exercises = inWindow(await sliced(mapExercisesSteps(input.ExerciseSession ?? [], input.ActiveCaloriesBurned, input.Distance, tz)));
    const dailyValues = [...inWindow(await sliced(mapDailyValuesSteps(input, tz))), ...derived];
    const metrics = inWindow(await sliced(mapMetricsSteps(input, sessions, stepsByDay, tz)));
    await slice();
    // Water, food and cycle logs made in Fitbit: the window's rows are replaced, so what Fitbit deleted goes too.
    const external = inWindow(mapExternalEntries(input, tz));
    const bpDiag = createBloodPressureDiagnostics();
    const bpReadings = inWindow(mapBloodPressure(input.BloodPressure ?? [], tz, nowTs, bpDiag));

    // Every HRV sample (the Pulse engine labels them by sleep stage); their days rerun stage 1.
    const hrv = mapHrv(input.HeartRateVariabilityRmssd ?? []);
    if (hrv.length) {
      // Per local day, so only the days with new or changed samples go back to stage 1.
      const byDay = new Map<string, typeof hrv>();
      for (const s of hrv) {
        const d = localDay(s.ts, tz);
        const list = byDay.get(d);
        if (list) list.push(s);
        else byDay.set(d, [s]);
      }
      for (const [d, xs] of byDay) if (await store.putHrv(xs)) dirty.push(d);
    }
    counts.hrv = hrv.length;
    if (sessions.length) await store.upsertSessions(sessions, segments);
    if (exercises.length) await store.upsertExercises(exercises);
    // The keys of every type this sync read are replaced over the window (so a food entry deleted in Health Connect takes the
    // day's calories with it); a type that was not granted, or had a record it could not read, keeps what is stored.
    const replaced = Object.entries(SOURCE_DAILY_KEYS).filter(([, type]) => granted.has(type) && !skipped.has(type)).map(([key]) => key);
    await store.replaceDailyValues({ from: fromDay, to: today }, replaced, dailyValues);
    if (metrics.length) await store.upsertMetrics(metrics);
    if (bpReadings.length) await store.upsertBloodPressure(bpReadings);
    await store.replaceExternalEntries({ from: fromDay, to: today }, external);
    if (dirty.length) await store.markIntradayDirty(dirty);
    counts.sessions = sessions.length;
    counts.segments = segments.length;
    counts.exercises = exercises.length;
    counts.dailyValues = dailyValues.length;
    counts.derived = derived.length;
    counts.externalEntries = external.length;
    counts.metrics = metrics.length;
    counts.bloodPressure = bpReadings.length;
    counts["bloodPressure:rejected"] = bpDiag.rejected;
    done++;

    for (const type of skipped) warnings.push(skippedWarning(type));

    const firstDay = state.firstDay && state.firstDay < fromDay ? state.firstDay : fromDay;
    await store.setSyncState({ lastSyncTs: nowTs, firstDay, lastError: null });
    if (nextToken) await AsyncStorage.multiSet([[TOKEN_KEY, nextToken], [TYPES_KEY, JSON.stringify(grantedTypes)]]).catch(() => {});
    // No token this time (the feed would not give one): the old one stays, it only reports more. Forgetting it would turn
    // the next sync into a read of the whole window.
    else if (!token) await forgetChanges();
    // Recorded last: a sync that fails part-way re-imports again next time.
    await writeImportState({ version: IMPORT_VERSION });
    progress("done", done, total);
    return { from: fromDay, to: today, counts, warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await store.setSyncState({ lastError: message }).catch(() => {});
    throw e;
  }
}

/** `origins`: "app/device: count" per origin and device type (origins.ts originBreakdown). */
export type HealthConnectDescription = { type: ReadType; count: number; origins: string[]; latest: string | null; error?: string };

/** What Health Connect holds for the last `days` days, per type: a diagnostics list for the Settings screen. */
export async function describeHealthConnect(days = 7, now = new Date()): Promise<HealthConnectDescription[]> {
  const range = { start: new Date(now.getTime() - days * 86_400_000), end: now };
  const out: HealthConnectDescription[] = [];
  for (const type of READ_TYPES) {
    try {
      const records = await readAll(type, range);
      let latest: number | null = null;
      for (const r of records) {
        const t = recordStart(r as { time?: string; startTime?: string });
        if (t !== null && (latest === null || t > latest)) latest = t;
      }
      // Every app and device that wrote this type, with counts ("com.fitbit.FitbitMobile/watch: 412"), whatever Pulse imports.
      out.push({ type, count: records.length, origins: originBreakdown(records), latest: latest === null ? null : new Date(latest * 1000).toISOString() });
    } catch (e) {
      out.push({ type, count: 0, origins: [], latest: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
