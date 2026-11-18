import { SqliteWorkoutStore } from "./workoutDb";
// The Store on expo-sqlite. The schema mirrors Pulse's Postgres one (src/server/db/schema.ts) minus user ids:
// one person per database. JSON columns hold the score and series blobs; heart rate and steps are bucketed per
// UTC day like Pulse's hr_days / steps_days (parallel JSON arrays of second-of-day offsets and values), since a
// row per 1 Hz sample is far too slow over months. Every batch write runs in one exclusive transaction.
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { isDeadConnection } from "./deadConnection";
import type { CoachChatRow, DayRange, EntrySource, JournalTagChange, JournalTagRow, LoggedEntryRow, ReportRow, ScoreRow, SeriesKind, Store } from "./store";
import type { GymExercise, GymImportState, GymMeasurement, GymRoutine, GymRoutineItem, GymSession, GymSet, SetType } from "./gym";
import type { Habit, HabitEntry } from "./habits";
import type { FoodOrder } from "./foodOrders";
import { DEFAULT_MODE, MOVE_BUCKET_S, TRACKING_MODES, type Fix, type FrozenStay, type MoveBucket, type Place, type PlaceEvent, type PlaceIcon, type TimelineOverride, type TimelineState, type TrackingMode } from "@/core/places/types";
import type { BloodPressureQuality, BloodPressureReading, DailyValue, Exercise, HealthRecord, HrSample, HrvSample, JournalEntry, Metrics, Profile, Segment, Session, StepsMinute, SyncState } from "./types";
import type { LeetCodeSnapshot } from "@/leetcode/types";
import type { ActivityCostResult } from "@/core/algorithms/activityCost";
import { minuteHr } from "@/core/engine/context";
import { slice } from "@/lib/yield";

const SCHEMA = `
create table if not exists profile (
  id integer primary key check (id = 1), birth_date text not null, sex text not null, max_hr real, height_cm real, time_zone text not null,
  waist_cm real, office text
);
create table if not exists sync_state (id integer primary key check (id = 1), last_sync_ts integer, first_day text, last_error text);
create table if not exists daily_metrics (
  day text primary key, hrv_ms real, hrv_deep_ms real, rhr_bpm real, resp_bpm real, nightly_temp_c real, spo2_pct real,
  vo2max_daily real, vo2max_run real, steps integer, calories real, weight_kg real, body_fat_pct real, hr_zones text,
  light_moderate_min real, vigorous_peak_min real, temp_baseline_c real, temp_sd_c real,
  rhr_range_low real, rhr_range_high real, hrv_range_low real, hrv_range_high real
);
create table if not exists sleep_sessions (
  id text primary key, day text not null, start_ts integer not null, end_ts integer not null, is_main integer not null,
  processed integer not null, stages_status text, asleep_min real, awake_min real, deep_min real, light_min real, rem_min real
);
create index if not exists sleep_sessions_day on sleep_sessions (day);
create table if not exists sleep_segments (
  session_id text not null, start_ts integer not null, end_ts integer not null, stage text not null, primary key (session_id, start_ts)
);
create table if not exists exercises (
  id text primary key, day text not null, start_ts integer not null, end_ts integer not null, type text not null, name text,
  calories real, distance_m real
);
create index if not exists exercises_day on exercises (day);
create table if not exists hr_days (bucket integer primary key, offsets text not null, vals text not null, minute integer not null default 0);
create table if not exists steps_days (bucket integer primary key, offsets text not null, vals text not null);
create table if not exists hrv_days (bucket integer primary key, offsets text not null, vals text not null);
create table if not exists daily_values (day text not null, key text not null, value real not null, primary key (day, key));
create table if not exists journal_entries (day text not null, tag text not null, value real not null, primary key (day, tag));
create table if not exists intraday_dirty (day text primary key);
create table if not exists daily_scores (
  day text primary key, scoring_version integer not null, strain text, activities text, session_rhr_bpm real,
  recovery text, sleep text, training_load text, strain_target text, sleep_planner text, energy_bank text, stress text,
  health_monitor text, healthspan text, fitness text, journal_impact text, detected text, hrv_status text, training text
);
create table if not exists intraday_series (day text not null, kind text not null, data text not null, primary key (day, kind));
create table if not exists reports (period text primary key, data text not null);
create table if not exists activity_cost (id integer primary key check (id = 1), data text not null);
create table if not exists pipeline_checkpoint (id integer primary key check (id = 1), data text not null);
create table if not exists journal_tags (
  tag text primary key, label text not null, is_default integer not null default 0, hidden integer not null default 0,
  position integer not null default 0, seq integer not null
);
create table if not exists logged_entries (
  id text primary key, type text not null, ts integer not null, day text not null, data text not null, created_at integer not null,
  source text not null default 'pulse'
);
create index if not exists logged_entries_ts on logged_entries (ts);
create table if not exists health_records (id text primary key, kind text not null, ts integer not null, day text not null, data text not null);
create index if not exists health_records_day on health_records (day);
create table if not exists blood_pressure_readings (
  id text primary key, ts integer not null, day text not null, systolic_mmhg real not null, diastolic_mmhg real not null,
  body_position text, measurement_location text, recording_method text, source_platform text, source_application text,
  source_device text, quality text not null, imported_at integer not null
);
create index if not exists blood_pressure_day on blood_pressure_readings (day);
create index if not exists blood_pressure_ts on blood_pressure_readings (ts);
create table if not exists coach_chats (id text primary key, title text not null, messages text not null, created_at integer not null, updated_at integer not null);
create index if not exists coach_chats_recent on coach_chats (updated_at desc, id desc);
create table if not exists leetcode_profiles (username text primary key, data text not null);
-- The gym log (src/core/gym). Weights are kilograms; a routine's items and a session's sets are ordered by position.
create table if not exists gym_exercises (
  id text primary key, name text not null, body_part text not null, equipment text not null, custom integer not null default 0,
  hold integer not null default 0, unit text not null default 'kg', note text
);
create table if not exists gym_routines (
  id text primary key, name text not null, notes text, position integer not null default 0, updated_at integer not null
);
create table if not exists gym_routine_items (
  routine_id text not null, exercise_id text not null, position integer not null, sets integer not null default 0,
  reps integer not null default 0, rest_sec integer, note text, primary key (routine_id, position)
);
create table if not exists gym_sessions (
  id text primary key, day text not null, start_ts integer not null, end_ts integer, name text not null, notes text,
  routine_id text, finished integer not null default 0, rest_started_ts integer, rest_sec integer
);
create index if not exists gym_sessions_start on gym_sessions (start_ts desc);
create index if not exists gym_sessions_day on gym_sessions (day);
create table if not exists gym_sets (
  id text primary key, session_id text not null, exercise_id text not null, position integer not null, set_no integer not null,
  weight_kg real not null default 0, reps integer not null default 0, seconds real, distance_m real, rpe real,
  type text not null default 'normal', superset_id text, completed integer not null default 0, ts integer, note text
);
create index if not exists gym_sets_session on gym_sets (session_id, position, set_no);
create index if not exists gym_sets_exercise on gym_sets (exercise_id, ts);
create table if not exists gym_measurements (id text primary key, day text not null, kind text not null, value real not null, unique (day, kind));
create table if not exists gym_import (id integer primary key check (id = 1), data text not null);
create table if not exists habits (
  id text primary key, name text not null, question text, notes text, kind text not null, color text not null,
  period text not null, interval_days integer not null default 1, weekdays_only integer not null default 0,
  start_day text not null default '', target real not null, target_type text not null, unit text,
  position integer not null, archived integer not null default 0, created_at integer not null, updated_at integer not null
);
create table if not exists habit_entries (
  habit_id text not null, day text not null, value real not null, skip integer not null default 0, note text,
  updated_at integer not null, primary key (habit_id, day)
);
create index if not exists habit_entries_day on habit_entries(day);
create table if not exists food_orders (
  id text primary key, key text not null unique, day text not null, ts integer not null, merchant text not null, source text not null
);
create index if not exists food_orders_day on food_orders(day);
-- The location timeline (src/core/places, docs/timeline.md). Fixes are pruned after RAW_FIX_DAYS; frozen stays and
-- movement slots keep a day's timeline after that.
create table if not exists places (
  id text primary key, name text not null, icon text not null, latitude real not null, longitude real not null,
  radius_m real not null, created_at integer not null
);
create table if not exists place_events (id text primary key, place_id text not null, kind text not null, ts integer not null, day text not null);
create index if not exists place_events_ts on place_events (ts);
create table if not exists location_fixes (ts integer primary key, latitude real not null, longitude real not null, accuracy_m real);
create table if not exists timeline_stays (
  day text not null, start_ts integer not null, end_ts integer not null, place_id text, latitude real, longitude real,
  capped integer not null default 0, primary key (day, start_ts)
);
create table if not exists timeline_moves (bucket integer primary key, metres real not null);
create table if not exists timeline_overrides (
  id text primary key, kind text not null, start_ts integer not null, end_ts integer not null, place_id text, label text,
  latitude real, longitude real, created_at integer not null
);
create index if not exists timeline_overrides_start on timeline_overrides (start_ts);
create table if not exists timeline_state (id integer primary key check (id = 1), mode text not null, frozen_through text);
`;

/**
 * Columns added after a release, in order. `pragma user_version` records the ones a database has applied; a column a
 * database already has (the base SCHEMA carries some of them) is accepted only for SQLite's own duplicate error. Any
 * other failure stops the open: the app would otherwise run against a missing column and fail later in a random screen.
 */
type Migration = { sql: string; table?: string; column?: string };
const MIGRATIONS: Migration[] = [
  { sql: "alter table logged_entries add column source text not null default 'pulse'", table: "logged_entries", column: "source" },
  { sql: "create index if not exists logged_entries_source_day on logged_entries (source, day)" },
  // Auto-detected workouts (stage 1, mobile).
  { sql: "alter table daily_scores add column detected text", table: "daily_scores", column: "detected" },
  // Waist for the Nes 2011 VO2max estimate (mobile).
  { sql: "alter table profile add column waist_cm real", table: "profile", column: "waist_cm" },
  // HRV Status and Garmin-style training (Training Effect, Recovery Time, Training Readiness and Status), version 19.
  { sql: "alter table daily_scores add column hrv_status text", table: "daily_scores", column: "hrv_status" },
  { sql: "alter table daily_scores add column training text", table: "daily_scores", column: "training" },
  // The owner's display name and profile photo path (mobile).
  { sql: "alter table profile add column name text", table: "profile", column: "name" },
  { sql: "alter table profile add column photo text", table: "profile", column: "photo" },
  // The sleep goal, JSON { hours, method } (Settings › Goals).
  { sql: "alter table profile add column sleep_goal text", table: "profile", column: "sleep_goal" },
  // Heart-rate days compacted to one mean per minute (compactHr).
  { sql: "alter table hr_days add column minute integer not null default 0", table: "hr_days", column: "minute" },
  // Units and the clock, JSON { units, hours } (Settings › App).
  { sql: "alter table profile add column display text", table: "profile", column: "display" },
  // Supersets: two exercises of a session sharing an id.
  { sql: "alter table gym_sets add column superset_id text", table: "gym_sets", column: "superset_id" },
  // Habit schedules: every N days and weekdays only.
  { sql: "alter table habits add column interval_days integer not null default 1", table: "habits", column: "interval_days" },
  { sql: "alter table habits add column weekdays_only integer not null default 0", table: "habits", column: "weekdays_only" },
  { sql: "alter table habits add column start_day text not null default ''", table: "habits", column: "start_day" },
  // The office geofence's events and the place in the profile (Settings › Places).
  { sql: "create table if not exists office_events (id text primary key, kind text not null, ts integer not null, day text not null)" },
  { sql: "create index if not exists office_events_ts on office_events (ts)" },
  { sql: "alter table profile add column office text", table: "profile", column: "office" },
  // Blood pressure readings (Health Connect).
  { sql: "create table if not exists blood_pressure_readings (id text primary key, ts integer not null, day text not null, systolic_mmhg real not null, diastolic_mmhg real not null, body_position text, measurement_location text, recording_method text, source_platform text, source_application text, source_device text, quality text not null, imported_at integer not null)" },
  { sql: "create index if not exists blood_pressure_day on blood_pressure_readings (day)" },
  { sql: "create index if not exists blood_pressure_ts on blood_pressure_readings (ts)" },
  // An unused view an earlier build created.
  { sql: "drop view if exists blood_pressure" },
  // The office geofence becomes one saved place of the location timeline, with its arrivals and departures. Its habit
  // tick is dropped. The base SCHEMA has made the timeline's tables by now.
  { sql: "insert or ignore into places (id, name, icon, latitude, longitude, radius_m, created_at) select 'office', 'Office', 'work', json_extract(office, '$.latitude'), json_extract(office, '$.longitude'), 200, cast(strftime('%s', 'now') as integer) from profile where id = 1 and office is not null and json_extract(office, '$.latitude') is not null and json_extract(office, '$.longitude') is not null" },
  { sql: "insert or ignore into place_events (id, place_id, kind, ts, day) select id, 'office', kind, ts, day from office_events where exists (select 1 from places where id = 'office')" },
  { sql: "update profile set office = null" },
  { sql: "drop table if exists office_events" },
];

/** The columns the app reads unconditionally; checked after the migrations so a half-applied schema cannot boot. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  logged_entries: ["source"],
  daily_scores: ["detected", "hrv_status", "training"],
  profile: ["name", "photo", "sleep_goal", "display"],
  hr_days: ["minute"],
  gym_sets: ["superset_id"],
  habits: ["interval_days", "weekdays_only", "start_day"],
};

const DAY = 86_400;
const bucketOf = (ts: number) => Math.floor(ts / DAY);
/** SQLite's `pragma auto_vacuum` value for incremental mode. */
const INCREMENTAL_VACUUM = 2;

type Param = string | number | null;
const json = (x: unknown): string | null => (x == null ? null : JSON.stringify(x));
const parse = <T>(s: string | null): T | null => (s == null ? null : (JSON.parse(s) as T));
const bool = (b: boolean) => (b ? 1 : 0);

/** The schema's own row shapes, as getAllAsync returns them. */
type MetricsRow = {
  day: string; hrv_ms: number | null; hrv_deep_ms: number | null; rhr_bpm: number | null; resp_bpm: number | null; nightly_temp_c: number | null;
  spo2_pct: number | null; vo2max_daily: number | null; vo2max_run: number | null; steps: number | null; calories: number | null;
  weight_kg: number | null; body_fat_pct: number | null; hr_zones: string | null; light_moderate_min: number | null;
  vigorous_peak_min: number | null; temp_baseline_c: number | null; temp_sd_c: number | null; rhr_range_low: number | null;
  rhr_range_high: number | null; hrv_range_low: number | null; hrv_range_high: number | null;
};
type SessionRow = {
  id: string; day: string; start_ts: number; end_ts: number; is_main: number; processed: number; stages_status: string | null;
  asleep_min: number | null; awake_min: number | null; deep_min: number | null; light_min: number | null; rem_min: number | null;
};
type SegmentRow = { session_id: string; start_ts: number; end_ts: number; stage: Segment["stage"] };
type ExerciseRow = { id: string; day: string; start_ts: number; end_ts: number; type: string; name: string | null; calories: number | null; distance_m: number | null };
type BucketRow = { bucket: number; offsets: string; vals: string };
type BloodPressureRow = {
  id: string;
  ts: number;
  day: string;
  systolic_mmhg: number;
  diastolic_mmhg: number;
  body_position: string | null;
  measurement_location: string | null;
  recording_method: string | null;
  source_platform: string | null;
  source_application: string | null;
  source_device: string | null;
  quality: BloodPressureQuality;
  imported_at: number;
};
type ScoresRow = {
  day: string; scoring_version: number; strain: string | null; activities: string | null; session_rhr_bpm: number | null;
  recovery: string | null; sleep: string | null; training_load: string | null; strain_target: string | null; sleep_planner: string | null;
  energy_bank: string | null; stress: string | null; health_monitor: string | null; healthspan: string | null; fitness: string | null;
  journal_impact: string | null; detected: string | null; hrv_status: string | null; training: string | null;
};

const metricsOf = (r: MetricsRow): Metrics => ({
  day: r.day,
  hrvMs: r.hrv_ms,
  hrvDeepMs: r.hrv_deep_ms,
  rhrBpm: r.rhr_bpm,
  respBpm: r.resp_bpm,
  nightlyTempC: r.nightly_temp_c,
  spo2Pct: r.spo2_pct,
  vo2maxDaily: r.vo2max_daily,
  vo2maxRun: r.vo2max_run,
  steps: r.steps,
  calories: r.calories,
  weightKg: r.weight_kg,
  bodyFatPct: r.body_fat_pct,
  hrZones: parse<number[]>(r.hr_zones),
  lightModerateMin: r.light_moderate_min,
  vigorousPeakMin: r.vigorous_peak_min,
  tempBaselineC: r.temp_baseline_c,
  tempSdC: r.temp_sd_c,
  rhrRangeLow: r.rhr_range_low,
  rhrRangeHigh: r.rhr_range_high,
  hrvRangeLow: r.hrv_range_low,
  hrvRangeHigh: r.hrv_range_high,
});
const metricsParams = (m: Metrics): Param[] => [
  m.day, m.hrvMs, m.hrvDeepMs, m.rhrBpm, m.respBpm, m.nightlyTempC, m.spo2Pct, m.vo2maxDaily, m.vo2maxRun, m.steps, m.calories,
  m.weightKg, m.bodyFatPct, json(m.hrZones), m.lightModerateMin, m.vigorousPeakMin, m.tempBaselineC, m.tempSdC, m.rhrRangeLow,
  m.rhrRangeHigh, m.hrvRangeLow, m.hrvRangeHigh,
];
const METRICS_SQL = `insert or replace into daily_metrics (day, hrv_ms, hrv_deep_ms, rhr_bpm, resp_bpm, nightly_temp_c, spo2_pct, vo2max_daily,
  vo2max_run, steps, calories, weight_kg, body_fat_pct, hr_zones, light_moderate_min, vigorous_peak_min, temp_baseline_c, temp_sd_c,
  rhr_range_low, rhr_range_high, hrv_range_low, hrv_range_high) values (${Array(22).fill("?").join(", ")})`;

const sessionOf = (r: SessionRow): Session => ({
  id: r.id,
  day: r.day,
  startTs: r.start_ts,
  endTs: r.end_ts,
  isMain: !!r.is_main,
  processed: !!r.processed,
  stagesStatus: r.stages_status,
  asleepMin: r.asleep_min,
  awakeMin: r.awake_min,
  deepMin: r.deep_min,
  lightMin: r.light_min,
  remMin: r.rem_min,
});
const exerciseOf = (r: ExerciseRow): Exercise => ({
  id: r.id,
  day: r.day,
  startTs: r.start_ts,
  endTs: r.end_ts,
  type: r.type,
  name: r.name,
  calories: r.calories,
  distanceM: r.distance_m,
});
const bloodPressureOf = (r: BloodPressureRow): BloodPressureReading => ({
  id: r.id,
  ts: r.ts,
  day: r.day,
  systolicMmhg: r.systolic_mmhg,
  diastolicMmhg: r.diastolic_mmhg,
  bodyPosition: r.body_position,
  measurementLocation: r.measurement_location,
  recordingMethod: r.recording_method,
  sourcePlatform: r.source_platform,
  sourceApplication: r.source_application,
  sourceDevice: r.source_device,
  quality: r.quality,
  importedAt: r.imported_at,
});

const SCORE_JSON = ["strain", "activities", "recovery", "sleep", "training_load", "strain_target", "sleep_planner", "energy_bank", "stress", "health_monitor", "healthspan", "fitness", "journal_impact", "detected", "hrv_status", "training"] as const;
const scoreOf = (r: ScoresRow): ScoreRow => ({
  day: r.day,
  scoringVersion: r.scoring_version,
  strain: parse(r.strain),
  activities: parse(r.activities),
  sessionRhrBpm: r.session_rhr_bpm,
  recovery: parse(r.recovery),
  sleep: parse(r.sleep),
  training_load: parse(r.training_load),
  strain_target: parse(r.strain_target),
  sleep_planner: parse(r.sleep_planner),
  energy_bank: parse(r.energy_bank),
  stress: parse(r.stress),
  health_monitor: parse(r.health_monitor),
  healthspan: parse(r.healthspan),
  fitness: parse(r.fitness),
  journal_impact: parse(r.journal_impact),
  detected: parse(r.detected),
  hrv_status: parse(r.hrv_status),
  training: parse(r.training),
});
const SCORES_SQL = `insert or replace into daily_scores (day, scoring_version, session_rhr_bpm, ${SCORE_JSON.join(", ")}) values (${Array(3 + SCORE_JSON.length).fill("?").join(", ")})`;

type LoggedRow = { id: string; type: string; ts: number; day: string; data: string; created_at: number; source: string | null };
const loggedOf = (r: LoggedRow): LoggedEntryRow => ({
  id: r.id,
  type: r.type,
  ts: r.ts,
  day: r.day,
  data: JSON.parse(r.data) as unknown,
  createdAt: r.created_at,
  source: r.source === "health_connect" ? "health_connect" : "pulse",
});
const LOGGED_COLUMNS = "id, type, ts, day, data, created_at, source";
const LOGGED_INSERT = `insert or replace into logged_entries (${LOGGED_COLUMNS}) values (?, ?, ?, ?, ?, ?, ?)`;
const loggedParams = (r: LoggedEntryRow, source: EntrySource): Param[] => [r.id, r.type, r.ts, r.day, JSON.stringify(r.data), r.createdAt, source];

class SqliteStore implements Store {
  readonly workouts = new SqliteWorkoutStore();
  constructor(private db: SQLiteDatabase) {}

  /** Swaps in a freshly opened connection (see `healing` below); the write queue carries on. */
  replaceDb(db: SQLiteDatabase): void {
    const old = this.db;
    this.db = db;
    this.queue = Promise.resolve();
    // Close the dead connection now rather than leave it to the garbage collector (its connection is its own:
    // openDb uses useNewConnection, so this can't close the new one).
    if (old !== db) void old.closeAsync().catch(() => {});
  }

  /** Tail of the write queue: every write runs after the previous one settles. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * One transaction at a time on the one connection. expo-sqlite's withExclusiveTransactionAsync opens and closes a
   * second native connection per call, which is slow for a sync's hundreds of small writes and on Android failed with
   * "NativeDatabase.prepareAsync has been rejected (NullPointerException)" under that churn.
   */
  private tx<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    return this.queued(async () => {
      await this.db.execAsync("begin immediate");
      try {
        const out = await task(this.db);
        await this.db.execAsync("commit");
        return out;
      } catch (e) {
        await this.db.execAsync("rollback").catch(() => {});
        throw e;
      }
    });
  }

  /** Runs `run` after every write before it, outside a transaction (VACUUM cannot run inside one). */
  private queued<T>(run: () => Promise<T>): Promise<T> {
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Runs one statement for every row, inside `task`'s transaction. */
  private async many(db: SQLiteDatabase, sql: string, rows: Param[][]) {
    if (!rows.length) return;
    const st = await db.prepareAsync(sql);
    try {
      for (const r of rows) await st.executeAsync(r);
    } finally {
      await st.finalizeAsync();
    }
  }

  // ── Profile and sync ──────────────────────────────────────────────────────

  async getProfile() {
    const r = await this.db.getFirstAsync<{
      birth_date: string; sex: Profile["sex"]; max_hr: number | null; height_cm: number | null; waist_cm: number | null; time_zone: string;
      name: string | null; photo: string | null; sleep_goal: string | null; display: string | null;
    }>("select birth_date, sex, max_hr, height_cm, waist_cm, time_zone, name, photo, sleep_goal, display from profile where id = 1");
    return r && {
      birthDate: r.birth_date, sex: r.sex, maxHr: r.max_hr, heightCm: r.height_cm, waistCm: r.waist_cm, timeZone: r.time_zone, name: r.name, photo: r.photo,
      sleepGoal: parse<NonNullable<Profile["sleepGoal"]>>(r.sleep_goal),
      display: parse<NonNullable<Profile["display"]>>(r.display),
    };
  }
  async setProfile(p: Profile) {
    await this.tx((db) => db.runAsync("insert or replace into profile (id, birth_date, sex, max_hr, height_cm, waist_cm, time_zone, name, photo, sleep_goal, display) values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      p.birthDate, p.sex, p.maxHr, p.heightCm, p.waistCm ?? null, p.timeZone, p.name ?? null, p.photo ?? null, json(p.sleepGoal), json(p.display),
    ]));
  }
  async getSyncState(): Promise<SyncState> {
    const r = await this.db.getFirstAsync<{ last_sync_ts: number | null; first_day: string | null; last_error: string | null }>(
      "select last_sync_ts, first_day, last_error from sync_state where id = 1",
    );
    return r ? { lastSyncTs: r.last_sync_ts, firstDay: r.first_day, lastError: r.last_error } : { lastSyncTs: null, firstDay: null, lastError: null };
  }
  async setSyncState(s: Partial<SyncState>) {
    const next = { ...(await this.getSyncState()), ...s };
    await this.tx((db) => db.runAsync("insert or replace into sync_state (id, last_sync_ts, first_day, last_error) values (1, ?, ?, ?)", [
      next.lastSyncTs, next.firstDay, next.lastError,
    ]));
  }

  // ── Rows ──────────────────────────────────────────────────────────────────

  async upsertMetrics(rows: Metrics[]) {
    if (!rows.length) return;
    await this.tx((db) => this.many(db, METRICS_SQL, rows.map(metricsParams)));
  }

  /** Segments replace those of every session they name; sessions passed without segments keep theirs. */
  async upsertSessions(rows: Session[], segments: Segment[]) {
    if (!rows.length && !segments.length) return;
    await this.tx(async (db) => {
      await this.many(
        db,
        `insert or replace into sleep_sessions (id, day, start_ts, end_ts, is_main, processed, stages_status, asleep_min, awake_min, deep_min, light_min, rem_min)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rows.map((s) => [s.id, s.day, s.startTs, s.endTs, bool(s.isMain), bool(s.processed), s.stagesStatus, s.asleepMin, s.awakeMin, s.deepMin, s.lightMin, s.remMin]),
      );
      const ids = [...new Set(segments.map((g) => g.sessionId))];
      await this.many(db, "delete from sleep_segments where session_id = ?", ids.map((id) => [id]));
      await this.many(
        db,
        "insert or replace into sleep_segments (session_id, start_ts, end_ts, stage) values (?, ?, ?, ?)",
        segments.map((g) => [g.sessionId, g.startTs, g.endTs, g.stage]),
      );
    });
  }

  async upsertExercises(rows: Exercise[]) {
    if (!rows.length) return;
    await this.tx((db) =>
      this.many(
        db,
        "insert or replace into exercises (id, day, start_ts, end_ts, type, name, calories, distance_m) values (?, ?, ?, ?, ?, ?, ?, ?)",
        rows.map((e) => [e.id, e.day, e.startTs, e.endTs, e.type, e.name, e.calories, e.distanceM]),
      ),
    );
  }

  async putHr(samples: HrSample[]) {
    return this.putSamples("hr_days", samples.map((s) => ({ ts: s.ts, v: s.bpm })));
  }
  async putSteps(minutes: StepsMinute[]) {
    return this.putSamples("steps_days", minutes);
  }
  async putHrv(samples: HrvSample[]) {
    return this.putSamples("hrv_days", samples.map((s) => ({ ts: s.ts, v: s.ms })));
  }

  /**
   * Merges samples into their UTC-day buckets, replacing by ts, in one transaction. A bucket whose samples are all
   * already there with the same values is left as it is. True when any bucket changed.
   */
  private async putSamples(table: SampleTable, samples: { ts: number; v: number }[]) {
    if (!samples.length) return false;
    let changed = false;
    const byBucket = new Map<number, { ts: number; v: number }[]>();
    for (const s of samples) {
      const b = bucketOf(s.ts);
      const list = byBucket.get(b);
      if (list) list.push(s);
      else byBucket.set(b, [s]);
    }
    await this.tx(async (db) => {
      for (const [b, xs] of byBucket) {
        const base = b * DAY;
        const merged = new Map<number, number>();
        const r = await db.getFirstAsync<BucketRow>(`select bucket, offsets, vals from ${table} where bucket = ?`, [b]);
        if (r) {
          const offsets = JSON.parse(r.offsets) as number[];
          const vals = JSON.parse(r.vals) as number[];
          for (let i = 0; i < offsets.length; i++) merged.set(base + offsets[i], vals[i]);
        }
        // A day of 1 Hz heart rate is tens of thousands of entries to parse, merge, sort and print: let a frame in
        // between (src/lib/yield.ts).
        await slice();
        if (xs.every((s) => merged.get(s.ts) === s.v)) continue;
        changed = true;
        for (const s of xs) merged.set(s.ts, s.v);
        const sorted = [...merged].sort((a, z) => a[0] - z[0]);
        await slice();
        await db.runAsync(`insert or replace into ${table} (bucket, offsets, vals) values (?, ?, ?)`, [
          b, JSON.stringify(sorted.map(([ts]) => ts - base)), JSON.stringify(sorted.map(([, v]) => v)),
        ]);
      }
    });
    return changed;
  }

  async upsertDailyValues(rows: DailyValue[]) {
    if (!rows.length) return;
    await this.tx((db) =>
      this.many(db, "insert or replace into daily_values (day, key, value) values (?, ?, ?)", rows.map((v) => [v.day, v.key, v.value])),
    );
  }
  async replaceDailyValues(range: DayRange, keys: readonly string[], rows: DailyValue[]) {
    await this.tx(async (db) => {
      if (keys.length) await db.runAsync(`delete from daily_values where day >= ? and day <= ? and key in (${keys.map(() => "?").join(",")})`, [range.from, range.to, ...keys]);
      await this.many(db, "insert or replace into daily_values (day, key, value) values (?, ?, ?)", rows.map((v) => [v.day, v.key, v.value]));
    });
  }
  async setJournal(entry: JournalEntry) {
    await this.tx((db) => db.runAsync("insert or replace into journal_entries (day, tag, value) values (?, ?, ?)", [entry.day, entry.tag, entry.value]));
  }
  async deleteJournal(day: string, tag: string) {
    await this.tx((db) => db.runAsync("delete from journal_entries where day = ? and tag = ?", [day, tag]));
  }
  async clearImported(range: DayRange, fromTs: number, toTs: number, opts?: { keepScores?: boolean }) {
    const days = [range.from, range.to];
    await this.tx(async (db) => {
      await db.runAsync("delete from daily_metrics where day >= ? and day <= ?", days);
      await db.runAsync("delete from sleep_segments where session_id in (select id from sleep_sessions where day >= ? and day <= ?)", days);
      await db.runAsync("delete from sleep_sessions where day >= ? and day <= ?", days);
      await db.runAsync("delete from exercises where day >= ? and day <= ?", days);
      await db.runAsync("delete from daily_values where day >= ? and day <= ?", days);
      await db.runAsync("delete from health_records where day >= ? and day <= ?", days);
      await db.runAsync("delete from blood_pressure_readings where day >= ? and day <= ?", days);
      await db.runAsync("delete from logged_entries where source = 'health_connect' and day >= ? and day <= ?", days);
      if (!opts?.keepScores) {
        await db.runAsync("delete from daily_scores where day >= ? and day <= ?", days);
        // The rows it vouches for are going.
        await db.runAsync("delete from pipeline_checkpoint");
      }
      await db.runAsync("delete from intraday_series where day >= ? and day <= ?", days);
      if (toTs > fromTs) for (const table of ["hr_days", "steps_days", "hrv_days"] as const) await this.dropSamples(db, table, fromTs, toTs);
    });
  }

  /** Removes samples with lo <= ts < hi: whole buckets inside the span go, the two edge buckets are rewritten. */
  private async dropSamples(db: SQLiteDatabase, table: SampleTable, lo: number, hi: number) {
    const first = bucketOf(lo);
    const last = bucketOf(hi - 1);
    await db.runAsync(`delete from ${table} where bucket > ? and bucket < ?`, [first, last]);
    for (const b of first === last ? [first] : [first, last]) {
      const r = await db.getFirstAsync<BucketRow>(`select bucket, offsets, vals from ${table} where bucket = ?`, [b]);
      if (!r) continue;
      const base = b * DAY;
      const offsets = JSON.parse(r.offsets) as number[];
      const vals = JSON.parse(r.vals) as number[];
      const keep = offsets.flatMap((o, i) => (base + o >= lo && base + o < hi ? [] : [[o, vals[i]] as const]));
      if (!keep.length) await db.runAsync(`delete from ${table} where bucket = ?`, [b]);
      else
        await db.runAsync(`insert or replace into ${table} (bucket, offsets, vals) values (?, ?, ?)`, [
          b, JSON.stringify(keep.map(([o]) => o)), JSON.stringify(keep.map(([, v]) => v)),
        ]);
    }
  }

  async compactHr(beforeTs: number) {
    const days = await this.db.getAllAsync<{ bucket: number }>("select bucket from hr_days where minute = 0 and bucket < ? order by bucket", [bucketOf(beforeTs)]);
    let done = 0;
    for (const { bucket } of days) {
      await this.tx(async (db) => {
        // Read again inside the transaction: a sync may have rewritten the day since the list was read.
        const r = await db.getFirstAsync<BucketRow>("select bucket, offsets, vals from hr_days where bucket = ? and minute = 0", [bucket]);
        if (!r) return;
        const offsets = JSON.parse(r.offsets) as number[];
        const vals = JSON.parse(r.vals) as number[];
        const minutes = minuteHr(offsets.map((o, i) => ({ ts: o, bpm: vals[i] })));
        await db.runAsync("update hr_days set offsets = ?, vals = ?, minute = 1 where bucket = ?", [
          JSON.stringify(minutes.map((m) => m.ts)), JSON.stringify(minutes.map((m) => Math.round(m.bpm))), bucket,
        ]);
        done++;
      });
      // A raw day is tens of thousands of samples to parse and print: let a frame in between days (src/lib/yield.ts).
      await slice();
    }
    return done;
  }
  async reclaimSpace() {
    await this.queued(async () => {
      const mode = await this.db.getFirstAsync<{ auto_vacuum: number }>("pragma auto_vacuum");
      // A database created before incremental vacuum was turned on switches with one full VACUUM; after that, the
      // pages a delete freed go back without rewriting the file.
      await this.db.execAsync(mode?.auto_vacuum === INCREMENTAL_VACUUM ? "pragma incremental_vacuum" : "pragma auto_vacuum = incremental; vacuum");
      // The write-ahead log keeps its largest size until truncated (a first import grows it).
      await this.db.execAsync("pragma wal_checkpoint(truncate)");
    });
  }
  async storageBytes() {
    const [pages, size] = await Promise.all([
      this.db.getFirstAsync<{ page_count: number }>("pragma page_count"),
      this.db.getFirstAsync<{ page_size: number }>("pragma page_size"),
    ]);
    return pages && size ? pages.page_count * size.page_size : null;
  }

  async deleteSessions(ids: string[]) {
    if (!ids.length) return;
    await this.tx(async (db) => {
      await this.many(db, "delete from sleep_segments where session_id = ?", ids.map((id) => [id]));
      await this.many(db, "delete from sleep_sessions where id = ?", ids.map((id) => [id]));
    });
  }
  async deleteExercises(ids: string[]) {
    if (!ids.length) return;
    await this.tx((db) => this.many(db, "delete from exercises where id = ?", ids.map((id) => [id])));
  }
  async upsertHealthRecords(rows: HealthRecord[]) {
    if (!rows.length) return;
    await this.tx((db) =>
      this.many(
        db,
        "insert or replace into health_records (id, kind, ts, day, data) values (?, ?, ?, ?, ?)",
        rows.map((r) => [r.id, r.kind, r.ts, r.day, JSON.stringify(r.data)]),
      ),
    );
  }

  async upsertBloodPressure(rows: BloodPressureReading[]) {
    if (!rows.length) return;
    await this.tx((db) =>
      this.many(
        db,
        `insert or replace into blood_pressure_readings (
          id, ts, day, systolic_mmhg, diastolic_mmhg, body_position, measurement_location,
          recording_method, source_platform, source_application, source_device, quality, imported_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rows.map((r) => [
          r.id,
          r.ts,
          r.day,
          r.systolicMmhg,
          r.diastolicMmhg,
          r.bodyPosition ?? null,
          r.measurementLocation ?? null,
          r.recordingMethod ?? null,
          r.sourcePlatform ?? null,
          r.sourceApplication ?? null,
          r.sourceDevice ?? null,
          r.quality,
          r.importedAt,
        ]),
      ),
    );
  }

  async markIntradayDirty(days: string[]) {
    if (!days.length) return;
    await this.tx((db) => this.many(db, "insert or ignore into intraday_dirty (day) values (?)", days.map((d) => [d])));
  }
  async takeIntradayDirty() {
    let days: string[] = [];
    await this.tx(async (db) => {
      days = (await db.getAllAsync<{ day: string }>("select day from intraday_dirty order by day")).map((r) => r.day);
      await db.runAsync("delete from intraday_dirty");
    });
    return days;
  }
  async needsScoring(today: string, scoringVersion: number) {
    const [day, stale, dirty] = await Promise.all([
      this.db.getFirstAsync<{ one: number }>("select 1 as one from daily_scores where day = ? and scoring_version = ? limit 1", [today, scoringVersion]),
      this.db.getFirstAsync<{ one: number }>("select 1 as one from daily_scores where scoring_version <> ? limit 1", [scoringVersion]),
      this.db.getFirstAsync<{ one: number }>("select 1 as one from intraday_dirty limit 1"),
    ]);
    return !day || !!stale || !!dirty;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async allMetrics() {
    return (await this.db.getAllAsync<MetricsRow>("select * from daily_metrics order by day")).map(metricsOf);
  }
  async allSessions() {
    return (await this.db.getAllAsync<SessionRow>("select * from sleep_sessions order by start_ts, id")).map(sessionOf);
  }
  async segmentsFor(sessionIds: string[]) {
    const out: Segment[] = [];
    // SQLite caps a statement's parameters (999 on older builds), so ids go in slices.
    for (let i = 0; i < sessionIds.length; i += 500) {
      const ids = sessionIds.slice(i, i + 500);
      const rows = await this.db.getAllAsync<SegmentRow>(
        `select session_id, start_ts, end_ts, stage from sleep_segments where session_id in (${ids.map(() => "?").join(", ")}) order by start_ts`,
        ids,
      );
      for (const r of rows) out.push({ sessionId: r.session_id, startTs: r.start_ts, endTs: r.end_ts, stage: r.stage });
    }
    return out.sort((a, b) => a.startTs - b.startTs);
  }
  async allExercises() {
    return (await this.db.getAllAsync<ExerciseRow>("select * from exercises order by start_ts, id")).map(exerciseOf);
  }
  async allJournal() {
    return this.db.getAllAsync<JournalEntry>("select day, tag, value from journal_entries order by day, tag");
  }
  async dailyValues(range?: DayRange) {
    return range
      ? this.db.getAllAsync<DailyValue>("select day, key, value from daily_values where day >= ? and day <= ? order by day, key", [range.from, range.to])
      : this.db.getAllAsync<DailyValue>("select day, key, value from daily_values order by day, key");
  }
  async healthRecords(toDay?: string) {
    const rows = await this.db.getAllAsync<{ id: string; kind: HealthRecord["kind"]; ts: number; day: string; data: string }>(
      toDay === undefined
        ? "select id, kind, ts, day, data from health_records order by ts desc, id"
        : "select id, kind, ts, day, data from health_records where day <= ? order by ts desc, id",
      toDay === undefined ? [] : [toDay],
    );
    return rows.map((r): HealthRecord => ({ id: r.id, kind: r.kind, ts: r.ts, day: r.day, data: JSON.parse(r.data) as Record<string, unknown> }));
  }

  async allBloodPressure(): Promise<BloodPressureReading[]> {
    const rows = await this.db.getAllAsync<BloodPressureRow>("select * from blood_pressure_readings order by ts desc, id desc");
    return rows.map(bloodPressureOf);
  }

  /** Samples with lo <= ts < hi from the buckets they can fall in, in time order. */
  private async readSamples(table: SampleTable, lo: number, hi: number) {
    const out: { ts: number; v: number }[] = [];
    if (hi <= lo) return out;
    const rows = await this.db.getAllAsync<BucketRow>(`select bucket, offsets, vals from ${table} where bucket between ? and ? order by bucket`, [
      bucketOf(lo), bucketOf(hi - 1),
    ]);
    for (const r of rows) {
      // A stage 1 batch reads a month of buckets: one at a time between frames (src/lib/yield.ts).
      await slice();
      const base = r.bucket * DAY;
      const offsets = JSON.parse(r.offsets) as number[];
      const vals = JSON.parse(r.vals) as number[];
      for (let i = 0; i < offsets.length; i++) {
        const ts = base + offsets[i];
        if (ts >= lo && ts < hi) out.push({ ts, v: vals[i] });
      }
    }
    return out;
  }
  async readHr(lo: number, hi: number) {
    return (await this.readSamples("hr_days", lo, hi)).map((s) => ({ ts: s.ts, bpm: s.v }));
  }
  async readSteps(lo: number, hi: number) {
    return this.readSamples("steps_days", lo, hi);
  }
  async readHrv(lo: number, hi: number) {
    return (await this.readSamples("hrv_days", lo, hi)).map((s) => ({ ts: s.ts, ms: s.v }));
  }
  async hrBounds() {
    const [lo, hi] = await Promise.all([
      this.db.getFirstAsync<BucketRow>("select bucket, offsets, vals from hr_days order by bucket limit 1"),
      this.db.getFirstAsync<BucketRow>("select bucket, offsets, vals from hr_days order by bucket desc limit 1"),
    ]);
    if (!lo || !hi) return null;
    const first = JSON.parse(lo.offsets) as number[];
    const last = JSON.parse(hi.offsets) as number[];
    if (!first.length || !last.length) return null;
    return { first: lo.bucket * DAY + first[0], last: hi.bucket * DAY + last[last.length - 1] };
  }

  // ── Scores ────────────────────────────────────────────────────────────────

  async getScores(day: string) {
    const r = await this.db.getFirstAsync<ScoresRow>("select * from daily_scores where day = ?", [day]);
    return r && scoreOf(r);
  }
  async scoresIn(range: DayRange) {
    const rows = await this.db.getAllAsync<ScoresRow>("select * from daily_scores where day >= ? and day <= ? order by day", [range.from, range.to]);
    // Fourteen JSON columns a day over the whole history: parsed between frames (src/lib/yield.ts).
    const out: ScoreRow[] = [];
    for (const r of rows) {
      await slice();
      out.push(scoreOf(r));
    }
    return out;
  }
  async wornDays(range: DayRange) {
    // json_extract reads the three fields in SQLite; only the small result crosses to JS, not 12 KB of score JSON a day.
    const rows = await this.db.getAllAsync<{ day: string; hr_count: number; am: number; pm: number }>(
      `select day,
              coalesce(json_extract(strain, '$.hrCount'), 0) as hr_count,
              coalesce(json_extract(strain, '$.hrMinutesAm'), 0) as am,
              coalesce(json_extract(strain, '$.hrMinutesPm'), 0) as pm
         from daily_scores where day >= ? and day <= ? order by day`,
      [range.from, range.to],
    );
    return rows.map((r) => ({ day: r.day, hrCount: r.hr_count, hrMinutesAm: r.am, hrMinutesPm: r.pm }));
  }
  async putScores(row: ScoreRow) {
    await this.tx((db) => db.runAsync(SCORES_SQL, [row.day, row.scoringVersion, row.sessionRhrBpm, ...SCORE_JSON.map((k) => json(row[k]))]));
  }
  async getSeries(day: string, kind: SeriesKind) {
    const r = await this.db.getFirstAsync<{ data: string }>("select data from intraday_series where day = ? and kind = ?", [day, kind]);
    return r ? (JSON.parse(r.data) as (number | null)[]) : null;
  }
  async putSeries(day: string, kind: SeriesKind, data: (number | null)[]) {
    await this.tx((db) =>
      data.length
        ? db.runAsync("insert or replace into intraday_series (day, kind, data) values (?, ?, ?)", [day, kind, JSON.stringify(data)])
        : db.runAsync("delete from intraday_series where day = ? and kind = ?", [day, kind]),
    );
  }

  // ── Journal behaviours and logged entries ────────────────────────────────

  async journalTags() {
    const rows = await this.db.getAllAsync<{ tag: string; label: string; is_default: number; hidden: number; position: number }>(
      "select tag, label, is_default, hidden, position from journal_tags order by position, seq",
    );
    return rows.map((r): JournalTagRow => ({ tag: r.tag, label: r.label, isDefault: !!r.is_default, hidden: !!r.hidden, position: r.position }));
  }
  async insertJournalTags(rows: JournalTagRow[]) {
    if (!rows.length) return [];
    return this.tx(async (db) => {
      const added: string[] = [];
      for (const r of rows) {
        const res = await db.runAsync(
          `insert or ignore into journal_tags (tag, label, is_default, hidden, position, seq)
           values (?, ?, ?, ?, ?, (select coalesce(max(seq), 0) + 1 from journal_tags))`,
          [r.tag, r.label, bool(r.isDefault), bool(r.hidden), r.position],
        );
        if (res.changes > 0) added.push(r.tag);
      }
      return added;
    });
  }
  async updateJournalTags(changes: JournalTagChange[]) {
    if (!changes.length) return;
    await this.tx(async (db) => {
      for (const ch of changes) {
        if (ch.hidden !== undefined) await db.runAsync("update journal_tags set hidden = ? where tag = ?", [bool(ch.hidden), ch.tag]);
        if (ch.position !== undefined) await db.runAsync("update journal_tags set position = ? where tag = ?", [ch.position, ch.tag]);
      }
    });
  }

  async addLoggedEntries(rows: LoggedEntryRow[]) {
    if (!rows.length) return;
    await this.tx((db) =>
      this.many(
        db,
        LOGGED_INSERT,
        rows.map((r) => loggedParams(r, r.source ?? "pulse")),
      ),
    );
  }
  async loggedEntries(fromTs: number, limit = 50) {
    const rows = await this.db.getAllAsync<LoggedRow>(
      `select ${LOGGED_COLUMNS} from logged_entries where ts >= ? order by ts desc, created_at desc limit ?`,
      [fromTs, limit],
    );
    return rows.map(loggedOf);
  }
  async deleteLoggedEntry(id: string) {
    return this.tx(async (db) => {
      const r = await db.getFirstAsync<LoggedRow>(`select ${LOGGED_COLUMNS} from logged_entries where id = ?`, [id]);
      if (!r) return null;
      await db.runAsync("delete from logged_entries where id = ?", [id]);
      return loggedOf(r);
    });
  }
  async replaceExternalEntries(range: DayRange, rows: LoggedEntryRow[]) {
    await this.tx(async (db) => {
      await db.runAsync("delete from logged_entries where source = 'health_connect' and day >= ? and day <= ?", [range.from, range.to]);
      await this.many(db, LOGGED_INSERT, rows.map((r) => loggedParams(r, "health_connect")));
    });
  }

  async getReports() {
    return (await this.db.getAllAsync<{ period: string; data: string }>("select period, data from reports order by period")).map((r) => ({
      period: r.period,
      data: JSON.parse(r.data) as ReportRow["data"],
    }));
  }
  async putReports(rows: ReportRow[]) {
    await this.tx(async (db) => {
      await db.runAsync("delete from reports");
      await this.many(db, "insert into reports (period, data) values (?, ?)", rows.map((r) => [r.period, JSON.stringify(r.data)]));
    });
  }

  async getActivityCost() {
    const r = await this.db.getFirstAsync<{ data: string }>("select data from activity_cost where id = 1");
    return r ? (JSON.parse(r.data) as ActivityCostResult) : null;
  }
  async putActivityCost(data: ActivityCostResult) {
    await this.tx((db) => db.runAsync("insert or replace into activity_cost (id, data) values (1, ?)", [JSON.stringify(data)]));
  }

  async getCheckpoint() {
    return (await this.db.getFirstAsync<{ data: string }>("select data from pipeline_checkpoint where id = 1"))?.data ?? null;
  }
  async putCheckpoint(json: string | null) {
    if (json === null) await this.db.runAsync("delete from pipeline_checkpoint");
    else await this.db.runAsync("insert or replace into pipeline_checkpoint (id, data) values (1, ?)", [json]);
  }

  async coachChats(limit: number, before?: { updatedAt: number; id: string }) {
    const rows = before
      ? await this.db.getAllAsync<{ id: string; title: string; updated_at: number }>(
          "select id, title, updated_at from coach_chats where updated_at < ? or (updated_at = ? and id < ?) order by updated_at desc, id desc limit ?",
          [before.updatedAt, before.updatedAt, before.id, limit],
        )
      : await this.db.getAllAsync<{ id: string; title: string; updated_at: number }>("select id, title, updated_at from coach_chats order by updated_at desc, id desc limit ?", [limit]);
    return rows.map((r): CoachChatRow => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  }
  async coachChatCount() {
    return (await this.db.getFirstAsync<{ n: number }>("select count(*) as n from coach_chats"))?.n ?? 0;
  }
  async coachChatMessages(id: string) {
    const r = await this.db.getFirstAsync<{ messages: string }>("select messages from coach_chats where id = ?", [id]);
    if (!r) return null;
    try {
      return JSON.parse(r.messages) as unknown[];
    } catch {
      return null;
    }
  }
  async putCoachChat(id: string, title: string, messages: unknown[], updatedAt: number) {
    await this.db.runAsync(
      "insert into coach_chats (id, title, messages, created_at, updated_at) values (?, ?, ?, ?, ?) on conflict(id) do update set title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at",
      [id, title, JSON.stringify(messages), updatedAt, updatedAt],
    );
  }
  async deleteCoachChats(id?: string) {
    if (id === undefined) await this.db.runAsync("delete from coach_chats");
    else await this.db.runAsync("delete from coach_chats where id = ?", [id]);
  }

  // ── LeetCode ──────────────────────────────────────────────────────────────

  async getLeetCode(username: string) {
    const r = await this.db.getFirstAsync<{ data: string }>("select data from leetcode_profiles where username = ?", [username]);
    if (!r) return null;
    try {
      return JSON.parse(r.data) as LeetCodeSnapshot;
    } catch {
      return null;
    }
  }
  async putLeetCode(snapshot: LeetCodeSnapshot) {
    await this.tx((db) =>
      db.runAsync("insert into leetcode_profiles (username, data) values (?, ?) on conflict(username) do update set data = excluded.data", [
        snapshot.username,
        JSON.stringify(snapshot),
      ]),
    );
  }
  async deleteLeetCode(username: string) {
    await this.db.runAsync("delete from leetcode_profiles where username = ?", [username]);
  }
  async clearLeetCode() {
    await this.db.runAsync("delete from leetcode_profiles");
  }


  // ── the gym log ───────────────────────────────────────────────────────────────────────────────────────────────────
  async gymExercises() {
    const rows = await this.db.getAllAsync<GymExerciseRow>("select * from gym_exercises order by name");
    return rows.map(gymExerciseOf);
  }
  async putGymExercises(rows: GymExercise[]) {
    if (!rows.length) return;
    await this.tx(async (db) => {
      for (const e of rows) {
        await db.runAsync(
          `insert or replace into gym_exercises (id, name, body_part, equipment, custom, hold, unit, note) values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.id, e.name, e.bodyPart, e.equipment, bool(e.custom), bool(e.hold), e.unit, e.note],
        );
      }
    });
  }
  async deleteGymExercise(id: string) {
    await this.db.runAsync("delete from gym_exercises where id = ?", [id]);
  }
  async gymRoutines() {
    const routines = await this.db.getAllAsync<GymRoutineRow>("select * from gym_routines order by position, name");
    const items = await this.db.getAllAsync<GymRoutineItemRow>("select * from gym_routine_items order by routine_id, position");
    return { routines: routines.map(gymRoutineOf), items: items.map(gymRoutineItemOf) };
  }
  async putGymRoutine(routine: GymRoutine, items: GymRoutineItem[]) {
    await this.tx(async (db) => {
      await db.runAsync(
        `insert or replace into gym_routines (id, name, notes, position, updated_at) values (?, ?, ?, ?, ?)`,
        [routine.id, routine.name, routine.notes, routine.position, routine.updatedAt],
      );
      await db.runAsync("delete from gym_routine_items where routine_id = ?", [routine.id]);
      for (const i of items) {
        await db.runAsync(
          `insert into gym_routine_items (routine_id, exercise_id, position, sets, reps, rest_sec, note) values (?, ?, ?, ?, ?, ?, ?)`,
          [i.routineId, i.exerciseId, i.position, i.sets, i.reps, i.restSec, i.note],
        );
      }
    });
  }
  async deleteGymRoutine(id: string) {
    await this.tx(async (db) => {
      await db.runAsync("delete from gym_routine_items where routine_id = ?", [id]);
      await db.runAsync("delete from gym_routines where id = ?", [id]);
    });
  }
  async gymSessions() {
    const rows = await this.db.getAllAsync<GymSessionRow>("select * from gym_sessions order by start_ts desc");
    return rows.map(gymSessionOf);
  }
  async putGymSession(s: GymSession) {
    await this.db.runAsync(
      `insert or replace into gym_sessions (id, day, start_ts, end_ts, name, notes, routine_id, finished, rest_started_ts, rest_sec)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.day, s.startTs, s.endTs, s.name, s.notes, s.routineId, bool(s.finished), s.restStartedTs, s.restSec],
    );
  }
  async deleteGymSession(id: string) {
    await this.tx(async (db) => {
      await db.runAsync("delete from gym_sets where session_id = ?", [id]);
      await db.runAsync("delete from gym_sessions where id = ?", [id]);
    });
  }
  async gymSets(sessionIds: string[]) {
    if (!sessionIds.length) return [];
    const marks = sessionIds.map(() => "?").join(", ");
    const rows = await this.db.getAllAsync<GymSetRow>(
      `select * from gym_sets where session_id in (${marks}) order by session_id, position, set_no`,
      sessionIds,
    );
    return rows.map(gymSetOf);
  }
  async gymAllSets() {
    const rows = await this.db.getAllAsync<GymSetRow>("select * from gym_sets order by ts, position, set_no");
    return rows.map(gymSetOf);
  }
  async gymExerciseSets(exerciseIds: string[], beforeTs?: number) {
    if (!exerciseIds.length) return [];
    const marks = exerciseIds.map(() => "?").join(", ");
    const rows = await this.db.getAllAsync<GymSetRow>(
      `select * from gym_sets where exercise_id in (${marks}) and (? is null or ts <= ?) order by ts, position, set_no`,
      [...exerciseIds, beforeTs ?? null, beforeTs ?? null],
    );
    return rows.map(gymSetOf);
  }
  async putGymSet(s: GymSet) {
    await this.db.runAsync(
      `insert or replace into gym_sets (id, session_id, exercise_id, position, set_no, weight_kg, reps, seconds, distance_m, rpe, type, superset_id, completed, ts, note)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.sessionId, s.exerciseId, s.position, s.setNo, s.weightKg, s.reps, s.seconds, s.distanceM, s.rpe, s.type, s.supersetId, bool(s.completed), s.ts, s.note],
    );
  }
  async putGymSets(sets: GymSet[]) {
    if (!sets.length) return;
    await this.tx(async (db) => {
      for (const s of sets) {
        await db.runAsync(
          `insert or replace into gym_sets (id, session_id, exercise_id, position, set_no, weight_kg, reps, seconds, distance_m, rpe, type, superset_id, completed, ts, note)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.id, s.sessionId, s.exerciseId, s.position, s.setNo, s.weightKg, s.reps, s.seconds, s.distanceM, s.rpe, s.type, s.supersetId, bool(s.completed), s.ts, s.note],
        );
      }
    });
  }
  async deleteGymSet(id: string) {
    await this.db.runAsync("delete from gym_sets where id = ?", [id]);
  }
  async gymMeasurements() {
    const rows = await this.db.getAllAsync<GymMeasurementRow>("select * from gym_measurements order by day desc");
    return rows.map(gymMeasurementOf);
  }
  async putGymMeasurement(m: GymMeasurement) {
    await this.db.runAsync(
      `insert into gym_measurements (id, day, kind, value) values (?, ?, ?, ?)
       on conflict (day, kind) do update set id = excluded.id, value = excluded.value`,
      [m.id, m.day, m.kind, m.value],
    );
  }
  async deleteGymMeasurement(id: string) {
    await this.db.runAsync("delete from gym_measurements where id = ?", [id]);
  }
  async getGymImport() {
    const row = await this.db.getFirstAsync<{ data: string }>("select data from gym_import where id = 1");
    return parse<GymImportState>(row?.data ?? null);
  }
  async putGymImport(state: GymImportState) {
    await this.db.runAsync("insert or replace into gym_import (id, data) values (1, ?)", [json(state)]);
  }

  async habits() {
    const rows = await this.db.getAllAsync<HabitRow>("select * from habits order by position, name");
    return rows.map(habitOf);
  }
  async putHabit(h: Habit) {
    await this.db.runAsync(
      `insert or replace into habits (id, name, question, notes, kind, color, period, interval_days, weekdays_only, start_day, target, target_type, unit, position, archived, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [h.id, h.name, h.question, h.notes, h.kind, h.color, h.period, h.intervalDays, bool(h.weekdaysOnly), h.startDay, h.target, h.targetType, h.unit, h.position, bool(h.archived), h.createdAt, h.updatedAt],
    );
  }
  async deleteHabit(id: string) {
    await this.tx(async (db) => {
      await db.runAsync("delete from habit_entries where habit_id = ?", [id]);
      await db.runAsync("delete from habits where id = ?", [id]);
    });
  }
  async habitEntries(from?: string, to?: string) {
    const rows =
      from && to
        ? await this.db.getAllAsync<HabitEntryRow>("select * from habit_entries where day >= ? and day <= ? order by day, habit_id", [from, to])
        : await this.db.getAllAsync<HabitEntryRow>("select * from habit_entries order by day, habit_id");
    return rows.map(habitEntryOf);
  }
  async putHabitEntry(e: HabitEntry) {
    await this.db.runAsync(
      `insert or replace into habit_entries (habit_id, day, value, skip, note, updated_at) values (?, ?, ?, ?, ?, ?)`,
      [e.habitId, e.day, e.value, bool(e.skip), e.note, e.updatedAt],
    );
  }
  async deleteHabitEntry(habitId: string, day: string) {
    await this.db.runAsync("delete from habit_entries where habit_id = ? and day = ?", [habitId, day]);
  }

  async foodOrders(from?: string, to?: string) {
    const rows =
      from && to
        ? await this.db.getAllAsync<FoodOrderRow>("select * from food_orders where day >= ? and day <= ? order by ts desc", [from, to])
        : await this.db.getAllAsync<FoodOrderRow>("select * from food_orders order by ts desc");
    return rows.map(foodOrderOf);
  }
  async putFoodOrder(o: FoodOrder) {
    await this.db.runAsync("insert or replace into food_orders (id, key, day, ts, merchant, source) values (?, ?, ?, ?, ?, ?)", [o.id, o.key, o.day, o.ts, o.merchant, o.source]);
  }
  async deleteFoodOrder(id: string) {
    await this.db.runAsync("delete from food_orders where id = ?", [id]);
  }
  async clearFoodOrders() {
    await this.db.runAsync("delete from food_orders");
  }

  // ── The location timeline ─────────────────────────────────────────────

  async places() {
    const rows = await this.db.getAllAsync<PlaceRow>("select * from places order by created_at, id");
    return rows.map(placeOf);
  }
  async putPlace(p: Place) {
    await this.db.runAsync("insert or replace into places (id, name, icon, latitude, longitude, radius_m, created_at) values (?, ?, ?, ?, ?, ?, ?)", [p.id, p.name, p.icon, p.latitude, p.longitude, p.radiusM, p.createdAt]);
  }
  async deletePlace(id: string) {
    await this.db.runAsync("delete from places where id = ?", [id]);
  }
  async placeEvents(fromTs: number, toTs: number) {
    const rows = await this.db.getAllAsync<PlaceEventRow>("select * from place_events where ts >= ? and ts < ? order by ts, id", [fromTs, toTs]);
    return rows.map((r): PlaceEvent => ({ id: r.id, placeId: r.place_id, kind: r.kind === "exit" ? "exit" : "enter", ts: r.ts, day: r.day }));
  }
  async addPlaceEvent(e: PlaceEvent) {
    await this.db.runAsync("insert or ignore into place_events (id, place_id, kind, ts, day) values (?, ?, ?, ?, ?)", [e.id, e.placeId, e.kind, e.ts, e.day]);
  }
  async locationFixes(fromTs: number, toTs: number) {
    const rows = await this.db.getAllAsync<FixRow>("select * from location_fixes where ts >= ? and ts < ? order by ts", [fromTs, toTs]);
    return rows.map((r): Fix => ({ ts: r.ts, latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracy_m }));
  }
  async addLocationFixes(fixes: Fix[]) {
    if (!fixes.length) return;
    await this.tx((db) => this.many(db, "insert or ignore into location_fixes (ts, latitude, longitude, accuracy_m) values (?, ?, ?, ?)", fixes.map((f) => [f.ts, f.latitude, f.longitude, f.accuracyM])));
  }
  async pruneLocationFixes(beforeTs: number) {
    const r = await this.db.runAsync("delete from location_fixes where ts < ?", [beforeTs]);
    return r.changes;
  }
  async frozenStays(from: string, to: string) {
    const rows = await this.db.getAllAsync<FrozenRow>("select * from timeline_stays where day >= ? and day <= ? order by start_ts", [from, to]);
    return rows.map((r): FrozenStay => ({ day: r.day, start: r.start_ts, end: r.end_ts, placeId: r.place_id, latitude: r.latitude, longitude: r.longitude, capped: !!r.capped }));
  }
  async moveBuckets(fromTs: number, toTs: number) {
    const rows = await this.db.getAllAsync<{ bucket: number; metres: number }>("select bucket, metres from timeline_moves where bucket >= ? and bucket < ? order by bucket", [Math.ceil(fromTs / MOVE_BUCKET_S), Math.ceil(toTs / MOVE_BUCKET_S)]);
    return rows.map((r): MoveBucket => ({ bucket: r.bucket, metres: r.metres }));
  }
  async freezeDay(day: string, stays: FrozenStay[], fromTs: number, toTs: number, buckets: MoveBucket[]) {
    await this.tx(async (db) => {
      await db.runAsync("delete from timeline_stays where day = ?", [day]);
      await db.runAsync("delete from timeline_moves where bucket >= ? and bucket < ?", [Math.ceil(fromTs / MOVE_BUCKET_S), Math.ceil(toTs / MOVE_BUCKET_S)]);
      await this.many(db, "insert or replace into timeline_stays (day, start_ts, end_ts, place_id, latitude, longitude, capped) values (?, ?, ?, ?, ?, ?, ?)", stays.map((x) => [day, x.start, x.end, x.placeId, x.latitude, x.longitude, bool(x.capped)]));
      await this.many(db, "insert or replace into timeline_moves (bucket, metres) values (?, ?)", buckets.map((b) => [b.bucket, b.metres]));
    });
  }
  async timelineOverrides(fromTs: number, toTs: number) {
    const rows = await this.db.getAllAsync<OverrideRow>("select * from timeline_overrides where start_ts < ? and end_ts > ? order by created_at, id", [toTs, fromTs]);
    return rows.map((r): TimelineOverride => ({ id: r.id, kind: r.kind === "clear" ? "clear" : "stay", start: r.start_ts, end: r.end_ts, placeId: r.place_id, label: r.label, latitude: r.latitude, longitude: r.longitude, createdAt: r.created_at }));
  }
  async putTimelineOverride(o: TimelineOverride) {
    await this.db.runAsync("insert or replace into timeline_overrides (id, kind, start_ts, end_ts, place_id, label, latitude, longitude, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", [o.id, o.kind, o.start, o.end, o.placeId, o.label, o.latitude, o.longitude, o.createdAt]);
  }
  async deleteTimelineOverride(id: string) {
    await this.db.runAsync("delete from timeline_overrides where id = ?", [id]);
  }
  async getTimelineState(): Promise<TimelineState> {
    return this.getTimelineStateIn(this.db);
  }
  async setTimelineState(patch: Partial<TimelineState>) {
    await this.tx(async (db) => {
      const cur = await this.getTimelineStateIn(db);
      const next = { ...cur, ...patch };
      await db.runAsync("insert or replace into timeline_state (id, mode, frozen_through) values (1, ?, ?)", [next.mode, next.frozenThrough]);
    });
  }
  private async getTimelineStateIn(db: SQLiteDatabase): Promise<TimelineState> {
    const r = await db.getFirstAsync<{ mode: string; frozen_through: string | null }>("select mode, frozen_through from timeline_state where id = 1");
    const mode = (TRACKING_MODES as readonly string[]).includes(r?.mode ?? "") ? (r!.mode as TrackingMode) : DEFAULT_MODE;
    return { mode, frozenThrough: r?.frozen_through ?? null };
  }
  async clearPlaces() {
    await this.tx(async (db) => {
      for (const t of ["places", "place_events", "location_fixes", "timeline_stays", "timeline_moves", "timeline_overrides", "timeline_state"]) await db.runAsync(`delete from ${t}`);
    });
  }

  async clearAll() {
    await this.tx(async (db) => {
      for (const t of TABLES) await db.runAsync(`delete from ${t}`);
    });
  }
  async clearGym() {
    await this.tx(async (db) => {
      for (const t of GYM_TABLES) await db.runAsync(`delete from ${t}`);
    });
  }
  async clearHabits() {
    await this.tx(async (db) => {
      await db.runAsync("delete from habit_entries");
      await db.runAsync("delete from habits");
    });
  }
}


// ── the gym log's row shapes ─────────────────────────────────────────────────────────────────────────────────────────
type GymExerciseRow = { id: string; name: string; body_part: string; equipment: string; custom: number; hold: number; unit: string; note: string | null };
type GymRoutineRow = { id: string; name: string; notes: string | null; position: number; updated_at: number };
type GymRoutineItemRow = { routine_id: string; exercise_id: string; position: number; sets: number; reps: number; rest_sec: number | null; note: string | null };
type GymSessionRow = {
  id: string; day: string; start_ts: number; end_ts: number | null; name: string; notes: string | null; routine_id: string | null;
  finished: number; rest_started_ts: number | null; rest_sec: number | null;
};
type GymSetRow = {
  id: string; session_id: string; exercise_id: string; position: number; set_no: number; weight_kg: number; reps: number;
  seconds: number | null; distance_m: number | null; rpe: number | null; type: string; superset_id: string | null; completed: number; ts: number | null; note: string | null;
};
type GymMeasurementRow = { id: string; day: string; kind: string; value: number };

// ── the habits' row shapes ─────────────────────────────────────────────────────────────────────────────────────────
type HabitRow = {
  id: string; name: string; question: string | null; notes: string | null; kind: string; color: string; period: string;
  interval_days: number; weekdays_only: number; start_day: string;
  target: number; target_type: string; unit: string | null; position: number; archived: number; created_at: number; updated_at: number;
};
type HabitEntryRow = { habit_id: string; day: string; value: number; skip: number; note: string | null; updated_at: number };
type PlaceRow = { id: string; name: string; icon: string; latitude: number; longitude: number; radius_m: number; created_at: number };
type PlaceEventRow = { id: string; place_id: string; kind: string; ts: number; day: string };
type FixRow = { ts: number; latitude: number; longitude: number; accuracy_m: number | null };
type FrozenRow = { day: string; start_ts: number; end_ts: number; place_id: string | null; latitude: number | null; longitude: number | null; capped: number };
type OverrideRow = { id: string; kind: string; start_ts: number; end_ts: number; place_id: string | null; label: string | null; latitude: number | null; longitude: number | null; created_at: number };
const placeOf = (r: PlaceRow): Place => ({ id: r.id, name: r.name, icon: r.icon as PlaceIcon, latitude: r.latitude, longitude: r.longitude, radiusM: r.radius_m, createdAt: r.created_at });
type FoodOrderRow = { id: string; key: string; day: string; ts: number; merchant: string; source: string };

const foodOrderOf = (r: FoodOrderRow): FoodOrder => ({ id: r.id, key: r.key, day: r.day, ts: r.ts, merchant: r.merchant, source: r.source });

const habitOf = (r: HabitRow): Habit => ({
  id: r.id,
  name: r.name,
  question: r.question,
  notes: r.notes,
  kind: r.kind === "numeric" ? "numeric" : "yes_no",
  color: r.color as Habit["color"],
  period: r.period === "week" ? "week" : r.period === "month" ? "month" : r.period === "interval" ? "interval" : "day",
  intervalDays: r.interval_days,
  weekdaysOnly: r.weekdays_only === 1,
  startDay: r.start_day,
  target: r.target,
  targetType: r.target_type === "at_most" ? "at_most" : "at_least",
  unit: r.unit,
  position: r.position,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const habitEntryOf = (r: HabitEntryRow): HabitEntry => ({
  habitId: r.habit_id,
  day: r.day,
  value: r.value,
  skip: r.skip === 1,
  note: r.note,
  updatedAt: r.updated_at,
});

const gymExerciseOf = (r: GymExerciseRow): GymExercise => ({
  id: r.id,
  name: r.name,
  bodyPart: r.body_part as GymExercise["bodyPart"],
  equipment: r.equipment as GymExercise["equipment"],
  custom: r.custom === 1,
  hold: r.hold === 1,
  unit: r.unit === "lb" ? "lb" : "kg",
  note: r.note,
});
const gymRoutineOf = (r: GymRoutineRow): GymRoutine => ({ id: r.id, name: r.name, notes: r.notes, position: r.position, updatedAt: r.updated_at });
const gymRoutineItemOf = (r: GymRoutineItemRow): GymRoutineItem => ({
  routineId: r.routine_id,
  exerciseId: r.exercise_id,
  position: r.position,
  sets: r.sets,
  reps: r.reps,
  restSec: r.rest_sec,
  note: r.note,
});
const gymSessionOf = (r: GymSessionRow): GymSession => ({
  id: r.id,
  day: r.day,
  startTs: r.start_ts,
  endTs: r.end_ts,
  name: r.name,
  notes: r.notes,
  routineId: r.routine_id,
  finished: r.finished === 1,
  restStartedTs: r.rest_started_ts,
  restSec: r.rest_sec,
});
const gymSetOf = (r: GymSetRow): GymSet => ({
  id: r.id,
  sessionId: r.session_id,
  exerciseId: r.exercise_id,
  position: r.position,
  setNo: r.set_no,
  weightKg: r.weight_kg,
  reps: r.reps,
  seconds: r.seconds,
  distanceM: r.distance_m,
  rpe: r.rpe,
  type: r.type as SetType,
  supersetId: r.superset_id,
  completed: r.completed === 1,
  ts: r.ts,
  note: r.note,
});
const gymMeasurementOf = (r: GymMeasurementRow): GymMeasurement => ({ id: r.id, day: r.day, kind: r.kind as GymMeasurement["kind"], value: r.value });

/** The gym log's tables, cleared only by "Delete everything": the import is the owner's history, not a source's rows. */
const GYM_TABLES = ["gym_exercises", "gym_routines", "gym_routine_items", "gym_sessions", "gym_sets", "gym_measurements", "gym_import"];

/** The bucketed sample tables: one row per UTC day of parallel offset and value arrays. */
type SampleTable = "hr_days" | "steps_days" | "hrv_days";

const TABLES = [
  "profile", "sync_state", "daily_metrics", "sleep_sessions", "sleep_segments", "exercises", "hr_days", "steps_days", "hrv_days", "daily_values",
  "journal_entries", "intraday_dirty", "daily_scores", "intraday_series", "reports", "activity_cost", "pipeline_checkpoint",
  "journal_tags", "logged_entries", "health_records", "blood_pressure_readings",
];

/** Opens (and migrates) the database. WAL with synchronous=normal: durable across crashes, no fsync per autocommit write. */
/**
 * Every handle gets its own native connection (`useNewConnection`). expo-sqlite otherwise hands the same cached native
 * database to every open of a name, and closes it when *any* JS handle to it is garbage-collected
 * (NativeDatabase.sharedObjectDidRelease → ref.close()): one dropped handle (a reopen, a second store opened by the
 * background task) then kills every other with "NativeDatabase.prepareAsync has been rejected → NullPointerException",
 * and a reopen just got the same dead connection back from the cache. WAL mode serves several connections; writes stay
 * serialised by the store's queue.
 *
 * `openDb` retries "database is locked": the headless background task opens its own store while a sync writes, and
 * maintenance can hold a VACUUM lock for seconds. Boot is the one place that must wait rather than fail, so the first
 * busy_timeout is 10 s and five more attempts follow a failed one. An already-open store is reused (see openStore), so
 * the two runtimes of a cold start do not race each other into a second schema write.
 *
 * The mode and auto-vacuum pragmas are read before they are written: `journal_mode = wal` takes an exclusive lock and
 * does not always wait on busy_timeout, so asking a database that is already WAL to switch could fail at once while the
 * background task was writing. A WAL database only needs the connection-local pragmas on a later open.
 */
const LOCK_RETRY_MS = [500, 1500, 3000, 5000, 5000] as const;
const isLocked = (e: unknown) => /database is locked|database table is locked|SQLITE_BUSY/i.test(e instanceof Error ? e.message : String(e));

async function openDb(name: string): Promise<SQLiteDatabase> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openDbOnce(name);
    } catch (e) {
      if (!isLocked(e) || attempt >= LOCK_RETRY_MS.length) throw e;
      console.warn(`[db] locked; retrying in ${LOCK_RETRY_MS[attempt]} ms`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS[attempt]));
    }
  }
}

const duplicateColumn = (e: unknown) => /duplicate column name|already exists/i.test(e instanceof Error ? e.message : String(e));

/** Applies the migrations a database has not seen, then records the new `user_version`. */
async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("pragma user_version");
  const done = row?.user_version ?? 0;
  for (let i = done; i < MIGRATIONS.length; i++) {
    try {
      await db.execAsync(MIGRATIONS[i].sql);
    } catch (e) {
      // Databases from before user_version tracking already have the column; anything else is a real failure.
      if (!duplicateColumn(e)) throw new Error(`[db] migration ${i + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await db.execAsync(`pragma user_version = ${i + 1}`);
  }
}

/** Fails the open when a column the app reads unconditionally is absent. */
async function verifySchema(db: SQLiteDatabase): Promise<void> {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const rows = await db.getAllAsync<{ name: string }>(`pragma table_info(${table})`);
    const have = new Set(rows.map((r) => r.name));
    for (const column of columns) if (!have.has(column)) throw new Error(`[db] ${table}.${column} is missing after the migrations`);
  }
}

async function openDbOnce(name: string): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(name, { useNewConnection: true });
  try {
    // busy_timeout first: every statement below may meet another connection's writer, and the wait belongs to SQLite,
    // not to a retry after the fact.
    await db.execAsync("pragma busy_timeout = 10000");
    // A JS reload mid-write (dev reloads, a crash) can leave the shared native connection inside our transaction.
    if (db.isInTransactionSync()) await db.execAsync("rollback");
    // Read the mode before setting it: on a database already in WAL, `journal_mode = wal` is a needless exclusive lock
    // that can fail instantly while the background task writes. auto_vacuum takes effect only before the file is first
    // written (setting WAL writes it), so it is set only on a database that is not in WAL yet.
    const mode = await db.getFirstAsync<{ journal_mode: string }>("pragma journal_mode");
    if (mode?.journal_mode?.toLowerCase() !== "wal") {
      const vacuum = await db.getFirstAsync<{ auto_vacuum: number }>("pragma auto_vacuum");
      if (vacuum?.auto_vacuum !== INCREMENTAL_VACUUM) await db.execAsync("pragma auto_vacuum = incremental");
      await db.execAsync("pragma journal_mode = wal");
    }
    await db.execAsync("pragma synchronous = normal; pragma foreign_keys = on;");
    await db.execAsync(SCHEMA);
    await migrate(db);
    await verifySchema(db);
    return db;
  } catch (e) {
    await db.closeAsync().catch(() => {});
    throw e;
  }
}

/** The database file. A new name: the drizzle-era `pulse.db` is never read (its rows came from the Google Health API). */
export const DB_NAME = "pulse-store.db";
/**
 * "Explore with sample data" lives in its own database: the demo seed overwrites every health table for 180 days, and
 * the person's own journal, logs and gym must survive the visit. Switching source opens one or the other
 * (src/state/app.ts); nothing is copied between them.
 */
export const DEMO_DB = "pulse-demo.db";
const LEGACY_DB = "pulse.db";

/** Deletes the drizzle-era database and its WAL files. Each is gone after the first launch, so later calls do nothing. */
async function deleteLegacyDb(): Promise<void> {
  for (const f of [LEGACY_DB, `${LEGACY_DB}-wal`, `${LEGACY_DB}-shm`]) await deleteDatabaseAsync(f).catch(() => {});
}

const opening = new Map<string, Promise<Store>>();

/**
 * The store for `name`, opened once per JS runtime. Boot and a background task that fires during boot would otherwise
 * open two connections and race their schema writes; both get this one. A failed open is not cached, so the error
 * screen's Try again can make a fresh attempt.
 */
export function openStore(name = DB_NAME): Promise<Store> {
  const already = opening.get(name);
  if (already) return already;
  const p = openStoreOnce(name);
  opening.set(name, p);
  void p.catch(() => {
    if (opening.get(name) === p) opening.delete(name);
  });
  return p;
}

async function openStoreOnce(name: string): Promise<Store> {
  if (name === DB_NAME) await deleteLegacyDb();
  return healing(new SqliteStore(await openDb(name)), name);
}

/**
 * A native connection that died under a long-lived JS runtime ("Call to function 'NativeDatabase.prepareAsync' has
 * been rejected → NullPointerException", or an access-closed error): seen on a phone after Android tore down and
 * recreated Pulse's native modules around a background sync while the JS kept its old handle. Every later call then
 * failed until Pulse was restarted, so syncs silently stopped. This reopens the database once and retries the call.
 */

function healing(store: SqliteStore, name: string): Store {
  let reopening: Promise<void> | null = null;
  const reopen = () =>
    (reopening ??= openDb(name)
      .then((db) => store.replaceDb(db))
      .finally(() => {
        reopening = null;
      }));
  return new Proxy(store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function" || prop === "replaceDb" || prop === "constructor") return v;
      return async (...args: unknown[]) => {
        try {
          return await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (e) {
          if (!isDeadConnection(e)) throw e;
          console.warn("[db] connection lost, reopening:", e instanceof Error ? e.message : String(e));
          await reopen();
          return (Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        }
      };
    },
  }) as Store;
}
