// The storage contract every layer talks to: the importer writes rows, the pipeline reads rows and writes scores,
// the screen queries read both. One implementation on expo-sqlite (db.ts); tests may use an in-memory one.
import type { BloodPressureReading, DailyValue, Exercise, HealthRecord, HrSample, HrvSample, JournalEntry, Metrics, Profile, Segment, Session, StepsMinute, SyncState } from "./types";
import type { Stage1Activity, Stage1Day, Stage2Row } from "@/pipeline/types";
import type { Report } from "@/core/algorithms/reports";
import type { ActivityCostResult } from "@/core/algorithms/activityCost";
import type { DetectedActivity } from "@/core/algorithms/autoWorkout";

export type DayRange = { from: string; to: string };

export interface Store {
  // Profile and sync
  getProfile(): Promise<Profile | null>;
  setProfile(p: Profile): Promise<void>;
  getSyncState(): Promise<SyncState>;
  setSyncState(s: Partial<SyncState>): Promise<void>;

  // Rows (upsert by primary key; the importer re-reads the last few days each sync)
  upsertMetrics(rows: Metrics[]): Promise<void>;
  upsertSessions(rows: Session[], segments: Segment[]): Promise<void>;
  upsertExercises(rows: Exercise[]): Promise<void>;
  /**
   * Samples are keyed by ts; re-imports overwrite. Each put says whether any sample was new or had another value, so a
   * sync that brings the same samples again leaves its days out of stage 1.
   */
  putHr(samples: HrSample[]): Promise<boolean>;
  putSteps(minutes: StepsMinute[]): Promise<boolean>;
  /** HRV samples, keyed by ts like heart rate; re-imports overwrite. */
  putHrv(samples: HrvSample[]): Promise<boolean>;
  upsertDailyValues(rows: DailyValue[]): Promise<void>;
  /**
   * Replaces the `keys` of the days in `range` with `rows`: a day the source no longer has anything for loses its value
   * (a food entry deleted in Health Connect must not leave the day's calories behind). Other keys are untouched.
   */
  replaceDailyValues(range: DayRange, keys: readonly string[], rows: DailyValue[]): Promise<void>;
  setJournal(entry: JournalEntry): Promise<void>;
  deleteJournal(day: string, tag: string): Promise<void>;
  /**
   * Drops what an importer wrote for the days in `range` (daily metrics, sleep sessions and their segments, workouts,
   * daily values and health records, by their `day`), the Health Connect log entries there (`source:
   * "health_connect"`), the heart-rate, HRV and step samples with fromTs <= ts < toTs, and those days' scores and series,
   * before a re-import (or the other source) writes them afresh. Pulse's own logs, the journal and the profile stay.
   */
  clearImported(range: DayRange, fromTs: number, toTs: number, opts?: { keepScores?: boolean }): Promise<void>;
  /** Removes sleep sessions and their segments by id: nights the source no longer has (deleted in Fitbit). */
  deleteSessions(ids: string[]): Promise<void>;
  /** Removes workouts by id: workouts the source no longer has. */
  deleteExercises(ids: string[]): Promise<void>;
  /** ECG readings and irregular-rhythm notifications (Google Health only), upserted by id. */
  upsertHealthRecords(rows: HealthRecord[]): Promise<void>;
  /** Paired blood pressure readings, upserted by id. */
  upsertBloodPressure(rows: BloodPressureReading[]): Promise<void>;
  /** Alias for upsertBloodPressure. */
  insertBloodPressure(records: BloodPressureReading[]): Promise<void>;
  /** Days whose intraday samples changed since the pipeline last ran (stage 1 reruns them). */
  markIntradayDirty(days: string[]): Promise<void>;
  takeIntradayDirty(): Promise<string[]>;

  // Reads
  allMetrics(): Promise<Metrics[]>;
  allSessions(): Promise<Session[]>;
  segmentsFor(sessionIds: string[]): Promise<Segment[]>;
  allExercises(): Promise<Exercise[]>;
  allJournal(): Promise<JournalEntry[]>;
  dailyValues(range?: DayRange): Promise<DailyValue[]>;
  /** Health records with day <= `toDay` (every one without), newest first. */
  healthRecords(toDay?: string): Promise<HealthRecord[]>;
  /** All blood pressure readings, newest first. */
  allBloodPressure(): Promise<BloodPressureReading[]>;
  /** Blood pressure readings with day in range, newest first. */
  bloodPressureIn(range: DayRange): Promise<BloodPressureReading[]>;
  /** Blood pressure readings with fromTs <= ts < toTs, ascending. */
  readBloodPressure(fromTs: number, toTs: number): Promise<BloodPressureReading[]>;
  /** Blood pressure readings for a day, or all if omitted, newest first. */
  getBloodPressure(day?: string): Promise<BloodPressureReading[]>;
  /** HR with lo <= ts < hi, ascending. */
  readHr(lo: number, hi: number): Promise<HrSample[]>;
  readSteps(lo: number, hi: number): Promise<StepsMinute[]>;
  /** HRV with lo <= ts < hi, ascending. */
  readHrv(lo: number, hi: number): Promise<HrvSample[]>;
  hrBounds(): Promise<{ first: number; last: number } | null>;

  // Scores (JSON blobs per day, the pipeline's memo and the screens' source)
  getScores(day: string): Promise<ScoreRow | null>;
  scoresIn(range: DayRange): Promise<ScoreRow[]>;
  putScores(row: ScoreRow): Promise<void>;
  getSeries(day: string, kind: SeriesKind): Promise<(number | null)[] | null>;
  /** An empty `data` removes the series (a day with no Energy Bank curve), so getSeries returns null for it. */
  putSeries(day: string, kind: SeriesKind, data: (number | null)[]): Promise<void>;

  // Journal behaviours (Pulse's `journal_tags`: what the check-in asks about)
  /** Every tag, hidden ones included, in check-in order: position, then insertion order. */
  journalTags(): Promise<JournalTagRow[]>;
  /** Inserts each row whose tag is new, after every existing one in insertion order; existing tags are left alone. Returns the tags inserted. */
  insertJournalTags(rows: JournalTagRow[]): Promise<string[]>;
  /** Sets `hidden` and/or `position` on existing tags, in one transaction; unknown tags are skipped. */
  updateJournalTags(changes: JournalTagChange[]): Promise<void>;

  // Entries logged in Pulse (Pulse's `logged_entries`). Kept on the phone only: nothing is written to Health Connect.
  // Entries the sync brings from Health Connect (water, food and cycle logs made in Fitbit) sit in the same table with
  // `source: "health_connect"`, read-only: Pulse never deletes them one by one, and never writes them back.
  addLoggedEntries(rows: LoggedEntryRow[]): Promise<void>;
  /** Entries of every source with ts >= fromTs, newest first (ts, then createdAt, descending), at most `limit`. */
  loggedEntries(fromTs: number, limit?: number): Promise<LoggedEntryRow[]>;
  /** Deletes one entry; returns it, or null when there was none. */
  deleteLoggedEntry(id: string): Promise<LoggedEntryRow | null>;
  /**
   * Replaces the Health Connect entries of the days in `range` with `rows` (each stored as `source: "health_connect"`,
   * whatever it says): what the source no longer has disappears. Rows outside the range are upserted by id.
   */
  replaceExternalEntries(range: DayRange, rows: LoggedEntryRow[]): Promise<void>;

  // Reports (Pulse's `reports` table: one ISO-week or month summary per period, rebuilt by every stage-2 run)
  getReports(): Promise<ReportRow[]>;
  /** Replaces the whole set: periods not in `rows` are dropped. */
  putReports(rows: ReportRow[]): Promise<void>;

  // Activity Cost (mobile): what each kind of workout costs next-morning Recovery, over all history; one row, rebuilt
  // by stage 2, null before its first run.
  getActivityCost(): Promise<ActivityCostResult | null>;
  putActivityCost(data: ActivityCostResult): Promise<void>;

  // Stage 2's resume point (src/pipeline/checkpoint.ts owns its JSON): one row, null when there is none. Kept in the
  // database so a background run, or the first run after a launch, starts near the end instead of replaying every day.
  getCheckpoint(): Promise<string | null>;
  putCheckpoint(json: string | null): Promise<void>;

  // Coach chats (halo's coach.db, here in the one store). `messages` is the AI SDK's UIMessage[] as stored; the
  // coach (src/coach/storage.ts) owns its shape. clearAll leaves them, as halo's separate file did.
  /** Newest first (updatedAt, then id, descending), after `before` when given; at most `limit`. */
  coachChats(limit: number, before?: { updatedAt: number; id: string }): Promise<CoachChatRow[]>;
  coachChatCount(): Promise<number>;
  coachChatMessages(id: string): Promise<unknown[] | null>;
  /** Upserts by id; a new chat's createdAt is `updatedAt`. */
  putCoachChat(id: string, title: string, messages: unknown[], updatedAt: number): Promise<void>;
  /** Deletes one chat, or every chat without an id. */
  deleteCoachChats(id?: string): Promise<void>;

  /** Drops every row (settings › disconnect, or switching demo ↔ Health Connect). */
  clearAll(): Promise<void>;

  // Upkeep (src/background/maintenance.ts)
  /**
   * Turns each raw heart-rate day (UTC bucket) that ends at or before `beforeTs` into one rounded mean per minute, a
   * day per transaction, oldest first. Returns how many days it compacted. Writing a day's samples again (a
   * re-import) makes it raw again, and the next call compacts it again.
   */
  compactHr(beforeTs: number): Promise<number>;
  /** Gives the space freed by deletes and compaction back to the phone. */
  reclaimSpace(): Promise<void>;
  /** The database's size on the phone in bytes; null for a store that keeps nothing on disk. */
  storageBytes(): Promise<number | null>;
}

/** A coach chat in the list: its title follows the first question. `updatedAt` is unix seconds. */
export type CoachChatRow = { id: string; title: string; updatedAt: number };

export type SeriesKind = "hr" | "still_hr" | "stress" | "energy_bank";

/** Mirrors Pulse's journal_tags: a behaviour the check-in can ask about. Defaults are never removed, only hidden. */
export type JournalTagRow = { tag: string; label: string; isDefault: boolean; hidden: boolean; position: number };
export type JournalTagChange = { tag: string; hidden?: boolean; position?: number };

/** Where a logged entry was made: in Pulse's Journal, or in another app (Fitbit) and read from Health Connect. */
export type EntrySource = "pulse" | "health_connect";

/**
 * Mirrors Pulse's logged_entries minus `google_name` (nothing leaves the phone). `type` is a LogType
 * (src/queries/_lib.ts); `data` is that type's LogData (src/queries/log.ts), stored as JSON.
 */
export type LoggedEntryRow = { id: string; type: string; ts: number; day: string; data: unknown; createdAt: number; source: EntrySource };

/** Mirrors Pulse's reports: `period` is `2026-W40` or `2026-10`. */
export type ReportRow = { period: string; data: Report };

/** Mirrors Pulse's daily_scores: stage-1 and stage-2 outputs for one day, typed by the pipeline's own types. */
export type ScoreRow = {
  day: string;
  scoringVersion: number;
  /** Stage 1. */
  strain: Stage1Day | null;
  activities: Stage1Activity[] | null;
  sessionRhrBpm: number | null;
  /** Stage 1 (mobile): stretches of elevated HR with no workout recorded, shown only; absent on rows stored before it. */
  detected?: DetectedActivity[] | null;
  /** Stage 2, keyed like Pulse's daily_scores columns; every column is null until stage 2 has run for the day. */
  recovery: Stage2Row["recovery"] | null;
  sleep: Stage2Row["sleep"] | null;
  training_load: Stage2Row["training_load"] | null;
  strain_target: Stage2Row["strain_target"] | null;
  sleep_planner: Stage2Row["sleep_planner"] | null;
  energy_bank: Stage2Row["energy_bank"] | null;
  stress: Stage2Row["stress"] | null;
  health_monitor: Stage2Row["health_monitor"] | null;
  healthspan: Stage2Row["healthspan"] | null;
  fitness: Stage2Row["fitness"] | null;
  journal_impact: Stage2Row["journal_impact"] | null;
  /** Version 19; absent on rows stored before. */
  hrv_status?: Stage2Row["hrv_status"] | null;
  training?: Stage2Row["training"] | null;
};
