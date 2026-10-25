import { PAUSE_EVERY, type Steps } from "@/lib/yield";

export const MIN_EXERCISE_SEC = 2 * 60;

type ExerciseRecord = {
  metadata?: { id?: string; dataOrigin?: string };
  startTime: string;
  endTime: string;
  exerciseType: number;
  title?: string;
};

/** Cross-source copies need matching sports and nearly identical intervals; containment alone is ambiguous. */
export function* uniqueExercises<T extends ExerciseRecord>(records: readonly T[]): Steps<T[]> {
  const ranked = records.map((record) => {
    const start = Date.parse(record.startTime);
    const end = Date.parse(record.endTime);
    return { record, start, end, eligible: Math.floor(end / 1000) - Math.floor(start / 1000) >= MIN_EXERCISE_SEC };
  });
  ranked.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) ||
    Number(!!b.record.title?.trim()) - Number(!!a.record.title?.trim()) ||
    (b.end - b.start) - (a.end - a.start) ||
    (a.record.metadata?.dataOrigin ?? "").localeCompare(b.record.metadata?.dataOrigin ?? "") ||
    (a.record.metadata?.id ?? "").localeCompare(b.record.metadata?.id ?? ""),
  );
  const kept: typeof ranked = [];
  let comparisons = 0;
  for (const candidate of ranked) {
    if (++comparisons % PAUSE_EVERY === 0) yield;
    const source = candidate.record.metadata?.dataOrigin?.trim();
    let duplicate = false;
    if (source) for (const other of kept) {
      if (++comparisons % PAUSE_EVERY === 0) yield;
      const otherSource = other.record.metadata?.dataOrigin?.trim();
      if (!otherSource || source === otherSource || candidate.record.exerciseType !== other.record.exerciseType) continue;
      const duration = Math.max(candidate.end - candidate.start, other.end - other.start);
      const overlap = Math.min(candidate.end, other.end) - Math.max(candidate.start, other.start);
      if (duration > 0 && Math.abs(candidate.start - other.start) <= 60_000 && Math.abs(candidate.end - other.end) <= 60_000 && overlap / duration >= 0.9) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start).map(({ record }) => record);
}
