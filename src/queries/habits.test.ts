import { describe, expect, it } from "vitest";
import type { Habit } from "@/core/habits/types";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import type { QueryCtx } from "./ctx";
import { getHabits, habitCards } from "./habits";

const TODAY = "2026-11-12";
const PROFILE = { birthDate: "1990-01-01", sex: "male" as const, maxHr: null, heightCm: null, timeZone: "UTC" };
const habit: Habit = {
  id: "h1",
  name: "Read",
  question: null,
  notes: null,
  kind: "yes_no",
  color: "optimal",
  period: "day",
  intervalDays: 1,
  weekdaysOnly: false,
  startDay: "2026-01-01",
  target: 1,
  targetType: "at_least",
  unit: null,
  position: 0,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};

describe("the habits list's day grid", () => {
  it("returns the requested days newest first, today's tick included", () => {
    const [card] = habitCards([habit], [{ habitId: "h1", day: TODAY, value: 1, skip: false, note: null, updatedAt: 0 }], TODAY, 30);
    expect(card.days).toHaveLength(30);
    expect(card.days[0]).toMatchObject({ day: TODAY, state: { state: "done" } });
    expect(card.days[29].day).toBe("2026-10-14");
    expect(habitCards([habit], [], TODAY)[0].days).toHaveLength(7);
  });
});

describe("the habits table's Activity row", () => {
  it("puts the month's workouts in one row: each day's kinds once, strength types merged, oldest session first", async () => {
    const store: Store = openMemoryStore();
    const exercise = (id: string, day: string, type: string, startTs: number) => ({ id, day, startTs, endTs: startTs + 60, type, name: null, calories: null, distanceM: null });
    await store.upsertExercises([
      exercise("e1", TODAY, "BADMINTON", 10),
      exercise("e2", "2026-11-11", "WEIGHTLIFTING", 30),
      exercise("e3", "2026-11-11", "WALKING", 10),
      exercise("e5", "2026-11-11", "STRENGTH_TRAINING", 50),
      exercise("e4", "2026-10-01", "ELLIPTICAL", 10),
    ]);
    const now = Date.parse(`${TODAY}T09:00:00Z`) / 1000;
    const ctx: QueryCtx = { store, profile: PROFILE, timeZone: "UTC", today: TODAY, now, sync: { lastSyncTs: null, firstDay: null, lastError: null } };
    const vm = await getHabits(ctx);
    expect(vm.days).toHaveLength(30);
    expect(vm.days[0]).toBe(TODAY);
    expect(Object.keys(vm.activity).sort()).toEqual(["2026-11-11", TODAY].sort());
    expect(vm.activity[TODAY].kinds).toEqual(["racket"]);
    expect(vm.activity["2026-11-11"].kinds).toEqual(["walk", "strength"]);
    expect(vm.activity["2026-11-11"].items.map((i) => i.id)).toEqual(["e3", "e2", "e5"]);
    // 2026-11-12 is a Thursday: the 11th and the 12th are this week, 1 October is not.
    expect(vm.activityWeek).toBe(2);
  });
});
