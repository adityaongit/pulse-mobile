import { SqliteWorkoutStore } from "./workoutDb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { RecordedWorkout, WorkoutSample } from "@/live/workout";

const sql = vi.hoisted(() => ({ current: null as DatabaseSync | null }));
vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  return { openDatabaseAsync: async () => {
    const db = new DatabaseSync(":memory:");
    sql.current = db;
    const adapter = {
      execAsync: async (query: string) => { db.exec(query); },
      getFirstAsync: async (query: string, ...params: SQLInputValue[]) => db.prepare(query).get(...params) ?? null,
      getAllAsync: async (query: string, ...params: SQLInputValue[]) => db.prepare(query).all(...params),
      runAsync: async (query: string, ...params: SQLInputValue[]) => db.prepare(query).run(...params),
      closeAsync: async () => { db.close(); },
      withExclusiveTransactionAsync: async (run: (tx: unknown) => Promise<void>) => {
        db.exec("BEGIN IMMEDIATE");
        try { await run(adapter); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    };
    return adapter;
  } };
});

const session = { id: "local-1", startedAt: 100, status: "recording", revision: 1, seq: 1 } as RecordedWorkout;
const sample: WorkoutSample = { seq: 1, t: 100, elapsedMs: 0, epoch: 1, bpm: 140, rrMs: [] };
afterEach(() => { sql.current?.close(); sql.current = null; });
describe("workout SQLite transactions", () => {
  it("rolls back the session, samples and journal cursor together on a failed sample write", async () => {
    const store = new SqliteWorkoutStore();
    await store.ingest(session, [sample], 50);
    sql.current!.exec("CREATE TRIGGER reject_sample BEFORE INSERT ON workout_samples WHEN NEW.seq=2 BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(store.ingest({ ...session, revision: 2, seq: 2 }, [{ ...sample, seq: 2 }], 100)).rejects.toThrow("disk full");
    expect(await store.cursor(session.id)).toBe(50);
    expect((await store.get(session.id))?.revision).toBe(1);
    expect(await store.samples(session.id)).toHaveLength(1);
    sql.current!.exec("DROP TRIGGER reject_sample");
    await store.ingest({ ...session, revision: 2, seq: 2 }, [{ ...sample, seq: 2 }], 100);
    expect(await store.cursor(session.id)).toBe(100);
    expect(await store.samples(session.id)).toHaveLength(2);
  });
  it("deduplicates replay and never regresses completed metadata or its cursor", async () => {
    const store = new SqliteWorkoutStore();
    await store.ingest({ ...session, status: "completed", revision: 2 }, [sample], 100);
    await store.ingest(session, [sample], 50);
    expect((await store.get(session.id))?.status).toBe("completed");
    expect(await store.cursor(session.id)).toBe(100);
    expect(await store.samples(session.id)).toHaveLength(1);
  });
});
