// The office geofence of earlier builds becomes a saved place of the timeline when the database opens: its spot and
// its events move, the profile column is emptied and the old table goes. Run on node:sqlite over the real migrations.
import { describe, expect, it, vi } from "vitest";

let seed: ((db: any) => void) | null = null;

vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  class FakeDb {
    readonly db: any;
    constructor() {
      this.db = new DatabaseSync(":memory:");
      seed?.(this.db);
    }
    async execAsync(sql: string) {
      this.db.exec(sql);
    }
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
    }
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return this.db.prepare(sql).all(...params) as T[];
    }
    async runAsync(sql: string, params: unknown[] = []) {
      const r = this.db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    }
    async prepareAsync(sql: string) {
      const st = this.db.prepare(sql);
      return { executeAsync: async (params: unknown[] = []) => void st.run(...params), finalizeAsync: async () => {} };
    }
    async closeAsync() {
      this.db.close();
    }
    isInTransactionSync() {
      return false;
    }
  }
  return { openDatabaseAsync: async () => new FakeDb(), deleteDatabaseAsync: async () => {} };
});

describe("the office migration", () => {
  it("moves the office and its events into the timeline", async () => {
    seed = (db) => {
      // A database from before user_version tracking: the migrations all run, and the columns it has are accepted.
      db.exec(`
        create table profile (id integer primary key check (id = 1), birth_date text not null, sex text not null, max_hr real, height_cm real, time_zone text not null, office text);
        create table office_events (id text primary key, kind text not null, ts integer not null, day text not null);
        insert into profile (id, birth_date, sex, time_zone, office) values (1, '1990-01-01', 'male', 'Asia/Kolkata', '{"latitude":12.9716,"longitude":77.5946,"habitId":"h1"}');
        insert into office_events values ('e1', 'enter', 100, '2026-11-12'), ('e2', 'exit', 900, '2026-11-12');
      `);
    };
    const { openStore } = await import("./db");
    const store = await openStore("migration.db");
    const [office] = await store.places();
    expect(office).toMatchObject({ id: "office", name: "Office", icon: "work", latitude: 12.9716, longitude: 77.5946, radiusM: 200 });
    expect((await store.placeEvents(0, 1000)).map((e) => [e.id, e.placeId, e.kind])).toEqual([
      ["e1", "office", "enter"],
      ["e2", "office", "exit"],
    ]);
    expect(await store.getProfile()).toMatchObject({ birthDate: "1990-01-01", timeZone: "Asia/Kolkata" });
    expect(await store.getProfile()).not.toHaveProperty("office");
  });
});
