// A template update's preview: what the update adds, removes, skips and reshapes, before the action writes it.
import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import type { GymSet } from "@/core/gym/types";
import type { QueryCtx } from "./ctx";
import { getGymRoutineUpdate } from "./gym";

const NOW = Date.parse("2026-11-02T09:00:00Z") / 1000;
const PROFILE = { birthDate: "1990-01-01", sex: "male" as const, maxHr: null, heightCm: null, timeZone: "UTC" };
let store: Store;
const ctx = (): QueryCtx => ({ store, profile: PROFILE, timeZone: "UTC", today: "2026-11-02", now: NOW, sync: { lastSyncTs: null, firstDay: null, lastError: null } });

const set = (exerciseId: string, setNo: number, completed: boolean, reps = 8): GymSet => ({
  id: `${exerciseId}-${setNo}`,
  sessionId: "s1",
  exerciseId,
  position: 0,
  setNo,
  weightKg: 60,
  reps,
  seconds: null,
  distanceM: null,
  rpe: null,
  type: "normal",
  supersetId: null,
  completed,
  ts: completed ? NOW : null,
  note: null,
});

beforeEach(async () => {
  store = openMemoryStore();
  await store.putGymRoutine({ id: "r1", name: "Push", notes: null, position: 0, updatedAt: NOW }, [
    { routineId: "r1", exerciseId: "bench-press-barbell", position: 0, sets: 4, reps: 8, restSec: null, note: null },
    { routineId: "r1", exerciseId: "bent-over-row-barbell", position: 1, sets: 3, reps: 10, restSec: null, note: null },
    { routineId: "r1", exerciseId: "squat-barbell", position: 2, sets: 5, reps: 5, restSec: null, note: null },
    { routineId: "r1", exerciseId: "bicep-curl-cable", position: 3, sets: 3, reps: 10, restSec: null, note: null },
  ]);
  await store.putGymSession({ id: "s1", day: "2026-11-02", startTs: NOW - 3000, endTs: null, name: "Push", notes: null, routineId: "r1", finished: false, restStartedTs: null, restSec: null });
  await store.putGymSets([
    set("bench-press-barbell", 1, true),
    set("bench-press-barbell", 2, true),
    set("bench-press-barbell", 3, false),
    set("bench-press-barbell", 4, false),
    set("bent-over-row-barbell", 1, false),
    set("bent-over-row-barbell", 2, false),
    set("bent-over-row-barbell", 3, false),
    set("bicep-curl-cable", 1, true, 10),
    set("bicep-curl-cable", 2, true, 10),
    set("bicep-curl-cable", 3, true, 10),
    set("lateral-raise-dumbbell", 1, true),
    set("lateral-raise-dumbbell", 2, true),
  ]);
});

describe("getGymRoutineUpdate", () => {
  it("separates added, removed, skipped, changed and kept exercises", async () => {
    const update = await getGymRoutineUpdate(ctx(), "s1");
    expect(update?.added.map((i) => [i.exercise.name, i.sets, i.reps])).toEqual([["Lateral Raise (Dumbbell)", 2, 8]]);
    expect(update?.removed.map((i) => [i.exercise.name, i.sets, i.reps])).toEqual([["Squat (Barbell)", 5, 5]]);
    expect(update?.skipped.map((i) => [i.exercise.name, i.sets, i.reps])).toEqual([["Bent Over Row (Barbell)", 3, 10]]);
    expect(update?.changed.map((c) => [c.exercise.name, c.from.sets, c.to.sets])).toEqual([["Bench Press (Barbell)", 4, 2]]);
    expect(update?.unchanged).toBe(1);
  });

  it("has nothing to preview without a template or a session", async () => {
    await store.putGymSession({ id: "s2", day: "2026-11-02", startTs: NOW, endTs: null, name: "Workout", notes: null, routineId: null, finished: false, restStartedTs: null, restSec: null });
    expect(await getGymRoutineUpdate(ctx(), "s2")).toBeNull();
    expect(await getGymRoutineUpdate(ctx(), "gone")).toBeNull();
  });
});
