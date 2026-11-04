import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";
import type { RecordedWorkout, WorkoutSample } from "@/live/workout";

const session = { schemaVersion: 1, id: "local-1", type: "walk", status: "completed", startedAt: 100, endedAt: 200, activeMs: 100, revision: 1 } as RecordedWorkout;
const sample = { seq: 1, t: 100, elapsedMs: 0, epoch: 1, bpm: 100, rrMs: [] } satisfies WorkoutSample;
describe("personal workout ownership", () => {
  it("retains recordings during imported-data clearing and source/demo reset", async () => {
    const store = new MemoryStore();
    await store.workouts.ingest(session, [sample], 50);
    await store.clearImported({ from: "2026-10-01", to: "2026-10-29" }, 0, 9_999_999);
    await store.clearAll();
    expect(await store.workouts.get(session.id)).toEqual(session);
    expect(await store.workouts.samples(session.id)).toEqual([sample]);
  });
  it("replays journal chunks idempotently and keeps cursor with session data", async () => {
    const store = new MemoryStore().workouts;
    await store.ingest(session, [sample], 50);
    await store.ingest(session, [sample], 50);
    expect(await store.samples(session.id)).toHaveLength(1);
    expect(await store.cursor(session.id)).toBe(50);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
  it("keeps more than fifty sessions and pages history", async () => {
    const store = new MemoryStore().workouts;
    for (let i = 1; i <= 75; i++) await store.ingest({ ...session, id: `s-${i}`, startedAt: i }, [], 0);
    expect(await store.list(100)).toHaveLength(75);
    const first = await store.list(25);
    const second = await store.list(25, first.at(-1)!.startedAt);
    expect(first[0].startedAt).toBe(75);
    expect(second[0].startedAt).toBe(50);
  });
});
