import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { WorkoutStore } from "./workouts";
import type { RecordedWorkout, WorkoutSample } from "@/live/workout";

export class SqliteWorkoutStore implements WorkoutStore {
  private opening: Promise<SQLiteDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private db() {
    return this.opening ??= openDatabaseAsync("pulse-workouts.db", { useNewConnection: true }).then(async (db) => {
      try {
      await db.execAsync("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
      if (version > 1) throw new Error("unsupportedWorkoutSchema");
      if (version === 0) await db.withExclusiveTransactionAsync(async (tx) => tx.execAsync(`
        CREATE TABLE IF NOT EXISTS workout_sessions (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, body TEXT NOT NULL, cursor INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS workout_sessions_recent ON workout_sessions(started_at DESC);
        CREATE TABLE IF NOT EXISTS workout_samples (session_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session_id,seq));
        PRAGMA user_version=1;`));
      return db;
      } catch (error) { await db.closeAsync().catch(() => {}); throw error; }
    }).catch((error) => { this.opening = null; throw error; });
  }
  private write<T>(run: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => run(await this.db()));
    this.queue = task.catch(() => {});
    return task;
  }
  async get(id: string) {
    const row = await (await this.db()).getFirstAsync<{ body: string }>("SELECT body FROM workout_sessions WHERE id=?", id);
    return row ? JSON.parse(row.body) as RecordedWorkout : null;
  }
  async list(limit = 25, before = Number.MAX_SAFE_INTEGER) {
    const rows = await (await this.db()).getAllAsync<{ body: string }>("SELECT body FROM workout_sessions WHERE started_at<? ORDER BY started_at DESC LIMIT ?", before, limit);
    return rows.map((r) => JSON.parse(r.body) as RecordedWorkout);
  }
  async samples(id: string) {
    const rows = await (await this.db()).getAllAsync<{ body: string }>("SELECT body FROM workout_samples WHERE session_id=? ORDER BY seq", id);
    return rows.map((r) => JSON.parse(r.body) as WorkoutSample);
  }
  async cursor(id: string) {
    return (await (await this.db()).getFirstAsync<{ cursor: number }>("SELECT cursor FROM workout_sessions WHERE id=?", id))?.cursor ?? 0;
  }
  ingest(session: RecordedWorkout, samples: readonly WorkoutSample[], cursor: number): Promise<void> {
    return this.write((db) => db.withExclusiveTransactionAsync(async (tx) => {
      const previous = await tx.getFirstAsync<{ body: string; cursor: number }>("SELECT body,cursor FROM workout_sessions WHERE id=?", session.id);
      const old = previous ? JSON.parse(previous.body) as RecordedWorkout : null;
      const newest = old && (old.revision > session.revision || old.seq > session.seq || (old.status === "completed" && session.status !== "completed")) ? old : session;
      await tx.runAsync("INSERT INTO workout_sessions(id,started_at,body,cursor) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,cursor=excluded.cursor", session.id, session.startedAt, JSON.stringify(newest), Math.max(previous?.cursor ?? 0, cursor));
      for (const s of samples) await tx.runAsync("INSERT OR IGNORE INTO workout_samples(session_id,seq,body) VALUES(?,?,?)", session.id, s.seq, JSON.stringify(s));
    }));
  }
  clear(): Promise<void> {
    return this.write((db) => db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync("DELETE FROM workout_samples; DELETE FROM workout_sessions;");
    }));
  }
}
