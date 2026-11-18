// The SQLite Store's contract: the same assertions the MemoryStore tests imply, run against the real SQL through
// node:sqlite. The native module is replaced by a small adapter; the schema, migrations, queries and JSON columns are
// the production code. This catches a wrong column, order, range or unit that MemoryStore cannot.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Metrics } from "./types";
import type { ScoreRow, Store } from "./store";
import type { Habit } from "@/core/habits/types";

/** The slice of expo-sqlite's SQLiteDatabase SqliteStore uses, over node:sqlite's synchronous in-memory database. */
class FakeDb {
  private readonly db: any;
  constructor(Database: new (path: string) => unknown) {
    this.db = new Database(":memory:");
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
    const r = this.db.prepare(sql).run(...params) as { lastInsertRowid: number | bigint; changes: number | bigint };
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  async prepareAsync(sql: string) {
    const st = this.db.prepare(sql);
    return {
      executeAsync: async (params: unknown[] = []) => {
        st.run(...params);
      },
      finalizeAsync: async () => {},
    };
  }
  async closeAsync() {
    this.db.close();
  }
  isInTransactionSync() {
    return false;
  }
}

vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  return {
    openDatabaseAsync: async () => new FakeDb(DatabaseSync as unknown as new (path: string) => unknown),
    deleteDatabaseAsync: async () => {},
  };
});

const metrics = (day: string, steps: number): Metrics => ({
  day,
  hrvMs: null,
  hrvDeepMs: null,
  rhrBpm: null,
  respBpm: null,
  nightlyTempC: null,
  spo2Pct: null,
  vo2maxDaily: null,
  vo2maxRun: null,
  steps,
  calories: null,
  weightKg: null,
  bodyFatPct: null,
  hrZones: [1, 2, 3],
  lightModerateMin: null,
  vigorousPeakMin: null,
  tempBaselineC: null,
  tempSdC: null,
  rhrRangeLow: null,
  rhrRangeHigh: null,
  hrvRangeLow: null,
  hrvRangeHigh: null,
});

const score = (day: string, scoringVersion: number): ScoreRow => ({
  day,
  scoringVersion,
  strain: null,
  activities: null,
  sessionRhrBpm: null,
  recovery: null,
  sleep: null,
  training_load: null,
  strain_target: null,
  sleep_planner: null,
  energy_bank: null,
  stress: null,
  health_monitor: null,
  healthspan: null,
  fitness: null,
  journal_impact: null,
});

describe("SqliteStore contract", () => {
  let store: Store;
  let n = 0;

  beforeAll(async () => {
    const { openStore } = await import("./db");
    store = await openStore(`contract-${process.pid}-${n++}.db`);
  });

  it("keeps daily metrics by day, with JSON columns intact", async () => {
    await store.upsertMetrics([metrics("2026-10-02", 2222), metrics("2026-10-01", 1111)]);
    const all = await store.allMetrics();
    expect(all.map((m) => [m.day, m.steps])).toEqual([
      ["2026-10-01", 1111],
      ["2026-10-02", 2222],
    ]);
    expect(all[0].hrZones).toEqual([1, 2, 3]);
  });

  it("reads a score range in day order and round-trips its JSON", async () => {
    await store.putScores({ ...score("2026-10-02", 30), recovery: { value: 66 } as ScoreRow["recovery"] });
    await store.putScores({ ...score("2026-10-01", 30), recovery: { value: 55 } as ScoreRow["recovery"] });
    const rows = await store.scoresIn({ from: "2026-10-01", to: "2026-10-02" });
    expect(rows.map((r) => [r.day, r.recovery?.value])).toEqual([
      ["2026-10-01", 55],
      ["2026-10-02", 66],
    ]);
    expect(rows[0].strain).toBeNull();
  });

  it("replaces a journal answer and deletes it on null", async () => {
    await store.setJournal({ day: "2026-10-01", tag: "alcohol", value: 1 });
    await store.setJournal({ day: "2026-10-01", tag: "alcohol", value: 2 });
    expect(await store.allJournal()).toEqual([{ day: "2026-10-01", tag: "alcohol", value: 2 }]);
    await store.deleteJournal("2026-10-01", "alcohol");
    expect(await store.allJournal()).toEqual([]);
  });

  it("reads logged entries since a timestamp, newest first, with the limit", async () => {
    const entry = (id: string, ts: number) => ({ id, type: "weight" as const, ts, day: "2026-10-01", data: { kg: 70 }, createdAt: ts, source: "pulse" as const });
    await store.addLoggedEntries([entry("a", 100), entry("b", 300), entry("c", 200)]);
    expect((await store.loggedEntries(0, 10)).map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect((await store.loggedEntries(150, 10)).map((e) => e.id)).toEqual(["b", "c"]);
    expect((await store.loggedEntries(0, 2)).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("reads only the streak's fields from a score row", async () => {
    await store.putScores({ ...score("2026-10-05", 30), strain: { hrCount: 312, hrMinutesAm: 280, hrMinutesPm: 240 } as ScoreRow["strain"] });
    expect(await store.wornDays({ from: "2026-10-05", to: "2026-10-05" })).toEqual([{ day: "2026-10-05", hrCount: 312, hrMinutesAm: 280, hrMinutesPm: 240 }]);
    expect(await store.wornDays({ from: "2026-10-06", to: "2026-10-06" })).toEqual([]);
  });

  it("keeps habits and their days, replaces a day, and deletes the entries with the habit", async () => {
    const habit: Habit = {
      id: "h1", name: "Read", question: null, notes: null, kind: "yes_no", color: "optimal", period: "week", target: 3,
      intervalDays: 1, weekdaysOnly: false, startDay: "2026-10-26",
      targetType: "at_least", unit: null, position: 0, archived: false, createdAt: 1, updatedAt: 1,
    };
    await store.putHabit(habit);
    await store.putHabitEntry({ habitId: "h1", day: "2026-11-01", value: 1, skip: false, note: null, updatedAt: 1 });
    await store.putHabitEntry({ habitId: "h1", day: "2026-11-02", value: 1, skip: false, note: null, updatedAt: 1 });
    expect(await store.habits()).toEqual([habit]);
    expect((await store.habitEntries("2026-11-02", "2026-11-02")).map((e) => e.day)).toEqual(["2026-11-02"]);
    await store.putHabitEntry({ habitId: "h1", day: "2026-11-02", value: 0, skip: true, note: "rest", updatedAt: 2 });
    expect((await store.habitEntries()).find((e) => e.day === "2026-11-02")).toMatchObject({ value: 0, skip: true, note: "rest" });
    await store.deleteHabit("h1");
    expect(await store.habits()).toEqual([]);
    expect(await store.habitEntries()).toEqual([]);
  });

  it("keeps the timeline's places, events, fixes, frozen days, edits and state", async () => {
    const home = { id: "home", name: "Home", icon: "home" as const, latitude: 12.97, longitude: 77.59, radiusM: 150, createdAt: 1 };
    await store.putPlace(home);
    await store.putPlace({ ...home, id: "gym", name: "Gym", icon: "gym", createdAt: 2 });
    expect((await store.places()).map((p) => p.id)).toEqual(["home", "gym"]);
    await store.deletePlace("gym");
    expect(await store.places()).toEqual([home]);

    await store.addPlaceEvent({ id: "a", placeId: "home", kind: "enter", ts: 100, day: "2026-11-12" });
    await store.addPlaceEvent({ id: "b", placeId: "home", kind: "exit", ts: 200, day: "2026-11-12" });
    await store.addPlaceEvent({ id: "b", placeId: "home", kind: "exit", ts: 200, day: "2026-11-12" });
    expect((await store.placeEvents(100, 300)).map((e) => [e.id, e.kind])).toEqual([["a", "enter"], ["b", "exit"]]);

    await store.addLocationFixes([{ ts: 50, latitude: 1, longitude: 2, accuracyM: 10 }, { ts: 60, latitude: 1, longitude: 2, accuracyM: null }]);
    await store.addLocationFixes([{ ts: 50, latitude: 9, longitude: 9, accuracyM: 99 }]);
    expect(await store.locationFixes(0, 100)).toEqual([{ ts: 50, latitude: 1, longitude: 2, accuracyM: 10 }, { ts: 60, latitude: 1, longitude: 2, accuracyM: null }]);
    expect(await store.pruneLocationFixes(55)).toBe(1);

    await store.freezeDay("2026-11-12", [{ day: "2026-11-12", start: 0, end: 600, placeId: "home", latitude: 12.97, longitude: 77.59, capped: true }], 0, 86_400, [{ bucket: 3, metres: 120 }]);
    await store.freezeDay("2026-11-12", [{ day: "2026-11-12", start: 0, end: 900, placeId: null, latitude: 1, longitude: 2, capped: false }], 0, 86_400, [{ bucket: 4, metres: 80 }]);
    expect(await store.frozenStays("2026-11-12", "2026-11-12")).toEqual([{ day: "2026-11-12", start: 0, end: 900, placeId: null, latitude: 1, longitude: 2, capped: false }]);
    expect(await store.moveBuckets(0, 86_400)).toEqual([{ bucket: 4, metres: 80 }]);

    const o = { id: "o1", kind: "stay" as const, start: 100, end: 500, placeId: "home", label: null, latitude: null, longitude: null, createdAt: 7 };
    await store.putTimelineOverride(o);
    expect(await store.timelineOverrides(400, 1000)).toEqual([o]);
    expect(await store.timelineOverrides(500, 1000)).toEqual([]);
    await store.deleteTimelineOverride("o1");
    expect(await store.timelineOverrides(0, 1000)).toEqual([]);

    expect(await store.getTimelineState()).toEqual({ mode: "balanced", frozenThrough: null });
    await store.setTimelineState({ mode: "precise" });
    await store.setTimelineState({ frozenThrough: "2026-11-12" });
    expect(await store.getTimelineState()).toEqual({ mode: "precise", frozenThrough: "2026-11-12" });

    await store.clearPlaces();
    expect(await store.places()).toEqual([]);
    expect(await store.placeEvents(0, 1000)).toEqual([]);
    expect(await store.getTimelineState()).toEqual({ mode: "balanced", frozenThrough: null });
  });

  it("keeps food orders and replaces a follow-up by key", async () => {
    const order = { id: "o1", key: "id:123456", day: "2026-11-02", ts: 1, merchant: "Biryani Blues", source: "SWIGGY" };
    await store.putFoodOrder(order);
    expect(await store.foodOrders("2026-11-02", "2026-11-02")).toEqual([order]);
    await store.putFoodOrder({ ...order, id: "o2", ts: 2 });
    expect(await store.foodOrders()).toEqual([{ ...order, id: "o2", ts: 2 }]);
    await store.clearFoodOrders();
    expect(await store.foodOrders()).toEqual([]);
  });

  it("writes a first set list in one batch", async () => {
    const base = {
      sessionId: "s1",
      exerciseId: "e1",
      position: 0,
      weightKg: 20,
      reps: 5,
      seconds: null,
      distanceM: null,
      rpe: null,
      type: "normal" as const,
      supersetId: null,
      completed: false,
      ts: null,
      note: null,
    };
    await store.putGymSets([
      { ...base, id: "g1", setNo: 1 },
      { ...base, id: "g2", setNo: 2 },
    ]);
    expect((await store.gymSets(["s1"])).map((x) => x.id)).toEqual(["g1", "g2"]);
  });

  it("knows when scoring is needed", async () => {
    expect(await store.needsScoring("2026-10-02", 30)).toBe(false);
    expect(await store.needsScoring("2026-10-03", 30)).toBe(true);
    expect(await store.needsScoring("2026-10-02", 31)).toBe(true);
    await store.markIntradayDirty(["2026-10-02"]);
    expect(await store.needsScoring("2026-10-02", 30)).toBe(true);
  });

  it("clearAll removes health, journal and logs but keeps the coach's chats", async () => {
    await store.putCoachChat("chat-1", "A question", [{ role: "user", content: "hi" }], 100);
    await store.clearAll();
    expect(await store.allMetrics()).toEqual([]);
    expect(await store.allJournal()).toEqual([]);
    expect(await store.loggedEntries(0, 10)).toEqual([]);
    expect(await store.coachChatCount()).toBe(1);
    await store.deleteCoachChats();
    expect(await store.coachChatCount()).toBe(0);
  });
});
