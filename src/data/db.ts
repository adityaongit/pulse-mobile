// The Store on expo-sqlite. The schema mirrors Pulse's Postgres one (src/server/db/schema.ts) minus user ids:
// one person per database. JSON columns hold the score and series blobs; heart rate and steps are bucketed per
// UTC day like Pulse's hr_days / steps_days (parallel JSON arrays of second-of-day offsets and values), since a
// row per 1 Hz sample is far too slow over months. Every batch write runs in one exclusive transaction.
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { isDeadConnection } from "./deadConnection";
import type { CoachChatRow, DayRange, EntrySource, JournalTagChange, JournalTagRow, LoggedEntryRow, ReportRow, ScoreRow, SeriesKind, Store } from "./store";
import type {
  BloodPressurePosture,
  BloodPressureQuality,
  BloodPressureReading,
  BloodPressureReadingRow,
  BloodPressureSource,
  DailyValue,
  Exercise,
  HealthRecord,
  HrSample,
  HrvSample,
  JournalEntry,
  Metrics,
  Profile,
  Segment,
  Session,
  StepsMinute,
  SyncState,
} from "./types";
import type { ActivityCostResult } from "@/core/algorithms/activityCost";
import { minuteHr } from "@/core/engine/context";
import { slice } from "@/lib/yield";

const SCHEMA = `
create table if not exists profile (
  id integer primary key check (id = 1), birth_date text not null, sex text not null, max_hr real, height_cm real, time_zone text not null,
  waist_cm real
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
  health_monitor text, healthspan text, fitness text, journal_impact text, detected text, hrv_status text, training text,
  vascular_corridor text
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
  pulse_bpm real, posture text, source text,
  body_position text, measurement_location text, recording_method text, source_platform text, source_application text,
  source_device text, quality text not null, imported_at integer not null
);
create index if not exists blood_pressure_day on blood_pressure_readings (day);
create index if not exists blood_pressure_ts on blood_pressure_readings (ts);
create view if not exists blood_pressure as select * from blood_pressure_readings;
create table if not exists coach_chats (id text primary key, title text not null, messages text not null, created_at integer not null, updated_at integer not null);
create index if not exists coach_chats_recent on coach_chats (updated_at desc, id desc);
`;

/** Columns added after a release: each `alter` fails harmlessly on a database that already has it. */
const MIGRATIONS = [
  "alter table logged_entries add column source text not null default 'pulse'",
  "create index if not exists logged_entries_source_day on logged_entries (source, day)",
  // Auto-detected workouts (stage 1, mobile).
  "alter table daily_scores add column detected text",
  // Waist for the Nes 2011 VO2max estimate (mobile).
  "alter table profile add column waist_cm real",
  // HRV Status and Garmin-style training (Training Effect, Recovery Time, Training Readiness and Status), version 19.
  "alter table daily_scores add column hrv_status text",
  "alter table daily_scores add column training text",
  // The owner's display name and profile photo path (mobile).
  "alter table profile add column name text",
  "alter table profile add column photo text",
  // The sleep goal, JSON { hours, method } (Settings › Goals).
  "alter table profile add column sleep_goal text",
  // Heart-rate days compacted to one mean per minute (compactHr).
  "alter table hr_days add column minute integer not null default 0",
  // Units and the clock, JSON { units, hours } (Settings › App).
  "alter table profile add column display text",
  // Blood pressure readings (Health Connect).
  "create table if not exists blood_pressure_readings (id text primary key, ts integer not null, day text not null, systolic_mmhg real not null, diastolic_mmhg real not null, pulse_bpm real, posture text, source text, body_position text, measurement_location text, recording_method text, source_platform text, source_application text, source_device text, quality text not null, imported_at integer not null)",
  "create index if not exists blood_pressure_day on blood_pressure_readings (day)",
  "create index if not exists blood_pressure_ts on blood_pressure_readings (ts)",
  "create view if not exists blood_pressure as select * from blood_pressure_readings",
  "alter table daily_scores add column vascular_corridor text",
  "alter table blood_pressure_readings add column pulse_bpm real",
  "alter table blood_pressure_readings add column posture text",
  "alter table blood_pressure_readings add column source text",
];

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
  pulse_bpm: number | null;
  posture: string | null;
  source: string | null;
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
  journal_impact: string | null; detected: string | null; hrv_status: string | null; training: string | null; vascular_corridor: string | null;
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
  pulseBpm: r.pulse_bpm ?? null,
  posture: (r.posture as BloodPressurePosture | null) ?? null,
  source: (r.source as BloodPressureSource | null) ?? null,
  bodyPosition: r.body_position,
  measurementLocation: r.measurement_location,
  recordingMethod: r.recording_method,
  sourcePlatform: r.source_platform,
  sourceApplication: r.source_application,
  sourceDevice: r.source_device,
  quality: r.quality,
  importedAt: r.imported_at,
});

const bloodPressureReadingRowOf = (r: BloodPressureRow): BloodPressureReadingRow => ({
  id: r.id,
  timestampMs: r.ts * 1000,
  date: r.day,
  systolicMmHg: r.systolic_mmhg,
  diastolicMmHg: r.diastolic_mmhg,
  pulseBpm: r.pulse_bpm ?? null,
  posture:
    (r.posture as BloodPressurePosture | null) ??
    (r.body_position === "sitting" || r.body_position === "standing"
      ? r.body_position
      : r.body_position === "lying_down" || r.body_position === "reclining"
        ? "supine"
        : null),
  source:
    (r.source as BloodPressureSource | null) ?? "health_connect",
});

const SCORE_JSON = ["strain", "activities", "recovery", "sleep", "training_load", "strain_target", "sleep_planner", "energy_bank", "stress", "health_monitor", "healthspan", "fitness", "journal_impact", "detected", "hrv_status", "training", "vascular_corridor"] as const;
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
  vascular_corridor: parse(r.vascular_corridor),
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
      await db.runAsync("delete from blood_pressure_readings where day >= ? and day <= ? and (source is null or source != 'manual')", days);
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
          id, ts, day, systolic_mmhg, diastolic_mmhg, pulse_bpm, posture, source,
          body_position, measurement_location,
          recording_method, source_platform, source_application, source_device, quality, imported_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rows.map((r) => {
          const posture: BloodPressurePosture | null =
            r.posture ??
            (r.bodyPosition === "sitting" || r.bodyPosition === "standing"
              ? r.bodyPosition
              : r.bodyPosition === "lying_down" || r.bodyPosition === "reclining"
                ? "supine"
                : null);
              const source: BloodPressureSource = r.source ?? "health_connect";
          return [
            r.id,
            r.ts,
            r.day,
            r.systolicMmhg,
            r.diastolicMmhg,
            r.pulseBpm ?? null,
            posture,
            source,
            r.bodyPosition ?? null,
            r.measurementLocation ?? null,
            r.recordingMethod ?? null,
            r.sourcePlatform ?? null,
            r.sourceApplication ?? null,
            r.sourceDevice ?? null,
            r.quality,
            r.importedAt,
          ];
        }),
      ),
    );
  }

  async insertBloodPressure(records: BloodPressureReading[]) {
    return this.upsertBloodPressure(records);
  }

  async upsertBloodPressureReadings(rows: BloodPressureReadingRow[]) {
    if (!rows.length) return;
    const nowSec = Math.floor(Date.now() / 1000);
    await this.tx((db) =>
      this.many(
        db,
        `insert or replace into blood_pressure_readings (
          id, ts, day, systolic_mmhg, diastolic_mmhg, pulse_bpm, posture, source,
          body_position, measurement_location,
          recording_method, source_platform, source_application, source_device, quality, imported_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rows.map((r) => {
          const tsSec = Math.floor(r.timestampMs / 1000);
          const bodyPosition = r.posture === "supine" ? "lying_down" : r.posture;
          const quality: BloodPressureQuality = r.source === "manual" ? "manual" : "direct";
          return [
            r.id,
            tsSec,
            r.date,
            r.systolicMmHg,
            r.diastolicMmHg,
            r.pulseBpm ?? null,
            r.posture ?? null,
            r.source,
            bodyPosition ?? null,
            null,
            r.source === "manual" ? "manual_entry" : "active",
            r.source === "manual" ? "pulse" : "health_connect",
            null,
            null,
            quality,
            nowSec,
          ];
        }),
      ),
    );
  }

  async getBloodPressureReadings(upToDate?: string): Promise<BloodPressureReadingRow[]> {
    const rows =
      upToDate === undefined
        ? await this.db.getAllAsync<BloodPressureRow>(
            "select * from blood_pressure_readings order by ts asc, id asc",
          )
        : await this.db.getAllAsync<BloodPressureRow>(
            "select * from blood_pressure_readings where day <= ? order by ts asc, id asc",
            [upToDate],
          );
    return rows.map(bloodPressureReadingRowOf);
  }

  async deleteBloodPressureReading(id: string): Promise<void> {
    await this.tx((db) =>
      db.runAsync("delete from blood_pressure_readings where id = ?", [id]),
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

  async bloodPressureIn(range: DayRange): Promise<BloodPressureReading[]> {
    const rows = await this.db.getAllAsync<BloodPressureRow>(
      "select * from blood_pressure_readings where day >= ? and day <= ? order by ts desc, id desc",
      [range.from, range.to],
    );
    return rows.map(bloodPressureOf);
  }

  async readBloodPressure(fromTs: number, toTs: number): Promise<BloodPressureReading[]> {
    const rows = await this.db.getAllAsync<BloodPressureRow>(
      "select * from blood_pressure_readings where ts >= ? and ts < ? order by ts asc",
      [fromTs, toTs],
    );
    return rows.map(bloodPressureOf);
  }

  async getBloodPressure(day?: string): Promise<BloodPressureReading[]> {
    if (day !== undefined) {
      const rows = await this.db.getAllAsync<BloodPressureRow>(
        "select * from blood_pressure_readings where day = ? order by ts desc, id desc",
        [day],
      );
      return rows.map(bloodPressureOf);
    }
    return this.allBloodPressure();
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

  async clearAll() {
    await this.tx(async (db) => {
      for (const t of TABLES) await db.runAsync(`delete from ${t}`);
    });
  }
}

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
 */
async function openDb(name: string): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(name, { useNewConnection: true });
  // A JS reload mid-write (dev reloads, a crash) can leave the shared native connection inside our transaction.
  if (db.isInTransactionSync()) await db.execAsync("rollback");
  // busy_timeout: with a connection per handle, a write that meets another connection's lock waits instead of failing.
  // auto_vacuum first: it takes effect only before the file is first written (setting WAL writes it), so only on a new
  // database; an older one switches in reclaimSpace.
  await db.execAsync("pragma auto_vacuum = incremental");
  await db.execAsync("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  await db.execAsync(SCHEMA);
  for (const sql of MIGRATIONS) await db.execAsync(sql).catch(() => {});
  return db;
}

/** The database file. A new name: the drizzle-era `pulse.db` is never read (its rows came from the Google Health API). */
export const DB_NAME = "pulse-store.db";
const LEGACY_DB = "pulse.db";

/** Deletes the drizzle-era database and its WAL files. Each is gone after the first launch, so later calls do nothing. */
async function deleteLegacyDb(): Promise<void> {
  for (const f of [LEGACY_DB, `${LEGACY_DB}-wal`, `${LEGACY_DB}-shm`]) await deleteDatabaseAsync(f).catch(() => {});
}

export async function openStore(name = DB_NAME): Promise<Store> {
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
