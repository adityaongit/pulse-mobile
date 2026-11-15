import { describe, expect, it } from "vitest";
import { planDiff, planItemsOf } from "./plan";
import type { GymSet } from "./types";

const set = (o: Partial<GymSet> & { id: string }): GymSet => ({
  sessionId: "s1",
  exerciseId: "bench-press-barbell",
  position: 0,
  setNo: 1,
  weightKg: 60,
  reps: 8,
  seconds: null,
  distanceM: null,
  rpe: null,
  type: "normal",
  supersetId: null,
  completed: true,
  ts: 1000,
  note: null,
  ...o,
});

describe("a workout as template rows", () => {
  it("keeps each exercise's set count and its most common reps, in the order trained", () => {
    const items = planItemsOf([
      set({ id: "1", exerciseId: "squat-barbell", position: 1, reps: 5 }),
      set({ id: "2", position: 0, reps: 8 }),
      set({ id: "3", position: 0, setNo: 2, reps: 10 }),
      set({ id: "4", position: 0, setNo: 3, reps: 10 }),
    ]);
    expect(items).toEqual([
      { exerciseId: "bench-press-barbell", sets: 3, reps: 10 },
      { exerciseId: "squat-barbell", sets: 1, reps: 5 },
    ]);
  });

  it("keeps within the template's bounds", () => {
    const many = Array.from({ length: 22 }, (_, i) => set({ id: String(i), setNo: i + 1, reps: 200 }));
    expect(planItemsOf(many)).toEqual([{ exerciseId: "bench-press-barbell", sets: 20, reps: 100 }]);
  });
});

describe("a template update", () => {
  it("says what is added, removed, changed and kept", () => {
    const diff = planDiff(
      [
        { exerciseId: "bench", sets: 4, reps: 8 },
        { exerciseId: "row", sets: 3, reps: 10 },
        { exerciseId: "squat", sets: 5, reps: 5 },
      ],
      [
        { exerciseId: "bench", sets: 4, reps: 10 },
        { exerciseId: "row", sets: 3, reps: 10 },
        { exerciseId: "press", sets: 3, reps: 12 },
      ],
    );
    expect(diff.added.map((i) => i.exerciseId)).toEqual(["press"]);
    expect(diff.removed.map((i) => i.exerciseId)).toEqual(["squat"]);
    expect(diff.changed.map((c) => [c.from, c.to])).toEqual([
      [
        { exerciseId: "bench", sets: 4, reps: 8 },
        { exerciseId: "bench", sets: 4, reps: 10 },
      ],
    ]);
    expect(diff.unchanged).toBe(1);
  });

  it("is empty when the shape did not move", () => {
    const items = [{ exerciseId: "bench", sets: 4, reps: 8 }];
    expect(planDiff(items, items)).toEqual({ added: [], removed: [], changed: [], unchanged: 1 });
  });
});
