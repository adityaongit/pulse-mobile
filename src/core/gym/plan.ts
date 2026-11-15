// A template's shape: which exercises, how many sets and which reps to plan. Built from a workout's working sets and
// compared with the template's rows, so an update can show what it changes before it writes.
import { groupByExercise } from "./stats";
import type { GymSet } from "./types";

export type PlanItem = { exerciseId: string; sets: number; reps: number };

/** A workout's working sets as template rows: one per exercise, its set count and its most common reps. */
export function planItemsOf(sets: readonly GymSet[]): PlanItem[] {
  return groupByExercise(sets)
    .map((g) => {
      const counts = new Map<number, number>();
      for (const s of g.sets) counts.set(s.reps, (counts.get(s.reps) ?? 0) + 1);
      const reps = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
      // The template's own bounds, so a preview promises exactly what saveRoutine writes.
      return { exerciseId: g.exerciseId, sets: Math.min(20, g.sets.length), reps: Math.min(100, Math.max(0, reps)) };
    })
    .filter((i) => i.exerciseId);
}

export type PlanDiff = {
  added: PlanItem[];
  removed: PlanItem[];
  changed: { from: PlanItem; to: PlanItem }[];
  unchanged: number;
};

/** What turning `current` into `next` changes, matched by exercise: added, removed, and set/reps changes. */
export function planDiff(current: readonly PlanItem[], next: readonly PlanItem[]): PlanDiff {
  const before = new Map(current.map((i) => [i.exerciseId, i]));
  const after = new Map(next.map((i) => [i.exerciseId, i]));
  const diff: PlanDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const item of next) {
    const old = before.get(item.exerciseId);
    if (!old) diff.added.push(item);
    else if (old.sets !== item.sets || old.reps !== item.reps) diff.changed.push({ from: old, to: item });
    else diff.unchanged++;
  }
  for (const item of current) if (!after.has(item.exerciseId)) diff.removed.push(item);
  return diff;
}
