// Reads Health Connect for a window of days and writes Pulse rows through the Store.
// Sleep, workouts and the nightly/daily records are read for the whole window (small: a handful per day);
// heart rate and steps are read one local day at a time and written as they come, so a 180-day first sync
// never holds more than a day of samples.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getChanges, type RecordResult } from "react-native-health-connect";
import { readAhead } from "@/lib/ahead";
import { READ_TYPES, ensureInitialized, permissionState, readAll, type ReadType } from "@/health/connect";
import { deriveDayExtras, restingHrOn, type Interval } from "@/health/derive";
import {
  createBloodPressureDiagnostics,
  mapBloodPressure,
  mapDailyValuesSteps,
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
import { applySourcePolicySteps, getSourcePolicy, originBreakdown, originFilter, type SourcePolicy } from "@/health/sourcePolicy";

export { forgetChanges };

/**
 * The importer's mapping version: bump when the importer's mapping changes (import.ts, derive.ts, the source policy, or
 * what sync.ts writes), so installed apps re-import the whole history window once under the new mapping and replace
 * what the old one wrote. 1: the first port. 2: the formula audit (steps and other measured totals from the largest
 * source, derived minutes on heart-rate reserve from the largest source's steps, staged nights' stage minutes kept) and
 * the source policy (Fitbit only by default). 3: reads start READ_LEAD_S before the window (Health Connect returns a
 * record only to the read its start falls in), so the window's first day keeps the night that began the evening before:
 * every day became the first day of some incremental sync, which rewrote its row without that night (no skin
 * temperature, nightly vitals from the fallback windows, a nap promoted to the main sleep, the night's minutes counted
 * as sedentary); heart-rate and steps records running over midnight keep their samples after it. 4: every HRV sample is
 * kept (`hrv_days`), not only the nightly mean, for the Pulse engine. 5: Blood pressure readings ingested.
 */
export const IMPORT_VERSION = 5;

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
  /** Hints, never errors: "history_permission_missing", "permission_missing:<Type>", "no_fitbit_records". */
  warnings: string[];
};

// Health Connect's changes feed: a token per sync, so the next sync learns about every record written since — including
// history the health app backfills with old dates (it does so when a data type is first shared), which a "last few
// days" window would never see. Kept outside the Store (importState.ts).
/** Pages of changes to walk before giving up and re-reading everything. */
const MAX_CHANGE_PAGES = 400;

/**
 * Whether this sync reads the whole history window, and whether it re-imports it: clears what the earlier imports wrote
 * for those days first, because the importer's version or the source policy changed (or nothing was recorded yet), so
 * a day the new mapping leaves empty doesn't keep old values. Pure, for the tests.
 */
export function windowPlan(a: {
  requested: boolean;
  lastSyncTs: number | null;
  hasNights: boolean;
  hasToken: boolean;
  newlyGranted: number;
  imported: { version: number; policy: string } | null;
  policy: SourcePolicy;
  importVersion?: number;
}): { full: boolean; reimport: boolean } {
  const reimport = !a.imported || a.imported.version < (a.importVersion ?? IMPORT_VERSION) || a.imported.policy !== a.policy;
  const full = reimport || a.requested || a.lastSyncTs === null || !a.hasNights || !a.hasToken || a.newlyGranted > 0;
  return { full, reimport };
}

const recordStart = (r: { time?: string; startTime?: string }): number | null => {
  const iso = r.time ?? r.startTime;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** The earliest instant among records written since `token` (null when nothing changed), or "expired". */
async function earliestChangeSince(token: string): Promise<{ earliest: number | null } | "expired"> {
  let tok = token;
  let earliest: number | null = null;
  for (let page = 0; page < MAX_CHANGE_PAGES; page++) {
    const res = await getChanges({ changesToken: tok });
    if (res.changesTokenExpired) return "expired";
    for (const c of res.upsertionChanges) {
      const t = recordStart(c.record as { time?: string; startTime?: string });
      if (t !== null && (earliest === null || t < earliest)) earliest = t;
    }
    tok = res.nextChangesToken;
    if (!res.hasMore) return { earliest };
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

    // Which records count (sourcePolicy.ts), and whether the stored rows were imported under this mapping and policy.
    const policy = await getSourcePolicy();
    const origins = originFilter(policy);
    const plan = windowPlan({
      requested: !!opts.full,
      lastSyncTs: state.lastSyncTs,
      hasNights,
      hasToken: !!token,
      newlyGranted: newlyGranted.length,
      imported: await readImportState(),
      policy,
    });
    if (plan.reimport) {
      await forgetChanges();
      counts.reimport = 1;
    }

    let fromDay: string;
    // (plan.full already covers a missing token or first sync; repeated so the else branch can rely on both.)
    if (plan.full || !token || state.lastSyncTs === null) {
      fromDay = historyFrom;
      counts.full = 1;
    } else {
      const changed = await earliestChangeSince(token).catch(() => "expired" as const);
      fromDay = localDay(state.lastSyncTs - RESYNC_DAYS * 86_400, tz);
      if (changed === "expired") {
        fromDay = historyFrom;
        counts.full = 1;
      } else if (changed.earliest !== null) {
        const backfill = localDay(changed.earliest, tz);
        if (backfill < fromDay) fromDay = backfill;
        counts.backfillFrom = 1;
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
    let recordsKept = 0;
    const windowTypes = WINDOW_TYPES.filter((t) => granted.has(t));
    const takeWindow = readAhead(windowTypes.length, READ_CONCURRENCY, (k) =>
      readAll(windowTypes[k], range(windowTypes[k]), undefined, windowTypes[k] === "BloodPressure" ? undefined : origins),
    );
    let windowRead = 0;
    for (const type of WINDOW_TYPES) {
      progress(`read:${type}`, done, total);
      if (granted.has(type)) {
        const records = await sliced(applySourcePolicySteps(type, (await takeWindow(windowRead++)) as never, policy, tz));
        (input as Record<string, unknown[]>)[type] = records;
        counts[`read:${type}`] = records.length;
        recordsKept += records.length;
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
    // new mapping or policy leaves without steps, a workout or a derived minute doesn't keep the old one. The first day
    // goes too: the reads' lead (READ_LEAD_S) brings back its night, which began before the window.
    if (plan.reimport) await store.clearImported({ from: fromDay, to: today }, windowStart, nowTs + 1);

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
      return Promise.all([readAll(type, range, undefined, origins), lead ? readAll(type, lead, undefined, origins) : null]);
    });
    let dayRead = 0;
    /** The day's records of `type`: those begun on it, and those begun before it that run past its midnight. */
    const dayRecords = async <T extends "HeartRate" | "Steps">(type: T, dayStart: number) => {
      const [raw, leadRaw] = await takeDay(dayRead++);
      const read = await sliced(applySourcePolicySteps(type, raw as RecordResult<T>[], policy, tz));
      recordsKept += read.length;
      const before = leadRaw ? await sliced(applySourcePolicySteps(type, leadRaw as RecordResult<T>[], policy, tz)) : spill[type];
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
      let hr: HrSample[] = [];
      let minutes: StepsMinute[] = [];
      /** The day's largest source's steps per minute, for the derived activity minutes. */
      let deriveSteps: StepsMinute[] = [];
      if (granted.has("HeartRate")) {
        const hrRecords = await dayRecords("HeartRate", dayStart);
        spill.HeartRate = hrRecords.filter((r) => ts(r.endTime) > nextMidnight);
        hr = await sliced(mapHrSteps(hrRecords, clip));
        if (hr.length) {
          await store.putHr(hr);
          hrCount += hr.length;
          touched = true;
        }
      }
      if (granted.has("Steps")) {
        const records = await dayRecords("Steps", dayStart);
        spill.Steps = records.filter((r) => ts(r.endTime) > nextMidnight);
        minutes = mapSteps(records, clip);
        if (minutes.length) {
          await store.putSteps(minutes);
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
      if (touched) dirty.push(day);
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
      await store.putHrv(hrv);
      for (const s of hrv) dirty.push(localDay(s.ts, tz));
    }
    counts.hrv = hrv.length;
    if (sessions.length) await store.upsertSessions(sessions, segments);
    if (exercises.length) await store.upsertExercises(exercises);
    if (dailyValues.length) await store.upsertDailyValues(dailyValues);
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

    // Under "Fitbit only", nothing at all from the Fitbit app means the policy is hiding everything (another band's app,
    // or Google Health not sharing yet): say so rather than show an empty Pulse.
    if (policy === "fitbit_only" && recordsKept === 0 && plan.full) warnings.push("no_fitbit_records");

    const firstDay = state.firstDay && state.firstDay < fromDay ? state.firstDay : fromDay;
    await store.setSyncState({ lastSyncTs: nowTs, firstDay, lastError: null });
    if (nextToken) await AsyncStorage.multiSet([[TOKEN_KEY, nextToken], [TYPES_KEY, JSON.stringify(grantedTypes)]]).catch(() => {});
    else await forgetChanges();
    // Recorded last: a sync that fails part-way re-imports again next time.
    await writeImportState({ version: IMPORT_VERSION, policy });
    progress("done", done, total);
    return { from: fromDay, to: today, counts, warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await store.setSyncState({ lastError: message }).catch(() => {});
    throw e;
  }
}

/** `origins`: "app/device: count" per origin and device type (sourcePolicy.ts originBreakdown). */
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
      // Every app and device that wrote this type, with counts ("com.fitbit.FitbitMobile/watch: 412"), whatever the
      // source policy keeps, so the list shows what the policy leaves out too.
      out.push({ type, count: records.length, origins: originBreakdown(records), latest: latest === null ? null : new Date(latest * 1000).toISOString() });
    } catch (e) {
      out.push({ type, count: 0, origins: [], latest: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
