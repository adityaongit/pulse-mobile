// Home's gym card: the next template of the owner's split is the suggestion, a session still running wins over it,
// and a template left unused for over a month is not guessed.
import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import type { QueryCtx } from "./ctx";
import { getHomeGym } from "./homeGym";
import { getGymHome } from "./gym";

const NOW = Date.parse("2026-11-02T09:00:00Z") / 1000;
const DAY = 86_400;
const PROFILE = { birthDate: "1990-01-01", sex: "male" as const, maxHr: null, heightCm: null, timeZone: "UTC" };
let store: Store;
const ctx = (): QueryCtx => ({ store, profile: PROFILE, timeZone: "UTC", today: "2026-11-02", now: NOW, sync: { lastSyncTs: null, firstDay: null, lastError: null } });

async function routine(id: string, name: string, exercises: string[]) {
  await store.putGymRoutine({ id, name, notes: null, position: 0, updatedAt: NOW }, exercises.map((exerciseId, position) => ({ routineId: id, exerciseId, position, sets: 3, reps: 8, restSec: null, note: null })));
}

async function session(id: string, routineId: string | null, daysAgo: number, finished = true) {
  const startTs = NOW - daysAgo * DAY;
  await store.putGymSession({ id, day: new Date(startTs * 1000).toISOString().slice(0, 10), startTs, endTs: finished ? startTs + 3000 : null, name: id, notes: null, routineId, finished, restStartedTs: null, restSec: null });
}

beforeEach(async () => {
  store = openMemoryStore();
  await routine("push", "Push", ["bench-press-barbell", "bench-press-barbell", "lat-pulldown-cable"]);
  await routine("pull", "Pull", ["lat-pulldown-cable"]);
  await routine("legs", "Legs", ["squat-barbell"]);
});

describe("getHomeGym", () => {
  it("follows push → pull → legs after the last split workout", async () => {
    await session("old-legs", "legs", 40);
    await session("push", "push", 12);
    await session("pull", "pull", 2);
    expect(await getHomeGym(ctx())).toEqual({
      active: null,
      doneToday: null,
      suggested: { routineId: "legs", name: "Legs", exercises: 1, lastTs: NOW - 40 * DAY },
    });
  });

  it("suggests Pull after Push even when Pull was last done weeks ago", async () => {
    await session("pull", "pull", 19);
    await session("legs", "legs", 3);
    await session("push", "push", 2);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "pull", lastTs: NOW - 19 * DAY });
  });

  it("wraps from legs back to push, matching names like \"Leg + arms\"", async () => {
    await routine("legs2", "Leg + arms", ["squat-barbell"]);
    await store.deleteGymRoutine("legs");
    await session("push", "push", 3);
    await session("legs2", "legs2", 1);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "push" });
  });

  it("ignores a non-split workout in between", async () => {
    await routine("cardio", "Cardio", ["running"]);
    await session("push", "push", 3);
    await session("cardio", "cardio", 1);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "pull" });
  });

  it("without a named split, suggests the template left longest this month", async () => {
    await store.deleteGymRoutine("push");
    await store.deleteGymRoutine("pull");
    await store.deleteGymRoutine("legs");
    await routine("a", "Day A", ["squat-barbell"]);
    await routine("b", "Day B", ["squat-barbell"]);
    await routine("c", "Day C", ["squat-barbell"]);
    await session("a", "a", 5);
    await session("b", "b", 3);
    await session("c", "c", 1);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "a" });
  });

  it("counts each exercise once in the suggestion", async () => {
    await session("legs", "legs", 1);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "push", name: "Push", exercises: 2, lastTs: null });
  });

  it("has no suggestion when the last template use is over a month old", async () => {
    await session("legs", "legs", 31);
    expect(await getHomeGym(ctx())).toEqual({ active: null, doneToday: null, suggested: null });
  });

  it("skips a deleted template", async () => {
    await session("gone", "gone", 1);
    await session("push", "push", 5);
    expect((await getHomeGym(ctx())).suggested).toMatchObject({ routineId: "pull", name: "Pull" });
  });

  it("reports the workout still running", async () => {
    await session("now", "pull", 0, false);
    expect(await getHomeGym(ctx())).toEqual({ active: { sessionId: "now", name: "now", startTs: NOW, done: 0, total: 0 }, doneToday: null, suggested: null });
  });

  it("does not suggest the template again after a workout today", async () => {
    await session("today", "legs", 0);
    expect(await getHomeGym(ctx())).toEqual({ active: null, doneToday: { sessionId: "today", name: "today", endTs: NOW + 3000, seconds: 3000, sets: 0 }, suggested: null });
  });

  it("lists the gym tab's templates in the saved order, the split's next one first", async () => {
    await store.putGymRoutine({ id: "legs", name: "Legs", notes: null, position: 0, updatedAt: NOW }, []);
    await store.putGymRoutine({ id: "push", name: "Push", notes: null, position: 1, updatedAt: NOW }, []);
    await store.putGymRoutine({ id: "pull", name: "Pull", notes: null, position: 2, updatedAt: NOW }, []);
    await session("push", "push", 2);
    await session("legs", "legs", 3);
    const vm = await getGymHome(ctx());
    expect(vm.nextId).toBe("pull");
    expect(vm.routines.map((c) => c.routine.id)).toEqual(["pull", "legs", "push"]);
  });
});
